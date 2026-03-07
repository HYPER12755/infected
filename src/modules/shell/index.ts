import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'; // Adapted SDK import
import type { ServerRequest, ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { Module, InfectedConfig, ManagerInstances } from '../../types/index.js'; // Our core types, include ManagerInstances
import { ExecutionInfo } from '../../types/shell-server/index.js'; // Adapted to shell-server types
import logger from '../../core/logger.js';
import { ShellTools } from './shell-tools.js'; // Adapted import
import { MCPShellError, ResourceNotFoundError } from '../../utils/shell-errors.js'; // Adapted custom errors
import {
  ShellExecuteParamsSchema,
  ShellExecuteParamsInputSchema,
  ShellGetExecutionParamsSchema,
  ProcessListParamsSchema,
  ProcessKillParamsSchema,
  ShellSetDefaultWorkdirParamsSchema,
  TerminalListParamsSchema,
  TerminalGetParamsSchema,
  TerminalCloseParamsSchema,
  CleanupSuggestionsParamsSchema,
  AutoCleanupParamsSchema,
  FileListParamsSchema,
  FileReadParamsSchema,
  FileDeleteParamsSchema,
  CommandHistoryQueryParamsSchema,
} from '../../types/shell-server/schemas.js';
import { TerminalOperateParamsInputSchema, TerminalOperateParamsSchema } from '../../types/shell-server/quick-schemas.js';

type ToolRequestExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

const PREVIEW_LIMIT = 6000;

function asRecord(value: unknown): Record<string, unknown> {
  return (value && typeof value === 'object') ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toCompactPreview(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  const json = JSON.stringify(value);
  if (!json) {
    return '';
  }
  return json.length > PREVIEW_LIMIT ? `${json.slice(0, PREVIEW_LIMIT)}\n...(truncated)` : json;
}

function sanitizeTerminalText(raw: string): string {
  let text = raw
    .replace(/\\u001b/gi, '\x1B')
    .replace(/\\x1b/gi, '\x1B')
    .replace(/\\u0007/gi, '\x07')
    .replace(/\\x07/gi, '\x07');

  // OSC: ESC ] ... BEL or ST
  text = text.replace(/\x1B\][\s\S]*?(?:\x07|\x1B\\)/g, '');
  // DCS/PM/APC: ESC P/^/_ ... ST
  text = text.replace(/\x1B[PX^_][\s\S]*?\x1B\\/g, '');
  // CSI sequences
  text = text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
  // 2-byte ESC sequences
  text = text.replace(/\x1B[@-Z\\-_]/g, '');
  // Remaining control characters except tab/newline.
  text = text.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '');

  // Normalize whitespace without losing meaningful line breaks.
  text = text.replace(/\r/g, '');
  text = text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line, index, arr) => !(line === '' && arr[index - 1] === ''))
    .join('\n');
  return text.trim();
}

function formatExecutionText(result: unknown): string {
  const data = asRecord(result);
  const lines: string[] = [];
  const executionId = asString(data['execution_id']);
  const status = asString(data['status']);
  const exitCode = asNumber(data['exit_code']);
  const pid = asNumber(data['process_id']);
  const duration = asNumber(data['execution_time_ms']);
  const workingDirectory = asString(data['working_directory']);
  const stdout = asString(data['stdout']) || '';
  const stderr = asString(data['stderr']) || '';
  const message = asString(data['message']);
  const outputId = asString(data['output_id']);
  const outputTruncated = data['output_truncated'] === true;

  if (executionId) lines.push(`execution_id: ${executionId}`);
  if (status) lines.push(`status: ${status}`);
  if (pid) lines.push(`process_id: ${pid}`);
  if (exitCode !== undefined) lines.push(`exit_code: ${exitCode}`);
  if (duration !== undefined) lines.push(`execution_time_ms: ${duration}`);
  if (workingDirectory) lines.push(`working_directory: ${workingDirectory}`);
  if (outputId) lines.push(`output_id: ${outputId}`);
  if (outputTruncated) lines.push('output_truncated: true');
  if (message) lines.push(`message: ${message}`);

  if (stdout) {
    lines.push('', 'stdout:', stdout);
  }
  if (stderr) {
    lines.push('', 'stderr:', stderr);
  }

  if (!stdout && !stderr && status && status !== 'completed') {
    lines.push('', 'No immediate output available yet.');
  }

  return lines.join('\n');
}

