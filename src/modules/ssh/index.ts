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

const sshOperateBaseSchema = z.object({
  terminal_id: z
    .string()
    .optional()
    .describe('Existing terminal/session ID to use. If not provided, creates new session when command is specified.'),
  session_id: z
    .string()
    .optional()
    .describe('Session ID to use (alias for terminal_id). If session exists, use it. If not found, create new session (requires target).'),
  session_name: z
    .string()
    .optional()
    .describe('Name for new session when creating one. If not provided, a random ID will be generated.'),
  target: z.union([sshTargetSchema, z.object({}).strip()]).optional().describe('SSH connection target. Used to create new session if terminal_id/session_id not provided or not found.'),
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
    .describe('Input to send to the session (alternative to command). Can be partial input or complete command.'),
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
    .describe('When true, strips ANSI/control sequences from terminal output text.'),
  include_ansi: z
    .boolean()
    .default(false)
    .describe('Include ANSI codes in output.'),
  output_id: z
    .string()
    .optional()
    .describe('Unique ID for streaming output subscription. If provided, real-time output updates will be emitted.'),
  dimensions: TerminalDimensionsSchema.optional().describe('Terminal dimensions for PTY.'),
  working_directory: z.string().optional().describe('Working directory for command execution.'),
  environment_variables: z.record(z.string(), z.string()).optional().describe('Environment variables.'),
  control_codes: z.boolean().default(false).describe('Interpret input as control codes (e.g., \\n, \\t, \\x03 for Ctrl+C).'),
  send_to: z.string().optional().describe('Program guard target for input routing.'),
  force_input: z.boolean().default(false).describe('Force input even if unread output exists. Default: false (input rejected if unread output exists).'),
  output_lines: z.number().int().min(1).max(1000).default(20).describe('Number of output lines to retrieve.'),
  response_level: z.enum(['minimal', 'standard', 'full']).default('standard').describe('Response detail level.'),
  return_session_info: z.boolean().default(true).describe('Include session information in response.'),
});

