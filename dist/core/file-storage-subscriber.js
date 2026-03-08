/**
 * Issue #13: FileManager Subscriber実装
 * 既存のFileManagerをStreamSubscriberパターンに拡張
 */
import * as fs from 'node:fs/promises'; // Use node:fs/promises
import * as path from 'node:path'; // Use node:path
import { generateId, getCurrentTimestamp } from '../utils/shell-helpers.js'; // Adapted import
import logger from './logger.js'; // Use our central logger
/**
 * FileManager の Subscriber ラッパー
 * プロセス出力をファイルに保存するSubscriber
 */
export class FileStorageSubscriber {
    constructor(fileManager, baseDir = '/tmp/mcp-shell-outputs') {
        this.fileManager = fileManager;
        this.baseDir = baseDir;
        this.fileStreams = new Map();
        this.filePaths = new Map();
        this.id = `file-storage-${generateId()}`;
    }
    async onProcessStart(executionId, _command) {
        // 出力ファイルのパスを準備
        const timestamp = getCurrentTimestamp().replace(/[:.]/g, '-');
        const stdoutPath = path.join(this.baseDir, `${executionId}-stdout-${timestamp}.txt`);
        const stderrPath = path.join(this.baseDir, `${executionId}-stderr-${timestamp}.txt`);
        this.filePaths.set(executionId, {
            stdout: stdoutPath,
            stderr: stderrPath,
        });
        // ファイルハンドルを開く（書き込み用）
        try {
            const stdoutHandle = await fs.open(stdoutPath, 'w');
            const stderrHandle = await fs.open(stderrPath, 'w');
            this.fileStreams.set(`${executionId}-stdout`, stdoutHandle);
            this.fileStreams.set(`${executionId}-stderr`, stderrHandle);
            // FileManagerに登録（まだ0サイズ）
            await this.fileManager.registerFile(stdoutPath, 'stdout', executionId);
            await this.fileManager.registerFile(stderrPath, 'stderr', executionId);
        }
        catch (error) {
            logger.error(`FileStorageSubscriber: Failed to create output files for ${executionId}:`, { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }
    async onOutputData(executionId, data, isStderr = false) {
        const streamKey = `${executionId}-${isStderr ? 'stderr' : 'stdout'}`;
        const fileHandle = this.fileStreams.get(streamKey);
        if (fileHandle) {
            try {
                await fileHandle.write(data);
                // すぐにフラッシュして、他のプロセスからも読み取り可能にする
                await fileHandle.sync();
            }
            catch (error) {
                logger.error(`FileStorageSubscriber: Failed to write data for ${executionId}:`, { error: error instanceof Error ? error.message : String(error) });
            }
        }
    }
    async onProcessEnd(executionId, _exitCode) {
        // ファイルハンドルを閉じる
        const stdoutHandle = this.fileStreams.get(`${executionId}-stdout`);
        const stderrHandle = this.fileStreams.get(`${executionId}-stderr`);
        try {
            if (stdoutHandle) {
                await stdoutHandle.close();
                this.fileStreams.delete(`${executionId}-stdout`);
            }
            if (stderrHandle) {
                await stderrHandle.close();
                this.fileStreams.delete(`${executionId}-stderr`);
            }
            // FileManagerの情報を更新（最終ファイルサイズなど）
            const filePaths = this.filePaths.get(executionId);
            if (filePaths) {
                await this.updateFileManagerInfo(executionId, filePaths);
                this.filePaths.delete(executionId);
            }
        }
        catch (error) {
            logger.error(`FileStorageSubscriber: Error closing files for ${executionId}:`, { error: error instanceof Error ? error.message : String(error) });
        }
    }
    async onError(executionId, error) {
        // エラー時もファイルを適切に閉じる
        await this.onProcessEnd(executionId, -1);
        // エラーログを stderr ファイルに書き込む
        const filePaths = this.filePaths.get(executionId);
        if (filePaths) {
            try {
                const errorMessage = `\n[ERROR] Process failed: ${error.message}\n`;
                await fs.appendFile(filePaths.stderr, errorMessage);
            }
            catch (writeError) {
                logger.error(`FileStorageSubscriber: Failed to write error to stderr file:`, { error: writeError instanceof Error ? writeError.message : String(writeError) });
            }
        }
    }
    /**
     * FileManagerの情報を最終的なファイルサイズで更新
     */
    async updateFileManagerInfo(executionId, filePaths) {
        try {
            // ファイルサイズを取得してFileManagerを更新
            const stdoutStat = await fs.stat(filePaths.stdout);
            const stderrStat = await fs.stat(filePaths.stderr);
            logger.info(`FileStorageSubscriber: Files updated for ${executionId}:`);
            logger.info(`  stdout: ${filePaths.stdout} (${stdoutStat.size} bytes)`);
            logger.info(`  stderr: ${filePaths.stderr} (${stderrStat.size} bytes)`);
        }
        catch (error) {
            logger.error(`FileStorageSubscriber: Failed to update file info for ${executionId}:`, { error: error instanceof Error ? error.message : String(error) });
        }
    }
    /**
     * 指定された実行の出力ファイルパスを取得
     */
    getFilePaths(executionId) {
        return this.filePaths.get(executionId);
    }
    /**
     * アクティブなファイルストリーム数を取得（デバッグ用）
     */
    getActiveStreamsCount() {
        return this.fileStreams.size;
    }
}
