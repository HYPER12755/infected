import path from 'node:path';
import { z } from 'zod';
import { createErrorResponse, ERROR_CODES, getErrorSuggestion } from '../../core/tool-error.js';
import logger from '../../core/logger.js';
// Import the 5 focused modules
import { SSHSessionManager } from './ssh-session-manager.js';
import { SSHCommandExecutor } from './ssh-command-executor.js';
import { SSHPromptDetector } from './ssh-prompt-detector.js';
import { SSHFileTransferHandler } from './ssh-file-transfer-handler.js';
import { SSHConnectionPoolWrapper } from './ssh-connection-pool-wrapper.js';
const DEFAULT_SESSION_ID = 'default';
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TIMEOUT_MS = 120000;
const FILE_TRANSFER_TIMEOUT = 300000;
// ===== SCHEMA DEFINITIONS =====
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
    output_id: z
        .string()
        .optional()
        .describe('Unique ID for streaming output subscription. If provided, real-time output updates will be emitted.'),
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
/**
 * Main SSH Module - orchestrates 5 focused sub-modules
 * - ssh-session-manager: Session lifecycle
 * - ssh-command-executor: Command execution
 * - ssh-prompt-detector: Prompt detection
 * - ssh-file-transfer-handler: File operations
 * - ssh-connection-pool-wrapper: Connection pooling
 */
