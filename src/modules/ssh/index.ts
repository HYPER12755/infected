import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { z } from 'zod';
import { EventEmitter } from 'node:events';
import { IUnifiedPlugin, UnifiedModuleContext, UnifiedModuleManifest } from '../../core/module-system/module-types.js';
import { createErrorResponse, ERROR_CODES, getErrorSuggestion } from '../../core/tool-error.js';
import logger from '../../core/logger.js';

// Import the 5 focused modules
import { SSHSessionManager, type SSHConnectionTarget, type Session } from './ssh-session-manager.js';
import { SSHCommandExecutor, type CommandResult } from './ssh-command-executor.js';
import { SSHFileTransferHandler, type FileTransferMethod } from './ssh-file-transfer-handler.js';
import { SSHConnectionPoolWrapper } from './ssh-connection-pool-wrapper.js';

// ===== STREAMING TYPES FOR SSH =====
/**
 * Tracks an SSH execution that uses real-time streaming
 */
interface StreamingSSHExecution {
  executionId: string;
  sessionId: string;
  command: string;
  status: 'running' | 'completed' | 'failed' | 'timeout';
  startTime: number;
  exitCode?: number;
  totalOutput: string;
  outputChunks: string[];
  lastUpdate: number;
  emitter: EventEmitter;
}

/**
 * SSH stream update event
 */
interface SSHStreamOutputUpdate {
  type: 'output' | 'complete' | 'error' | 'timeout';
  executionId: string;
  sessionId: string;
  data?: string;
  isStderr?: boolean;
  timestamp: number;
  exitCode?: number;
  duration?: number;
  error?: string;
}

const DEFAULT_SESSION_ID = 'default';
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TIMEOUT_MS = 120000;
const FILE_TRANSFER_TIMEOUT = 300000;

// ===== SCHEMA DEFINITIONS =====

const sshTargetSchema = z
  .object({
    host: z.string().min(1).describe('Remote hostname or IP address.'),
    port: z.number().int().min(1).max(65535).describe('Remote SSH port.'),
    user: z.string().min(1).describe('Remote username.'),
    identity_file: z.string().min(1).optional().describe('Path to private key file for authentication.'),
    identityFile: z.string().min(1).optional().describe('Path to private key file for authentication.'),
    password: z
      .string()
      .min(1)
      .optional()
      .describe('Optional password used by FTP transfers or when SSH keys are unavailable.'),
    extraArgs: z
      .array(z.string())
      .optional()
      .describe('Additional command-line arguments forwarded to `ssh` (e.g., "-o StrictHostKeyChecking=no").'),
  })
  .transform((obj) => ({
    ...obj,
    identityFile: obj.identity_file || obj.identityFile,
  }))
  .describe('Connection target used to spawn an SSH client session to a remote host.');

type SSHConnectionTargetType = z.infer<typeof sshTargetSchema>;

const sshCloseSessionSchema = z.object({
  session_id: z.string().min(1).describe('Session ID to close.'),
});

const TerminalDimensionsSchema = z.object({
  width: z.number().int().min(1).max(500).default(120).describe('Terminal width in characters.'),
  height: z.number().int().min(1).max(100).default(30).describe('Terminal height in rows.'),
}).describe('Terminal dimensions for PTY.');

const sshOperateSchema = z.object({
  session_id: z
    .string()
    .optional()
    .describe('Session ID to use. If session exists, use it. If not found, create new session (requires target).'),
  session_name: z
    .string()
    .optional()
    .describe('Name for new session when creating one. If not provided, a random ID will be generated.'),
  target: z.union([sshTargetSchema, z.object({}).strip()]).optional().describe('SSH connection target. Used to create new session if session_id not provided or not found.'),
  shell_type: z
    .enum(['bash', 'zsh', 'fish', 'cmd', 'powershell'])
    .optional()
    .describe('Shell type to use for new session.'),
  command: z
    .string()
    .optional()
    .describe('Command to execute in the session.'),
  input: z
    .string()
    .optional()
    .describe('Input to send to the session (alternative to command).'),
  execute: z
    .boolean()
    .default(true)
    .describe('Whether to press Enter after sending input (execute command).'),
  get_output: z
    .boolean()
    .default(true)
    .describe('Whether to retrieve session output after operations.'),
  create_session_only: z
    .boolean()
    .default(false)
    .describe('If true, only create the session without executing any command. Returns session info after creation.'),
  interactive: z
    .boolean()
    .default(false)
    .describe('If true, keep session open for interactive use (implies create_session_only if no command provided).'),
  output_delay_ms: z
    .number()
    .int()
    .min(0)
    .max(10000)
    .default(5000)
    .describe('Delay in milliseconds before retrieving output.'),
  strip_ansi: z
    .boolean()
    .default(true)
    .describe('Strip ANSI/control sequences from output.'),
  output_id: z
    .string()
    .optional()
    .describe('Unique ID for streaming output subscription. If provided, real-time output updates will be emitted.'),
  dimensions: TerminalDimensionsSchema.optional().describe('Terminal dimensions for PTY.'),
  working_directory: z.string().optional().describe('Working directory for command execution.'),
  environment_variables: z.record(z.string(), z.string()).optional().describe('Environment variables.'),
  control_codes: z.boolean().default(false).describe('Interpret input as control codes (e.g., \n, \t, \x03 for Ctrl+C).'),
  send_to: z.string().optional().describe('Program guard target for input routing.'),
  force_input: z.boolean().default(false).describe('Force input even if unread output exists.'),
  output_lines: z.number().int().min(1).max(1000).default(20).describe('Number of output lines to retrieve.'),
  include_ansi: z.boolean().default(false).describe('Include ANSI control codes in output.'),
  response_level: z.enum(['minimal', 'standard', 'full']).default('standard').describe('Response detail level.'),
});

