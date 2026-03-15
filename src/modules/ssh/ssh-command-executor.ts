import logger from '../../core/logger.js';
import { Session } from './ssh-session-manager.js';

/**
 * Result of command execution
 */
export interface CommandResult {
  output: string;
  exitCode: number;
  durationMs: number;
  completedNormally: boolean;
}

/**
 * Options for command execution
 */
export interface ExecuteCommandOptions {
  timeout?: number;
  captureOutput?: boolean;
}

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TIMEOUT_MS = 120000;
const MAX_HISTORY_CHARS = 400_000;

/**
 * SSHCommandExecutor handles command execution within SSH sessions
 * - Executes shell commands using marker-based approach
 * - Handles timeouts and output capture
 * - Supports exit code extraction
 */
export class SSHCommandExecutor {
  /**
   * Executes a command in an SSH session
   */
  async executeCommand(
    session: Session,
    command: string,
    timeout: number = DEFAULT_TIMEOUT_MS
  ): Promise<CommandResult> {
    if (!session.isConnected) {
      throw new Error(`Session ${session.id} is not connected`);
    }

    if (!session.isReady) {
      throw new Error(`Session ${session.id} is busy executing: ${session.lastCommand}`);
    }

    const validTimeout = Math.min(Math.max(timeout, 1000), MAX_TIMEOUT_MS);

    session.lastCommand = command;
    session.isReady = false;
    session.outputBuffer = '';

    // Use session ID + timestamp for unique markers to avoid collision
    const timestamp = `${session.id}-${Date.now()}`;
    const startMarker = `===START${timestamp}===`;
    const endMarker = `===END${timestamp}===`;
    const exitMarker = `===EXIT${timestamp}===`;

    try {
      // Wait for PTY to stabilize before sending commands
      await this.sleep(100);

      // Send a newline first to ensure we're at a clean prompt
      session.ptyProcess.write('\n');
      await this.sleep(150);

      // Write start marker
      session.ptyProcess.write(`echo '${startMarker}'\n`);
      await this.sleep(100);

      // Write the actual command
      session.ptyProcess.write(`${command}\n`);
      await this.sleep(100);

      // Write exit code marker
      session.ptyProcess.write(`echo '${exitMarker}'$?\n`);
      await this.sleep(100);

      // Write end marker
      session.ptyProcess.write(`echo '${endMarker}'\n`);
      await this.sleep(100);

      const startTime = Date.now();
      let foundEnd = false;
      let stableCount = 0;

      // Poll for end marker
      while (Date.now() - startTime < validTimeout) {
        if (session.outputBuffer.includes(endMarker)) {
          await this.sleep(200);
          const prevBuffer = session.outputBuffer;
          await this.sleep(150);
          if (session.outputBuffer === prevBuffer || stableCount > 3) {
            foundEnd = true;
            break;
          }
          stableCount++;
        }
        await this.sleep(50);
      }

      session.isReady = true;

      if (!foundEnd) {
        throw new Error(`Command timeout after ${validTimeout}ms. Output may still be streaming.`);
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

      // Add to history
      const historyLines = [`$ ${command}`, cleaned || '(no output)', `(exit ${exitCode})`].join('\n');
      this.appendHistory(session, historyLines);

      logger.debug('Command executed', {
        component: 'SSHCommandExecutor',
        sessionId: session.id,
        command: command.substring(0, 100),
        exitCode,
        durationMs,
      });

      return {
        output: cleaned,
        exitCode,
        durationMs,
        completedNormally: true,
      };
    } catch (error) {
      session.isReady = true;
      logger.error('Command execution failed', {
        component: 'SSHCommandExecutor',
        sessionId: session.id,
        command: command.substring(0, 100),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Cancels a running command
   */
  async cancelCommand(sessionId: string, session: Session): Promise<void> {
    if (!session.isConnected) {
      throw new Error(`Session ${sessionId} is not connected`);
    }

    try {
      // Send SIGTERM
      session.ptyProcess.write('\u0003'); // Ctrl+C
      await this.sleep(500);

      if (!session.isReady) {
        // If still not ready, send SIGKILL
        session.ptyProcess.write('\u0004'); // Ctrl+D
      }

      logger.info('Command cancelled', {
        component: 'SSHCommandExecutor',
        sessionId,
      });
    } catch (error) {
      logger.error('Error cancelling command', {
        component: 'SSHCommandExecutor',
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ===== PRIVATE METHODS =====

  private filterCommandOutput(
    raw: string,
    command: string,
    startMarker: string,
    endMarker: string,
    exitMarker: string
  ): string {
    const lines: string[] = [];
    let skippedCommandEcho = false;
    const commandSignature = command.trim();

    for (const line of raw.split(/\r?\n/)) {
      const trimmedLine = line.trim();

      // Skip empty lines
      if (!trimmedLine) continue;

      // Skip marker lines
      if (
        trimmedLine.includes(startMarker) ||
        trimmedLine.includes(endMarker) ||
        trimmedLine.includes(exitMarker)
      ) {
        continue;
      }

      // Skip echo commands themselves
      if (trimmedLine.startsWith('echo ')) continue;

      // Skip the command itself (exact match)
      if (trimmedLine === commandSignature) {
        skippedCommandEcho = true;
        continue;
      }

      // Skip command echoed with prompt prefix
      if (
        trimmedLine.match(/^[❯$>#]\s+/) &&
        trimmedLine.replace(/^[❯$>#]\s+/, '').trim() === commandSignature
      ) {
        skippedCommandEcho = true;
        continue;
      }

      // Skip if line ends with command (command echo from some shells)
      if (!skippedCommandEcho && trimmedLine.endsWith(commandSignature)) {
        skippedCommandEcho = true;
        continue;
      }

      // Skip prompt-only lines
      if (trimmedLine.match(/^[❯$>#]\s*$/)) continue;

      lines.push(trimmedLine);
    }

    return lines.join('\n');
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

  private appendHistory(session: Session, entry: string): void {
    session.historyLog = session.historyLog ? `${session.historyLog}\n\n${entry}` : entry;
    if (session.historyLog.length > MAX_HISTORY_CHARS) {
      session.historyLog = session.historyLog.slice(-MAX_HISTORY_CHARS);
    }
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
