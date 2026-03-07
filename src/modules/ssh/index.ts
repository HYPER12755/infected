import os from 'node:os';
import path from 'node:path';
import { promises as fsPromises } from 'node:fs';
import { spawn, type IPty } from 'node-pty';
import { z } from 'zod';
import { IUnifiedPlugin, UnifiedModuleContext, UnifiedModuleManifest } from '../../core/module-system/module-types.js';
import { createErrorResponse, ERROR_CODES, getErrorSuggestion } from '../../core/tool-error.js';

const DEFAULT_SESSION_ID = 'default';
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TIMEOUT_MS = 120000;
const MAX_BUFFER_CHARS = 200_000;
const MAX_HISTORY_CHARS = 400_000;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const FILE_TRANSFER_TIMEOUT = 300000;

const sshExecuteSchema = z.object({
  command: z.string().min(1).describe('Command to run inside the session.'),
  session_id: z
    .string()
    .optional()
    .default(DEFAULT_SESSION_ID)
    .describe('Session identifier to reuse across commands.'),
  timeout: z
    .number()
    .int()
    .min(1000)
    .max(MAX_TIMEOUT_MS)
    .optional()
    .default(DEFAULT_TIMEOUT_MS)
    .describe('Timeout in milliseconds (default 30000, max 120000).'),
  allowFailure: z
    .boolean()
    .optional()
    .default(false)
    .describe('Return the output even if the command exits with a non-zero code.'),
});

const sshTargetSchema = z
  .object({
    host: z.string().min(1).describe('Remote hostname or IP address.'),
    port: z.number().int().min(1).max(65535).describe('Remote SSH port.'),
    user: z.string().min(1).describe('Remote username.'),
    identityFile: z.string().min(1).optional().describe('Path to private key file for authentication.'),
    extraArgs: z
      .array(z.string())
      .optional()
      .describe('Additional command-line arguments forwarded to `ssh` (e.g., "-o StrictHostKeyChecking=no").'),
  })
  .describe('Connection target used to spawn an SSH client session to a remote host.');

type SSHConnectionTarget = z.infer<typeof sshTargetSchema>;

const sshNewSessionSchema = z.object({
  session_id: z.string().min(1).describe('Unique identifier for the new session.'),
  target: sshTargetSchema.describe('Remote connection details for this session.'),
});

const sshCloseSessionSchema = z.object({
  session_id: z.string().min(1).describe('Session ID to close.'),
});

const sshOperateSchema = z.object({
  session_id: z
    .string()
    .optional()
    .describe('Session ID to use. If session exists, use it. If not found, create new session (requires target).'),
  target: z.union([sshTargetSchema, z.object({}).strip()]).optional().describe('SSH connection target. Used to create new session if session_id not provided or not found.'),
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
  output_delay_ms: z
    .number()
    .int()
    .min(0)
    .max(10000)
    .default(500)
    .describe('Delay in milliseconds before retrieving output.'),
  clean: z
    .boolean()
    .default(true)
    .describe('Strip ANSI/control sequences from output.'),
  timeout: z
    .number()
    .int()
    .min(1000)
    .max(MAX_TIMEOUT_MS)
    .optional()
    .default(DEFAULT_TIMEOUT_MS)
    .describe('Timeout in milliseconds for command execution.'),
});

const sshBufferSchema = z.object({
  session_id: z
    .string()
    .optional()
    .default(DEFAULT_SESSION_ID)
    .describe('Session ID to inspect.'),
  clean: z.boolean().optional().default(true).describe('Strip ANSI/control sequences.'),
});

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
});

