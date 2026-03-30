import logger from '../../core/logger.js';
import { ShellTools } from './shell-tools.js'; // Adapted import
import { MCPShellError, ResourceNotFoundError } from '../../utils/shell-errors.js'; // Adapted custom errors
import { ShellExecuteParamsSchema, ShellExecuteParamsInputSchema, ShellExecuteStreamingParamsSchema, ShellGetExecutionParamsSchema, ProcessListParamsSchema, ProcessKillParamsSchema, ShellSetDefaultWorkdirParamsSchema, TerminalListParamsSchema, TerminalGetParamsSchema, TerminalCloseParamsSchema, CleanupSuggestionsParamsSchema, AutoCleanupParamsSchema, FileListParamsSchema, FileReadParamsSchema, FileDeleteParamsSchema, CommandHistoryQueryParamsSchema, } from '../../types/shell-server/schemas.js';
import { TerminalOperateParamsInputSchema, TerminalOperateParamsSchema } from '../../types/shell-server/quick-schemas.js';
const PREVIEW_LIMIT = 6000;
function asRecord(value) {
    return (value && typeof value === 'object') ? value : {};
}
function asString(value) {
    return typeof value === 'string' ? value : undefined;
}
function asNumber(value) {
    return typeof value === 'number' ? value : undefined;
}
function asArray(value) {
    return Array.isArray(value) ? value : [];
}
function toCompactPreview(value) {
    if (typeof value === 'string') {
        return value;
    }
    const json = JSON.stringify(value);
    if (!json) {
        return '';
    }
    return json.length > PREVIEW_LIMIT ? `${json.slice(0, PREVIEW_LIMIT)}\n...(truncated)` : json;
}
function sanitizeTerminalText(raw) {
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
function formatExecutionText(result) {
    const data = asRecord(result);
    const lines = [];
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
    if (executionId)
        lines.push(`execution_id: ${executionId}`);
    if (status)
        lines.push(`status: ${status}`);
    if (pid)
        lines.push(`process_id: ${pid}`);
    if (exitCode !== undefined)
        lines.push(`exit_code: ${exitCode}`);
    if (duration !== undefined)
        lines.push(`execution_time_ms: ${duration}`);
    if (workingDirectory)
        lines.push(`working_directory: ${workingDirectory}`);
    if (outputId)
        lines.push(`output_id: ${outputId}`);
    if (outputTruncated)
        lines.push('output_truncated: true');
    if (message)
        lines.push(`message: ${message}`);
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
function formatProcessListText(result) {
    const data = asRecord(result);
    const executions = asArray(data['executions']);
    const processes = executions.length > 0 ? executions : asArray(data['processes']);
    const total = asNumber(data['total']) ?? processes.length;
    const lines = [`count: ${processes.length}`, `total: ${total}`];
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
function formatListExecutionOutputsText(result) {
    const data = asRecord(result);
    const files = asArray(data['files']);
    const totalCount = asNumber(data['total_count']) ?? files.length;
    const lines = [`files: ${files.length}`, `total_count: ${totalCount}`];
    for (const entry of files.slice(0, 20)) {
        const file = asRecord(entry);
        const outputId = asString(file['output_id']) || 'unknown';
        const outputType = asString(file['output_type']) || 'unknown';
        const size = asNumber(file['size']);
        const executionId = asString(file['execution_id']) || 'unknown';
        const name = asString(file['name']) || '';
        lines.push(`${outputId} | ${outputType} | ${size ?? 0}B | exec:${executionId}${name ? ` | ${name}` : ''}`);
    }
    if (files.length > 20) {
        lines.push(`...and ${files.length - 20} more`);
    }
    return lines.join('\n');
}
function formatTerminalListText(result) {
    const data = asRecord(result);
    const terminals = asArray(data['terminals']);
    const total = asNumber(data['total']) ?? terminals.length;
    const lines = [`terminals: ${terminals.length}`, `total: ${total}`];
    for (const entry of terminals.slice(0, 20)) {
        const terminal = asRecord(entry);
        const terminalId = asString(terminal['terminal_id']) || 'unknown';
        const status = asString(terminal['status']) || 'unknown';
        const shellType = asString(terminal['shell_type']) || '';
        const sessionName = asString(terminal['session_name']) || '';
        lines.push(`${terminalId} | ${status}${shellType ? ` | shell:${shellType}` : ''}${sessionName ? ` | session:${sessionName}` : ''}`);
    }
    if (terminals.length > 20) {
        lines.push(`...and ${terminals.length - 20} more`);
    }
    return lines.join('\n');
}
function formatTerminalInfoText(result) {
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
    if (sessionName)
        lines.push(`session_name: ${sessionName}`);
    if (lastActivity)
        lines.push(`last_activity: ${lastActivity}`);
    return lines.join('\n');
}
function formatTerminalOperateText(result) {
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
    const lines = [`terminal_id: ${terminalId}`, `success: ${success}`];
    if (sessionId)
        lines.push(`session_id: ${sessionId}`);
    if (processId)
        lines.push(`process_id: ${processId}`);
    lines.push(`strip_ansi: ${shouldStripAnsi}`);
    if (inputRejected)
        lines.push('input_rejected: true');
    if (reason)
        lines.push(`reason: ${reason}`);
    if (lineCount !== undefined)
        lines.push(`line_count: ${lineCount}`);
    if (outputInfo && Object.keys(outputInfo).length > 0)
        lines.push(`has_more: ${hasMore}`);
    if (output)
        lines.push('', 'output:', output);
    return lines.join('\n');
}
function formatTerminalCloseText(result) {
    const data = asRecord(result);
    const terminalId = asString(data['terminal_id']) || 'unknown';
    const success = data['success'] === true;
    const message = asString(data['message']) || '';
    const closedAt = asString(data['closed_at']) || asString(data['timestamp']) || '';
    const lines = [`terminal_id: ${terminalId}`, `success: ${success}`];
    if (message)
        lines.push(`message: ${message}`);
    if (closedAt)
        lines.push(`closed_at: ${closedAt}`);
    return lines.join('\n');
}
function formatCommandHistoryText(result) {
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
    const lines = [`success: true`, `entries: ${entries.length}`, `total_entries: ${totalEntries}`, `page: ${page}`];
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
function formatShellToolText(toolName, result) {
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
        const output = asString(data['content']) ||
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
export class ShellModule {
    constructor() {
        this.name = 'shell';
        this.deregisterFunctions = []; // Store SDK tool handles/deregister functions
        // Store active execution contexts for progress streaming
        // Maps executionId -> { progressToken, sessionId }
        this.executionContexts = new Map();
    }
    async register(server, config, managers) {
        this.serverInstance = server;
        this.shellTools = new ShellTools(managers.processManager, managers.terminalManager, managers.fileManager, managers.monitoringManager, managers.securityManager, managers.commandHistoryManager);
        managers.processManager.setBackgroundProcessCallbacks({
            onComplete: async (executionId, executionInfo) => {
                const context = this.executionContexts.get(executionId);
                const progressToken = context?.progressToken;
                const message = `✅ Command '${executionInfo.command.substring(0, 50)}...' completed. ID: ${executionId}`;
                const params = {
                    level: 'info',
                    data: message,
                    execution_id: executionId,
                    status: 'completed'
                };
                if (progressToken !== undefined) {
                    params.progressToken = progressToken;
                }
                await this.serverInstance.server.notification({
                    method: 'notifications/message',
                    params,
                });
                // Clean up execution context
                this.executionContexts.delete(executionId);
            },
            onError: async (executionId, executionInfo, error) => {
                const context = this.executionContexts.get(executionId);
                const progressToken = context?.progressToken;
                const message = `❌ Command '${executionInfo.command.substring(0, 50)}...' failed. ID: ${executionId}`;
                const params = {
                    level: 'error',
                    data: message,
                    execution_id: executionId,
                    status: 'failed',
                    error: String(error)
                };
                if (progressToken !== undefined) {
                    params.progressToken = progressToken;
                }
                await this.serverInstance.server.notification({
                    method: 'notifications/message',
                    params,
                });
                // Clean up execution context
                this.executionContexts.delete(executionId);
            },
            onTimeout: async (executionId, executionInfo) => {
                const context = this.executionContexts.get(executionId);
                const progressToken = context?.progressToken;
                const message = `⏰ Command '${executionInfo.command.substring(0, 50)}...' timed out. ID: ${executionId}`;
                const params = {
                    level: 'warn',
                    data: message,
                    execution_id: executionId,
                    status: 'timeout'
                };
                if (progressToken !== undefined) {
                    params.progressToken = progressToken;
                }
                await this.serverInstance.server.notification({
                    method: 'notifications/message',
                    params,
                });
                // Clean up execution context
                this.executionContexts.delete(executionId);
            },
            onOutputData: async (executionId, data, isStderr) => {
                const context = this.executionContexts.get(executionId);
                const progressToken = context?.progressToken;
                const params = {
                    execution_id: executionId,
                    type: isStderr ? 'stderr' : 'stdout',
                    data: data,
                };
                if (progressToken !== undefined) {
                    params.progressToken = progressToken;
                }
                await this.serverInstance.server.notification({
                    method: 'notifications/progress',
                    params,
                });
            },
        });
        this.deregisterFunctions.push(server.registerTool('ShellExecute', {
            title: 'Shell Execute',
            description: 'Executes a shell command on the host system with streaming output, adaptive/foreground/background execution modes, and workdir/env overrides. ' +
                'Supports execution_id/output_id tracking, allowlist enforcement, and optional progress tokens so you can watch builds, deployments, diagnostics, or long-running processes while capturing exit codes and status metadata.',
            inputSchema: ShellExecuteParamsInputSchema.shape,
        }, async (rawArgs, extra) => {
            const args = ShellExecuteParamsSchema.parse(rawArgs);
            const allowlist = config.shell?.allowlist;
            const commandExecutable = args.command.trim().split(' ')[0];
            // Extract progressToken and sessionId from request for streaming
            const progressToken = extra._meta?.progressToken;
            const sessionId = extra.sessionId;
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
                // Store execution context for progress streaming
                if (executionInfo.execution_id) {
                    const execId = executionInfo.execution_id;
                    this.executionContexts.set(execId, {
                        sessionId,
                        progressToken
                    });
                }
                logger.info(`ShellExecute command completed. ID: ${executionInfo.execution_id}, Status: ${executionInfo.status}`);
                const text = formatShellToolText('ShellExecute', executionInfo);
                return {
                    content: [{ type: 'text', text }],
                    structuredContent: executionInfo,
                };
            }
            catch (error) {
                if (error instanceof MCPShellError) {
                    logger.error(`ShellExecute failed: ${error.message}`, { details: error.details });
                    return {
                        content: [{ type: 'text', text: `Error: ${error.message}` }],
                        structuredContent: { error: error.message, details: error.details },
                        isError: true,
                    };
                }
                logger.error(`An unexpected error occurred during ShellExecute: ${error}`);
                return {
                    content: [{ type: 'text', text: `Error: An unexpected error occurred: ${error instanceof Error ? error.message : String(error)}` }],
                    structuredContent: { error: `An unexpected error occurred: ${error instanceof Error ? error.message : String(error)}` },
                    isError: true,
                };
            }
        }));
        logger.info('  ShellModule: ShellExecute tool registered.');
        if (process.env.MCP_SHELL_ENABLE_STREAMING !== 'false') {
            this.deregisterFunctions.push(server.registerTool('ShellExecuteStreaming', {
                title: 'Shell Execute Streaming',
                description: 'Execute a shell command and stream output via SSE/WebSocket. Returns the output_id that subscribers can follow.',
                inputSchema: ShellExecuteStreamingParamsSchema.shape,
            }, async (rawArgs) => {
                const args = ShellExecuteStreamingParamsSchema.parse(rawArgs);
                try {
                    const result = await this.shellTools.executeShellStreaming({
                        command: args.command,
                        working_directory: args.working_directory,
                        timeout_seconds: args.timeout_seconds,
                        capture_stderr: args.capture_stderr,
                        output_id: args.output_id,
                    });
                    return {
                        content: [{
                                type: 'text',
                                text: `Streaming execution launched (output_id: ${result.output_id})`,
                            }],
                        structuredContent: result,
                    };
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    logger.error(`ShellExecuteStreaming error: ${message}`);
                    return {
                        content: [{ type: 'text', text: `Error: ${message}` }],
                        structuredContent: { error: message },
                        isError: true,
                    };
                }
            }));
            logger.info('  ShellModule: ShellExecuteStreaming tool registered.');
        }
        this.deregisterFunctions.push(server.registerTool('ProcessGetExecution', {
            title: 'Get Execution Details',
            description: 'Retrieve metadata (status, exit code, timestamps) plus stdout/stderr references and output IDs for a given execution_id. ' +
                'Use it to poll completion, display last output, or chain follow-up commands once a previous execution finishes.',
            inputSchema: ShellGetExecutionParamsSchema.shape,
        }, async (rawArgs, _extra) => {
            const args = ShellGetExecutionParamsSchema.parse(rawArgs);
            const executionInfo = await this.shellTools.getExecution({
                execution_id: args.execution_id,
            });
            if (!executionInfo) {
                throw new ResourceNotFoundError('execution', args.execution_id);
            }
            const structuredContent = executionInfo;
            const text = formatShellToolText('ProcessGetExecution', executionInfo);
            return {
                content: [{ type: 'text', text }],
                structuredContent,
            };
        }));
        logger.info('  ShellModule: ProcessGetExecution tool registered.');
        this.deregisterFunctions.push(server.registerTool('ProcessListExecutions', {
            title: 'List Command Executions',
            description: 'List active, queued, and recently completed shell executions with status, pid, brief command previews, and pagination controls. ' +
                'Ideal for dashboards, monitoring parallel work, or choosing an execution_id before fetching detailed output.',
            inputSchema: ProcessListParamsSchema.shape,
        }, async (rawArgs, _extra) => {
            const args = ProcessListParamsSchema.parse(rawArgs);
            const statusFilter = args.status_filter === 'all' ? undefined : args.status_filter;
            const result = await this.shellTools.listProcesses({
                status_filter: statusFilter,
                command_pattern: args.command_pattern,
                limit: args.limit,
                offset: args.offset,
                session_id: args.session_id,
            });
            const structuredContent = result;
            const text = formatShellToolText('ProcessListExecutions', result);
            return {
                content: [{ type: 'text', text }],
                structuredContent,
            };
        }));
        logger.info('  ShellModule: ProcessListExecutions tool registered.');
        this.deregisterFunctions.push(server.registerTool('ProcessKill', {
            title: 'Kill Process',
            description: 'Send a signal (default SIGTERM) to a running execution_id or PID to stop runaway commands. ' +
                'Use this when long-running jobs misbehave or you need to cancel pending work gracefully before retrying.',
            inputSchema: ProcessKillParamsSchema.shape,
        }, async (rawArgs, _extra) => {
            const args = ProcessKillParamsSchema.parse(rawArgs);
            const result = await this.shellTools.killProcess({
                process_id: args.process_id,
                signal: args.signal,
                force: args.force,
            });
            const text = formatShellToolText('ProcessKill', result);
            return {
                content: [{ type: 'text', text }],
                structuredContent: result,
            };
        }));
        logger.info('  ShellModule: ProcessKill tool registered.');
        this.deregisterFunctions.push(server.registerTool('ShellSetDefaultWorkdir', {
            title: 'Set Default Working Directory',
            description: 'Update the default working directory that future ShellExecute calls inherit, including terminal sessions. ' +
                'Use it when you switch contexts (repos, builds, artifact folders) so commands no longer need explicit absolute paths.',
            inputSchema: ShellSetDefaultWorkdirParamsSchema.shape,
        }, async (rawArgs, _extra) => {
            const args = ShellSetDefaultWorkdirParamsSchema.parse(rawArgs);
            const result = await this.shellTools.setDefaultWorkingDirectory({
                working_directory: args.working_directory,
            });
            const text = formatShellToolText('ShellSetDefaultWorkdir', result);
            return {
                content: [{ type: 'text', text }],
                structuredContent: result,
            };
        }));
        logger.info('  ShellModule: ShellSetDefaultWorkdir tool registered.');
        // ===============================================
        // Terminal Management Tools
        // ===============================================
        // Unified Terminal Operations (create + send + get output)
        this.deregisterFunctions.push(server.registerTool('TerminalOperate', {
            title: 'Terminal Operate',
            description: 'Manage PTY-backed interactive terminal sessions: create terminals, send input, resize dimensions, capture buffered output, and stream updates. ' +
                'Supports commands, input, execute flags, output_delay/output_lines, output_id streaming, and interactive sessions (e.g., installers, package managers) that require real-time control.',
            inputSchema: TerminalOperateParamsInputSchema.shape,
        }, async (rawArgs, _extra) => {
            const args = TerminalOperateParamsSchema.parse(rawArgs);
            const result = await this.shellTools.terminalOperate(args);
            const structuredContent = result;
            const text = formatShellToolText('TerminalOperate', result);
            return {
                content: [{ type: 'text', text }],
                structuredContent,
            };
        }));
        logger.info('  ShellModule: TerminalOperate tool registered.');
        // List terminal sessions
        this.deregisterFunctions.push(server.registerTool('TerminalList', {
            title: 'List Terminal Sessions',
            description: 'List active terminal sessions with status, shell_type, labels, and terminal IDs. ' +
                'Use it before sending input to confirm which session is busy and to clean up idle terminals.',
            inputSchema: TerminalListParamsSchema,
        }, async (rawArgs, _extra) => {
            const args = TerminalListParamsSchema.parse(rawArgs);
            const result = await this.shellTools.listTerminals(args);
            const text = formatShellToolText('TerminalList', result);
            return {
                content: [{ type: 'text', text }],
                structuredContent: result,
            };
        }));
        logger.info('  ShellModule: TerminalList tool registered.');
        // Get terminal info
        this.deregisterFunctions.push(server.registerTool('TerminalGetInfo', {
            title: 'Get Terminal Info',
            description: 'Return metadata for a terminal (dimensions, busy flag, working directory, last command, buffer stats). ' +
                'Helpful when you need to know whether a session is ready before sending new input or closing it.',
            inputSchema: TerminalGetParamsSchema,
        }, async (rawArgs, _extra) => {
            const args = TerminalGetParamsSchema.parse(rawArgs);
            const result = await this.shellTools.getTerminal(args);
            const structuredContent = result;
            const text = formatShellToolText('TerminalGetInfo', result);
            return {
                content: [{ type: 'text', text }],
                structuredContent,
            };
        }));
        logger.info('  ShellModule: TerminalGetInfo tool registered.');
        // Close terminal
        this.deregisterFunctions.push(server.registerTool('TerminalClose', {
            title: 'Close Terminal',
            description: 'Close an interactive terminal session gracefully (or forcefully) to release PTY resources. ' +
                'Use after finishing interactive tasks to avoid orphaned terminals.',
            inputSchema: TerminalCloseParamsSchema,
        }, async (rawArgs, _extra) => {
            const args = TerminalCloseParamsSchema.parse(rawArgs);
            const result = await this.shellTools.closeTerminal(args);
            const text = formatShellToolText('TerminalClose', result);
            return {
                content: [{ type: 'text', text }],
                structuredContent: result,
            };
        }));
        logger.info('  ShellModule: TerminalClose tool registered.');
        // ===============================================
        // File Management & Cleanup Tools
        // ===============================================
        // List execution outputs
        this.deregisterFunctions.push(server.registerTool('ListExecutionOutputs', {
            title: 'List Execution Outputs',
            description: 'List recorded stdout/stderr blobs, trimmed files, and streaming outputs with output_id, size, execution_id, and timestamps. ' +
                'Use it to discover logs or artifacts to read/download for follow-up analysis.',
            inputSchema: FileListParamsSchema,
        }, async (rawArgs, _extra) => {
            const args = FileListParamsSchema.parse(rawArgs);
            const result = await this.shellTools.listFiles(args);
            const structuredContent = result;
            const text = formatShellToolText('ListExecutionOutputs', result);
            return {
                content: [{ type: 'text', text }],
                structuredContent,
            };
        }));
        logger.info('  ShellModule: ListExecutionOutputs tool registered.');
        // Read execution output
        this.deregisterFunctions.push(server.registerTool('ReadExecutionOutput', {
            title: 'Read Execution Output',
            description: 'Read console output files produced by shell executions (stdout/stderr) with offsets, lengths, and optional tail/head. ' +
                'Useful for showing logs in UI, downloading long outputs, or tailing the most recent lines.',
            inputSchema: FileReadParamsSchema.shape,
        }, async (rawArgs, _extra) => {
            const args = FileReadParamsSchema.parse(rawArgs);
            const result = await this.shellTools.readFile(args);
            const structuredContent = result;
            const text = formatShellToolText('ReadExecutionOutput', result);
            return {
                content: [{ type: 'text', text }],
                structuredContent,
            };
        }));
        logger.info('  ShellModule: ReadExecutionOutput tool registered.');
        // Delete execution outputs
        this.deregisterFunctions.push(server.registerTool('DeleteExecutionOutputs', {
            title: 'Delete Execution Outputs',
            description: 'Delete stored execution outputs (stdout/stderr files, trimmed logs) using filters or explicit identifiers. ' +
                'Use this to reclaim disk space after artifacts have been processed.',
            inputSchema: FileDeleteParamsSchema.shape,
        }, async (rawArgs, _extra) => {
            const args = FileDeleteParamsSchema.parse(rawArgs);
            const result = await this.shellTools.deleteFiles(args);
            const structuredContent = result;
            const text = formatShellToolText('DeleteExecutionOutputs', result);
            return {
                content: [{ type: 'text', text }],
                structuredContent,
            };
        }));
        logger.info('  ShellModule: DeleteExecutionOutputs tool registered.');
        // Cleanup suggestions
        this.deregisterFunctions.push(server.registerTool('GetCleanupSuggestions', {
            title: 'Get Cleanup Suggestions',
            description: 'Analyze stored outputs and suggest candidates for deletion based on age, size, or completion status. ' +
                'Ideal for planning automated cleanup runs before hitting storage limits.',
            inputSchema: CleanupSuggestionsParamsSchema,
        }, async (rawArgs, _extra) => {
            const args = CleanupSuggestionsParamsSchema.parse(rawArgs);
            const result = await this.shellTools.getCleanupSuggestions(args);
            const structuredContent = result;
            const text = formatShellToolText('GetCleanupSuggestions', result);
            return {
                content: [{ type: 'text', text }],
                structuredContent,
            };
        }));
        logger.info('  ShellModule: GetCleanupSuggestions tool registered.');
        // Auto cleanup
        this.deregisterFunctions.push(server.registerTool('PerformAutoCleanup', {
            title: 'Perform Auto Cleanup',
            description: 'Execute cleanup routines that delete execution outputs matching TTL/size filters and summarize what was removed. ' +
                'Use this as a periodic housekeeping step to keep log storage bounded.',
            inputSchema: AutoCleanupParamsSchema,
        }, async (rawArgs, _extra) => {
            const args = AutoCleanupParamsSchema.parse(rawArgs);
            const result = await this.shellTools.performAutoCleanup(args);
            const structuredContent = result;
            const text = formatShellToolText('PerformAutoCleanup', result);
            return {
                content: [{ type: 'text', text }],
                structuredContent,
            };
        }));
        logger.info('  ShellModule: PerformAutoCleanup tool registered.');
        // Command history query
        this.deregisterFunctions.push(server.registerTool('CommandHistoryQuery', {
            title: 'Command History Query',
            description: 'Search past shell commands with filters for query text, status, session, and time ranges while returning paginated results. ' +
                'Use it to reproduce previous work, audit activity, or reuse commands in new contexts.',
            inputSchema: CommandHistoryQueryParamsSchema.shape,
        }, async (rawArgs, _extra) => {
            const args = CommandHistoryQueryParamsSchema.parse(rawArgs);
            const result = await this.shellTools.queryCommandHistory(args);
            const structuredContent = result;
            const text = formatShellToolText('CommandHistoryQuery', result);
            return {
                content: [{ type: 'text', text }],
                structuredContent,
            };
        }));
        logger.info('  ShellModule: CommandHistoryQuery tool registered.');
    }
    async shutdown() {
        logger.info('  ShellModule: Shutting down, deregistering tools...');
        this.deregisterFunctions.forEach((deregister) => {
            if (typeof deregister === 'function') {
                deregister();
            }
            else if (deregister && typeof deregister.remove === 'function') {
                deregister.remove();
            }
        });
        this.deregisterFunctions = []; // Clear the array (fixed typo)
        // Clear execution contexts
        this.executionContexts.clear();
        logger.info('  ShellModule: All tools deregistered.');
    }
}
export default ShellModule;
