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
  ShellGetExecutionParamsSchema,
  ProcessListParamsSchema,
  ProcessKillParamsSchema,
  ShellSetDefaultWorkdirParamsSchema,
} from '../../types/shell-server/schemas.js';

type ToolRequestExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;


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
        inputSchema: ShellExecuteParamsSchema,
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
          return {
            content: [{ type: 'text', text: `Command execution started. ID: ${executionInfo.execution_id}. Status: ${executionInfo.status}.` }],
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
        inputSchema: ShellGetExecutionParamsSchema,
      },
      async (args, _extra: ToolRequestExtra) => {
        const executionInfo = await this.shellTools.getExecution({
          execution_id: args.execution_id,
        });
        if (!executionInfo) {
          throw new ResourceNotFoundError('execution', args.execution_id);
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(executionInfo, null, 2) }],
          structuredContent: executionInfo,
        };
      }
    ));
    logger.info('  ShellModule: process_get_execution tool registered.');

    this.deregisterFunctions.push(server.registerTool(
      'process_list_executions',
      {
        title: 'List Command Executions',
        description: 'Lists active and completed command executions with filtering and pagination.',
        inputSchema: ProcessListParamsSchema,
      },
      async (args, _extra: ToolRequestExtra) => {
        const statusFilter = args.status_filter === 'all' ? undefined : args.status_filter;
        const result = await this.shellTools.listProcesses({
          status_filter: statusFilter,
          command_pattern: args.command_pattern,
          limit: args.limit,
          offset: args.offset,
          session_id: args.session_id,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      }
    ));
    logger.info('  ShellModule: process_list_executions tool registered.');

    this.deregisterFunctions.push(server.registerTool(
      'process_kill',
      {
        title: 'Kill Process',
        description: 'Sends a signal to terminate a running process by its process ID.',
        inputSchema: ProcessKillParamsSchema,
      },
      async (rawArgs: unknown, _extra: ToolRequestExtra) => {
        const args = ProcessKillParamsSchema.parse(rawArgs);
        const result = await this.shellTools.killProcess({
          process_id: args.process_id,
          signal: args.signal,
          force: args.force,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
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
        inputSchema: ShellSetDefaultWorkdirParamsSchema,
      },
      async (rawArgs: unknown, _extra: ToolRequestExtra) => {
        const args = ShellSetDefaultWorkdirParamsSchema.parse(rawArgs);
        const result = await this.shellTools.setDefaultWorkingDirectory({
          working_directory: args.working_directory,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      }
    ));
    logger.info('  ShellModule: shell_set_default_workdir tool registered.');
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
