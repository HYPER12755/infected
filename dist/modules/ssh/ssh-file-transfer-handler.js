import os from 'node:os';
import path from 'node:path';
import { promises as fsPromises } from 'node:fs';
import { spawn as cpSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { stripVTControlCharacters } from 'node:util';
import { LoggingContext } from '../../core/logging/logging-context.js';
import { CorrelationContext } from '../../core/logging/correlation-context.js';
import { RetryStrategy } from '../../core/recovery/retry-strategy.js';
import { CircuitBreaker } from '../../core/recovery/circuit-breaker.js';
const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB
const FILE_TRANSFER_TIMEOUT = 300000; // 5 minutes
const DEFAULT_TRANSFER_METHOD = 'scp';
/**
 * SSHFileTransferHandler manages file transfer operations
 * - SCP / SFTP / FTP transfers with `get`/`put` semantics
 * - Protocol-specific handling, retries, and logging
 * - Directory support and remote verification
 */
export class SSHFileTransferHandler {
    constructor(commandExecutor) {
        this.fileTransferRetry = new RetryStrategy({
            maxAttempts: 3,
            initialDelayMs: 100,
            maxDelayMs: 2000,
            useJitter: true
        });
        this.fileTransferCircuitBreaker = new CircuitBreaker({
            failureThreshold: 5,
            successThreshold: 2,
            timeout: 30000,
            windowSize: 60000
        });
        this.transferCounter = 0;
        this.commandExecutor = commandExecutor;
        this.loggingContext = new LoggingContext();
    }
    stripAnsiCodes(text) {
        if (!text)
            return '';
        // First use Node.js built-in
        let result = stripVTControlCharacters(text);
        // Also handle leftover ESC characters and other ANSI remnants
        result = result
            .replace(/\x1B/g, '') // Remove standalone ESC characters
            .replace(/\\x1B/g, '') // Remove escaped ESC
            .replace(/\u0033/g, '') // Remove octal ESC
            .replace(/\\u0033/g, '') // Remove escaped octal
            .replace(/\[([0-9;]*)m/g, '') // Remove any remaining SGR sequences
            .replace(/\n/g, '\n') // Normalize newlines
            .trim();
        // Also filter out lines that are just ANSI codes
        const lines = result.split('\n').filter(line => line.trim().length > 0);
        return lines.join('\n').trim();
    }
    /**
     * Uploads a file to remote host
     */
    async uploadFile(session, localPath, remotePath, method = DEFAULT_TRANSFER_METHOD, timeout = FILE_TRANSFER_TIMEOUT) {
        const transferId = `upload_${++this.transferCounter}_${Date.now()}`;
        const context = CorrelationContext.generate(undefined, undefined, session.id);
        return CorrelationContext.runAsync(context, async () => {
            if (!session.target) {
                throw new Error('No SSH target configured for this session');
            }
            if (!session.isReady) {
                throw new Error(`Session ${session.id} is busy executing: ${session.lastCommand}`);
            }
            const resolvedLocalPath = path.resolve(localPath);
            try {
                this.loggingContext.debug('Upload file path info', {
                    localPath,
                    resolvedLocalPath,
                    sessionId: session.id,
                });
                if (!existsSync(resolvedLocalPath)) {
                    throw new Error(`Local file not found: ${resolvedLocalPath}`);
                }
                const stats = await fsPromises.stat(resolvedLocalPath);
                if (!stats.isFile()) {
                    throw new Error('Upload source must be a regular file.');
                }
                if (Number.isNaN(stats.size) || stats.size < 0) {
                    throw new Error(`Invalid file size detected for ${resolvedLocalPath}: ${stats.size}`);
                }
                if (stats.size === 0) {
                    this.loggingContext.warn('Uploading empty file', {
                        localPath: resolvedLocalPath,
                        sessionId: session.id,
                    });
                }
                if (stats.size > MAX_FILE_SIZE) {
                    throw new Error(`File size (${(stats.size / 1024 / 1024).toFixed(2)}MB) exceeds the ${(MAX_FILE_SIZE /
                        1024 /
                        1024).toFixed(0)}MB limit.`);
                }
                let finalRemotePath = remotePath;
                // Check if remote path is a directory
                try {
                    const dirCheck = await this.commandExecutor.executeCommand(session, `test -d ${this.escapeShellArg(finalRemotePath)} && echo "DIR" || echo "FILE"`, 5000);
                    if (dirCheck.output.trim() === 'DIR') {
                        const candidate = finalRemotePath.endsWith('/')
                            ? `${finalRemotePath}${path.basename(localPath)}`
                            : `${finalRemotePath}/${path.basename(localPath)}`;
                        finalRemotePath = candidate;
                    }
                }
                catch {
                    // ignore
                }
                // Check if file exists and generate unique name if needed
                try {
                    const fileStatus = await this.commandExecutor.executeCommand(session, `test -f ${this.escapeShellArg(finalRemotePath)} && echo "EXISTS" || echo "OK"`, 5000);
                    if (fileStatus.output.trim() === 'EXISTS') {
                        const ext = path.extname(finalRemotePath);
                        const name = path.basename(finalRemotePath, ext);
                        const dir = path.dirname(finalRemotePath);
                        const suffix = Math.random().toString(36).substring(2, 8);
                        finalRemotePath = `${dir}/${name}_${suffix}${ext}`;
                    }
                }
                catch {
                    // ignore
                }
                await this.transferViaMethod(session, 'upload', resolvedLocalPath, finalRemotePath, method, timeout);
                // Verify file was created
                const verify = await this.commandExecutor.executeCommand(session, `ls -lh ${this.escapeShellArg(finalRemotePath)}`, 10000);
                if (verify.exitCode !== 0) {
                    const output = verify.output || '';
                    if (output.includes('permission denied') || output.includes('Permission denied')) {
                        throw new Error(`Permission denied accessing remote file after upload: ${finalRemotePath}`);
                    }
                    throw new Error(`File upload verification failed. Remote file may not have been created: ${output || 'File not found'}`);
                }
                if (!verify.output.includes(path.basename(finalRemotePath))) {
                    throw new Error(`File upload verification failed. Remote file may not have been created: ${verify.output || 'File not found'}`);
                }
                this.loggingContext.info('File uploaded successfully', {
                    sessionId: session.id,
                    transferId,
                    operationType: 'upload',
                    transferMethod: method,
                    localPath: resolvedLocalPath,
                    remotePath: finalRemotePath,
                    size: stats.size,
                });
                const sizeInKB = stats.size / 1024;
                const sizeStr = stats.size < 1024
                    ? `${stats.size} bytes`
                    : stats.size < 1024 * 1024
                        ? `${sizeInKB.toFixed(2)} KB`
                        : `${(stats.size / 1024 / 1024).toFixed(2)} MB`;
                return {
                    message: `File uploaded successfully (${method.toUpperCase()}): ${resolvedLocalPath} -> ${finalRemotePath} (${sizeStr})`,
                    remotePath: finalRemotePath,
                    size: stats.size,
                };
            }
            catch (error) {
                this.loggingContext.error('File upload failed', {
                    sessionId: session.id,
                    transferId,
                    operationType: 'upload',
                    transferMethod: method,
                    localPath: resolvedLocalPath,
                    remotePath,
                    error: error instanceof Error ? error.message : String(error),
                });
                throw error;
            }
        });
    }
    /**
     * Downloads a file from remote host
     */
    async downloadFile(session, remotePath, localPath, method = DEFAULT_TRANSFER_METHOD, timeout = FILE_TRANSFER_TIMEOUT) {
        const transferId = `download_${++this.transferCounter}_${Date.now()}`;
        const context = CorrelationContext.generate(undefined, undefined, session.id);
        return CorrelationContext.runAsync(context, async () => {
            if (!session.target) {
                throw new Error('No SSH target configured for this session');
            }
            if (!session.isReady) {
                throw new Error(`Session ${session.id} is busy executing: ${session.lastCommand}`);
            }
            try {
                const escapedPath = this.escapeShellArg(remotePath);
                const sizeCheckCmd = `if [ -f ${escapedPath} ]; then stat -c%s ${escapedPath} 2>&1 || stat -f%z ${escapedPath} 2>&1; else echo "FILE_NOT_FOUND"; fi`;
                const sizeResult = await this.commandExecutor.executeCommand(session, sizeCheckCmd, 10000);
                const cleanedOutput = this.stripAnsiCodes(sizeResult.output);
                if (sizeResult.exitCode !== 0) {
                    const output = cleanedOutput || '';
                    if (output.includes('permission denied') ||
                        output.includes('Permission denied') ||
                        output.includes('EACCES')) {
                        throw new Error(`Permission denied accessing remote file: ${remotePath}. Check read permissions for the file.`);
                    }
                    if (output.includes('No such file') || output.includes('no such file') || output.includes('cannot stat')) {
                        throw new Error(`Remote file not found: ${remotePath}`);
                    }
                    throw new Error(`Failed to access remote file: ${output || 'Unknown error'}`);
                }
                const outputLines = cleanedOutput.trim().split('\n').filter((l) => l.trim());
                const lastLine = outputLines[outputLines.length - 1]?.trim() || '';
                if (lastLine === 'FILE_NOT_FOUND' || lastLine === '') {
                    throw new Error(`Remote file not found: ${remotePath}`);
                }
                const numericMatch = lastLine.match(/(\d+)/);
                if (!numericMatch) {
                    throw new Error(`Failed to determine remote file size for ${remotePath}. Output: ${sizeResult.output}`);
                }
                const fileSize = parseInt(numericMatch[1], 10);
                if (Number.isNaN(fileSize) || fileSize <= 0) {
                    throw new Error(`Failed to determine remote file size for ${remotePath}. Output: ${sizeResult.output}`);
                }
                if (fileSize > MAX_FILE_SIZE) {
                    throw new Error(`Remote file (${(fileSize / 1024 / 1024).toFixed(2)}MB) exceeds the ${(MAX_FILE_SIZE /
                        1024 /
                        1024).toFixed(0)}MB limit.`);
                }
                await fsPromises.mkdir(path.dirname(localPath), { recursive: true });
                await this.transferViaMethod(session, 'download', localPath, remotePath, method, timeout);
                const localStats = await fsPromises.stat(localPath);
                this.loggingContext.info('File downloaded successfully', {
                    sessionId: session.id,
                    transferId,
                    operationType: 'download',
                    transferMethod: method,
                    remotePath,
                    localPath,
                    size: localStats.size,
                });
                return {
                    message: `File downloaded successfully (${method.toUpperCase()}): ${remotePath} -> ${localPath}\nSize: ${(localStats.size / 1024).toFixed(2)}KB`,
                    localPath,
                    size: localStats.size,
                };
            }
            catch (error) {
                this.loggingContext.error('File download failed', {
                    sessionId: session.id,
                    transferId,
                    operationType: 'download',
                    transferMethod: method,
                    remotePath,
                    localPath,
                    error: error instanceof Error ? error.message : String(error),
                });
                throw error;
            }
        });
    }
    /**
     * Lists files in a remote directory
     */
    async listRemoteFiles(session, remotePath, timeout = 10000) {
        const context = CorrelationContext.generate(undefined, undefined, session.id);
        return CorrelationContext.runAsync(context, async () => {
            if (!session.isReady) {
                throw new Error(`Session ${session.id} is busy executing: ${session.lastCommand}`);
            }
            try {
                const escapedPath = this.escapeShellArg(remotePath);
                const listCmd = `ls -lAh ${escapedPath}`;
                const result = await this.commandExecutor.executeCommand(session, listCmd, timeout);
                if (result.exitCode !== 0) {
                    throw new Error(`Failed to list remote directory: ${result.output || 'Unknown error'}`);
                }
                const files = [];
                const lines = result.output.split('\n').filter((l) => l.trim());
                for (const line of lines) {
                    // Parse ls output: permissions size date name
                    const parts = line.split(/\s+/).filter((p) => p);
                    if (parts.length < 9)
                        continue;
                    const permissions = parts[0];
                    const size = parseInt(parts[4], 10);
                    const name = parts.slice(8).join(' ');
                    files.push({
                        name,
                        path: `${remotePath}/${name}`,
                        size: Number.isNaN(size) ? 0 : size,
                        isDirectory: permissions.startsWith('d'),
                        permissions,
                    });
                }
                return files;
            }
            catch (error) {
                this.loggingContext.error('Failed to list remote files', {
                    sessionId: session.id,
                    remotePath,
                    error: error instanceof Error ? error.message : String(error),
                });
                throw error;
            }
        });
    }
    /**
     * Deletes a file on remote host
     */
    async deleteRemoteFile(session, remotePath, timeout = 10000) {
        const context = CorrelationContext.generate(undefined, undefined, session.id);
        return CorrelationContext.runAsync(context, async () => {
            if (!session.isReady) {
                throw new Error(`Session ${session.id} is busy executing: ${session.lastCommand}`);
            }
            try {
                const escapedPath = this.escapeShellArg(remotePath);
                const deleteCmd = `rm -f ${escapedPath}`;
                const result = await this.commandExecutor.executeCommand(session, deleteCmd, timeout);
                if (result.exitCode !== 0) {
                    throw new Error(`Failed to delete remote file: ${result.output || 'Unknown error'}`);
                }
                this.loggingContext.info('Remote file deleted', {
                    sessionId: session.id,
                    remotePath,
                });
            }
            catch (error) {
                this.loggingContext.error('Failed to delete remote file', {
                    sessionId: session.id,
                    remotePath,
                    error: error instanceof Error ? error.message : String(error),
                });
                throw error;
            }
        });
    }
    async transferViaMethod(session, direction, localPath, remotePath, method, timeout) {
        switch (method) {
            case 'scp':
                return this.transferWithScp(session, direction, localPath, remotePath, timeout);
            case 'sftp':
                return this.transferWithSftp(session, direction, localPath, remotePath, timeout);
            case 'ftp':
                return this.transferWithFtp(session, direction, localPath, remotePath, timeout);
            default:
                throw new Error(`Unsupported transfer method: ${method}`);
        }
    }
    async transferWithScp(session, direction, localPath, remotePath, timeout) {
        const target = this.ensureSessionTarget(session);
        const options = ['-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null'];
        if (!target.password) {
            options.push('-o', 'BatchMode=yes');
        }
        if (target.port) {
            options.push('-P', String(target.port));
        }
        if (target.identityFile) {
            const keyPath = target.identityFile.startsWith('~')
                ? target.identityFile.replace('~', os.homedir())
                : target.identityFile;
            options.push('-i', this.escapeShellArg(keyPath));
        }
        const remoteSpec = `${target.user ? `${target.user}@` : ''}${target.host}`;
        const remoteTarget = `${remoteSpec}:${remotePath}`;
        const optionString = options.join(' ');
        const resolvedLocalPath = path.resolve(localPath);
        const command = direction === 'upload'
            ? `scp ${optionString} ${this.escapeShellArg(resolvedLocalPath)} ${this.escapeShellArg(remoteTarget)}`
            : `scp ${optionString} ${this.escapeShellArg(remoteTarget)} ${this.escapeShellArg(resolvedLocalPath)}`;
        await this.runLocalCommand(command, timeout);
    }
    async transferWithSftp(session, direction, localPath, remotePath, timeout) {
        const target = this.ensureSessionTarget(session);
        const scriptPath = path.join(os.tmpdir(), `mcp_sftp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.cmd`);
        const resolvedLocalPath = path.resolve(localPath);
        const action = direction === 'upload'
            ? `put ${this.escapeSftpPath(resolvedLocalPath)} ${this.escapeSftpPath(remotePath)}`
            : `get ${this.escapeSftpPath(remotePath)} ${this.escapeSftpPath(resolvedLocalPath)}`;
        await fsPromises.writeFile(scriptPath, `${action}\nbye\n`, { mode: 0o600 });
        const options = ['-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null'];
        if (!target.password) {
            options.push('-o', 'BatchMode=yes');
        }
        if (target.port) {
            options.push('-P', String(target.port));
        }
        if (target.identityFile) {
            options.push('-i', this.escapeShellArg(target.identityFile));
        }
        const targetHost = `${target.user ? `${target.user}@` : ''}${target.host}`;
        const command = `sftp ${options.join(' ')} -b ${this.escapeShellArg(scriptPath)} ${this.escapeShellArg(targetHost)}`;
        try {
            await this.runLocalCommand(command, timeout);
        }
        finally {
            await fsPromises.rm(scriptPath).catch(() => { });
        }
    }
    async transferWithFtp(session, direction, localPath, remotePath, timeout) {
        const target = this.ensureSessionTarget(session);
        if (!target.password) {
            throw new Error('FTP transfers require a password on the SSH target configuration.');
        }
        const ftpUrl = this.buildFtpUrl(target, remotePath);
        const credentials = `${target.user}:${target.password}`;
        const baseFlags = '--fail --silent --show-error';
        const command = direction === 'upload'
            ? `curl ${baseFlags} --ftp-create-dirs -T ${this.escapeShellArg(localPath)} -u ${this.escapeShellArg(credentials)} ${this.escapeShellArg(ftpUrl)}`
            : `curl ${baseFlags} -o ${this.escapeShellArg(localPath)} -u ${this.escapeShellArg(credentials)} ${this.escapeShellArg(ftpUrl)}`;
        await this.runLocalCommand(command, timeout);
    }
    async runLocalCommand(command, timeout) {
        const commandName = command.split(' ')[0];
        if (!this.isCommandAvailable(commandName)) {
            throw new Error(`Required command '${commandName}' not found. Please ensure OpenSSH (scp, sftp) is installed on the system.`);
        }
        return new Promise((resolve, reject) => {
            const proc = cpSpawn(command, { shell: true, env: process.env });
            let stdout = '';
            let stderr = '';
            let timedOut = false;
            const timer = setTimeout(() => {
                timedOut = true;
                proc.kill('SIGTERM');
            }, timeout);
            proc.stdout?.on('data', (chunk) => {
                stdout += chunk.toString();
            });
            proc.stderr?.on('data', (chunk) => {
                stderr += chunk.toString();
            });
            proc.on('close', (code) => {
                clearTimeout(timer);
                if (timedOut) {
                    reject(new Error(`Transfer command timed out after ${timeout}ms`));
                    return;
                }
                if (code !== 0) {
                    reject(new Error(`Transfer command exited with code ${code}: ${stderr || stdout}`));
                    return;
                }
                resolve();
            });
            proc.on('error', (error) => {
                clearTimeout(timer);
                if (error.message.includes('ENOENT')) {
                    reject(new Error(`Required command '${commandName}' not found. Please ensure OpenSSH (scp, sftp) is installed.`));
                    return;
                }
                reject(error);
            });
        });
    }
    isCommandAvailable(command) {
        const commandPath = command.replace(/ .*$/, '');
        if (existsSync(commandPath)) {
            return true;
        }
        const pathEnv = process.env.PATH || process.env.Path || '';
        const pathDirs = pathEnv.split(process.platform === 'win32' ? ';' : ':');
        return pathDirs.some((dir) => {
            try {
                return existsSync(path.join(dir, command));
            }
            catch {
                return false;
            }
        });
    }
    ensureSessionTarget(session) {
        if (!session.target) {
            throw new Error('No SSH target configured for file transfer.');
        }
        return session.target;
    }
    escapeSftpPath(value) {
        const escaped = value.replace(/(["\\])/g, '\\$1');
        return `"${escaped}"`;
    }
    buildFtpUrl(target, remotePath) {
        const normalizedPath = remotePath.replace(/^\/+/, '');
        const encodedPath = normalizedPath
            .split('/')
            .filter((part) => part.length > 0)
            .map(encodeURIComponent)
            .join('/');
        const port = target.port || 21;
        const suffix = encodedPath ? `/${encodedPath}` : '';
        return `ftp://${target.host}:${port}${suffix}`;
    }
    /**
     * Resolves remote path (handles ~ expansion)
     */
    resolveRemotePath(remotePath, session) {
        if (session?.target) {
            return remotePath;
        }
        if (remotePath.startsWith('~')) {
            const home = process.env.HOME || os.homedir();
            return path.resolve(home, remotePath.slice(1));
        }
        return path.resolve(remotePath);
    }
    // ===== PRIVATE METHODS =====
    escapeShellArg(value) {
        if (value.length === 0) {
            return "''";
        }
        const escaped = value.split("'").join("'\\''");
        return `'${escaped}'`;
    }
}