export default class SshModule {
    constructor() {
        this.manifest = {
            id: 'plugin.ssh',
            name: 'SSH Session Manager',
            version: '1.0.0',
            type: 'plugin',
            entry: 'index.ts',
            description: 'Stateful SSH sessions with persistent PTYs and file-transfer helpers.',
            provides: ['tools'],
            timeout: 30000,
        };
        this.deregisterFns = [];
        // ===== STREAMING SUPPORT =====
        this.streamingExecutions = new Map();
        this.streamingEnabled = process.env.MCP_SSH_ENABLE_STREAMING !== 'false';
        this.streamUpdateCallbacks = [];
    }
    // ===== STREAMING METHODS =====
    onSSHStreamUpdate(callback) {
        this.streamUpdateCallbacks.push(callback);
        return () => {
            const index = this.streamUpdateCallbacks.indexOf(callback);
            if (index > -1) {
                this.streamUpdateCallbacks.splice(index, 1);
            }
        };
    }
    emitSSHStreamUpdate(update) {
        for (const callback of this.streamUpdateCallbacks) {
            try {
                callback(update);
            }
            catch (error) {
                logger.error('Error in SSH stream update callback:', {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
    }
    getSSHStreamingStatus(executionId) {
        return this.streamingExecutions.get(executionId);
    }
    async onLoad(context) {
        // Initialize all 5 sub-modules
        this.sessionManager = new SSHSessionManager();
        this.commandExecutor = new SSHCommandExecutor();
        this.promptDetector = new SSHPromptDetector();
        this.fileTransferHandler = new SSHFileTransferHandler(this.commandExecutor);
        this.poolWrapper = new SSHConnectionPoolWrapper();
        // Register all tools
        this.registerSshExecute(context);
        this.registerSshNewSession(context);
        this.registerSshOperate(context);
        this.registerSshListSessions(context);
        this.registerSshCloseSession(context);
        this.registerSshBuffer(context);
        this.registerSshUploadFile(context);
        this.registerSshDownloadFile(context);
        context.logger.info('SSH Session Manager module loaded (refactored with 5 sub-modules).', {
            component: this.manifest.id,
        });
    }
    async onUnload() {
        for (const deregister of this.deregisterFns) {
            deregister();
        }
        this.deregisterFns = [];
        // Shutdown all sub-modules
        try {
            await this.sessionManager.shutdown();
            await this.poolWrapper.shutdown();
        }
        catch (error) {
            logger.error('Error during SSH module shutdown', {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    // ===== TOOL REGISTRATION =====
    registerSshExecute(context) {
        const deregister = context.moduleManager.registerToolExecution('ssh_execute', async (rawArgs) => {
            const args = sshExecuteSchema.parse(rawArgs);
            return this.handleSshExecute(args, context);
        }, 'ssh_execute', 'Execute a command inside a persistent SSH session.', sshExecuteSchema, this.manifest.id);
        this.deregisterFns.push(deregister);
    }
    registerSshNewSession(context) {
        const deregister = context.moduleManager.registerToolExecution('ssh_new_session', async (rawArgs) => {
            const args = sshNewSessionSchema.parse(rawArgs);
            return this.handleSshNewSession(args, context);
        }, 'ssh_new_session', 'Create a new SSH session backed by a persistent PTY.', sshNewSessionSchema, this.manifest.id);
        this.deregisterFns.push(deregister);
    }
    registerSshOperate(context) {
        const deregister = context.moduleManager.registerToolExecution('ssh_operate', async (rawArgs) => {
            const args = sshOperateSchema.parse(rawArgs);
            return this.handleSshOperate(args, context);
        }, 'ssh_operate', 'Unified SSH operations: create sessions, send input, get output with automatic position tracking. Combines ssh_new_session, ssh_execute, and ssh_get_buffer into a single streamlined interface.', sshOperateSchema, this.manifest.id);
        this.deregisterFns.push(deregister);
    }
    registerSshListSessions(context) {
        const deregister = context.moduleManager.registerToolExecution('ssh_list_sessions', async () => this.handleListSessions(), 'ssh_list_sessions', 'List all active SSH sessions with metadata.', {}, this.manifest.id);
        this.deregisterFns.push(deregister);
    }
    registerSshCloseSession(context) {
        const deregister = context.moduleManager.registerToolExecution('ssh_close_session', async (rawArgs) => {
            const args = sshCloseSessionSchema.parse(rawArgs);
            return this.handleCloseSession(args, context);
        }, 'ssh_close_session', 'Close an SSH session and clean up its PTY.', sshCloseSessionSchema, this.manifest.id);
        this.deregisterFns.push(deregister);
    }
    registerSshBuffer(context) {
        const deregister = context.moduleManager.registerToolExecution('ssh_get_buffer', async (rawArgs) => {
            const args = sshBufferSchema.parse(rawArgs);
            return this.handleGetBuffer(args, context);
        }, 'ssh_get_buffer', 'Read the raw buffer for a specific SSH session.', sshBufferSchema, this.manifest.id);
        this.deregisterFns.push(deregister);
    }
    registerSshUploadFile(context) {
        const deregister = context.moduleManager.registerToolExecution('ssh_upload_file', async (rawArgs) => {
            const args = sshUploadSchema.parse(rawArgs);
            return this.handleUploadFile(args, context);
        }, 'ssh_upload_file', 'Upload a local file into the remote session environment via base64 transfer.', sshUploadSchema, this.manifest.id);
        this.deregisterFns.push(deregister);
    }
    registerSshDownloadFile(context) {
        const deregister = context.moduleManager.registerToolExecution('ssh_download_file', async (rawArgs) => {
            const args = sshDownloadSchema.parse(rawArgs);
            return this.handleDownloadFile(args, context);
        }, 'ssh_download_file', 'Download a remote file through the session and save it locally.', sshDownloadSchema, this.manifest.id);
        this.deregisterFns.push(deregister);
    }
    // ===== TOOL HANDLERS =====
    async handleSshExecute(args, context) {
        try {
            const session = this.sessionManager.getSession(args.session_id);
            if (!session) {
                throw new Error(`Session ${args.session_id} not found. Create it with ssh_new_session before using other tools.`);
            }
            const validTimeout = Math.min(Math.max(args.timeout, 1000), MAX_TIMEOUT_MS);
            const result = await this.commandExecutor.executeCommand(session, args.command, validTimeout);
            if (result.exitCode !== 0 && !args.allowFailure) {
                throw new Error(`Command exited with code ${result.exitCode}\nOutput: ${result.output || '(no output)'}`);
            }
            const response = {
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
            // Check for interactive prompts
            if (!result.completedNormally) {
                const promptInfo = this.promptDetector.detectInteractivePrompts(session.outputBuffer);
                if (promptInfo.detected) {
                    response.structuredContent.awaitingInput = true;
                    response.structuredContent.promptType = promptInfo.type;
                    response.structuredContent.promptText = promptInfo.prompt;
                    response.content[0].text += `\n\n⚠️ Awaiting input: ${promptInfo.type} prompt detected. Use ssh_operate with input parameter to respond.`;
                }
            }
            return response;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const exitCodeMatch = message.match(/Command exited with code (\d+)/);
            const exitCode = exitCodeMatch ? parseInt(exitCodeMatch[1], 10) : undefined;
            return this.handleError(error, context, {
                toolName: 'ssh_execute',
                sessionId: args.session_id,
                command: args.command,
                details: exitCode !== undefined ? { exitCode } : undefined,
            });
        }
    }
    async handleSshNewSession(args, context) {
        try {
            const existingSession = this.sessionManager.getSession(args.session_id);
            if (existingSession) {
                throw new Error(`Session ${args.session_id} already exists. Close it before recreating.`);
            }
            const session = await this.sessionManager.createSession(args.session_id, args.target);
            // Wait for SSH connection to establish
            await this.sleep(1500);
            // Check if process exited (connection failed)
            if (!session.isConnected) {
                const bufferError = session.outputBuffer || '';
                let errorMsg = `SSH connection failed - could not connect to ${args.target.host}:${args.target.port}.`;
                if (bufferError.includes('permission denied') || bufferError.includes('Permission denied')) {
                    errorMsg += ' Authentication failed. Check username, password or SSH key.';
                }
                else if (bufferError.includes('connection refused') || bufferError.includes('Connection refused')) {
                    errorMsg += ' SSH service may not be running on the remote host.';
                }
                else if (bufferError.includes('no route') || bufferError.includes('No route')) {
                    errorMsg += ' Network issue - check host address.';
                }
                else if (bufferError.includes('name or service not known') || bufferError.includes('Could not resolve')) {
                    errorMsg += ' Could not resolve hostname.';
                }
                else if (bufferError) {
                    errorMsg += ` Server said: ${bufferError.substring(0, 200)}`;
                }
                await this.sessionManager.closeSession(args.session_id);
                throw new Error(errorMsg);
            }
            const label = ` (remote: ${args.target.user ? `${args.target.user}@` : ''}${args.target.host}:${args.target.port})`;
            return {
                content: [
                    {
                        type: 'text',
                        text: `Created session ${args.session_id}${label}. Session is ready for commands.`,
                    },
                ],
                structuredContent: {
                    session_id: args.session_id,
                    target: args.target,
                    status: 'ready',
                },
            };
        }
        catch (error) {
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
    async handleSshOperate(args, context) {
        try {
            let sessionId = args.session_id;
            let sessionCreated = false;
            let session = this.sessionManager.getSession(sessionId);
            // 1. Resolve session
            if (session) {
                if (!session.isConnected) {
                    try {
                        await this.sessionManager.closeSession(sessionId);
                    }
                    catch {
                        /* ignore */
                    }
                    session = null;
                }
            }
            // Helper to check if target has valid SSH connection info
            const hasValidTarget = (t) => {
                return t && typeof t === 'object' && typeof t.host === 'string' && t.host.length > 0;
            };
            // 2. Create new session if needed
            if (!session) {
                if (hasValidTarget(args.target)) {
                    const newSessionId = sessionId || `session_${Date.now()}`;
                    session = await this.sessionManager.createSession(newSessionId, args.target);
                    await this.sleep(1000);
                    if (!session.isConnected) {
                        await this.sessionManager.closeSession(newSessionId);
                        throw new Error(`SSH connection failed to ${args.target.host}. Process exited.`);
                    }
                    sessionId = newSessionId;
                    sessionCreated = true;
                }
                else if (sessionId) {
                    const defaultSession = this.sessionManager.getSession(DEFAULT_SESSION_ID);
                    if (defaultSession && defaultSession.isConnected) {
                        session = defaultSession;
                        sessionId = DEFAULT_SESSION_ID;
                    }
                    else {
                        throw new Error(`Session "${sessionId}" not found. Provide target to create new session.`);
                    }
                }
                else {
                    const defaultSession = this.sessionManager.getSession(DEFAULT_SESSION_ID);
                    if (defaultSession && defaultSession.isConnected) {
                        session = defaultSession;
                        sessionId = DEFAULT_SESSION_ID;
                    }
                    else {
                        throw new Error('No active session. Provide session_id or target.');
                    }
                }
            }
            let commandOutput = '';
            let exitCode;
            let commandCompletedNormally = true;
            const executionStartTime = Date.now();
            // 3. Execute command or send input
            const inputToSend = args.command || args.input;
            if (inputToSend) {
                const timeout = args.timeout || DEFAULT_TIMEOUT_MS;
                const result = await this.commandExecutor.executeCommand(session, inputToSend, timeout);
                commandOutput = result.output || '';
                exitCode = result.exitCode;
                commandCompletedNormally = result.completedNormally ?? true;
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
            // ===== STREAMING: Emit SSH execution updates =====
            if (this.streamingEnabled && args.output_id) {
                const executionDuration = Date.now() - executionStartTime;
                if (commandOutput) {
                    this.emitSSHStreamUpdate({
                        type: 'output',
                        executionId: args.output_id,
                        sessionId: sessionId,
                        data: commandOutput,
                        isStderr: false,
                        timestamp: Date.now(),
                    });
                }
                this.emitSSHStreamUpdate({
                    type: 'complete',
                    executionId: args.output_id,
                    sessionId: sessionId,
                    exitCode: exitCode || 0,
                    duration: executionDuration,
                    timestamp: Date.now(),
                });
            }
            // ===== END STREAMING ====
            // 5. Detect interactive prompts
            const promptInfo = !commandCompletedNormally && session.outputBuffer
                ? this.promptDetector.detectInteractivePrompts(session.outputBuffer)
                : { detected: false };
            // 6. Build response
            const response = {
                session_id: sessionId,
                success: true,
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
        }
        catch (error) {
            return this.handleError(error, context, {
                toolName: 'ssh_operate',
                sessionId: args.session_id,
                command: args.command,
            });
        }
    }
    handleListSessions() {
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
            return (`• ${s.id}\n` +
                `  Status: ${s.isRunning ? 'connected' : 'disconnected'} (${s.status})\n` +
                `  Target: ${s.target}\n` +
                `  Last command: ${s.lastCommand || '(none)'}\n` +
                `  Uptime: ${s.uptimeSeconds}s`);
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
    async handleCloseSession(args, context) {
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
        }
        catch (error) {
            return this.handleError(error, context, {
                toolName: 'ssh_close_session',
                sessionId: args.session_id,
            });
        }
    }
    async handleGetBuffer(args, context) {
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
                    buffer: buffer,
                },
            };
        }
        catch (error) {
            return this.handleError(error, context, {
                toolName: 'ssh_get_buffer',
                sessionId: args.session_id,
            });
        }
    }
    async handleUploadFile(args, context) {
        try {
            const session = this.sessionManager.getSession(args.session_id);
            if (!session) {
                throw new Error(`Session ${args.session_id} not found. Create it with ssh_new_session before uploading files.`);
            }
            const localPath = path.resolve(process.cwd(), args.local_path);
            const remoteTarget = this.fileTransferHandler.resolveRemotePath(args.remote_path, session);
            const timeout = Math.min(args.timeout, FILE_TRANSFER_TIMEOUT);
            const result = await this.fileTransferHandler.uploadFile(session, localPath, remoteTarget, timeout);
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
        }
        catch (error) {
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
    async handleDownloadFile(args, context) {
        try {
            const session = this.sessionManager.getSession(args.session_id);
            if (!session) {
                throw new Error(`Session ${args.session_id} not found. Create it with ssh_new_session before downloading files.`);
            }
            const remoteTarget = this.fileTransferHandler.resolveRemotePath(args.remote_path, session);
            const localPath = path.resolve(process.cwd(), args.local_path);
            const timeout = Math.min(args.timeout, FILE_TRANSFER_TIMEOUT);
            const result = await this.fileTransferHandler.downloadFile(session, remoteTarget, localPath, timeout);
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
        }
        catch (error) {
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
    // ===== PRIVATE HELPERS =====
    handleError(error, context, options) {
        const message = error instanceof Error ? error.message : String(error);
        let errorCode = options.code || ERROR_CODES.INTERNAL_ERROR;
        // Error classification
        if (message.includes('Session') && message.includes('not found')) {
            errorCode = ERROR_CODES.SESSION_NOT_FOUND;
        }
        else if (message.includes('busy executing')) {
            errorCode = ERROR_CODES.SESSION_BUSY;
        }
        else if (message.includes('already exists')) {
            errorCode = ERROR_CODES.SESSION_EXISTS;
        }
        else if (message.includes('timeout') || message.includes('timeout after')) {
            errorCode = ERROR_CODES.COMMAND_TIMEOUT;
        }
        else if (message.includes('Connection') ||
            message.includes('ECONNREFUSED') ||
            message.includes('connection failed')) {
            errorCode = ERROR_CODES.CONNECTION_FAILED;
        }
        else if (message.includes('authentication') || message.includes('Auth')) {
            errorCode = ERROR_CODES.AUTHENTICATION_FAILED;
        }
        else if (message.includes('ENOENT') || message.includes('not exist') || message.includes('No such file')) {
            errorCode = ERROR_CODES.NOT_FOUND;
        }
        else if (message.includes('EACCES') || message.includes('permission denied') || message.includes('Permission denied')) {
            errorCode = ERROR_CODES.PERMISSION_DENIED;
        }
        else if (message.includes('Command exited with code')) {
            errorCode = ERROR_CODES.TOOL_EXECUTION_ERROR;
        }
        context.logger.error(`${options.toolName} failed`, {
            component: this.manifest.id,
            error,
            ...options.details,
        });
        return createErrorResponse(errorCode, message, {
            details: {
                tool: options.toolName,
                ...options.details,
            },
            suggestion: getErrorSuggestion(errorCode, message),
        });
    }
    formatSshOperateText(response) {
        const lines = [];
        if (response.session_created) {
            const target = response.target;
            if (target) {
                lines.push(`Created session: ${response.session_id}`);
                lines.push(`Target: ${target.user ? `${target.user}@` : ''}${target.host}:${target.port}`);
            }
        }
        else {
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
        if (response.awaiting_input) {
            lines.push('');
            lines.push(`⚠️ Awaiting input: ${response.prompt_type} prompt detected.`);
            lines.push(`Prompt: ${response.prompt_text}`);
            lines.push(`Use ssh_operate with input parameter to respond.`);
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
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
