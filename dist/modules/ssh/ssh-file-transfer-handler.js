import os from 'node:os';
import path from 'node:path';
import { promises as fsPromises } from 'node:fs';
import logger from '../../core/logger.js';
import { RetryStrategy } from '../../core/recovery/retry-strategy.js';
import { CircuitBreaker } from '../../core/recovery/circuit-breaker.js';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const FILE_TRANSFER_TIMEOUT = 300000; // 5 minutes
/**
 * SSHFileTransferHandler manages file transfer operations
 * - SCP and SFTP file transfer
 * - Base64 encoding/decoding for large files
 * - Directory support and recursive operations
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
        this.commandExecutor = commandExecutor;
    }
    /**
     * Uploads a file to remote host
     */
    async uploadFile(session, localPath, remotePath, timeout = FILE_TRANSFER_TIMEOUT) {
        if (!session.target) {
            throw new Error('No SSH target configured for this session');
        }
        if (!session.isReady) {
            throw new Error(`Session ${session.id} is busy executing: ${session.lastCommand}`);
        }
        try {
            const stats = await fsPromises.stat(localPath);
            if (!stats.isFile()) {
                throw new Error('Upload source must be a regular file.');
            }
            if (stats.size > MAX_FILE_SIZE) {
                throw new Error(`File size (${(stats.size / 1024 / 1024).toFixed(2)}MB) exceeds the 10MB limit.`);
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
            // Use base64 encoding with temp file approach
            const base64Content = (await fsPromises.readFile(localPath)).toString('base64');
            const tempBase64File = `/tmp/mcp_upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.b64`;
            // Write base64 content to temp file
            const writeTempCmd = `printf '%s' '${base64Content}' > ${this.escapeShellArg(tempBase64File)}`;
            await this.commandExecutor.executeCommand(session, writeTempCmd, timeout);
            // Decode temp file to destination
            const decodeCmd = `base64 -d ${this.escapeShellArg(tempBase64File)} > ${this.escapeShellArg(finalRemotePath)} && rm -f ${this.escapeShellArg(tempBase64File)}`;
            const decodeResult = await this.commandExecutor.executeCommand(session, decodeCmd, timeout);
            if (decodeResult.exitCode !== 0) {
                const output = decodeResult.output || '';
                if (output.includes('permission denied') ||
                    output.includes('Permission denied') ||
                    output.includes('EACCES')) {
                    throw new Error(`Permission denied writing to remote path: ${finalRemotePath}. Check write permissions for the target directory.`);
                }
                else if (output.includes('no such file') || output.includes('No such file')) {
                    throw new Error(`Remote directory does not exist: ${path.dirname(finalRemotePath)}`);
                }
                throw new Error(`Failed to decode and write file to remote: ${output || 'Unknown error'}`);
            }
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
            logger.info('File uploaded successfully', {
                component: 'SSHFileTransferHandler',
                sessionId: session.id,
                localPath,
                remotePath: finalRemotePath,
                size: stats.size,
            });
            return {
                message: `File uploaded successfully: ${localPath} -> ${finalRemotePath}\n${verify.output}`,
                remotePath: finalRemotePath,
                size: stats.size,
            };
        }
        catch (error) {
            logger.error('File upload failed', {
                component: 'SSHFileTransferHandler',
                sessionId: session.id,
                localPath,
                remotePath,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
    /**
     * Downloads a file from remote host
     */
    async downloadFile(session, remotePath, localPath, timeout = FILE_TRANSFER_TIMEOUT) {
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
            if (sizeResult.exitCode !== 0) {
                const output = sizeResult.output || '';
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
            const outputLines = sizeResult.output.trim().split('\n').filter((l) => l.trim());
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
                throw new Error(`Remote file (${(fileSize / 1024 / 1024).toFixed(2)}MB) exceeds the 10MB limit.`);
            }
            // Download using base64 encoding
            const tempRemoteFile = `/tmp/mcp_download_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.b64`;
            // Encode to temp file on remote
            const encodeCmd = `base64 ${escapedPath} > ${this.escapeShellArg(tempRemoteFile)}`;
            const encodeResult = await this.commandExecutor.executeCommand(session, encodeCmd, timeout);
            if (encodeResult.exitCode !== 0) {
                const output = encodeResult.output || '';
                if (output.includes('permission denied') ||
                    output.includes('Permission denied') ||
                    output.includes('EACCES')) {
                    throw new Error(`Permission denied reading remote file: ${remotePath}. Check read permissions.`);
                }
                if (output.includes('No such file') || output.includes('no such file')) {
                    throw new Error(`Remote file not found: ${remotePath}`);
                }
                throw new Error(`Failed to encode remote file: ${output || 'Unknown error'}`);
            }
            // Read the temp file content
            const readTempCmd = `cat ${this.escapeShellArg(tempRemoteFile)}`;
            const tempResult = await this.commandExecutor.executeCommand(session, readTempCmd, timeout);
            // Clean up temp file
            await this.commandExecutor.executeCommand(session, `rm -f ${this.escapeShellArg(tempRemoteFile)}`, 5000);
            const cleaned = tempResult.output.replace(/[\s\n\r]+/g, '');
            let buffer;
            try {
                buffer = Buffer.from(cleaned, 'base64');
            }
            catch (e) {
                throw new Error(`Failed to decode base64 content: ${e}`);
            }
            await fsPromises.mkdir(path.dirname(localPath), { recursive: true });
            await fsPromises.writeFile(localPath, buffer);
            const localStats = await fsPromises.stat(localPath);
            logger.info('File downloaded successfully', {
                component: 'SSHFileTransferHandler',
                sessionId: session.id,
                remotePath,
                localPath,
                size: localStats.size,
            });
            return {
                message: `File downloaded successfully: ${remotePath} -> ${localPath}\nSize: ${(localStats.size / 1024).toFixed(2)}KB`,
                localPath,
                size: localStats.size,
            };
        }
        catch (error) {
            logger.error('File download failed', {
                component: 'SSHFileTransferHandler',
                sessionId: session.id,
                remotePath,
                localPath,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
    /**
     * Lists files in a remote directory
     */
    async listRemoteFiles(session, remotePath, timeout = 10000) {
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
            logger.error('Failed to list remote files', {
                component: 'SSHFileTransferHandler',
                sessionId: session.id,
                remotePath,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
    /**
     * Deletes a file on remote host
     */
    async deleteRemoteFile(session, remotePath, timeout = 10000) {
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
            logger.info('Remote file deleted', {
                component: 'SSHFileTransferHandler',
                sessionId: session.id,
                remotePath,
            });
        }
        catch (error) {
            logger.error('Failed to delete remote file', {
                component: 'SSHFileTransferHandler',
                sessionId: session.id,
                remotePath,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
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