function formatProcessListText(result: unknown): string {
  const data = asRecord(result);
  const executions = asArray(data['executions']);
  const processes = executions.length > 0 ? executions : asArray(data['processes']);
  const total = asNumber(data['total']) ?? processes.length;

  const lines: string[] = [`count: ${processes.length}`, `total: ${total}`];
  for (const entry of processes.slice(0, 20)) {
    const item = asRecord(entry);
    const id = asString(item['execution_id']) || asString(item['id']) || 'unknown';
    const pid = asNumber(item['process_id']);
    const status = asString(item['status']) || 'unknown';
    const command = (asString(item['command']) || '').replace(/\s+/g, ' ').trim();
    const preview = command.length > 60 ? `${command.slice(0, 57)}...` : command;
    const pidStr = pid ? `pid:${pid}` : '';
    lines.push(`${id} | ${status}${pidStr ? ` | ${pidStr}` : ''}${preview ? ` | ${preview}` : ''}`);
  }

  if (processes.length > 20) {
    lines.push(`...and ${processes.length - 20} more`);
  }

  return lines.join('\n');
}

function formatListExecutionOutputsText(result: unknown): string {
  const data = asRecord(result);
  const files = asArray(data['files']);
  const totalCount = asNumber(data['total_count']) ?? files.length;
  const lines: string[] = [`files: ${files.length}`, `total_count: ${totalCount}`];

  for (const entry of files.slice(0, 20)) {
    const file = asRecord(entry);
    const outputId = asString(file['output_id']) || 'unknown';
    const outputType = asString(file['output_type']) || 'unknown';
    const size = asNumber(file['size']);
    const executionId = asString(file['execution_id']) || 'unknown';
    const name = asString(file['name']) || '';
    lines.push(
      `${outputId} | ${outputType} | ${size ?? 0}B | exec:${executionId}${name ? ` | ${name}` : ''}`
    );
  }

  if (files.length > 20) {
    lines.push(`...and ${files.length - 20} more`);
  }

  return lines.join('\n');
}

function formatTerminalListText(result: unknown): string {
  const data = asRecord(result);
  const terminals = asArray(data['terminals']);
  const total = asNumber(data['total']) ?? terminals.length;
  const lines: string[] = [`terminals: ${terminals.length}`, `total: ${total}`];

  for (const entry of terminals.slice(0, 20)) {
    const terminal = asRecord(entry);
    const terminalId = asString(terminal['terminal_id']) || 'unknown';
    const status = asString(terminal['status']) || 'unknown';
    const shellType = asString(terminal['shell_type']) || '';
    const sessionName = asString(terminal['session_name']) || '';
    lines.push(
      `${terminalId} | ${status}${shellType ? ` | shell:${shellType}` : ''}${sessionName ? ` | session:${sessionName}` : ''}`
    );
  }

  if (terminals.length > 20) {
    lines.push(`...and ${terminals.length - 20} more`);
  }

  return lines.join('\n');
}

function formatTerminalInfoText(result: unknown): string {
  const data = asRecord(result);
  const terminalId = asString(data['terminal_id']) || 'unknown';
  const status = asString(data['status']) || 'unknown';
  const shellType = asString(data['shell_type']) || 'unknown';
  const sessionName = asString(data['session_name']) || '';
  const lastActivity = asString(data['last_activity']) || '';
  const lines = [
    `terminal_id: ${terminalId}`,
    `status: ${status}`,
    `shell_type: ${shellType}`,
  ];
  if (sessionName) lines.push(`session_name: ${sessionName}`);
  if (lastActivity) lines.push(`last_activity: ${lastActivity}`);
  return lines.join('\n');
}

