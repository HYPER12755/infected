import os from 'node:os';
import path from 'node:path';
import { promises as fsPromises } from 'node:fs';
import { spawn, type IPty } from 'node-pty';
import { z } from 'zod';
import { IUnifiedPlugin, UnifiedModuleContext, UnifiedModuleManifest } from '../../core/module-system/module-types.js';

const DEFAULT_SESSION_ID = 'default';
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TIMEOUT_MS = 120000;
const MAX_BUFFER_CHARS = 200_000;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const FILE_TRANSFER_TIMEOUT = 300000;

interface TerminalSession {
  id: string;
  ptyProcess: IPty;
  outputBuffer: string;
  isReady: boolean;
  lastCommand: string;
  createdAt: Date;
}

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

const sshNewSessionSchema = z.object({
  session_id: z.string().min(1).describe('Unique identifier for the new session.'),
  shell: z.string().optional().describe('Optional shell executable override.'),
});

const sshCloseSessionSchema = z.object({
  session_id: z.string().min(1).describe('Session ID to close.'),
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
      const session = this.getOrCreateSession(args.session_id);
      if (!session.isReady) {
        throw new Error(`Session ${args.session_id} is busy executing: ${session.lastCommand}`);
      }
      const validTimeout = Math.min(Math.max(args.timeout, 1000), MAX_TIMEOUT_MS);
      const result = await this.executeCommand(session, args.command, validTimeout);
      if (result.exitCode !== 0 && !args.allowFailure) {
        throw new Error(
          `Command exited with code ${result.exitCode}\nOutput: ${result.output || '(no output)'}`
        );
      }
      return {
        content: [
          {
            type: 'text',
            text: result.output || '(Command executed successfully with no output)',
          },
        ],
        structuredContent: {
          sessionId: args.session_id,
          command: args.command,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.logger.error('ssh_execute failed', {
        component: this.manifest.id,
        error,
        sessionId: args.session_id,
        command: args.command,
      });
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${message}`,
          },
        ],
        isError: true,
        structuredContent: {
          sessionId: args.session_id,
          command: args.command,
        },
      };
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
      this.createSession(args.session_id, args.shell);
      await this.sleep(250);
      return {
        content: [
          {
            type: 'text',
            text: `Created session ${args.session_id}${args.shell ? ` (shell: ${args.shell})` : ''}.`,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.logger.error('ssh_new_session failed', {
        component: this.manifest.id,
        error,
        sessionId: args.session_id,
      });
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }

  private handleListSessions() {
    if (this.sessions.size === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No active sessions.',
          },
        ],
      };
    }

    const formatted = Array.from(this.sessions.values())
      .map((session) => {
        const uptimeSeconds = Math.floor((Date.now() - session.createdAt.getTime()) / 1000);
        return (
          `• ${session.id}\n  Status: ${session.isReady ? 'ready' : 'busy'}\n` +
          `  Last command: ${session.lastCommand || '(none)'}\n` +
          `  Uptime: ${uptimeSeconds}s`
        );
      })
      .join('\n\n');

    return {
      content: [
        {
          type: 'text',
          text: `Active sessions (${this.sessions.size}):\n\n${formatted}`,
        },
      ],
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
      const message = error instanceof Error ? error.message : String(error);
      context.logger.error('ssh_close_session failed', {
        component: this.manifest.id,
        error,
        sessionId: args.session_id,
      });
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleGetBuffer(
    args: z.infer<typeof sshBufferSchema>,
    context: UnifiedModuleContext
  ) {
    try {
      let session = this.sessions.get(args.session_id);
      if (!session) {
        if (args.session_id === DEFAULT_SESSION_ID) {
          session = this.createSession(args.session_id);
          await this.sleep(250);
        }
      }

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

      const buffer = args.clean ? this.cleanOutput(session.outputBuffer) : session.outputBuffer;
      return {
        content: [
          {
            type: 'text',
            text: buffer || '(Empty buffer)',
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.logger.error('ssh_get_buffer failed', {
        component: this.manifest.id,
        error,
        sessionId: args.session_id,
      });
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleUploadFile(
    args: z.infer<typeof sshUploadSchema>,
    context: UnifiedModuleContext
  ) {
    try {
      const session = this.getOrCreateSession(args.session_id);
      if (!session.isReady) {
        throw new Error(`Session ${args.session_id} is busy executing: ${session.lastCommand}`);
      }
      const localPath = path.resolve(process.cwd(), args.local_path);
      const remoteTarget = this.resolveRemotePath(args.remote_path);
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
      const message = error instanceof Error ? error.message : String(error);
      context.logger.error('ssh_upload_file failed', {
        component: this.manifest.id,
        error,
        sessionId: args.session_id,
        localPath: args.local_path,
        remotePath: args.remote_path,
      });
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleDownloadFile(
    args: z.infer<typeof sshDownloadSchema>,
    context: UnifiedModuleContext
  ) {
    try {
      const session = this.getOrCreateSession(args.session_id);
      if (!session.isReady) {
        throw new Error(`Session ${args.session_id} is busy executing: ${session.lastCommand}`);
      }
      const remoteTarget = this.resolveRemotePath(args.remote_path);
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
      const message = error instanceof Error ? error.message : String(error);
      context.logger.error('ssh_download_file failed', {
        component: this.manifest.id,
        error,
        sessionId: args.session_id,
        remotePath: args.remote_path,
        localPath: args.local_path,
      });
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }

  private resolveRemotePath(remotePath: string): string {
    if (remotePath.startsWith('~')) {
      const home = process.env.HOME || os.homedir();
      return path.resolve(home, remotePath.slice(1));
    }
    return path.resolve(remotePath);
  }

  private getOrCreateSession(sessionId?: string, shell?: string): TerminalSession {
    const normalized = (sessionId || DEFAULT_SESSION_ID).trim() || DEFAULT_SESSION_ID;
    let session = this.sessions.get(normalized);
    if (!session) {
      session = this.createSession(normalized, shell);
    }
    return session;
  }

  private createSession(sessionId: string, shellOverride?: string): TerminalSession {
    const shellPath =
      shellOverride ??
      (os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash');

    const ptyProcess = spawn(shellPath, [], {
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
      lastCommand: '',
      createdAt: new Date(),
    };

    ptyProcess.onData((data) => {
      session.outputBuffer += data;
      if (session.outputBuffer.length > MAX_BUFFER_CHARS) {
        session.outputBuffer = session.outputBuffer.slice(-MAX_BUFFER_CHARS);
      }
    });

    ptyProcess.onExit(() => {
      this.sessions.delete(sessionId);
    });

    this.sessions.set(sessionId, session);
    return session;
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
