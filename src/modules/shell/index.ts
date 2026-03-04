import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'; // Adapted SDK import
import { Module, InfectedConfig, ManagerInstances } from '../../types/index.js'; // Our core types, include ManagerInstances
import { ExecutionInfo, ExecutionStatusSchema, ExecutionModeSchema, ProcessSignalSchema } from '../../types/shell-server'; // Adapted to shell-server types
import { z } from 'zod';
import logger from '../../core/logger.js';
import { ShellTools } from './shell-tools.js'; // Adapted import
import { MCPShellError, ResourceNotFoundError } from '../../utils/shell-errors.js'; // Adapted custom errors

// Zod schema for shell_execute tool arguments
const shellExecuteSchema = z.object({
  command: z.string().describe('The shell command to execute.'),
  executionMode: ExecutionModeSchema.default('foreground').describe('Execution mode: foreground, background, detached, or adaptive.'),
  workingDirectory: z.string().optional().describe('Working directory for the command. Defaults to current server CWD.'),
  environmentVariables: z.record(z.string(), z.string()).optional().describe('Additional environment variables for the command.'),
  inputData: z.string().optional().describe('Input data to pipe to the command\'s stdin.'),
  inputOutputId: z.string().optional().describe('Use output_id of a previous execution as input to this command.'),
  timeoutSeconds: z.number().int().min(1).default(60).describe('Timeout for the command in seconds.'),
  foregroundTimeoutSeconds: z.number().int().min(1).optional().describe('Timeout for foreground execution in adaptive mode.'),
  maxOutputSize: z.number().int().min(0).default(10485760).describe('Maximum output size to capture in bytes (default 10MB).'),
  captureStderr: z.boolean().default(true).describe('Capture stderr output.'),
  createTerminal: z.boolean().default(false).describe('Create a new terminal session for the command (requires TerminalManager).'),
});

const processGetExecutionSchema = z.object({
  executionId: z.string().describe('The ID of the command execution.'),
});

const processListExecutionsSchema = z.object({
  status: ExecutionStatusSchema.optional().describe('Filter by execution status.'), // Using ExecutionStatus
  commandPattern: z.string().optional().describe('Filter by command pattern (regex).'),
  limit: z.number().int().min(1).default(50).describe('Maximum number of executions to return.'),
  offset: z.number().int().min(0).default(0).describe('Offset for pagination.'),
});

const processKillSchema = z.object({
  processId: z.number().int().describe('The process ID to kill.'),
  signal: ProcessSignalSchema.default('TERM').describe('The signal to send to the process (TERM, KILL, INT, INT, HUP, USR1, USR2).'), // Corrected signal type
  force: z.boolean().default(false).describe('Force kill with SIGKILL if TERM fails.'),
});

