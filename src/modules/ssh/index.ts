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
  session_id: z.string().optional().default(DEFAULT_SESSION_ID).describe('Session identifier.'),
  timeout: z
    .number()
    .int()
    .min(1000)
    .max(MAX_TIMEOUT_MS)
    .optional()
    .default(DEFAULT_TIMEOUT_MS)
    .describe('Timeout in milliseconds (1s - 120s).'),
  allowFailure: z.boolean().optional().default(false).describe('Return the output even if the command exits with a non-zero code.'),
});

const sshNewSessionSchema = z.object({
  session_id: z.string().min(1).describe('Unique identifier for the new session.'),
  shell: z.string().optional().describe('Optional shell executable (default: system shell).'),
});

const sshCloseSessionSchema = z.object({
  session_id: z.string().min(1).describe('Session ID to close.'),
});

const sshBufferSchema = z.object({
  session_id: z.string().optional().default(DEFAULT_SESSION_ID).describe('Session ID to inspect.'),
  clean: z.boolean().optional().default(true).describe('Strip ANSI/control sequences.'),
});

const sshUploadSchema = z.object({
  session_id: z.string().optional().default(DEFAULT_SESSION_ID).describe('Session ID to attribute the upload.'),
  remote_path: z.string().min(1).describe('Remote filesystem path to write.'),
  content_base64: z.string().min(1).describe('Base64-encoded payload to upload.'),
  mode: z.string().optional().default('0644').describe('File mode (octal string).'),
});

const sshDownloadSchema = z.object({
  session_id: z.string().optional().default(DEFAULT_SESSION_ID).describe('Session ID associated with the download.'),
  remote_path: z.string().min(1).describe('Remote filesystem path to read.'),
});

export default class SshModule implements IUnifiedPlugin {
  public manifest: UnifiedModuleManifest = {
    id: 'plugin.ssh',
    name: 'SSH Session Manager',
    version: '1.0.0',
    type: 'plugin',
    entry: 'index.ts',
    description: 'Stateful SSH session manager with persistent PTYs and helper tools.',
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
    this.registerSshDownloadFile(context);
    this.registerSshUploadFile(context);
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
        // ignore
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
      'Execute a command inside a persistent SSH session (same PTY across calls).',
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
      'Read the raw buffer for a specific SSH session for debugging purposes.',
      sshBufferSchema,
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
      'Download a file from the server filesystem (base64 payload).',
      sshDownloadSchema,
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
      'Upload base64 content into the server filesystem.',
      sshUploadSchema,
      this.manifest.id
    );
    this.deregisterFns.push(deregister);
  }

  private async handleSshExecute(args: z.infer<typeof sshExecuteSchema>, context: UnifiedModuleContext) {
    try {
      const session = this.getOrCreateSession(args.session_id);
      if (!session.isReady) {
        throw new Error(`Session ${args.session_id} is busy executing: ${session.lastCommand}`);
      }
      const start = Date.now();
      const result = await this.executeCommand(session, args.command, args.timeout);
      if (result.exitCode !== 0 && !args.allowFailure) {
        throw new Error(`Command exited with code ${result.exitCode}\nOutput: ${result.output || '(no output)'}`);
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
          durationMs: Date.now() - start,
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

  private async handleSshNewSession(args: z.infer<typeof sshNewSessionSchema>, context: UnifiedModuleContext) {
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

  private async handleCloseSession(args: z.infer<typeof sshCloseSessionSchema>, context: UnifiedModuleContext) {
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

  private handleGetBuffer(args: z.infer<typeof sshBufferSchema>, context: UnifiedModuleContext) {
    try {
      const session = this.sessions.get(args.session_id);
      if (!session) {
        throw new Error(`Session ${args.session_id} not found.`);
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

  private async handleDownloadFile(args: z.infer<typeof sshDownloadSchema>, context: UnifiedModuleContext) {
    try {
      const resolved = this.resolveRemotePath(args.remote_path);
      const data = await fsPromises.readFile(resolved);
      return {
        content: [
          {
            type: 'text',
            text: `Downloaded ${data.length} bytes from ${resolved}`,
          },
        ],
        structuredContent: {
          remotePath: resolved,
          size: data.length,
          content_base64: data.toString('base64'),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.logger.error('ssh_download_file failed', {
        component: this.manifest.id,
        error,
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

  private async handleUploadFile(args: z.infer<typeof sshUploadSchema>, context: UnifiedModuleContext) {
    try {
      const resolved = this.resolveRemotePath(args.remote_path);
      await fsPromises.mkdir(path.dirname(resolved), { recursive: true });
      const decoded = Buffer.from(args.content_base64, 'base64');
      const writeOptions = {} as { mode?: number };
      const modeInt = parseInt(args.mode, 8);
      if (!Number.isNaN(modeInt)) {
        writeOptions.mode = modeInt;
      }
      await fsPromises.writeFile(resolved, decoded, writeOptions);
      if (writeOptions.mode !== undefined) {
        await fsPromises.chmod(resolved, writeOptions.mode);
      }
      return {
        content: [
          {
            type: 'text',
            text: `Wrote ${decoded.length} bytes to ${resolved}`,
          },
        ],
        structuredContent: {
          remotePath: resolved,
          size: decoded.length,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.logger.error('ssh_upload_file failed', {
        component: this.manifest.id,
        error,
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
    const shellPath = shellOverride
      ?? (os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash');

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

    const timestamp = Date.now();
    const startMarker = `===START${timestamp}===`;
    const endMarker = `===END${timestamp}===`;
    const exitMarker = `===EXIT${timestamp}===`;

    session.ptyProcess.write(`echo '${startMarker}'\n`);
    await this.sleep(150);
    session.ptyProcess.write(`${command}\n`);
    await this.sleep(150);
    session.ptyProcess.write(`echo '${exitMarker}'$?\n`);
    await this.sleep(150);
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
    const durationMs = Date.now() - startTime;

    return { output: cleaned, exitCode, durationMs };
  }

  private filterCommandOutput(raw: string, command: string, startMarker: string, endMarker: string, exitMarker: string) {
    let skippedCommandEcho = false;
    const lines = raw.split(/\r?\n/);
    const filtered = lines.filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (trimmed.includes(startMarker) || trimmed.includes(endMarker) || trimmed.includes(exitMarker)) {
        return false;
      }
      if (trimmed.startsWith('echo ')) return false;
      if (trimmed === command) return false;
      if (!skippedCommandEcho && trimmed.endsWith(command)) {
        skippedCommandEcho = true;
        return false;
      }
      if (trimmed.match(/^[❯$>#]\s+/)) {
        return false;
      }
      return true;
    });
    return filtered.join('\n');
  }

  private cleanOutput(output: string): string {
    return output
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1b\][0-9;]*\x07/g, '')
      .replace(/\x1b\][0-9;]*;[^\x07]*\x07/g, '')
      .replace(/\x1b[><=]/g, '')
      .replace(/\[\?[0-9]+[hl]/g, '')
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
}