const sshBufferSchema = z.object({
  session_id: z
    .string()
    .optional()
    .default(DEFAULT_SESSION_ID)
    .describe('Session ID to inspect.'),
  clean: z.boolean().optional().default(true).describe('Strip ANSI/control sequences from output.'),
  clear: z.boolean().optional().default(false).describe('Clear the buffer after reading it.'),
  format: z.enum(['text', 'json']).optional().default('text').describe('Return format: text or JSON.'),
  filter: z.enum(['all', 'last_command', 'since_last']).optional().default('all').describe('Filter buffer content.'),
  pattern: z.string().optional().describe('Filter buffer by command pattern (substring match).'),
});

const transferMethodSchema = z
  .enum(['scp', 'sftp', 'ftp'])
  .default('scp')
  .describe(
    'Preferred transfer method for uploads/downloads. SCP is the default; SFTP uses get/put scripts, FTP requires a password.'
  );

const sshUploadSchema = z.object({
  session_id: z
    .string()
    .optional()
    .default(DEFAULT_SESSION_ID)
    .describe('Session ID to reuse for uploads.'),
  local_path: z.string().min(1).describe('Local filesystem path to read (server-local path).'),
  remote_path: z.string().min(1).describe('Destination path on the remote host.'),
  timeout: z
    .number()
    .int()
    .min(1000)
    .max(FILE_TRANSFER_TIMEOUT)
    .optional()
    .default(FILE_TRANSFER_TIMEOUT)
    .describe('Upload timeout in milliseconds (default 5 minutes).'),
  transfer_method: transferMethodSchema,
});

const sshDownloadSchema = z.object({
  session_id: z
    .string()
    .optional()
    .default(DEFAULT_SESSION_ID)
    .describe('Session ID to reuse for downloads.'),
  remote_path: z.string().min(1).describe('Remote file path to download.'),
  local_path: z.string().min(1).describe('Local destination path on the server.'),
  timeout: z
    .number()
    .int()
    .min(1000)
    .max(FILE_TRANSFER_TIMEOUT)
    .optional()
    .default(FILE_TRANSFER_TIMEOUT)
    .describe('Download timeout in milliseconds (default 5 minutes).'),
  transfer_method: transferMethodSchema,
});

const sshGetSessionInfoSchema = z.object({
  session_id: z.string().min(1).describe('Session ID to get information about.'),
});

const sshProcessListSchema = z.object({
  session_id: z.string().optional().describe('Filter by session ID.'),
  status_filter: z.enum(['running', 'completed', 'failed', 'all']).optional().default('all').describe('Filter by execution status.'),
  command_pattern: z.string().optional().describe('Filter by command substring.'),
  limit: z.number().int().min(1).max(500).optional().default(50).describe('Maximum results.'),
  offset: z.number().int().min(0).optional().default(0).describe('Pagination offset.'),
});

const sshProcessKillSchema = z.object({
  session_id: z.string().min(1).describe('Session ID.'),
  process_id: z.number().int().describe('Process ID to terminate.'),
  signal: z.enum(['TERM', 'KILL', 'INT', 'HUP', 'USR1', 'USR2']).optional().default('TERM').describe('Signal to send.'),
  force: z.boolean().default(false).describe('Force immediate termination (sends KILL).'),
});


/**
 * Main SSH Module - orchestrates 4 focused sub-modules
 * - ssh-session-manager: Session lifecycle
 * - ssh-command-executor: Command execution
 * - ssh-file-transfer-handler: File operations
 * - ssh-connection-pool-wrapper: Connection pooling
 */