const shellSetDefaultWorkdirSchema = z.object({
  workingDirectory: z.string().describe('The new default working directory.'),
});


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

    this.deregisterFunctions.push(server.registerTool( // Store deregister function
      'shell_execute',
      {
        title: 'Shell Execute',
        description: 'Executes a shell command on the host system with enhanced real-time output and execution control.',
        inputSchema: shellExecuteSchema,
      },
      async (args: z.infer<typeof shellExecuteSchema>) => {
        const allowlist = config.shell?.allowlist;
        const commandExecutable = args.command.trim().split(' ')[0];

        if (allowlist && allowlist.length > 0 && !allowlist.includes(commandExecutable)) {
          logger.warn(`Attempted to execute disallowed command: ${commandExecutable}`);
          return {
            content: [{ type: "text", text: `Error: Command '${commandExecutable}' is not allowed by the server's allowlist.` }],
            structuredContent: { error: `Command '${commandExecutable}' is not allowed.` },
            isError: true,
          };
        }

        try {
          const executionInfo = await this.shellTools.executeShell({
            command: args.command,
            execution_mode: args.executionMode,
            working_directory: args.workingDirectory,
            environment_variables: args.environmentVariables,
            input_data: args.inputData,
            input_output_id: args.inputOutputId,
            timeout_seconds: args.timeoutSeconds,
            foreground_timeout_seconds: args.foregroundTimeoutSeconds,
            max_output_size: args.maxOutputSize,
            capture_stderr: args.captureStderr,
            create_terminal: args.createTerminal,
          });
          logger.info(`shell_execute command completed. ID: ${executionInfo.execution_id}, Status: ${executionInfo.status}`);
          
          return {
            content: [{ type: "text", text: `Command execution started. ID: ${executionInfo.execution_id}. Status: ${executionInfo.status}.` }],
            structuredContent: {
              execution_id: executionInfo.execution_id,
              status: executionInfo.status,
              message: (executionInfo as ExecutionInfo).message, // Cast to ExecutionInfo
              output_id: (executionInfo as ExecutionInfo).output_id, // Cast to ExecutionInfo
              truncated: (executionInfo as ExecutionInfo).output_truncated, // Cast to ExecutionInfo
              next_steps: (executionInfo as ExecutionInfo).next_steps, // Cast to ExecutionInfo
              guidance: (executionInfo as ExecutionInfo).guidance, // Cast to ExecutionInfo
            },
          };
        } catch (error) {
          if (error instanceof MCPShellError) { // Use MCPShellError
            logger.error(`shell_execute failed: ${error.message}`, { details: error.details });
            return {
              content: [{ type: "text", text: `Error: ${error.message}` }],
              structuredContent: { error: error.message, details: error.details },
              isError: true,
            };
          }
          logger.error(`An unexpected error occurred during shell_execute: ${error}`);
          return {
            content: [{ type: "text", text: `Error: An unexpected error occurred: ${error instanceof Error ? error.message : String(error)}` }],
            structuredContent: { error: `An unexpected error occurred: ${error instanceof Error ? error.message : String(error)}` },
            isError: true,
          };
        }
      },
    ));
    logger.info('  ShellModule: shell_execute tool registered.');

    this.deregisterFunctions.push(server.registerTool( // Store deregister function
      'process_get_execution',
      {
        title: 'Get Execution Details',
        description: 'Retrieves detailed information about a specific command execution.',
        inputSchema: processGetExecutionSchema,
      },
      async (args: z.infer<typeof processGetExecutionSchema>) => {
        const executionInfo = await this.shellTools.getExecution({
          execution_id: args.executionId,
        });
        if (!executionInfo) {
          throw new ResourceNotFoundError('execution', args.executionId);
        }
        return {
          content: [{ type: "text", text: JSON.stringify(executionInfo, null, 2) }],
          structuredContent: executionInfo,
        };
      }
    ));
    logger.info('  ShellModule: process_get_execution tool registered.');

    this.deregisterFunctions.push(server.registerTool( // Store deregister function
      'process_list_executions',
      {
        title: 'List Command Executions',
        description: 'Lists active and completed command executions with filtering and pagination.',
        inputSchema: processListExecutionsSchema,
      },
      async (args: z.infer<typeof processListExecutionsSchema>) => {
        const result = await this.shellTools.listProcesses({
          status_filter: args.status,
          command_pattern: args.commandPattern,
          limit: args.limit,
          offset: args.offset,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      }
    ));
    logger.info('  ShellModule: process_list_executions tool registered.');

    this.deregisterFunctions.push(server.registerTool( // Store deregister function
      'process_kill',
      {
        title: 'Kill Process',
        description: 'Sends a signal to terminate a running process by its process ID.',
        inputSchema: processKillSchema,
      },
      async (args: z.infer<typeof processKillSchema>) => {
        const result = await this.shellTools.killProcess({
          process_id: args.processId,
          signal: args.signal,
          force: args.force,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      }
    ));
    logger.info('  ShellModule: process_kill tool registered.');

    this.deregisterFunctions.push(server.registerTool( // Store deregister function
      'shell_set_default_workdir',
      {
        title: 'Set Default Working Directory',
        description: 'Sets the default working directory for subsequent shell commands.',
        inputSchema: shellSetDefaultWorkdirSchema,
      },
      async (args: z.infer<typeof shellSetDefaultWorkdirSchema>) => {
        const result = await this.shellTools.setDefaultWorkingDirectory({
          working_directory: args.workingDirectory,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
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