function formatTerminalOperateText(result: unknown): string {
  const data = asRecord(result);
  const terminalId = asString(data['terminal_id']) || 'unknown';
  const sessionId = asString(data['session_id']);
  const success = data['success'] === true;
  const inputRejected = data['input_rejected'] === true;
  const reason = asString(data['reason']);
  const outputRaw = asString(data['output']) || '';
  const shouldStripAnsi = data['strip_ansi'] !== false;
  const output = shouldStripAnsi ? sanitizeTerminalText(outputRaw) : outputRaw;
  const outputInfo = asRecord(data['output_info']);
  const hasMore = outputInfo['has_more'] === true;
  const lineCount = asNumber(outputInfo['line_count']);
  const processId = asNumber(data['process_id']);

  const lines: string[] = [`terminal_id: ${terminalId}`, `success: ${success}`];
  if (sessionId) lines.push(`session_id: ${sessionId}`);
  if (processId) lines.push(`process_id: ${processId}`);
  lines.push(`strip_ansi: ${shouldStripAnsi}`);
  if (inputRejected) lines.push('input_rejected: true');
  if (reason) lines.push(`reason: ${reason}`);
  if (lineCount !== undefined) lines.push(`line_count: ${lineCount}`);
  if (outputInfo && Object.keys(outputInfo).length > 0) lines.push(`has_more: ${hasMore}`);
  if (output) lines.push('', 'output:', output);
  return lines.join('\n');
}

function formatTerminalCloseText(result: unknown): string {
  const data = asRecord(result);
  const terminalId = asString(data['terminal_id']) || 'unknown';
  const success = data['success'] === true;
  const message = asString(data['message']) || '';
  const closedAt = asString(data['closed_at']) || asString(data['timestamp']) || '';
  const lines = [`terminal_id: ${terminalId}`, `success: ${success}`];
  if (message) lines.push(`message: ${message}`);
  if (closedAt) lines.push(`closed_at: ${closedAt}`);
  return lines.join('\n');
}

function formatCommandHistoryText(result: unknown): string {
  const data = asRecord(result);
  if (data['success'] === false) {
    return `success: false\nerror: ${asString(data['error']) || 'unknown error'}`;
  }

  const entry = asRecord(data['entry']);
  if (Object.keys(entry).length > 0) {
    return [
      'success: true',
      `entry_id: ${asString(entry['execution_id']) || 'unknown'}`,
      `command: ${asString(entry['command']) || ''}`,
      `timestamp: ${asString(entry['timestamp']) || ''}`,
      `executed: ${entry['was_executed'] === true}`,
    ].join('\n');
  }

  const analytics = asRecord(data['analytics']);
  if (Object.keys(analytics).length > 0) {
    return toCompactPreview({ success: true, analytics });
  }

  const entries = asArray(data['entries']);
  const pagination = asRecord(data['pagination']);
  const page = asNumber(pagination['page']) ?? 1;
  const totalEntries = asNumber(pagination['total_entries']) ?? entries.length;
  const lines: string[] = [`success: true`, `entries: ${entries.length}`, `total_entries: ${totalEntries}`, `page: ${page}`];

  for (const entryItem of entries.slice(0, 20)) {
    const item = asRecord(entryItem);
    const executionId = asString(item['execution_id']) || 'unknown';
    const command = (asString(item['command']) || '').replace(/\s+/g, ' ').trim();
    const timestamp = asString(item['timestamp']) || '';
    lines.push(`${executionId} | ${timestamp}${command ? ` | ${command}` : ''}`);
  }

  if (entries.length > 20) {
    lines.push(`...and ${entries.length - 20} more`);
  }

  return lines.join('\n');
}

function formatShellToolText(toolName: string, result: unknown): string {
  if (toolName === 'shell_execute' || toolName === 'process_get_execution') {
    return formatExecutionText(result);
  }
  if (toolName === 'process_list_executions') {
    return formatProcessListText(result);
  }
  if (toolName === 'list_execution_outputs') {
    return formatListExecutionOutputsText(result);
  }
  if (toolName === 'terminal_list') {
    return formatTerminalListText(result);
  }
  if (toolName === 'terminal_get_info') {
    return formatTerminalInfoText(result);
  }
  if (toolName === 'terminal_operate') {
    return formatTerminalOperateText(result);
  }
  if (toolName === 'terminal_close') {
    return formatTerminalCloseText(result);
  }
  if (toolName === 'command_history_query') {
    return formatCommandHistoryText(result);
  }
  if (toolName === 'read_execution_output') {
    const data = asRecord(result);
    const output =
      asString(data['content']) ||
      asString(data['output']) ||
      asString(data['stdout']) ||
      asString(data['stderr']);
    if (output) {
      return output;
    }
  }
  const preview = toCompactPreview(result);
  return preview || '(no output)';
}