export default class SshModule implements IUnifiedPlugin {
  public manifest: UnifiedModuleManifest = {
    id: 'plugin.ssh',
    name: 'SSH Session Manager',
    version: '1.0.0',
    type: 'plugin',
    entry: 'index.ts',
    description: 'Stateful SSH sessions with persistent PTYs and file-transfer helpers.',
    provides: ['tools'],
    timeout: 30000,
  };

  // ===== COMPONENTS =====
  private sessionManager!: SSHSessionManager;
  private commandExecutor!: SSHCommandExecutor;
  private fileTransferHandler!: SSHFileTransferHandler;
  private poolWrapper!: SSHConnectionPoolWrapper;

  private deregisterFns: Array<() => void> = [];

  // ===== STREAMING SUPPORT =====
  private streamingExecutions = new Map<string, StreamingSSHExecution>();
  private streamingEnabled = process.env.MCP_SSH_ENABLE_STREAMING !== 'false';
  private streamUpdateCallbacks: Array<(update: SSHStreamOutputUpdate) => void> = [];

  // ===== STREAMING METHODS =====
  onSSHStreamUpdate(callback: (update: SSHStreamOutputUpdate) => void): () => void {
    this.streamUpdateCallbacks.push(callback);
    return () => {
      const index = this.streamUpdateCallbacks.indexOf(callback);
      if (index > -1) {
        this.streamUpdateCallbacks.splice(index, 1);
      }
    };
  }

