import { LoggingContext } from '../../core/logging/logging-context.js';
import { CorrelationContext } from '../../core/logging/correlation-context.js';
import { RetryStrategy } from '../../core/recovery/retry-strategy.js';
import { CircuitBreaker } from '../../core/recovery/circuit-breaker.js';
import { SSHError } from '../../core/error-system/error-categories.js';
import { SSHErrorCode, ErrorSeverity } from '../../core/error-system/error-taxonomy.js';
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
    constructor() {
        this.sessionCircuitBreakers = new Map();
        this.commandRetryStrategy = new RetryStrategy({
            maxAttempts: 2,
            initialDelayMs: 100,
            maxDelayMs: 1000,
            useJitter: true
        });
        this.commandCounter = 0;
        this.loggingContext = new LoggingContext();
    }
    getSessionCircuitBreaker(sessionId) {
        if (!this.sessionCircuitBreakers.has(sessionId)) {
            this.sessionCircuitBreakers.set(sessionId, new CircuitBreaker({
                failureThreshold: 5,
                successThreshold: 2,
                timeout: 30000,
                windowSize: 60000
            }));
        }
        return this.sessionCircuitBreakers.get(sessionId);
    }
    cleanupSessionCircuitBreaker(sessionId) {
        this.sessionCircuitBreakers.delete(sessionId);
    }
    /**
     * Executes a command in an SSH session
     */
    async executeCommand(session, command, timeout = DEFAULT_TIMEOUT_MS) {
        const commandId = `cmd_${++this.commandCounter}_${Date.now()}`;
        const context = CorrelationContext.generate(undefined, undefined, session.id);
        return CorrelationContext.runAsync(context, async () => {
            const sessionCB = this.getSessionCircuitBreaker(session.id);
            try {
                await sessionCB.execute(async () => {
                    if (!session.isConnected) {
                        throw new SSHError(`Session ${session.id} is not connected`, { code: SSHErrorCode.DISCONNECTED, severity: ErrorSeverity.HIGH, retryable: true });
                    }
                    return true;
                });
            }
            catch (error) {
                if (error instanceof Error && error.message.includes('CIRCUIT_BREAKER_OPEN')) {
                    throw new SSHError(`SSH session ${session.id} circuit breaker open - too many disconnection failures`, { code: SSHErrorCode.DISCONNECTED, severity: ErrorSeverity.HIGH, retryable: true });
                }
                throw error;
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
                    throw new SSHError(`Command timeout after ${validTimeout}ms. Output may still be streaming.`, { code: SSHErrorCode.TIMEOUT, severity: ErrorSeverity.HIGH, retryable: true });
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
                this.loggingContext.debug('Command executed', {
                    sessionId: session.id,
                    commandId,
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
            }
            catch (error) {
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
    async cancelCommand(sessionId, session) {
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
            }
            catch (error) {
                this.loggingContext.error('Error cancelling command', {
                    sessionId,
                    error: error instanceof Error ? error.message : String(error),
                });
                throw error;
            }
        });
    }
    // ===== PRIVATE METHODS =====
    filterCommandOutput(raw, command, startMarker, endMarker, exitMarker) {
        const lines = [];
        let skippedCommandEcho = false;
        const commandSignature = command.trim();
        for (const line of raw.split(/\r?\n/)) {
            const trimmedLine = line.trim();
            // Skip empty lines
            if (!trimmedLine)
                continue;
            // Skip marker lines
            if (trimmedLine.includes(startMarker) ||
                trimmedLine.includes(endMarker) ||
                trimmedLine.includes(exitMarker)) {
                continue;
            }
            // Skip echo commands themselves
            if (trimmedLine.startsWith('echo '))
                continue;
            // Skip the command itself (exact match)
            if (trimmedLine === commandSignature) {
                skippedCommandEcho = true;
                continue;
            }
            // Skip command echoed with prompt prefix
            if (trimmedLine.match(/^[❯$>#]\s+/) &&
                trimmedLine.replace(/^[❯$>#]\s+/, '').trim() === commandSignature) {
                skippedCommandEcho = true;
                continue;
            }
            // Skip if line ends with command (command echo from some shells)
            if (!skippedCommandEcho && trimmedLine.endsWith(commandSignature)) {
                skippedCommandEcho = true;
                continue;
            }
            // Skip prompt-only lines
            if (trimmedLine.match(/^[❯$>#]\s*$/))
                continue;
            lines.push(trimmedLine);
        }
        return lines.join('\n');
    }
    cleanOutput(output) {
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
    appendHistory(session, entry) {
        session.historyLog = session.historyLog ? `${session.historyLog}\n\n${entry}` : entry;
        if (session.historyLog.length > MAX_HISTORY_CHARS) {
            session.historyLog = session.historyLog.slice(-MAX_HISTORY_CHARS);
        }
    }
    escapeRegex(value) {
        return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