export class ShellModule implements Module {
  name = 'shell';
  private shellTools!: ShellTools;
  private serverInstance!: McpServer; // To store the McpServer instance for notifications
  private deregisterFunctions: any[] = []; // Store SDK tool handles/deregister functions

  async register(
    server: McpServer, 
    config: InfectedConfig,
    managers: ManagerInstances
  ): Promise<void> {
    this.serverInstance = server;

    this.shellTools = new ShellTools(
      managers.processManager,
      managers.terminalManager,
      managers.fileManager,
      managers.monitoringManager,
      managers.securityManager,
      managers.commandHistoryManager
    );

    managers.processManager.setBackgroundProcessCallbacks({
      onComplete: async (executionId, executionInfo) => {
        const message = `✅ Command '${executionInfo.command.substring(0, 50)}...' completed. ID: ${executionId}`;
        await this.serverInstance.server.notification({
          method: 'notifications/message',
          params: { level: 'info', data: message, execution_id: executionId, status: 'completed' },
        });
      },
      onError: async (executionId, executionInfo, error) => {
        const message = `❌ Command '${executionInfo.command.substring(0, 50)}...' failed. ID: ${executionId}`;
        await this.serverInstance.server.notification({
          method: 'notifications/message',
          params: { level: 'error', data: message, execution_id: executionId, status: 'failed', error: String(error) },
        });
      },
      onTimeout: async (executionId, executionInfo) => {
        const message = `⏰ Command '${executionInfo.command.substring(0, 50)}...' timed out. ID: ${executionId}`;
        await this.serverInstance.server.notification({
          method: 'notifications/message',
          params: { level: 'warn', data: message, execution_id: executionId, status: 'timeout' },
        });
      },
      onOutputData: async (executionId, data, isStderr) => {
        await this.serverInstance.server.notification({
          method: 'notifications/progress', // Use progress notification for streaming output
          params: {
            execution_id: executionId,
            type: isStderr ? 'stderr' : 'stdout',
            data: data,
          },
        });
      },
    });

    this.deregisterFunctions.push(server.registerTool(
      'shell_execute',
      {
        title: 'Shell Execute',
        description: 'Executes a shell command on the host system with enhanced real-time output and execution control.',
        inputSchema: ShellExecuteParamsInputSchema.shape,
      },
      async (rawArgs: unknown, _extra: ToolRequestExtra) => {
        const args = ShellExecuteParamsSchema.parse(rawArgs);
        const allowlist = config.shell?.allowlist;
        const commandExecutable = args.command.trim().split(' ')[0];

        if (allowlist && allowlist.length > 0 && !allowlist.includes(commandExecutable)) {
          logger.warn(`Attempted to execute disallowed command: ${commandExecutable}`);
          return {
            content: [{ type: 'text', text: `Error: Command '${commandExecutable}' is not allowed by the server's allowlist.` }],
            structuredContent: { error: `Command '${commandExecutable}' is not allowed.` },
            isError: true,
          };
        }

        try {
          const executionInfo = await this.shellTools.executeShell(args);
          logger.info(`shell_execute command completed. ID: ${executionInfo.execution_id}, Status: ${executionInfo.status}`);
          const text = formatShellToolText('shell_execute', executionInfo);
          return {
            content: [{ type: 'text', text }],
            structuredContent: executionInfo,
          };
        } catch (error) {
          if (error instanceof MCPShellError) {
            logger.error(`shell_execute failed: ${error.message}`, { details: error.details });
            return {
              content: [{ type: 'text', text: `Error: ${error.message}` }],
              structuredContent: { error: error.message, details: error.details },
              isError: true,
            };
          }
          logger.error(`An unexpected error occurred during shell_execute: ${error}`);
          return {
            content: [{ type: 'text', text: `Error: An unexpected error occurred: ${error instanceof Error ? error.message : String(error)}` }],
            structuredContent: { error: `An unexpected error occurred: ${error instanceof Error ? error.message : String(error)}` },
            isError: true,
          };
        }
      },
    ));
    logger.info('  ShellModule: shell_execute tool registered.');

    this.deregisterFunctions.push(server.registerTool(
      'process_get_execution',
      {
        title: 'Get Execution Details',
        description: 'Retrieves detailed information about a specific command execution.',
        inputSchema: ShellGetExecutionParamsSchema.shape,
      },
      async (rawArgs: unknown, _extra: ToolRequestExtra) => {
        const args = ShellGetExecutionParamsSchema.parse(rawArgs);
        const executionInfo = await this.shellTools.getExecution({
          execution_id: args.execution_id,
        });
        if (!executionInfo) {
          throw new ResourceNotFoundError('execution', args.execution_id);
        }
        const structuredContent = executionInfo as unknown as Record<string, unknown>;
        const text = formatShellToolText('process_get_execution', executionInfo);
        return {
          content: [{ type: 'text', text }],
          structuredContent,
        };
      }
    ));
    logger.info('  ShellModule: process_get_execution tool registered.');

    this.deregisterFunctions.push(server.registerTool(
      'process_list_executions',
      {
        title: 'List Command Executions',
        description: 'Lists active and completed command executions with filtering and pagination.',
        inputSchema: ProcessListParamsSchema.shape,
      },
      async (rawArgs: unknown, _extra: ToolRequestExtra) => {
        const args = ProcessListParamsSchema.parse(rawArgs);
        const statusFilter = args.status_filter === 'all' ? undefined : args.status_filter;
        const result = await this.shellTools.listProcesses({
          status_filter: statusFilter,
          command_pattern: args.command_pattern,
          limit: args.limit,
          offset: args.offset,
          session_id: args.session_id,
        });
        const structuredContent = result as unknown as Record<string, unknown>;
        const text = formatShellToolText('process_list_executions', result);
        return {
          content: [{ type: 'text', text }],
          structuredContent,
        };
      }
    ));
    logger.info('  ShellModule: process_list_executions tool registered.');

    this.deregisterFunctions.push(server.registerTool(
      'process_kill',
      {
        title: 'Kill Process',
        description: 'Sends a signal to terminate a running process by its process ID.',
        inputSchema: ProcessKillParamsSchema.shape,
      },
      async (rawArgs: unknown, _extra: ToolRequestExtra) => {
        const args = ProcessKillParamsSchema.parse(rawArgs);
        const result = await this.shellTools.killProcess({
          process_id: args.process_id,
          signal: args.signal,
          force: args.force,
        });
        const text = formatShellToolText('process_kill', result);
        return {
          content: [{ type: 'text', text }],
          structuredContent: result,
        };
      }
    ));
    logger.info('  ShellModule: process_kill tool registered.');

    this.deregisterFunctions.push(server.registerTool(
      'shell_set_default_workdir',
      {
        title: 'Set Default Working Directory',
        description: 'Sets the default working directory for subsequent shell commands.',
        inputSchema: ShellSetDefaultWorkdirParamsSchema.shape,
      },
      async (rawArgs: unknown, _extra: ToolRequestExtra) => {
        const args = ShellSetDefaultWorkdirParamsSchema.parse(rawArgs);
        const result = await this.shellTools.setDefaultWorkingDirectory({
          working_directory: args.working_directory,
        });
        const text = formatShellToolText('shell_set_default_workdir', result);
        return {
          content: [{ type: 'text', text }],
          structuredContent: result,
        };
      }
    ));
    logger.info('  ShellModule: shell_set_default_workdir tool registered.');

    // ===============================================
    // Terminal Management Tools
    // ===============================================

    // Unified Terminal Operations (create + send + get output)
    this.deregisterFunctions.push(server.registerTool(
      'terminal_operate',
      {
        title: 'Terminal Operate',
        description: 'Unified terminal operations: create sessions, send input, get output with automatic position tracking. Combines terminal_create, terminal_send_input, and terminal_get_output into a single streamlined interface. USE THIS for interactive sessions like "apt upgrade" that ask for yes/no.',
        inputSchema: TerminalOperateParamsInputSchema.shape,
      },
      async (rawArgs: unknown, _extra: ToolRequestExtra) => {
        const args = TerminalOperateParamsSchema.parse(rawArgs);
        const result = await this.shellTools.terminalOperate(args);
        const structuredContent = result as unknown as Record<string, unknown>;
        const text = formatShellToolText('terminal_operate', result);
        return {
          content: [{ type: 'text' as const, text }],
          structuredContent,
        };
      }
    ));
    logger.info('  ShellModule: terminal_operate tool registered.');

    // List terminal sessions
    this.deregisterFunctions.push(server.registerTool(
      'terminal_list',
      {
        title: 'List Terminal Sessions',
        description: 'Lists all active terminal sessions with their IDs, status, and metadata.',
        inputSchema: TerminalListParamsSchema,
      },
      async (rawArgs: unknown, _extra: ToolRequestExtra) => {
        const args = TerminalListParamsSchema.parse(rawArgs);
        const result = await this.shellTools.listTerminals(args);
        const text = formatShellToolText('terminal_list', result);
        return {
          content: [{ type: 'text', text }],
          structuredContent: result,
        };
      }
    ));
    logger.info('  ShellModule: terminal_list tool registered.');

    // Get terminal info
    this.deregisterFunctions.push(server.registerTool(
      'terminal_get_info',
      {
        title: 'Get Terminal Info',
        description: 'Get detailed information about a specific terminal session.',
        inputSchema: TerminalGetParamsSchema,
      },
      async (rawArgs: unknown, _extra: ToolRequestExtra) => {
        const args = TerminalGetParamsSchema.parse(rawArgs);
        const result = await this.shellTools.getTerminal(args);
        const structuredContent = result as unknown as Record<string, unknown>;
        const text = formatShellToolText('terminal_get_info', result);
        return {
          content: [{ type: 'text' as const, text }],
          structuredContent,
        };
      }
    ));
    logger.info('  ShellModule: terminal_get_info tool registered.');

    // Close terminal
    this.deregisterFunctions.push(server.registerTool(
      'terminal_close',
      {
        title: 'Close Terminal',
        description: 'Closes an active terminal session.',
        inputSchema: TerminalCloseParamsSchema,
      },
      async (rawArgs: unknown, _extra: ToolRequestExtra) => {
        const args = TerminalCloseParamsSchema.parse(rawArgs);
        const result = await this.shellTools.closeTerminal(args);
        const text = formatShellToolText('terminal_close', result);
        return {
          content: [{ type: 'text', text }],
          structuredContent: result,
        };
      }
    ));
    logger.info('  ShellModule: terminal_close tool registered.');

    // ===============================================
    // File Management & Cleanup Tools
    // ===============================================

    // List execution outputs
    this.deregisterFunctions.push(server.registerTool(
      'list_execution_outputs',
      {
        title: 'List Execution Outputs',
        description: 'Lists all output files generated by command executions.',
        inputSchema: FileListParamsSchema,
      },
      async (rawArgs: unknown, _extra: ToolRequestExtra) => {
        const args = FileListParamsSchema.parse(rawArgs);
        const result = await this.shellTools.listFiles(args);
        const structuredContent = result as unknown as Record<string, unknown>;
        const text = formatShellToolText('list_execution_outputs', result);
        return {
          content: [{ type: 'text' as const, text }],
          structuredContent,
        };
      }
    ));
    logger.info('  ShellModule: list_execution_outputs tool registered.');

    // Read execution output
    this.deregisterFunctions.push(server.registerTool(
      'read_execution_output',
      {
        title: 'Read Execution Output',
        description: 'Reads a specific execution output file by output_id.',
        inputSchema: FileReadParamsSchema.shape,
      },
      async (rawArgs: unknown, _extra: ToolRequestExtra) => {
        const args = FileReadParamsSchema.parse(rawArgs);
        const result = await this.shellTools.readFile(args);
        const structuredContent = result as unknown as Record<string, unknown>;
        const text = formatShellToolText('read_execution_output', result);
        return {
          content: [{ type: 'text' as const, text }],
          structuredContent,
        };
      }
    ));
    logger.info('  ShellModule: read_execution_output tool registered.');

    // Delete execution outputs
    this.deregisterFunctions.push(server.registerTool(
      'delete_execution_outputs',
      {
        title: 'Delete Execution Outputs',
        description: 'Deletes one or more execution output files.',
        inputSchema: FileDeleteParamsSchema.shape,
      },
      async (rawArgs: unknown, _extra: ToolRequestExtra) => {
        const args = FileDeleteParamsSchema.parse(rawArgs);
        const result = await this.shellTools.deleteFiles(args);
        const structuredContent = result as unknown as Record<string, unknown>;
        const text = formatShellToolText('delete_execution_outputs', result);
        return {
          content: [{ type: 'text' as const, text }],
          structuredContent,
        };
      }
    ));
    logger.info('  ShellModule: delete_execution_outputs tool registered.');

    // Cleanup suggestions
    this.deregisterFunctions.push(server.registerTool(
      'get_cleanup_suggestions',
      {
        title: 'Get Cleanup Suggestions',
        description: 'Get automatic cleanup suggestions for output file management.',
        inputSchema: CleanupSuggestionsParamsSchema,
      },
      async (rawArgs: unknown, _extra: ToolRequestExtra) => {
        const args = CleanupSuggestionsParamsSchema.parse(rawArgs);
        const result = await this.shellTools.getCleanupSuggestions(args);
        const structuredContent = result as unknown as Record<string, unknown>;
        const text = formatShellToolText('get_cleanup_suggestions', result);
        return {
          content: [{ type: 'text' as const, text }],
          structuredContent,
        };
      }
    ));
    logger.info('  ShellModule: get_cleanup_suggestions tool registered.');

    // Auto cleanup
    this.deregisterFunctions.push(server.registerTool(
      'perform_auto_cleanup',
      {
        title: 'Perform Auto Cleanup',
        description: 'Perform automatic cleanup of old output files based on age and retention policies.',
        inputSchema: AutoCleanupParamsSchema,
      },
      async (rawArgs: unknown, _extra: ToolRequestExtra) => {
        const args = AutoCleanupParamsSchema.parse(rawArgs);
        const result = await this.shellTools.performAutoCleanup(args);
        const structuredContent = result as unknown as Record<string, unknown>;
        const text = formatShellToolText('perform_auto_cleanup', result);
        return {
          content: [{ type: 'text' as const, text }],
          structuredContent,
        };
      }
    ));
    logger.info('  ShellModule: perform_auto_cleanup tool registered.');

    // Command history query
    this.deregisterFunctions.push(server.registerTool(
      'command_history_query',
      {
        title: 'Command History Query',
        description: 'Query command history with filtering, pagination, and analytics.',
        inputSchema: CommandHistoryQueryParamsSchema.shape,
      },
      async (rawArgs: unknown, _extra: ToolRequestExtra) => {
        const args = CommandHistoryQueryParamsSchema.parse(rawArgs);
        const result = await this.shellTools.queryCommandHistory(args);
        const structuredContent = result as unknown as Record<string, unknown>;
        const text = formatShellToolText('command_history_query', result);
        return {
          content: [{ type: 'text' as const, text }],
          structuredContent,
        };
      }
    ));
    logger.info('  ShellModule: command_history_query tool registered.');
  }

  async shutdown(): Promise<void> {
    logger.info('  ShellModule: Shutting down, deregistering tools...');
    this.deregisterFunctions.forEach((deregister) => {
      if (typeof deregister === 'function') {
        deregister();
      } else if (deregister && typeof deregister.remove === 'function') {
        deregister.remove();
      }
    });
    this.deregisterFunctions = []; // Clear the array (fixed typo)
    logger.info('  ShellModule: All tools deregistered.');
  }
}

export default ShellModule;