interface TerminalSession {
  id: string;
  ptyProcess: IPty;
  outputBuffer: string;
  isReady: boolean;
  isConnected: boolean;
  lastCommand: string;
  createdAt: Date;
  target?: SSHConnectionTarget;
  historyLog: string;
}

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

  private sessions = new Map<string, TerminalSession>();
  private deregisterFns: Array<() => void> = [];

  async onLoad(context: UnifiedModuleContext): Promise<void> {
    this.registerSshExecute(context);
    this.registerSshNewSession(context);
    this.registerSshOperate(context);
    this.registerSshListSessions(context);
    this.registerSshCloseSession(context);
    this.registerSshBuffer(context);
    this.registerSshUploadFile(context);
    this.registerSshDownloadFile(context);
    context.logger.info('SSH Session Manager module loaded.', { component: this.manifest.id });
  }

  async onUnload(): Promise<void> {
    for (const deregister of this.deregisterFns) {
      deregister();
    }
    this.deregisterFns = [];
    this.sessions.forEach((session) => {
      try {
        session.ptyProcess.kill();
      } catch {
        // ignore failures when cleaning up
      }
    });
    this.sessions.clear();
  }

  private registerSshExecute(context: UnifiedModuleContext): void {
    const deregister = context.moduleManager.registerToolExecution(
      'ssh_execute',
      async (rawArgs: any) => {
        const args = sshExecuteSchema.parse(rawArgs);
        return this.handleSshExecute(args, context);
      },
      'ssh_execute',
      'Execute a command inside a persistent SSH session.',
      sshExecuteSchema,
      this.manifest.id
    );
    this.deregisterFns.push(deregister);
  }

  private registerSshNewSession(context: UnifiedModuleContext): void {
    const deregister = context.moduleManager.registerToolExecution(
      'ssh_new_session',
      async (rawArgs: any) => {
        const args = sshNewSessionSchema.parse(rawArgs);
        return this.handleSshNewSession(args, context);
      },
      'ssh_new_session',
      'Create a new SSH session backed by a persistent PTY.',
      sshNewSessionSchema,
      this.manifest.id
    );
    this.deregisterFns.push(deregister);
  }

  private registerSshOperate(context: UnifiedModuleContext): void {
    const deregister = context.moduleManager.registerToolExecution(
      'ssh_operate',
      async (rawArgs: any) => {
        const args = sshOperateSchema.parse(rawArgs);
        return this.handleSshOperate(args, context);
      },
      'ssh_operate',
      'Unified SSH operations: create sessions, send input, get output with automatic position tracking. Combines ssh_new_session, ssh_execute, and ssh_get_buffer into a single streamlined interface.',
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

    if (message.includes('not found')) {
      errorCode = ERROR_CODES.SESSION_NOT_FOUND;
    } else if (message.includes('already exists')) {
      errorCode = ERROR_CODES.SESSION_EXISTS;
    } else if (message.includes('busy executing')) {
      errorCode = ERROR_CODES.SESSION_BUSY;
    } else if (message.includes('timeout')) {
      errorCode = ERROR_CODES.COMMAND_TIMEOUT;
    } else if (message.includes('authentication') || message.includes('Auth')) {
      errorCode = ERROR_CODES.AUTHENTICATION_FAILED;
    } else if (message.includes('Connection') || message.includes('ECONNREFUSED')) {
      errorCode = ERROR_CODES.CONNECTION_FAILED;
    } else if (message.includes('ENOENT') || message.includes('not exist')) {
      errorCode = ERROR_CODES.NOT_FOUND;
    } else if (message.includes('EACCES') || message.includes('permission')) {
      errorCode = ERROR_CODES.PERMISSION_DENIED;
    }

    context.logger.error(`${options.toolName} failed`, {
      component: this.manifest.id,
      error,
      ...options.details,
    });

    return createErrorResponse(
      errorCode as any,
      message,
      {
        details: {
          tool: options.toolName,
          ...options.details,
        },
        suggestion: getErrorSuggestion(errorCode as any, message),
      }
    );
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
      'Upload a local file into the remote session environment via base64 transfer.',
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
      'Download a remote file through the session and save it locally.',
      sshDownloadSchema,
      this.manifest.id
    );
    this.deregisterFns.push(deregister);
  }

  private async handleSshExecute(
    args: z.infer<typeof sshExecuteSchema>,
    context: UnifiedModuleContext
  ) {
    try {
      const session = this.getSession(args.session_id);
      if (!session.isReady) {
        throw new Error(`Session ${args.session_id} is busy executing: ${session.lastCommand}`);
      }
      const validTimeout = Math.min(Math.max(args.timeout, 1000), MAX_TIMEOUT_MS);
      const result = await this.executeCommand(session, args.command, validTimeout);
      
      // Check buffer for interactive prompts
      const promptInfo = this.detectInteractivePrompts(session.outputBuffer);
      
      if (result.exitCode !== 0 && !args.allowFailure) {
        throw new Error(
          `Command exited with code ${result.exitCode}\nOutput: ${result.output || '(no output)'}`
        );
      }
      
      const response: any = {
        content: [
          {
            type: 'text',
            text: result.output || '(Command executed successfully with no output)',
          },
        ],
        structuredContent: {
          sessionId: args.session_id,
          target: session.target
            ? {
                host: session.target.host,
                port: session.target.port,
                user: session.target.user,
              }
            : undefined,
          command: args.command,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
        },
      };
      
      // Add prompt detection info if detected
      if (promptInfo.detected) {
        response.structuredContent.awaitingInput = true;
        response.structuredContent.promptType = promptInfo.type;
        response.structuredContent.promptText = promptInfo.prompt;
        response.content[0].text += `\n\n⚠️ Awaiting input: ${promptInfo.type} prompt detected. Use ssh_operate with input parameter to respond.`;
      }
      
      return response;
    } catch (error) {
      return this.handleError(error, context, {
        toolName: 'ssh_execute',
        sessionId: args.session_id,
        command: args.command,
      });
    }
  }

  private async handleSshNewSession(
    args: z.infer<typeof sshNewSessionSchema>,
    context: UnifiedModuleContext
  ) {
    try {
      if (this.sessions.has(args.session_id)) {
        throw new Error(`Session ${args.session_id} already exists. Close it before recreating.`);
      }
      const connectionTarget = args.target;
      this.createSession(args.session_id, connectionTarget);
      
      // Wait and verify session is actually connected
      const session = this.sessions.get(args.session_id);
      if (!session) {
        throw new Error('Failed to create session - not found after creation');
      }
      
      // Wait for SSH connection to establish
      await this.sleep(1500);
      
      // Check if process exited (connection failed)
      if (!session || !session.isConnected) {
        // Check buffer for error messages
        const bufferError = session?.outputBuffer || '';
        let errorMsg = `SSH connection failed - could not connect to ${connectionTarget.host}:${connectionTarget.port}.`;
        
        if (bufferError.includes('permission denied') || bufferError.includes('Permission denied')) {
          errorMsg += ' Authentication failed. Check username, password or SSH key.';
        } else if (bufferError.includes('connection refused') || bufferError.includes('Connection refused')) {
          errorMsg += ' SSH service may not be running on the remote host.';
        } else if (bufferError.includes('no route') || bufferError.includes('No route')) {
          errorMsg += ' Network issue - check host address.';
        } else if (bufferError.includes('name or service not known') || bufferError.includes('Could not resolve')) {
          errorMsg += ' Could not resolve hostname.';
        } else if (bufferError) {
          errorMsg += ` Server said: ${bufferError.substring(0, 200)}`;
        }
        
        this.sessions.delete(args.session_id);
        throw new Error(errorMsg);
      }
      
      const label = ` (remote: ${connectionTarget.user ? `${connectionTarget.user}@` : ''}${connectionTarget.host}:${connectionTarget.port})`;
      return {
        content: [
          {
            type: 'text',
            text: `Created session ${args.session_id}${label}. Session is ready for commands.`,
          },
        ],
        structuredContent: {
          session_id: args.session_id,
          target: connectionTarget,
          status: 'ready'
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.logger.error('ssh_new_session failed', {
        component: this.manifest.id,
        error,
        sessionId: args.session_id,
      });
      return this.handleError(error, context, {
        toolName: 'ssh_new_session',
        sessionId: args.session_id,
      });
    }
  }

  private async handleSshOperate(
    args: z.infer<typeof sshOperateSchema>,
    context: UnifiedModuleContext
  ) {
    try {
      let sessionId = args.session_id;
      let sessionCreated = false;
      let session: TerminalSession | undefined;

      // 1. Resolve session: check if session_id exists
      if (sessionId) {
        session = this.sessions.get(sessionId) ?? undefined;
      }

      // 2. Handle session based on its state
      if (session) {
        // Session exists - check if it's alive
        if (!session.isConnected) {
          // Dead session - clean up
          try { session.ptyProcess.kill(); } catch { /* ignore */ }
          this.sessions.delete(sessionId!);
          session = undefined;
          
          // If target provided, will create new below
          // If no target, will fall through to default session check
        }
      }

      // Helper to check if target has valid SSH connection info
      const hasValidTarget = (t: any): t is { host: string; port: number; user: string } => {
        return t && typeof t === 'object' && typeof t.host === 'string' && t.host.length > 0;
      };

      // 3. Create new session if needed
      if (!session) {
        if (hasValidTarget(args.target)) {
          // Create new session with provided target
          const newSessionId = sessionId || `session_${Date.now()}`;
          this.createSession(newSessionId, args.target);
          
          await this.sleep(1000);
          
          session = this.sessions.get(newSessionId);
          if (!session) {
            throw new Error(`Failed to create SSH session to ${args.target.host}. Check SSH availability and credentials.`);
          }
          
          if (!session.isConnected) {
            this.sessions.delete(newSessionId);
            throw new Error(`SSH connection failed to ${args.target.host}. Process exited.`);
          }
          
          sessionId = newSessionId;
          sessionCreated = true;
        } else if (sessionId) {
          // No target but session_id provided - try default
          const defaultSession = this.sessions.get(DEFAULT_SESSION_ID);
          if (defaultSession && defaultSession.isConnected) {
            sessionId = DEFAULT_SESSION_ID;
            session = defaultSession;
          } else {
            throw new Error(`Session "${sessionId}" not found. Provide target to create new session.`);
          }
        } else {
          // No session_id and no target - try default
          const defaultSession = this.sessions.get(DEFAULT_SESSION_ID);
          if (defaultSession && defaultSession.isConnected) {
            sessionId = DEFAULT_SESSION_ID;
            session = defaultSession;
          } else {
            throw new Error('No active session. Provide session_id or target.');
          }
        }
      }

      let commandOutput = '';
      let exitCode: number | undefined;

      // 3. Execute command or send input
      const inputToSend = args.command || args.input;
      if (inputToSend) {
        if (!session.isReady) {
          throw new Error(`Session ${sessionId} is busy executing: ${session.lastCommand}`);
        }

        const timeout = args.timeout || DEFAULT_TIMEOUT_MS;
        const result = await this.executeCommand(session, inputToSend, timeout);
        commandOutput = result.output || '';
        exitCode = result.exitCode;
      }

      // 4. Get output
      let output = null;
      if (args.get_output !== false && session) {
        const delayMs = args.output_delay_ms || 500;
        if (delayMs > 0) {
          await this.sleep(delayMs);
        }

        const contentSource = session.historyLog || session.outputBuffer;
        output = args.clean !== false ? this.cleanOutput(contentSource) : contentSource;
      }

      // 5. Detect interactive prompts
      const promptInfo = session.outputBuffer ? this.detectInteractivePrompts(session.outputBuffer) : { detected: false };

      // 6. Build response
      const response: Record<string, unknown> = {
        session_id: sessionId,
        success: true,
      };

      if (sessionCreated) {
        response.session_created = true;
        response.target = hasValidTarget(args.target) ? {
          host: args.target.host,
          port: args.target.port,
          user: args.target.user,
        } : undefined;
      }

      if (inputToSend) {
        response.command = inputToSend;
        response.exit_code = exitCode;
      }

      if (output) {
        response.output = output;
      }

      // Add prompt detection info
      if (promptInfo.detected) {
        response.awaiting_input = true;
        response.prompt_type = promptInfo.type;
        response.prompt_text = promptInfo.prompt;
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

  private formatSshOperateText(response: Record<string, unknown>): string {
    const lines: string[] = [];

    if (response.session_created) {
      const target = response.target as { host?: string; port?: number; user?: string } | undefined;
      if (target) {
        lines.push(`Created session: ${response.session_id}`);
        lines.push(`Target: ${target.user ? `${target.user}@` : ''}${target.host}:${target.port}`);
      }
    } else {
      lines.push(`Session: ${response.session_id}`);
    }

    if (response.command) {
      lines.push(`Command: ${response.command}`);
      if (response.exit_code !== undefined) {
        lines.push(`Exit code: ${response.exit_code}`);
      }
    }

    if (response.output) {
      lines.push('');
      lines.push(String(response.output));
    }

    // Add interactive prompt warning
    if (response.awaiting_input) {
      lines.push('');
      lines.push(`⚠️ Awaiting input: ${response.prompt_type} prompt detected.`);
      lines.push(`Prompt: ${response.prompt_text}`);
      lines.push(`Use ssh_operate with input parameter to respond.`);
    }

    return lines.join('\n');
  }

  private handleListSessions() {
    if (this.sessions.size === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No active SSH sessions.',
          },
        ],
        structuredContent: { sessions: [], count: 0 }
      };
    }

    const sessionList = Array.from(this.sessions.values()).map((session) => {
      const uptimeSeconds = Math.floor((Date.now() - session.createdAt.getTime()) / 1000);
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
        createdAt: session.createdAt.toISOString()
      };
    });

    const formatted = sessionList.map((s) => {
      return (
        `• ${s.id}\n` +
        `  Status: ${s.isRunning ? 'connected' : 'disconnected'} (${s.status})\n` +
        `  Target: ${s.target}\n` +
        `  Last command: ${s.lastCommand || '(none)'}\n` +
        `  Uptime: ${s.uptimeSeconds}s`
      );
    }).join('\n\n');

    return {
      content: [
        {
          type: 'text',
          text: `Active SSH sessions (${this.sessions.size}):\n\n${formatted}`,
        },
      ],
      structuredContent: { sessions: sessionList, count: this.sessions.size }
    };
  }

  private async handleCloseSession(
    args: z.infer<typeof sshCloseSessionSchema>,
    context: UnifiedModuleContext
  ) {
    try {
      const session = this.sessions.get(args.session_id);
      if (!session) {
        throw new Error(`Session ${args.session_id} not found.`);
      }
      session.ptyProcess.kill();
      this.sessions.delete(args.session_id);
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
      const session = this.sessions.get(args.session_id);
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
      const buffer = args.clean ? this.cleanOutput(contentSource) : contentSource;
      const target = session.target;
      const targetStr = target ? `${target.user ? `${target.user}@` : ''}${target.host}:${target.port}` : 'unknown';
      const isRunning = session.isConnected;
      
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
          buffer: buffer
        }
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
      const session = this.getSession(args.session_id);
      if (!session.isReady) {
        throw new Error(`Session ${args.session_id} is busy executing: ${session.lastCommand}`);
      }
      const localPath = path.resolve(process.cwd(), args.local_path);
      const remoteTarget = this.resolveRemotePath(args.remote_path, session);
      const timeout = Math.min(args.timeout, FILE_TRANSFER_TIMEOUT);
      const result = await this.uploadFile(session, localPath, remoteTarget, timeout);
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
      const session = this.getSession(args.session_id);
      if (!session.isReady) {
        throw new Error(`Session ${args.session_id} is busy executing: ${session.lastCommand}`);
      }
      const remoteTarget = this.resolveRemotePath(args.remote_path, session);
      const localPath = path.resolve(process.cwd(), args.local_path);
      const timeout = Math.min(args.timeout, FILE_TRANSFER_TIMEOUT);
      const result = await this.downloadFile(session, remoteTarget, localPath, timeout);
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

  private resolveRemotePath(remotePath: string, session?: TerminalSession): string {
    if (session?.target) {
      return remotePath;
    }
    if (remotePath.startsWith('~')) {
      const home = process.env.HOME || os.homedir();
      return path.resolve(home, remotePath.slice(1));
    }
    return path.resolve(remotePath);
  }

  private getSession(sessionId?: string): TerminalSession {
    const normalized = (sessionId || DEFAULT_SESSION_ID).trim() || DEFAULT_SESSION_ID;
    const session = this.sessions.get(normalized);
    if (!session) {
      throw new Error(`Session ${normalized} not found. Create it with ssh_new_session before using other tools.`);
    }
    return session;
  }

  private createSession(sessionId: string, connection: SSHConnectionTarget): TerminalSession {
    if (!connection) {
      throw new Error('SSH session creation requires a remote target.');
    }
    
    const shellPath = 'ssh';
    const args = this.buildSshArgs(connection);

    const ptyProcess = spawn(shellPath, args, {
      name: 'xterm-256color',
      cols: 160,
      rows: 40,
      cwd: process.env.HOME || process.cwd(),
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        PS1: '[READY]$ ',
        SSH_ASKPASS: '',
        GIT_TERMINAL_PROMPT: '0',
      },
    });

    const session: TerminalSession = {
      id: sessionId,
      ptyProcess,
      outputBuffer: '',
      isReady: true,
      isConnected: true,
      lastCommand: '',
      createdAt: new Date(),
      target: connection,
      historyLog: '',
    };

    ptyProcess.onData((data) => {
      session.outputBuffer += data;
      if (session.outputBuffer.length > MAX_BUFFER_CHARS) {
        session.outputBuffer = session.outputBuffer.slice(-MAX_BUFFER_CHARS);
      }
    });

    ptyProcess.onExit((e: { exitCode: number; signal?: number }) => {
      session.isConnected = false;
      console.error(`[SSH] Session ${sessionId} exited with code=${e.exitCode}, signal=${e.signal}`);
      this.sessions.delete(sessionId);
    });

    this.sessions.set(sessionId, session);
    return session;
  }

  private buildSshArgs(target: SSHConnectionTarget): string[] {
    const args: string[] = ['-tt', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=no'];
    if (target.identityFile) {
      args.push('-i', target.identityFile);
    }
    if (target.port) {
      args.push('-p', String(target.port));
    }
    args.push(`${target.user ? `${target.user}@` : ''}${target.host}`);
    if (target.extraArgs?.length) {
      args.push(...target.extraArgs);
    }
    return args;
  }

  private async executeCommand(session: TerminalSession, command: string, timeout: number) {
    session.lastCommand = command;
    session.isReady = false;
    session.outputBuffer = '';

    const timestamp = Date.now();
    const startMarker = `===START${timestamp}===`;
    const endMarker = `===END${timestamp}===`;
    const exitMarker = `===EXIT${timestamp}===`;

    session.ptyProcess.write(`echo '${startMarker}'\n`);
    await this.sleep(100);
    session.ptyProcess.write(`${command}\n`);
    await this.sleep(100);
    session.ptyProcess.write(`echo '${exitMarker}'$?\n`);
    await this.sleep(100);
    session.ptyProcess.write(`echo '${endMarker}'\n`);

    const startTime = Date.now();
    let foundEnd = false;

    while (Date.now() - startTime < timeout) {
      if (session.outputBuffer.includes(endMarker)) {
        await this.sleep(250);
        foundEnd = true;
        break;
      }
      await this.sleep(100);
    }

    session.isReady = true;

    if (!foundEnd) {
      throw new Error(`Command timeout after ${timeout}ms. Output may still be streaming.`);
    }

    const buffer = session.outputBuffer;
    const startIdx = buffer.lastIndexOf(startMarker);
    const endIdx = buffer.lastIndexOf(endMarker);
    let segment = buffer;
    if (startIdx >= 0 && endIdx > startIdx) {
      segment = buffer.substring(startIdx + startMarker.length, endIdx);
    }

    const filtered = this.filterCommandOutput(segment, command, startMarker, endMarker, exitMarker);
    const cleaned = this.cleanOutput(filtered);
    const exitMatch = buffer.match(new RegExp(`${this.escapeRegex(exitMarker)}(\\d+)`));
    const exitCode = exitMatch ? parseInt(exitMatch[1], 10) : 0;

    const historyLines = [`$ ${command}`, cleaned || '(no output)', `(exit ${exitCode})`].join('\n');
    this.appendHistory(session, historyLines);

    return {
      output: cleaned,
      exitCode,
      durationMs: Date.now() - startTime,
    };
  }

  private filterCommandOutput(
    raw: string,
    command: string,
    startMarker: string,
    endMarker: string,
    exitMarker: string
  ) {
    const seenLines = new Set<string>();
    let skippedCommandEcho = false;
    const commandSignature = command.trim();

    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => {
        if (!line) return false;
        if (line.includes(startMarker) || line.includes(endMarker) || line.includes(exitMarker)) {
          return false;
        }
        if (line.startsWith('echo ')) return false;
        if (line === commandSignature) return false;
        if (!skippedCommandEcho && line.endsWith(commandSignature)) {
          skippedCommandEcho = true;
          return false;
        }
        if (line.match(/^[❯$>#]\s+/)) return false;
        if (seenLines.has(line)) return false;
        seenLines.add(line);
        return true;
      })
      .join('\n');
  }

  private appendHistory(session: TerminalSession, entry: string) {
    session.historyLog = session.historyLog ? `${session.historyLog}\n\n${entry}` : entry;
    if (session.historyLog.length > MAX_HISTORY_CHARS) {
      session.historyLog = session.historyLog.slice(-MAX_HISTORY_CHARS);
    }
  }

  private cleanOutput(output: string): string {
    return output
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1b\][0-9;]*\x07/g, '')
      .replace(/\x1b\][0-9;]*;[^\x07]*\x07/g, '')
      .replace(/\x1b[><=]/g, '')
      .replace(/\[\?[0-9]+[hl]/g, '')
      .replace(/\[READY\]\$ /g, '')
      .replace(/^%\s*$/gm, '')
      .replace(/^❯\s*$/gm, '')
      .replace(/^~\s*$/gm, '')
      .replace(/^\$\s*$/gm, '')
      .replace(/^>\s*$/gm, '')
      .replace(/^#\s*$/gm, '')
      .replace(/^[❯$>#]\s+/gm, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private detectInteractivePrompts(output: string): { detected: boolean; type?: string; prompt?: string } {
    const patterns = [
      // Password/passphrase prompts
      { regex: /(?:password|passphrase)[:\s]/i, type: 'password', suggestion: 'Use ssh_operate with input="your_password" to respond' },
      // Yes/no confirmation
      { regex: /(?:yes|no|continue|confirm|accept|approve|delete|overwrite)\s*[\(\[]?[yYnN]?[\)\]]?/i, type: 'yes_no', suggestion: 'Use ssh_operate with input="y" or input="n" to respond' },
      // Interactive menu - select option
      { regex: /(?:select|choose|option|menu|enter choice)[:\s]/i, type: 'menu', suggestion: 'Use ssh_operate with input="1" or the desired option number' },
      // Press any key
      { regex: /press\s+(any\s+)?key/i, type: 'any_key', suggestion: 'Use ssh_operate with input="" to press Enter' },
      // Numbered menu
      { regex: /\[\s*[0-9]+\s*\]\s*$/m, type: 'numbered_menu', suggestion: 'Use ssh_operate with input="1" or desired number' },
      // Username prompt
      { regex: /(?:login|username|user)[:\s]/i, type: 'username', suggestion: 'Use ssh_operate with input="username" to respond' },
      // SSH host key verification
      { regex: /(?:host\s+key|authenticity|are you sure|known hosts)/i, type: 'host_key', suggestion: 'Use ssh_operate with input="yes" to accept the host key' },
      // Two-factor authentication
      { regex: /(?:2fa|verification code|authenticator|sms code|token)[:\s]/i, type: '2fa', suggestion: 'Use ssh_operate with input="code" to provide the verification code' },
      // sudo password
      { regex: /\[sudo\]\s*password/i, type: 'sudo_password', suggestion: 'Use ssh_operate with input="sudo_password" to respond' },
      // Terminal interrupt
      { regex: /\^C\s*interrupt/i, type: 'interrupted', suggestion: 'Command was interrupted. Session may be waiting for input.' },
      // EOF/end of file
      // EOF/end of file
      { regex: /(?:end of file|ctrl\+d|ctrl\+c)/i, type: 'eof', suggestion: 'Use ssh_operate with input="" to send EOF' },
    ];

    for (const pattern of patterns) {
      const match = output.match(pattern.regex);
      if (match) {
        return { detected: true, type: pattern.type, prompt: match[0] };
      }
    }
    return { detected: false };
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private escapeShellArg(value: string): string {
    if (value.length === 0) {
      return "''";
    }
    const escaped = value.split("'").join("'\\''");
    return `'${escaped}'`;
  }

  private async uploadFile(
    session: TerminalSession,
    localPath: string,
    remotePath: string,
    timeout: number
  ): Promise<{ message: string; remotePath: string; size: number }> {
    await fsPromises.access(localPath);
    const stats = await fsPromises.stat(localPath);
    if (!stats.isFile()) {
      throw new Error('Upload source must be a regular file.');
    }
    if (stats.size > MAX_FILE_SIZE) {
      throw new Error(
        `File size (${(stats.size / 1024 / 1024).toFixed(2)}MB) exceeds the 10MB limit.`
      );
    }

    let finalRemotePath = remotePath;
    try {
      const dirCheck = await this.executeCommand(
        session,
        `test -d ${this.escapeShellArg(finalRemotePath)} && echo "DIR" || echo "FILE"`,
        5000
      );
      if (dirCheck.output.trim() === 'DIR') {
        const candidate = finalRemotePath.endsWith('/')
          ? `${finalRemotePath}${path.basename(localPath)}`
          : `${finalRemotePath}/${path.basename(localPath)}`;
        finalRemotePath = candidate;
      }
    } catch {
      // ignore
    }

    try {
      const fileStatus = await this.executeCommand(
        session,
        `test -f ${this.escapeShellArg(finalRemotePath)} && echo "EXISTS" || echo "OK"`,
        5000
      );
      if (fileStatus.output.trim() === 'EXISTS') {
        const ext = path.extname(finalRemotePath);
        const name = path.basename(finalRemotePath, ext);
        const dir = path.dirname(finalRemotePath);
        const suffix = Math.random().toString(36).substring(2, 8);
        finalRemotePath = `${dir}/${name}_${suffix}${ext}`;
      }
    } catch {
      // ignore
    }

    const base64Content = (await fsPromises.readFile(localPath)).toString('base64');
    const chunkSize = 50000;
    const tempBase64File = `/tmp/mcp_upload_${Date.now()}_${Math.random().toString(
      36
    ).slice(2, 8)}.b64`;

    await this.executeCommand(
      session,
      `rm -f ${this.escapeShellArg(tempBase64File)}`,
      10000
    ).catch(() => {});

    for (let i = 0; i < base64Content.length; i += chunkSize) {
      const chunk = base64Content.substring(i, i + chunkSize);
      const cmd = `printf '%s' '${chunk}' >> ${this.escapeShellArg(tempBase64File)}`;
      await this.executeCommand(session, cmd, 30000);
    }

    const decodeCmd = `(base64 -D -i ${this.escapeShellArg(tempBase64File)} -o ${this.escapeShellArg(
      finalRemotePath
    )} 2>/dev/null || base64 -d ${this.escapeShellArg(tempBase64File)} > ${
      this.escapeShellArg(finalRemotePath)
    }) && rm -f ${this.escapeShellArg(tempBase64File)}`;
    await this.executeCommand(session, decodeCmd, timeout);

    const verify = await this.executeCommand(
      session,
      `ls -lh ${this.escapeShellArg(finalRemotePath)}`,
      10000
    );

    return {
      message: `File uploaded successfully: ${localPath} -> ${finalRemotePath}\n${verify.output}`,
      remotePath: finalRemotePath,
      size: stats.size,
    };
  }

  private async downloadFile(
    session: TerminalSession,
    remotePath: string,
    localPath: string,
    timeout: number
  ): Promise<{ message: string; localPath: string; size: number }> {
    const sizeCheckCmd = `test -f ${this.escapeShellArg(remotePath)} && stat -f%z ${this.escapeShellArg(
      remotePath
    )} 2>/dev/null || stat -c%s ${this.escapeShellArg(remotePath)} 2>/dev/null`;
    const sizeOutput = await this.executeCommand(session, sizeCheckCmd, 10000);
    const fileSize = parseInt(sizeOutput.output.trim(), 10);
    if (Number.isNaN(fileSize) || fileSize <= 0) {
      throw new Error(`Failed to determine remote file size for ${remotePath}`);
    }
    if (fileSize > MAX_FILE_SIZE) {
      throw new Error(
        `Remote file (${(fileSize / 1024 / 1024).toFixed(2)}MB) exceeds the 10MB limit.`
      );
    }

    const encodeCmd = `base64 ${this.escapeShellArg(remotePath)}`;
    const base64Content = await this.executeCommand(session, encodeCmd, timeout);
    const cleaned = base64Content.output.replace(/\s/g, '');
    const buffer = Buffer.from(cleaned, 'base64');

    await fsPromises.mkdir(path.dirname(localPath), { recursive: true });
    await fsPromises.writeFile(localPath, buffer);
    const localStats = await fsPromises.stat(localPath);

    return {
      message: `File downloaded successfully: ${remotePath} -> ${localPath}\nSize: ${(localStats.size / 1024).toFixed(
        2
      )}KB`,
      localPath,
      size: localStats.size,
    };
  }
}
