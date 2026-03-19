import { spawn as ptySpawn } from 'node-pty';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import { LoggingContext } from '../../core/logging/logging-context.js';
import { CorrelationContext } from '../../core/logging/correlation-context.js';
import { RetryStrategy } from '../../core/recovery/retry-strategy.js';
const DEFAULT_SESSION_ID = 'default';
const MAX_BUFFER_CHARS = 200_000;
const MAX_HISTORY_CHARS = 400_000;
/**
 * SSHSessionManager handles session lifecycle management
 * - Creates and destroys SSH sessions
 * - Manages session state
 * - Tracks active sessions
 */
export class SSHSessionManager extends EventEmitter {
    constructor() {
        super();
        this.sessionCreationRetry = new RetryStrategy({
            maxAttempts: 3,
            initialDelayMs: 100,
            maxDelayMs: 2000,
            useJitter: true
        });
        this.sessions = new Map();
        this.connectionIdCounter = 0;
        this.loggingContext = new LoggingContext();
    }
    /**
     * Creates a new SSH session
     */
    async createSession(sessionId, target, options) {
        // Create correlation context for this session
        const context = CorrelationContext.generate(undefined, undefined, sessionId);
        return CorrelationContext.runAsync(context, async () => {
            if (this.sessions.has(sessionId)) {
                throw new Error(`Session ${sessionId} already exists. Close it before recreating.`);
            }
            const shellPath = 'ssh';
            const args = this.buildSshArgs(target);
            const ptyProcess = ptySpawn(shellPath, args, {
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
            const connectionId = `conn_${this.connectionIdCounter++}`;
            const now = Date.now();
            const session = {
                id: sessionId,
                connectionId,
                created: now,
                lastUsed: now,
                state: 'active',
                ptyProcess,
                outputBuffer: '',
                historyLog: '',
                isReady: true,
                isConnected: true,
                lastCommand: '',
                target,
            };
            // Set up data listener
            ptyProcess.onData((data) => {
                session.outputBuffer += data;
                if (session.outputBuffer.length > MAX_BUFFER_CHARS) {
                    session.outputBuffer = session.outputBuffer.slice(-MAX_BUFFER_CHARS);
                }
            });
            // Set up exit listener
            ptyProcess.onExit((e) => {
                session.isConnected = false;
                session.state = 'closed';
                this.loggingContext.warn(`SSH Session ${sessionId} exited with code=${e.exitCode}, signal=${e.signal}`, {
                    sessionId,
                    exitCode: e.exitCode,
                    signal: e.signal,
                });
                this.emit('session:closed', {
                    sessionId,
                    exitCode: e.exitCode,
                });
                // Remove from map after a delay to allow cleanup
                setTimeout(() => {
                    this.sessions.delete(sessionId);
                }, 100);
            });
            this.sessions.set(sessionId, session);
            const readyResult = await this.waitForReady(session);
            if (!readyResult.success) {
                session.isConnected = false;
                session.isReady = false;
                if (readyResult.error) {
                    session.outputBuffer += `\n${readyResult.error}\n`;
                }
            }
            this.loggingContext.debug('SSH session created', {
                sessionId,
                connectionId,
                target: `${target.user}@${target.host}:${target.port}`,
            });
            this.emit('session:created', {
                sessionId,
                connectionId,
                target,
            });
            return session;
        });
    }
    /**
     * Gets a session by ID
     */
    getSession(sessionId) {
        const normalized = (sessionId || DEFAULT_SESSION_ID).trim() || DEFAULT_SESSION_ID;
        return this.sessions.get(normalized) || null;
    }
    /**
     * Closes and cleans up a session
     */
    async closeSession(sessionId) {
        const context = CorrelationContext.generate(undefined, undefined, sessionId);
        return CorrelationContext.runAsync(context, async () => {
            const session = this.sessions.get(sessionId);
            if (!session) {
                throw new Error(`Session ${sessionId} not found`);
            }
            try {
                session.ptyProcess.kill();
                session.isConnected = false;
                session.state = 'closed';
                this.sessions.delete(sessionId);
                this.loggingContext.debug('SSH session closed', {
                    sessionId,
                });
                this.emit('session:closed', { sessionId });
            }
            catch (error) {
                this.loggingContext.error('Error closing SSH session', {
                    sessionId,
                    error: error instanceof Error ? error.message : String(error),
                });
                throw error;
            }
        });
    }
    /**
     * Lists all active sessions
     */
    listSessions() {
        return Array.from(this.sessions.values());
    }
    /**
     * Gets statistics about active sessions
     */
    getSessionStats() {
        const sessions = Array.from(this.sessions.values());
        const activeSessions = sessions.filter((s) => s.isConnected).length;
        const readySessions = sessions.filter((s) => s.isReady).length;
        const busySessions = activeSessions - readySessions;
        const averageSessionAge = sessions.length > 0
            ? sessions.reduce((sum, s) => sum + (Date.now() - s.created), 0) / sessions.length
            : 0;
        return {
            totalSessions: sessions.length,
            activeSessions,
            readySessions,
            busySessions,
            averageSessionAge,
        };
    }
    /**
     * Cleans up all sessions
     */
    async shutdown() {
        const context = CorrelationContext.generate();
        return CorrelationContext.runAsync(context, async () => {
            const sessionIds = Array.from(this.sessions.keys());
            for (const sessionId of sessionIds) {
                try {
                    await this.closeSession(sessionId);
                }
                catch (error) {
                    this.loggingContext.warn('Error closing session during shutdown', {
                        sessionId,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
            this.sessions.clear();
            this.loggingContext.info('SSH session manager shutdown complete');
        });
    }
    // ===== PRIVATE METHODS =====
    buildSshArgs(target) {
        const args = ['-tt', '-o', 'StrictHostKeyChecking=no'];
        if (!target.password) {
            args.push('-o', 'BatchMode=yes');
        }
        if (target.identityFile) {
            const keyPath = target.identityFile.startsWith('~')
                ? target.identityFile.replace('~', os.homedir())
                : target.identityFile;
            args.push('-i', keyPath);
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
    async waitForReady(session) {
        return new Promise((resolve) => {
            let output = '';
            let resolved = false;
            const handleData = (data) => {
                if (resolved)
                    return;
                output += data;
                // Auto-send password when password prompt detected
                if (/password[:\s]*$/i.test(output) || /password:\s*$/.test(output)) {
                    if (session.target?.password) {
                        session.ptyProcess.write(session.target.password + '\n');
                        output = '';
                    }
                }
                // Auto-respond to host key confirmation
                if (/are you sure you want to continue connecting/i.test(output)) {
                    session.ptyProcess.write('yes\n');
                    output = '';
                }
                // Detect shell prompt or session ready
                if (/\[READY\]/.test(output) || /\$\s*$/.test(output) || /#\s*$/.test(output) || />\s*$/.test(output)) {
                    resolved = true;
                    resolve({ success: true });
                }
            };
            // If already connected, resolve immediately
            if (session.isConnected) {
                resolve({ success: true });
                return;
            }
            // Listen for data
            session.ptyProcess.onData(handleData);
            // Also check periodically if session is still connected
            const checkInterval = setInterval(() => {
                if (resolved) {
                    clearInterval(checkInterval);
                    return;
                }
                if (session.isConnected) {
                    resolved = true;
                    clearInterval(checkInterval);
                    resolve({ success: true });
                }
                // If session is NOT connected and process has exited, fail
                if (!session.isConnected && session.state === 'closed') {
                    resolved = true;
                    clearInterval(checkInterval);
                    resolve({ success: false, error: 'Session process exited unexpectedly' });
                }
            }, 500);
        });
    }
}
