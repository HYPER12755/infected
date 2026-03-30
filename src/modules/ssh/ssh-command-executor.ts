import logger from '../../core/logger.js';
import { LoggingContext } from '../../core/logging/logging-context.js';
import { CorrelationContext, ICorrelationContext } from '../../core/logging/correlation-context.js';
import { Session } from './ssh-session-manager.js';
import { RetryStrategy } from '../../core/recovery/retry-strategy.js';
import { CircuitBreaker } from '../../core/recovery/circuit-breaker.js';
import { SSHError } from '../../core/error-system/error-categories.js';
import { SSHErrorCode, ErrorSeverity } from '../../core/error-system/error-taxonomy.js';

/**
 * Result of command execution
 */
export interface CommandResult {
  output: string;
  exitCode: number;
  durationMs: number;
  completedNormally: boolean;
  timedOut: boolean;
  partial: boolean;
  bufferStartPos: number;
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
  private sessionCircuitBreakers = new Map<string, CircuitBreaker>();
  private commandRetryStrategy = new RetryStrategy({
    maxAttempts: 2,
    initialDelayMs: 100,
    maxDelayMs: 1000,
    useJitter: true
  });
  private loggingContext: LoggingContext;
  private commandCounter = 0;

  constructor() {
    this.loggingContext = new LoggingContext();
  }

  private getSessionCircuitBreaker(sessionId: string): CircuitBreaker {
    if (!this.sessionCircuitBreakers.has(sessionId)) {
      this.sessionCircuitBreakers.set(sessionId, new CircuitBreaker({
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 30000,
        windowSize: 60000
      }));
    }
    return this.sessionCircuitBreakers.get(sessionId)!;
  }