  private emitSSHStreamUpdate(update: SSHStreamOutputUpdate): void {
    for (const callback of this.streamUpdateCallbacks) {
      try {
        callback(update);
      } catch (error) {
        logger.error('Error in SSH stream update callback:', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  getSSHStreamingStatus(executionId: string): StreamingSSHExecution | undefined {
    return this.streamingExecutions.get(executionId);
  }

  async onLoad(context: UnifiedModuleContext): Promise<void> {
    // Initialize all 5 sub-modules
    this.sessionManager = new SSHSessionManager();
    this.commandExecutor = new SSHCommandExecutor();
    this.fileTransferHandler = new SSHFileTransferHandler(this.commandExecutor);
    this.poolWrapper = new SSHConnectionPoolWrapper();

    // Register all tools
    this.registerSshOperate(context);
    this.registerSshListSessions(context);
    this.registerSshCloseSession(context);
    this.registerSshBuffer(context);
    this.registerSshUploadFile(context);
    this.registerSshDownloadFile(context);
    this.registerSshGetSessionInfo(context);
    this.registerSshProcessList(context);
    this.registerSshProcessKill(context);

    context.logger.info('SSH Session Manager module loaded (refactored with 5 sub-modules).', {
      component: this.manifest.id,
    });
  }

  async onUnload(): Promise<void> {
    for (const deregister of this.deregisterFns) {
      deregister();
    }
    this.deregisterFns = [];

    // Shutdown all sub-modules
    try {
      await this.sessionManager.shutdown();
      await this.poolWrapper.shutdown();
    } catch (error) {
      logger.error('Error during SSH module shutdown', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ===== TOOL REGISTRATION =====

  private registerSshOperate(context: UnifiedModuleContext): void {
    const deregister = context.moduleManager.registerToolExecution(
      'ssh_operate',
      async (rawArgs: any) => {
        const args = sshOperateSchema.parse(rawArgs);
        return this.handleSshOperate(args, context);
      },
      'ssh_operate',
      'Unified SSH operations: create sessions, send input, get output with automatic position tracking. Can create new sessions (with target), reuse existing sessions (with session_id), or just create sessions without executing commands (create_session_only). Combines ssh_new_session, ssh_execute, and ssh_get_buffer into a single streamlined interface.',
      sshOperateSchema,
      this.manifest.id
    );
    this.deregisterFns.push(deregister);
  }

  private registerSshListSessions(context: UnifiedModuleContext): void {
    const deregister = context.moduleManager.registerToolExecution(
      'ssh_list_sessions',
      async () => this.handleListSessions(),
      'ssh_list_sessions',
      'List all active SSH sessions with metadata.',
      {},
      this.manifest.id
    );
    this.deregisterFns.push(deregister);
  }

  private registerSshCloseSession(context: UnifiedModuleContext): void {
    const deregister = context.moduleManager.registerToolExecution(
      'ssh_close_session',
      async (rawArgs: any) => {
        const args = sshCloseSessionSchema.parse(rawArgs);
        return this.handleCloseSession(args, context);
      },
      'ssh_close_session',
      'Close an SSH session and clean up its PTY.',
      sshCloseSessionSchema,
      this.manifest.id
    );
    this.deregisterFns.push(deregister);
  }

  private registerSshBuffer(context: UnifiedModuleContext): void {
    const deregister = context.moduleManager.registerToolExecution(
      'ssh_get_buffer',
      async (rawArgs: any) => {
        const args = sshBufferSchema.parse(rawArgs);
        return this.handleGetBuffer(args, context);
      },
      'ssh_get_buffer',
      'Read the raw buffer for a specific SSH session.',
      sshBufferSchema,
      this.manifest.id
    );
    this.deregisterFns.push(deregister);
  }

  private registerSshUploadFile(context: UnifiedModuleContext): void {
    const deregister = context.moduleManager.registerToolExecution(
      'ssh_upload_file',
      async (rawArgs: any) => {
        const args = sshUploadSchema.parse(rawArgs);
        return this.handleUploadFile(args, context);
      },
      'ssh_upload_file',
      'Upload a local file into the remote session environment using SCP/SFTP/FTP (select transfer_method).',
      sshUploadSchema,
      this.manifest.id
    );
    this.deregisterFns.push(deregister);
  }

  private registerSshDownloadFile(context: UnifiedModuleContext): void {
    const deregister = context.moduleManager.registerToolExecution(
      'ssh_download_file',
      async (rawArgs: any) => {
        const args = sshDownloadSchema.parse(rawArgs);
        return this.handleDownloadFile(args, context);
      },
      'ssh_download_file',
      'Download a remote file through the session and save it locally via SCP/SFTP/FTP get/put.',
      sshDownloadSchema,
      this.manifest.id
    );
    this.deregisterFns.push(deregister);
  }

  private registerSshGetSessionInfo(context: UnifiedModuleContext): void {
    const deregister = context.moduleManager.registerToolExecution(
      'ssh_get_session_info',
      async (rawArgs: any) => {
        const args = sshGetSessionInfoSchema.parse(rawArgs);
        return this.handleSshGetSessionInfo(args, context);
      },
      'ssh_get_session_info',
      'Get detailed information about a specific SSH session.',
      sshGetSessionInfoSchema,
      this.manifest.id
    );
    this.deregisterFns.push(deregister);
  }

  private registerSshProcessList(context: UnifiedModuleContext): void {
    const deregister = context.moduleManager.registerToolExecution(
      'ssh_process_list',
      async (rawArgs: any) => {
        const args = sshProcessListSchema.parse(rawArgs);
        return this.handleSshProcessList(args, context);
      },
      'ssh_process_list',
      'List SSH session executions with filtering and pagination.',
      sshProcessListSchema,
      this.manifest.id
    );
    this.deregisterFns.push(deregister);
  }

  private registerSshProcessKill(context: UnifiedModuleContext): void {
    const deregister = context.moduleManager.registerToolExecution(
      'ssh_process_kill',
      async (rawArgs: any) => {
        const args = sshProcessKillSchema.parse(rawArgs);
        return this.handleSshProcessKill(args, context);
      },
      'ssh_process_kill',
      'Send a signal to terminate a running SSH process.',
      sshProcessKillSchema,
      this.manifest.id
    );
    this.deregisterFns.push(deregister);
  }


  // ===== TOOL HANDLERS =====

  private async handleSshOperate(
    args: z.infer<typeof sshOperateSchema>,
    context: UnifiedModuleContext
  ) {
    try {
      let sessionId = args.session_id;
      let sessionCreated = false;
      let session = this.sessionManager.getSession(sessionId);

      // 1. Resolve session
      if (session && sessionId) {
        if (!session.isConnected) {
          try {
            await this.sessionManager.closeSession(sessionId!);
          } catch {
            /* ignore */
          }
          session = null;
        }
      }

      // Helper to check if target has valid SSH connection info
      const hasValidTarget = (t: any): t is { host: string; port: number; user: string } => {
        return t && typeof t === 'object' && typeof t.host === 'string' && t.host.length > 0;
      };

      // Determine if we should create a session only (no command execution)
      const createSessionOnly = args.create_session_only || 
        (args.interactive && !args.command && !args.input);

      // 2. Create new session if needed
      if (!session) {
        if (hasValidTarget(args.target)) {
          const newSessionId = sessionId || `session_${Date.now()}`;
          session = await this.sessionManager.createSession(newSessionId, args.target);

          await this.sleep(1000);

          if (!session.isConnected) {
            const output = session.outputBuffer || '';
            await this.sessionManager.closeSession(newSessionId);
            if (output) {
              throw new Error(`SSH connection failed to ${args.target.host}: ${output.slice(-500)}`);
            }
            throw new Error(`SSH connection failed to ${args.target.host}. Process exited.`);
          }

          sessionId = newSessionId;
          sessionCreated = true;
        } else if (sessionId) {
          // Only session_id provided - try to find existing session
          const existingSession = this.sessionManager.getSession(sessionId);
          if (existingSession && existingSession.isConnected) {
            session = existingSession;
          } else if (existingSession) {
            throw new Error(`Session "${sessionId}" exists but is not connected. Provide target to recreate.`);
          } else {
            throw new Error(`Session "${sessionId}" not found. Provide target to create new session.`);
          }
        } else {
          // No session_id and no target - try default session
          const defaultSession = this.sessionManager.getSession(DEFAULT_SESSION_ID);
          if (defaultSession && defaultSession.isConnected) {
            session = defaultSession;
            sessionId = DEFAULT_SESSION_ID;
          } else if (createSessionOnly) {
            throw new Error('No active session. Provide session_id or target to create new session.');
          } else {
            throw new Error('No active session. Provide session_id or target.');
          }
        }
      }

      // If create_session_only is true, return session info without executing command
      if (createSessionOnly && session) {
        const target = session.target;
        const targetStr = target ? `${target.user ? `${target.user}@` : ''}${target.host}:${target.port}` : 'unknown';
        
        const response: Record<string, unknown> = {
          session_id: sessionId,
          success: true,
          session_created: sessionCreated,
          interactive: args.interactive,
          response_level: args.response_level || 'standard',
        };

        if (sessionCreated && hasValidTarget(args.target)) {
          response.target = {
            host: args.target.host,
            port: args.target.port,
            user: args.target.user,
          };
        }

        const outputText = args.interactive 
          ? `Session ${sessionId} created and ready for interactive use.\nTarget: ${targetStr}\nUse ssh_operate with session_id to send commands.`
          : `Session ${sessionId} created successfully.\nTarget: ${targetStr}`;

        return {
          content: [
            {
              type: 'text',
              text: outputText,
            },
          ],
          structuredContent: response,
        };
      }

      let commandOutput = '';
      let exitCode: number | undefined;
      let commandCompletedNormally = true;
      const executionStartTime = Date.now();

      // 3. Execute command or send input
      const inputToSend = args.command || args.input;
      if (inputToSend) {
        const timeout = DEFAULT_TIMEOUT_MS;
        const result = await this.commandExecutor.executeCommand(session, inputToSend, timeout);
        commandOutput = result.output || '';
        exitCode = result.exitCode;
        commandCompletedNormally = result.completedNormally ?? true;
      }

      // 4. Get output
      let output: string | null = null;
      if (args.get_output !== false && session) {
        if (commandOutput) {
          output = args.strip_ansi !== false ? this.cleanOutput(commandOutput) : commandOutput;
        } else {
          const delayMs = args.output_delay_ms || 500;
          if (delayMs > 0) {
            await this.sleep(delayMs);
          }
          const contentSource = session.historyLog || session.outputBuffer;
          output = args.strip_ansi !== false ? this.cleanOutput(contentSource) : contentSource;
        }

        if (output && args.output_lines) {
          const lines = output.split('\n');
          if (lines.length > args.output_lines) {
            output = lines.slice(-args.output_lines).join('\n');
          }
        }
      }

      // ===== STREAMING: Emit SSH execution updates =====
      if (this.streamingEnabled && args.output_id) {
        const executionDuration = Date.now() - executionStartTime;

        if (commandOutput) {
          this.emitSSHStreamUpdate({
            type: 'output',
            executionId: args.output_id,
            sessionId: sessionId!,
            data: commandOutput,
            isStderr: false,
            timestamp: Date.now(),
          });
        }

        this.emitSSHStreamUpdate({
          type: 'complete',
          executionId: args.output_id,
          sessionId: sessionId!,
          exitCode: exitCode || 0,
          duration: executionDuration,
          timestamp: Date.now(),
        });
      }
      // ===== END STREAMING ====

      // 6. Build response
      const response: Record<string, unknown> = {
        session_id: sessionId,
        success: true,
        response_level: args.response_level || 'standard',
      };

      if (sessionCreated) {
        response.session_created = true;
        response.target = hasValidTarget(args.target)
          ? {
              host: args.target.host,
              port: args.target.port,
              user: args.target.user,
            }
          : undefined;
      }

      if (inputToSend) {
        response.command = inputToSend;
        response.exit_code = exitCode;
      }

      if (output) {
        response.output = output;
      }

      const outputText = this.formatSshOperateText(response);

      return {
        content: [
          {
            type: 'text',
            text: outputText,
          },
        ],
        structuredContent: response,
      };
    } catch (error) {
      return this.handleError(error, context, {
        toolName: 'ssh_operate',
        sessionId: args.session_id,
        command: args.command,
      });
    }
  }

  private handleListSessions() {
    const sessions = this.sessionManager.listSessions();

    if (sessions.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No active SSH sessions.',
          },
        ],
        structuredContent: { sessions: [], count: 0 },
      };
    }

    const sessionList = sessions.map((session) => {
      const uptimeSeconds = Math.floor((Date.now() - session.created) / 1000);
      const target = session.target;
      const targetStr = target ? `${target.user ? `${target.user}@` : ''}${target.host}:${target.port}` : 'unknown';
      const isRunning = session.isConnected;

      return {
        id: session.id,
        status: session.isReady ? 'ready' : 'busy',
        target: targetStr,
        lastCommand: session.lastCommand || null,
        uptimeSeconds,
        isRunning,
        createdAt: new Date(session.created).toISOString(),
      };
    });

    const formatted = sessionList
      .map((s) => {
        return (
          `• ${s.id}\n` +
          `  Status: ${s.isRunning ? 'connected' : 'disconnected'} (${s.status})\n` +
          `  Target: ${s.target}\n` +
          `  Last command: ${s.lastCommand || '(none)'}\n` +
          `  Uptime: ${s.uptimeSeconds}s`
        );
      })
      .join('\n\n');

    return {
      content: [
        {
          type: 'text',
          text: `Active SSH sessions (${sessions.length}):\n\n${formatted}`,
        },
      ],
      structuredContent: { sessions: sessionList, count: sessions.length },
    };
  }

  private async handleCloseSession(
    args: z.infer<typeof sshCloseSessionSchema>,
    context: UnifiedModuleContext
  ) {
    try {
      const session = this.sessionManager.getSession(args.session_id);
      if (!session) {
        throw new Error(`Session ${args.session_id} not found.`);
      }

      await this.sessionManager.closeSession(args.session_id);

      return {
        content: [
          {
            type: 'text',
            text: `Closed session ${args.session_id}`,
          },
        ],
      };
    } catch (error) {
      return this.handleError(error, context, {
        toolName: 'ssh_close_session',
        sessionId: args.session_id,
      });
    }
  }

  private async handleGetBuffer(
    args: z.infer<typeof sshBufferSchema>,
    context: UnifiedModuleContext
  ) {
    try {
      const session = this.sessionManager.getSession(args.session_id);
      if (!session) {
        const message = `Session ${args.session_id} not found. Call ssh_new_session before inspecting buffers.`;
        context.logger.warn('ssh_get_buffer: session missing', {
          component: this.manifest.id,
          sessionId: args.session_id,
        });
        return {
          content: [
            {
              type: 'text',
              text: message,
            },
          ],
          isError: true,
        };
      }

      const contentSource = session.historyLog || session.outputBuffer;
      let buffer = contentSource;

      if (args.filter === 'last_command' && session.lastCommand) {
        const cmdIndex = contentSource.lastIndexOf(session.lastCommand);
        if (cmdIndex >= 0) {
          buffer = contentSource.substring(cmdIndex + session.lastCommand.length);
        }
      } else if (args.filter === 'since_last') {
        if (session.lastCommand) {
          const cmdIndex = contentSource.lastIndexOf(session.lastCommand);
          if (cmdIndex >= 0) {
            buffer = contentSource.substring(cmdIndex + session.lastCommand.length);
          }
        }
      }

      if (args.pattern) {
        const lines = buffer.split('\n');
        buffer = lines.filter(line =>
          line.toLowerCase().includes(args.pattern!.toLowerCase())
        ).join('\n');
      }

      const shouldClean = args.clean !== false;
      buffer = shouldClean ? this.cleanOutput(buffer) : buffer;

      const target = session.target;
      const targetStr = target ? `${target.user ? `${target.user}@` : ''}${target.host}:${target.port}` : 'unknown';
      const isRunning = session.isConnected;

      if (args.clear) {
        session.outputBuffer = '';
        session.historyLog = '';
      }

      if (args.format === 'json') {
        const jsonData = {
          session_id: args.session_id || DEFAULT_SESSION_ID,
          target: target ? {
            host: target.host,
            port: target.port,
            user: target.user,
          } : null,
          status: isRunning ? 'connected' : 'disconnected',
          is_ready: session.isReady,
          buffer_size: buffer.length,
          last_command: session.lastCommand || null,
          created_at: session.created,
          buffer: buffer,
          filter: args.filter,
          pattern: args.pattern || null,
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(jsonData, null, 2),
            },
          ],
          isJson: true,
        };
      }

      const info = `Session: ${args.session_id}
Target: ${targetStr}
Status: ${isRunning ? 'connected' : 'disconnected'} (${session.isReady ? 'ready' : 'busy'})
Buffer size: ${buffer.length} chars
Last command: ${session.lastCommand || '(none)'}

--- Buffer Content ---
${buffer || '(empty)'}`;

      return {
        content: [
          {
            type: 'text',
            text: info,
          },
        ],
        structuredContent: {
          session_id: args.session_id,
          target: target,
          status: isRunning ? 'connected' : 'disconnected',
          bufferSize: buffer.length,
          lastCommand: session.lastCommand,
          buffer: buffer,
        },
      };
    } catch (error) {
      return this.handleError(error, context, {
        toolName: 'ssh_get_buffer',
        sessionId: args.session_id,
      });
    }
  }

  private async handleUploadFile(
    args: z.infer<typeof sshUploadSchema>,
    context: UnifiedModuleContext
  ) {
    try {
      const session = this.sessionManager.getSession(args.session_id);
      if (!session) {
        throw new Error(`Session ${args.session_id} not found. Create it with ssh_new_session before uploading files.`);
      }

      const localPath = path.resolve(process.cwd(), args.local_path);
      const remoteTarget = this.fileTransferHandler.resolveRemotePath(args.remote_path, session);
      const timeout = Math.min(args.timeout, FILE_TRANSFER_TIMEOUT);

      const result = await this.fileTransferHandler.uploadFile(
        session,
        localPath,
        remoteTarget,
        args.transfer_method,
        timeout
      );

      return {
        content: [
          {
            type: 'text',
            text: result.message,
          },
        ],
        structuredContent: {
          sessionId: args.session_id,
          localPath,
          remotePath: result.remotePath,
          transferMethod: args.transfer_method,
          size: result.size,
        },
      };
    } catch (error) {
      return this.handleError(error, context, {
        toolName: 'ssh_upload_file',
        sessionId: args.session_id,
        details: {
          localPath: args.local_path,
          remotePath: args.remote_path,
        },
      });
    }
  }

  private async handleDownloadFile(
    args: z.infer<typeof sshDownloadSchema>,
    context: UnifiedModuleContext
  ) {
    try {
      const session = this.sessionManager.getSession(args.session_id);
      if (!session) {
        throw new Error(
          `Session ${args.session_id} not found. Create it with ssh_new_session before downloading files.`
        );
      }

      const remoteTarget = this.fileTransferHandler.resolveRemotePath(args.remote_path, session);
      const localPath = path.resolve(process.cwd(), args.local_path);
      const timeout = Math.min(args.timeout, FILE_TRANSFER_TIMEOUT);

      const result = await this.fileTransferHandler.downloadFile(
        session,
        remoteTarget,
        localPath,
        args.transfer_method,
        timeout
      );

      return {
        content: [
          {
            type: 'text',
            text: result.message,
          },
        ],
        structuredContent: {
          sessionId: args.session_id,
          remotePath: remoteTarget,
          localPath: result.localPath,
          transferMethod: args.transfer_method,
          size: result.size,
        },
      };
    } catch (error) {
      return this.handleError(error, context, {
        toolName: 'ssh_download_file',
        sessionId: args.session_id,
        details: {
          remotePath: args.remote_path,
          localPath: args.local_path,
        },
      });
    }
  }

  private async handleSshGetSessionInfo(
    args: z.infer<typeof sshGetSessionInfoSchema>,
    context: UnifiedModuleContext
  ) {
    const session = this.sessionManager.getSession(args.session_id);
    if (!session) {
      throw new Error(`Session ${args.session_id} not found.`);
    }

    const info = {
      session_id: session.id,
      target: session.target ? {
        host: session.target.host,
        port: session.target.port,
        user: session.target.user,
      } : null,
      is_connected: session.isConnected,
      is_ready: session.isReady,
      last_command: session.lastCommand,
      created_at: session.created,
      output_buffer_size: session.outputBuffer?.length || 0,
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(info, null, 2) }],
      structuredContent: info,
    };
  }