const sshOperateSchema = sshOperateBaseSchema
  .transform((data) => ({
    ...data,
    session_id: data.terminal_id || data.session_id,
  }))
  .refine((data) => data.session_id || data.command || data.create_session_only || data.target, {
    message: 'Provide session_id, command, or target',
    path: ['terminal_id', 'session_id', 'command', 'target'],
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
  filter_command: z.string().optional().describe('Filter to show only output for specific command.'),
  last_command: z.boolean().optional().default(false).describe('Show only last command output.'),
  search: z.string().optional().describe('Search for text in output.'),
  start_after: z.string().optional().describe('Start output after this text.'),
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
      'SshOperate',
      async (rawArgs: any) => {
        const args = sshOperateSchema.parse(rawArgs);
        return this.handleSshOperate(args, context);
      },
      'SshOperate',
      'Unified SSH operations that can create or reuse sessions, execute commands, stream output, and handle interactive input in one request. ' +
        'Supports targets, session_id, commands, input, output_id streaming, clean output, and create_session_only flows so a single call can manage session lifecycle and output retrieval. ' +
        'Use it for deployments, package installs, troubleshooting prompts, or any flow where you want the server to open sessions and capture output with minimal orchestration.',
      sshOperateSchema,
      this.manifest.id
    );
    this.deregisterFns.push(deregister);
  }

  private registerSshListSessions(context: UnifiedModuleContext): void {
    const deregister = context.moduleManager.registerToolExecution(
      'SshListSessions',
      async () => this.handleListSessions(),
      'SshListSessions',
      'List all active SSH sessions with metadata (target, user, busy flag, creation time, last used, PTY size). ' +
        'Use it before reusing session_ids or to display active sessions in monitoring dashboards.',
      {},
      this.manifest.id
    );
    this.deregisterFns.push(deregister);
  }

  private registerSshCloseSession(context: UnifiedModuleContext): void {
    const deregister = context.moduleManager.registerToolExecution(
      'SshCloseSession',
      async (rawArgs: any) => {
        const args = sshCloseSessionSchema.parse(rawArgs);
        return this.handleCloseSession(args, context);
      },
      'SshCloseSession',
      'Close an SSH session gracefully (or forcefully) and clean up its PTY/buffer. ' +
        'Use it when the remote workflow is finished to release resources and avoid stale terminals.',
      sshCloseSessionSchema,
      this.manifest.id
    );
    this.deregisterFns.push(deregister);
  }

  private registerSshBuffer(context: UnifiedModuleContext): void {
    const deregister = context.moduleManager.registerToolExecution(
      'SshGetBuffer',
      async (rawArgs: any) => {
        const args = sshBufferSchema.parse(rawArgs);
        return this.handleGetBuffer(args, context);
      },
      'SshGetBuffer',
      'Read the current buffer for a session with optional cleaning, ANSI stripping, filtering, or clear-on-read behavior. ' +
        'Use this to inspect output before sending new commands or to verify a remote job status without executing anything.',
      sshBufferSchema,
      this.manifest.id
    );
    this.deregisterFns.push(deregister);
  }

  private registerSshUploadFile(context: UnifiedModuleContext): void {
    const deregister = context.moduleManager.registerToolExecution(
      'SshUploadFile',
      async (rawArgs: any) => {
        const args = sshUploadSchema.parse(rawArgs);
        return this.handleUploadFile(args, context);
      },
      'SshUploadFile',
      'Upload a local file to the remote host via SCP (default), SFTP, or FTP transfer methods, validating paths and honoring the transfer_method override. ' +
        'Use it for pushing scripts, configs, or deployments before running remote commands.',
      sshUploadSchema,
      this.manifest.id
    );
    this.deregisterFns.push(deregister);
  }

  private registerSshDownloadFile(context: UnifiedModuleContext): void {
    const deregister = context.moduleManager.registerToolExecution(
      'SshDownloadFile',
      async (rawArgs: any) => {
        const args = sshDownloadSchema.parse(rawArgs);
        return this.handleDownloadFile(args, context);
      },
      'SshDownloadFile',
      'Download a remote file via SCP/SFTP/FTP while validating remote paths and optional destination. ' +
        'Use it when you need logs, artifacts, or configs from the remote host for inspection.',
      sshDownloadSchema,
      this.manifest.id
    );
    this.deregisterFns.push(deregister);
  }

  private registerSshGetSessionInfo(context: UnifiedModuleContext): void {
    const deregister = context.moduleManager.registerToolExecution(
      'SshGetSessionInfo',
      async (rawArgs: any) => {
        const args = sshGetSessionInfoSchema.parse(rawArgs);
        return this.handleSshGetSessionInfo(args, context);
      },
      'SshGetSessionInfo',
      'Return metadata for a session (target, busy flag, last command, timestamps, PTY dimensions, buffer length). ' +
        'Use this before sending new commands to know if the session is ready or should be replaced.',
      sshGetSessionInfoSchema,
      this.manifest.id
    );
    this.deregisterFns.push(deregister);
  }

  private registerSshProcessList(context: UnifiedModuleContext): void {
    const deregister = context.moduleManager.registerToolExecution(
      'SshProcessList',
      async (rawArgs: any) => {
        const args = sshProcessListSchema.parse(rawArgs);
        return this.handleSshProcessList(args, context);
      },
      'SshProcessList',
      'List executed commands across SSH sessions with filters for session_id, status, and command pattern plus pagination. ' +
        'Use it to monitor remote jobs, check for stuck commands, or replay their output.',
      sshProcessListSchema,
      this.manifest.id
    );
    this.deregisterFns.push(deregister);
  }

  private registerSshProcessKill(context: UnifiedModuleContext): void {
    const deregister = context.moduleManager.registerToolExecution(
      'SshProcessKill',
      async (rawArgs: any) => {
        const args = sshProcessKillSchema.parse(rawArgs);
        return this.handleSshProcessKill(args, context);
      },
      'SshProcessKill',
      'Send a signal (default SIGTERM) to terminate a running SSH process by PID or execution_id. ' +
        'Use it to stop stuck remote commands before restarting them or cleaning up locks.',
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
      const shouldStripAnsi = args.strip_ansi !== undefined ? args.strip_ansi : !args.include_ansi;
      let sessionId = args.session_id;
      let sessionInfo: Session | null = null;
      let sessionCreated = false;
      let inputRejected = false;
      let rejectionReason = '';
      let unreadOutputInfo: {
        output: string;
        line_count: number;
        total_lines: number;
        has_more: boolean;
        start_line: number;
        next_start_line: number;
      } | null = null;

      const hasValidTarget = (t: unknown): t is { host: string; port: number; user: string } => {
        return t !== null && t !== undefined && typeof t === 'object' && typeof (t as { host?: unknown }).host === 'string' && (t as { host: string }).host.length > 0;
      };

      const createSessionOnly = args.create_session_only || 
        (args.interactive && !args.command && !args.input);

      if (hasValidTarget(args.target)) {
        if (sessionId) {
          console.warn(`[SSH] Both session_id and target provided. Target will override session_id "${sessionId}". Use target=null to use existing session.`);
        }

        const newSessionId = args.session_id || args.session_name || `session_${Date.now()}`;
        sessionInfo = await this.sessionManager.createSession(newSessionId, args.target);
        await this.sleep(1000);

        if (!sessionInfo.isConnected) {
          const output = sessionInfo.outputBuffer || '';
          await this.sessionManager.closeSession(newSessionId);
          
          const targetPassword = (args.target as { password?: string }).password;
          const authType = targetPassword ? 'password' : 'key';
          const targetUser = String((args.target as { user?: unknown }).user || '');
          const targetHost = String((args.target as { host?: unknown }).host || '');
          
          if (/permission denied/i.test(output)) {
            if (authType === 'key') {
              throw new Error(`SSH key auth failed: ${targetUser}@${targetHost} (Permission denied)`);
            } else {
              throw new Error(`SSH password auth failed: ${targetUser}@${targetHost} (Incorrect password)`);
            }
          }
          
          if (/password/i.test(output) && !targetPassword) {
            throw new Error(`SSH auth failed: Password required for ${targetUser}@${targetHost}`);
          }
          
          const port = (args.target as { port?: number }).port || 22;
          if (output) {
            throw new Error(`SSH connection failed: ${targetHost}:${port}`);
          }
          throw new Error(`SSH connection failed: ${targetHost}:${port}`);
        }

        sessionId = newSessionId;
        sessionCreated = true;

        if (args.command) {
          const commandResult = await this.commandExecutor.executeCommand(
            sessionInfo,
            args.command,
            DEFAULT_TIMEOUT_MS
          );
          sessionInfo.lastCommandOutput = commandResult.output;
          sessionInfo.lastCommandBufferPos = commandResult.bufferStartPos;
        }
      } else if (sessionId) {
        const existingSession = this.sessionManager.getSession(sessionId);
        if (existingSession && existingSession.isConnected) {
          sessionInfo = existingSession;
        } else if (existingSession) {
          throw new Error('Session not connected. Provide target to recreate.');
        } else {
          throw new Error(`Session "${sessionId}" not found`);
        }

        const inputToSend = args.input || args.command;
        if (typeof inputToSend === 'string' && inputToSend.length > 0) {
          const effectiveForceInput = args.force_input || args.control_codes;

          if (!effectiveForceInput) {
            const fullBuffer = sessionInfo.outputBuffer || '';
            if (fullBuffer.trim().length > 0) {
              inputRejected = true;
              rejectionReason = 'Unread output exists. Use force_input=true';
              unreadOutputInfo = this.buildOutputInfo(fullBuffer, 1000, !shouldStripAnsi);
            }
          }

          if (!inputRejected) {
            const commandResult = await this.commandExecutor.executeCommand(
              sessionInfo,
              inputToSend,
              DEFAULT_TIMEOUT_MS
            );
            sessionInfo.lastCommandOutput = commandResult.output;
            sessionInfo.lastCommandBufferPos = commandResult.bufferStartPos;
          }
        }
      } else {
        const defaultSession = this.sessionManager.getSession(DEFAULT_SESSION_ID);
        if (defaultSession && defaultSession.isConnected) {
          sessionInfo = defaultSession;
          sessionId = DEFAULT_SESSION_ID;
        } else {
          throw new Error('No active session. Provide session_id or target.');
        }
      }

      if (createSessionOnly && sessionInfo) {
        const target = sessionInfo.target;
        const targetStr = target ? `${target.user ? `${target.user}@` : ''}${target.host}:${target.port}` : 'unknown';
        
        const response: Record<string, unknown> = {
          session_id: sessionId,
          success: true,
          strip_ansi: shouldStripAnsi,
          session_created: sessionCreated,
          interactive: args.interactive,
          response_level: args.response_level || 'standard',
        };

        if (sessionCreated && hasValidTarget(args.target)) {
          response.target = {
            host: String((args.target as { host?: unknown }).host || ''),
            port: Number((args.target as { port?: unknown }).port) || 22,
            user: String((args.target as { user?: unknown }).user || ''),
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

      if (args.output_delay_ms > 0) {
        await this.sleep(args.output_delay_ms);
      }

      let outputData: {
        output: string;
        line_count: number;
        total_lines: number;
        has_more: boolean;
        start_line: number;
        next_start_line: number;
      } | null = null;

      if (args.get_output !== false && sessionInfo) {
        let outputSource = sessionInfo.lastCommandOutput || '';
        if (!outputSource && sessionInfo.outputBuffer) {
          outputSource = sessionInfo.outputBuffer;
        }
        outputData = this.buildOutputInfo(outputSource, args.output_lines || 20, !shouldStripAnsi);
        sessionInfo.lastCommandOutput = '';
      }

      const inputToSend = args.input || args.command;

      const response: Record<string, unknown> = {
        session_id: sessionId,
        success: !inputRejected,
        strip_ansi: shouldStripAnsi,
      };

      if (inputToSend) {
        response.command = inputToSend;
      }

      if (inputRejected) {
        response.input_rejected = true;
        response.reason = rejectionReason;
        if (unreadOutputInfo) {
          response.unread_output = unreadOutputInfo.output;
          response.unread_output_info = {
            line_count: unreadOutputInfo.line_count,
            total_lines: unreadOutputInfo.total_lines,
            has_more: unreadOutputInfo.has_more,
            start_line: unreadOutputInfo.start_line,
            next_start_line: unreadOutputInfo.next_start_line,
          };
        }
      }

      if (sessionInfo && args.return_session_info !== false) {
        response.session_info = {
          id: sessionInfo.id,
          is_connected: sessionInfo.isConnected,
          is_ready: sessionInfo.isReady,
          last_command: sessionInfo.lastCommand,
          created: sessionInfo.created,
        };
      }

      if (sessionCreated && hasValidTarget(args.target)) {
        response.target = {
          host: String((args.target as { host?: unknown }).host || ''),
          port: Number((args.target as { port?: unknown }).port) || 22,
          user: String((args.target as { user?: unknown }).user || ''),
        };
      }

      if (outputData) {
        response.output = outputData.output;
        response.output_info = {
          line_count: outputData.line_count,
          total_lines: outputData.total_lines,
          has_more: outputData.has_more,
          start_line: outputData.start_line,
          next_start_line: outputData.next_start_line,
        };
      }

      if (args.response_level === 'minimal') {
        return {
          content: [
            {
              type: 'text',
              text: outputData?.output || '',
            },
          ],
          structuredContent: {
            session_id: sessionId,
            success: !inputRejected,
            output: outputData?.output || null,
          },
        };
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
        throw new Error(`Session "${args.session_id}" not found`);
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
        const message = `Session "${args.session_id}" not found`;
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

      if (args.filter_command) {
        const cmdIndex = contentSource.lastIndexOf(args.filter_command);
        if (cmdIndex >= 0) {
          buffer = contentSource.substring(cmdIndex + args.filter_command.length);
        }
      }

      if (args.last_command && session.lastCommand) {
        const cmdIndex = contentSource.lastIndexOf(session.lastCommand);
        if (cmdIndex >= 0) {
          buffer = contentSource.substring(cmdIndex + session.lastCommand.length);
        }
      }

      if (args.start_after) {
        const startIndex = buffer.indexOf(args.start_after);
        if (startIndex >= 0) {
          buffer = buffer.substring(startIndex + args.start_after.length);
        }
      }

      if (args.pattern) {
        const lines = buffer.split('\n');
        buffer = lines.filter(line =>
          line.toLowerCase().includes(args.pattern!.toLowerCase())
        ).join('\n');
      }

      if (args.search) {
        const searchLower = args.search.toLowerCase();
        const lines = buffer.split('\n');
        buffer = lines.filter(line =>
          line.toLowerCase().includes(searchLower)
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
          filter_command: args.filter_command || null,
          last_command_filter: args.last_command || null,
          search: args.search || null,
          start_after: args.start_after || null,
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
        throw new Error(`Session "${args.session_id}" not found`);
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
        throw new Error(`Session "${args.session_id}" not found`);
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
      throw new Error(`Session "${args.session_id}" not found`);
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
      throw new Error(`Session "${args.session_id}" not found`);
    }

    if (!session.ptyProcess) {
      throw new Error('No PTY process found');
    }

    const pid = args.process_id;
    if (pid <= 0) {
      throw new Error('Invalid process ID');
    }

    const signalLabel = args.force ? 'KILL' : args.signal;
    const killCmd = `kill -${signalLabel} ${pid}`;

    const result = await this.commandExecutor.executeCommand(session, killCmd, 5000);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to send ${signalLabel} to PID ${pid}`);
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
    const sessionId = String(response.session_id || 'unknown');
    const success = response.success === true;
    const inputRejected = response.inputRejected === true || response.input_rejected === true;
    const reason = response.reason || response.reason;
    const outputRaw = String(response.output || '');
    const shouldStripAnsi = response.strip_ansi !== false;
    const output = shouldStripAnsi ? this.cleanOutput(outputRaw) : outputRaw;
    const outputInfo = response.output_info as Record<string, unknown> | undefined;
    const hasMore = outputInfo?.has_more === true;
    const lineCount = outputInfo?.line_count as number | undefined;
    const partial = response.partial === true;

    const lines: string[] = [`session_id: ${sessionId}`, `success: ${success}`];
    lines.push(`strip_ansi: ${shouldStripAnsi}`);
    
    if (inputRejected) {
      lines.push('input_rejected: true');
    }
    if (reason) {
      lines.push(`reason: ${reason}`);
    }
    if (lineCount !== undefined) {
      lines.push(`line_count: ${lineCount}`);
    }
    if (outputInfo && Object.keys(outputInfo).length > 0) {
      lines.push(`has_more: ${hasMore}`);
    }
    if (partial) {
      lines.push('partial: true');
      lines.push('note: Command may still be running. Use ssh_get_buffer for full output.');
    }
    const command = response.command as string | undefined;
    if (command) {
      lines.push(`command: ${command}`);
    }
    if (output) {
      lines.push('', output);
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

  private buildOutputInfo(
    fullBuffer: string,
    maxLines: number,
    includeAnsi: boolean
  ): {
    output: string;
    line_count: number;
    total_lines: number;
    has_more: boolean;
    start_line: number;
    next_start_line: number;
  } {
    let content = fullBuffer;
    if (!includeAnsi) {
      content = this.cleanOutput(content);
    }

    const allLines = content.split('\n');
    const totalLines = allLines.length;
    const startLine = Math.max(0, totalLines - maxLines);
    const hasMore = totalLines > maxLines;

    const outputLines = hasMore ? allLines.slice(startLine) : allLines;
    const output = outputLines.join('\n');

    return {
      output,
      line_count: outputLines.length,
      total_lines: totalLines,
      has_more: hasMore,
      start_line: startLine,
      next_start_line: hasMore ? startLine + maxLines : totalLines,
    };
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