  cleanupSessionCircuitBreaker(sessionId: string): void {
    this.sessionCircuitBreakers.delete(sessionId);
  }
  /**
   * Executes a command in an SSH session
   * Simplified approach: send command, wait fixed delay, capture output
   */
  async executeCommand(
    session: Session,
    command: string,
    timeout: number = DEFAULT_TIMEOUT_MS
  ): Promise<CommandResult> {
    const commandId = `cmd_${++this.commandCounter}_${Date.now()}`;
    const context = CorrelationContext.generate(undefined, undefined, session.id);
    
    return CorrelationContext.runAsync(context, async () => {
      const sessionCB = this.getSessionCircuitBreaker(session.id);
      try {
        await sessionCB.execute(async () => {
          if (!session.isConnected) {
            throw new SSHError(
              `Session ${session.id} is not connected`,
              { code: SSHErrorCode.DISCONNECTED, severity: ErrorSeverity.HIGH, retryable: true }
            );
          }
          return true;
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes('CIRCUIT_BREAKER_OPEN')) {
          throw new SSHError(
            `SSH session ${session.id} circuit breaker open - too many disconnection failures`,
            { code: SSHErrorCode.DISCONNECTED, severity: ErrorSeverity.HIGH, retryable: true }
          );
        }
        throw error;
      }

      // Check if there was a previous background command that finished
      if (!session.isReady && session.lastCommand) {
        const buffer = session.outputBuffer || '';
        // Check if the previous command has finished (has exit code)
        if (/exit\s*(\d+)/i.test(buffer) || /\(exit\s*(\d+)\)/i.test(buffer)) {
          session.isReady = true;
          session.lastCommand = '';
        }
      }

      // Check and set busy state atomically to prevent race conditions
      if (!session.isReady) {
        throw new Error(`Session is busy executing: ${session.lastCommand || 'previous command'}`);
      }

      // Set isReady to false BEFORE executing to prevent race conditions
      session.isReady = false;

      // Use 10 second timeout for safety (shorter than before)
      const SAFETY_TIMEOUT_MS = 10000;
      const validTimeout = Math.min(Math.max(timeout, 1000), Math.min(SAFETY_TIMEOUT_MS, MAX_TIMEOUT_MS));

      // Capture buffer position before sending command
      const bufferStartPos = session.outputBuffer.length;
      session.lastCommand = command;

      try {
        // Send the command
        session.ptyProcess.write(`${command}\n`);

        const startTime = Date.now();
        let lastBufferSize = bufferStartPos;
        let stableCount = 0;

        // Poll for output until timeout
        while (Date.now() - startTime < validTimeout) {
          await this.sleep(200);
          
          // Check if session disconnected
          if (!session.isConnected) {
            session.isReady = true;
            throw new SSHError(
              `Session ${session.id} disconnected during command execution`,
              { code: SSHErrorCode.DISCONNECTED, severity: ErrorSeverity.HIGH, retryable: true }
            );
          }
          
          // Check if output has stabilized (command likely finished)
          if (session.outputBuffer.length === lastBufferSize) {
            stableCount++;
            if (stableCount >= 2) {
              break; // Output stable, command likely done
            }
          } else {
            stableCount = 0;
            lastBufferSize = session.outputBuffer.length;
          }
        }

        // Capture output
        const currentBuffer = session.outputBuffer;
        let commandOutput = '';
        
        if (currentBuffer.length > bufferStartPos) {
          commandOutput = currentBuffer.substring(bufferStartPos);
        }

        // Check if we timed out
        const timedOut = Date.now() - startTime >= validTimeout;
        
        // Try to extract exit code from buffer
        let exitCode = 0;
        const exitCodeMatch = commandOutput.match(/exit[_\s]?code[:\s]*(\d+)/i) 
          || commandOutput.match(/(?:^|\n)\s*(\d+)\s*$/);
        
        if (exitCodeMatch) {
          exitCode = parseInt(exitCodeMatch[1], 10);
        } else if (timedOut) {
          // No exit code found and timed out - command may still be running
          exitCode = -1; // Indicate unknown
        }

        // If timed out, don't mark session as ready - command is still running
        // This prevents new commands from interrupting the background process
        if (!timedOut) {
          session.isReady = true;
        } else {
          // Mark as busy but allow reading buffer
          session.isReady = false;
          // Store the background command info
          session.lastCommand = command;
        }

        const cleaned = this.cleanOutput(commandOutput);
        const durationMs = Date.now() - startTime;

        // Add to history
        const status = timedOut ? 'partial' : 'complete';
        const historyLines = [`$ ${command}`, cleaned || '(no output)', `(exit ${exitCode}) [${status}]`].join('\n');
        this.appendHistory(session, historyLines);

        this.loggingContext.debug('Command executed', {
          sessionId: session.id,
          commandId,
          command: command.substring(0, 100),
          exitCode,
          durationMs,
          timedOut,
        });

        if (timedOut) {
          // Note: command continues running in background
          this.loggingContext.debug('Command timed out but continues in background', {
            sessionId: session.id,
            command: command.substring(0, 50),
          });
        }

        return {
          output: cleaned,
          exitCode,
          durationMs,
          completedNormally: !timedOut,
          timedOut,
          partial: timedOut,
          bufferStartPos,
        };
      } catch (error) {
        session.isReady = true;
        this.loggingContext.error('Command execution failed', {
          sessionId: session.id,
          commandId,
          command: command.substring(0, 100),
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    });
  }

  /**
   * Cancels a running command
   */
  async cancelCommand(sessionId: string, session: Session): Promise<void> {
    const context = CorrelationContext.generate(undefined, undefined, sessionId);
    
    return CorrelationContext.runAsync(context, async () => {
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

        this.loggingContext.info('Command cancelled', {
          sessionId,
        });
      } catch (error) {
        this.loggingContext.error('Error cancelling command', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    });
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
      .split('\n')
      .filter(line => line.trim() !== '')
      .filter((line, idx, arr) => {
        if (idx === 0) return false;
        if (idx > 0 && line === arr[idx - 1]) return false;
        return true;
      })
      .join('\n')
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