  private async handleSshProcessList(
    args: z.infer<typeof sshProcessListSchema>,
    context: UnifiedModuleContext
  ) {
    const sessions = this.sessionManager.listSessions();
    
    let filtered = sessions;
    if (args.session_id) {
      filtered = filtered.filter((s) => s.id === args.session_id);
    }
    if (args.command_pattern) {
      const pattern = args.command_pattern || '';
      filtered = filtered.filter((s) => (s.lastCommand ? s.lastCommand.includes(pattern) : false));
    }

    const statusFilter = args.status_filter || 'all';
    filtered = filtered.filter((s) => this.matchesStatusFilter(s, statusFilter));

    const limit = args.limit || 50;
    const offset = args.offset || 0;
    const paginated = filtered.slice(offset, offset + limit);

    const executions = paginated.map(s => ({
      session_id: s.id,
      status: s.isReady ? 'completed' : (s.isConnected ? 'running' : 'failed'),
      command: s.lastCommand || '',
      start_time: s.created,
      output_buffer_size: s.outputBuffer?.length || 0,
    }));

    return {
      content: [{ type: 'text', text: JSON.stringify(executions, null, 2) }],
      structuredContent: {
        total: filtered.length,
        limit,
        offset,
        executions,
      },
    };
  }

  private async handleSshProcessKill(
    args: z.infer<typeof sshProcessKillSchema>,
    context: UnifiedModuleContext
  ) {
    const session = this.sessionManager.getSession(args.session_id);
    if (!session) {
      throw new Error(`Session ${args.session_id} not found.`);
    }

    if (!session.ptyProcess) {
      throw new Error(`No PTY process found for session ${args.session_id}`);
    }

    const pid = args.process_id;
    if (pid <= 0) {
      throw new Error('Invalid process ID provided.');
    }

    const signalLabel = args.force ? 'KILL' : args.signal;
    const killCmd = `kill -${signalLabel} ${pid}`;

    const result = await this.commandExecutor.executeCommand(session, killCmd, 5000);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to send ${signalLabel} to PID ${pid}: ${result.output || 'unknown error'}`);
    }

    return {
      content: [{ type: 'text', text: `Signal ${signalLabel} sent to PID ${pid} (session ${args.session_id})` }],
      structuredContent: {
        session_id: args.session_id,
        signal: signalLabel,
        process_id: pid,
        forced: args.force,
      },
    };
  }


  // ===== PRIVATE HELPERS =====

  private handleError(
    error: unknown,
    context: UnifiedModuleContext,
    options: {
      toolName: string;
      code?: string;
      details?: Record<string, unknown>;
      sessionId?: string;
      command?: string;
    }
  ) {
    const message = error instanceof Error ? error.message : String(error);
    let errorCode = options.code || ERROR_CODES.INTERNAL_ERROR;

    // Error classification
    if (message.includes('Session') && message.includes('not found')) {
      errorCode = ERROR_CODES.SESSION_NOT_FOUND;
    } else if (message.includes('busy executing')) {
      errorCode = ERROR_CODES.SESSION_BUSY;
    } else if (message.includes('already exists')) {
      errorCode = ERROR_CODES.SESSION_EXISTS;
    } else if (message.includes('timeout') || message.includes('timeout after')) {
      errorCode = ERROR_CODES.COMMAND_TIMEOUT;
    } else if (
      message.includes('Connection') ||
      message.includes('ECONNREFUSED') ||
      message.includes('connection failed')
    ) {
      errorCode = ERROR_CODES.CONNECTION_FAILED;
    } else if (message.includes('authentication') || message.includes('Auth')) {
      errorCode = ERROR_CODES.AUTHENTICATION_FAILED;
    } else if (message.includes('ENOENT') || message.includes('not exist') || message.includes('No such file')) {
      errorCode = ERROR_CODES.NOT_FOUND;
    } else if (message.includes('EACCES') || message.includes('permission denied') || message.includes('Permission denied')) {
      errorCode = ERROR_CODES.PERMISSION_DENIED;
    } else if (message.includes('Command exited with code')) {
      errorCode = ERROR_CODES.TOOL_EXECUTION_ERROR;
    }

    context.logger.error(`${options.toolName} failed`, {
      component: this.manifest.id,
      error,
      ...options.details,
    });

    return createErrorResponse(errorCode as any, message, {
      details: {
        tool: options.toolName,
        ...options.details,
      },
      suggestion: getErrorSuggestion(errorCode as any, message),
    });
  }

  private formatSshOperateText(response: Record<string, unknown>): string {
    const lines: string[] = [];
    const level = (response.response_level as string) || 'standard';

    if (level === 'full') {
      if (response.session_created) {
        const target = response.target as { host?: string; port?: number; user?: string } | undefined;
        if (target) {
          lines.push(`Created session: ${response.session_id}`);
          lines.push(`Target: ${target.user ? `${target.user}@` : ''}${target.host}:${target.port}`);
        }
      } else {
        lines.push(`Session: ${response.session_id}`);
      }
    } else if (level === 'standard') {
      lines.push(`Session: ${response.session_id}`);
    }

    if (response.command && level !== 'minimal') {
      lines.push(`Command: ${response.command}`);
      if (response.exit_code !== undefined) {
        lines.push(`Exit code: ${response.exit_code}`);
      }
    }

    if (response.output) {
      if (level !== 'minimal') {
        lines.push('');
      }
      lines.push(String(response.output));
    }

    return lines.join('\n');
  }

  private matchesStatusFilter(session: Session, filter: 'running' | 'completed' | 'failed' | 'all'): boolean {
    switch (filter) {
      case 'running':
        return session.isConnected && !session.isReady;
      case 'completed':
        return session.isConnected && session.isReady;
      case 'failed':
        return !session.isConnected;
      case 'all':
      default:
        return true;
    }
  }

  private cleanOutput(output: string): string {
    if (!output) return '';
    let result = stripVTControlCharacters(output);
    result = result
      .replace(/\x1b/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return result;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
