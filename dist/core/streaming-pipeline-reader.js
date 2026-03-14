/**
 * Issue #13: Streaming Pipeline Reader
 * 実行中プロセスの出力をリアルタイムで読み取り、次のプロセスのSTDINに流すためのStream
 */
import { Readable } from 'node:stream'; // Use node:stream
import logger from './logger.js'; // Use our central logger
// Configuration constants
const DEFAULT_READ_TIMEOUT = 30000; // 30 seconds for stream reading
const DEFAULT_BUFFER_SIZE = 8192; // 8 KB
const DEFAULT_POLLING_INTERVAL = 100; // 100 milliseconds
/**
 * input_output_idが実行中プロセスの場合に使用するStreamingリーダー
 * 1. まずFileの既存内容を読み取り
 * 2. File末尾到達後、RealtimeStreamからリアルタイムデータを取得
 */
export class StreamingPipelineReader extends Readable {
    constructor(fileManager, realtimeSubscriber, outputId, executionId, options = {}) {
        super({ objectMode: false });
        // State management
        this.filePosition = 0;
        this.isFileComplete = false;
        this.lastSequenceNumber = -1;
        this.readTimer = null;
        this.isDestroyed = false;
        this.fileManager = fileManager;
        this.realtimeSubscriber = realtimeSubscriber;
        this.outputId = outputId;
        this.executionId = executionId;
        this.options = {
            readTimeout: DEFAULT_READ_TIMEOUT,
            bufferSize: DEFAULT_BUFFER_SIZE,
            pollingInterval: DEFAULT_POLLING_INTERVAL,
            ...options,
        };
    }
    /**
     * Readable stream implementation
     */
    _read(_size) {
        if (this.isDestroyed) {
            this.push(null);
            return;
        }
        // 既に読み取りタイマーが動いている場合はスキップ
        if (this.readTimer) {
            return;
        }
        this.startReading();
    }
    /**
     * 読み取り処理を開始
     */
    startReading() {
        this.readTimer = setInterval(async () => {
            try {
                await this.performRead();
            }
            catch (error) {
                logger.error(`StreamingPipelineReader: Read error for ${this.outputId}:`, { error: error instanceof Error ? error.message : String(error) });
                this.destroy(error);
            }
        }, this.options.pollingInterval);
        // タイムアウト設定
        setTimeout(() => {
            if (!this.isDestroyed && this.readTimer) {
                logger.error(`StreamingPipelineReader: Read timeout for ${this.outputId}`);
                this.destroy(new Error('Read timeout'));
            }
        }, this.options.readTimeout);
    }
    /**
     * 実際の読み取り処理
     */
    async performRead() {
        if (!this.isFileComplete) {
            // Phase 1: Fileから既存データを読み取り
            await this.readFromFile();
        }
        else {
            // Phase 2: RealtimeStreamからデータを読み取り
            await this.readFromStream();
        }
    }
    /**
     * Phase 1: Fileから既存データを読み取り
     */
    async readFromFile() {
        try {
            const result = await this.fileManager.readFile(this.outputId, this.filePosition, this.options.bufferSize, 'utf-8');
            if (result.content && result.content.length > 0) {
                // データがある場合は読み取り位置を更新
                this.filePosition += Buffer.byteLength(result.content, 'utf-8');
                this.push(result.content);
                logger.debug(`StreamingPipelineReader: Read ${result.content.length} chars from file position ${this.filePosition - result.content.length}`);
            }
            else {
                // ファイルの末尾に到達 - プロセスが終了しているかチェック
                const streamState = this.realtimeSubscriber.getStreamState(this.executionId);
                if (streamState && !streamState.isActive) {
                    // プロセスが終了している場合は読み取り完了
                    logger.info(`StreamingPipelineReader: Process ${this.executionId} completed, file reading finished`);
                    this.push(null); // EOF
                    this.cleanup();
                }
                else {
                    // プロセスがまだ実行中の場合は、Streamモードに移行
                    logger.info(`StreamingPipelineReader: File EOF reached, switching to stream mode for ${this.outputId}`);
                    this.isFileComplete = true;
                    // Fileに保存された最後のシーケンス番号を特定
                    if (streamState) {
                        // 最新のバッファから最後に保存されたシーケンス番号を推定
                        const latestBuffers = this.realtimeSubscriber.getLatestBuffers(this.executionId, 10);
                        if (latestBuffers.length > 0) {
                            // ファイルサイズと比較して、どこまでがFile保存済みかを推定
                            this.lastSequenceNumber = this.estimateLastFileSequence(latestBuffers);
                        }
                    }
                }
            }
        }
        catch (error) {
            logger.error(`StreamingPipelineReader: File read error: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    /**
     * Phase 2: RealtimeStreamからデータを読み取り
     */
    async readFromStream() {
        const streamState = this.realtimeSubscriber.getStreamState(this.executionId);
        if (!streamState) {
            logger.error(`StreamingPipelineReader: Stream state not found for ${this.executionId}`);
            this.push(null);
            this.cleanup();
            return;
        }
        // 最後に読み取ったシーケンス番号以降のバッファを取得
        const newBuffers = this.realtimeSubscriber.getBuffersFromSequence(this.executionId, this.lastSequenceNumber + 1, 50 // 一度に最大50バッファ
        );
        if (newBuffers.length > 0) {
            for (const buffer of newBuffers) {
                this.push(buffer.data);
                this.lastSequenceNumber = buffer.sequenceNumber;
                logger.debug(`StreamingPipelineReader: Streamed buffer seq=${buffer.sequenceNumber}, ${buffer.data.length} chars`);
            }
        }
        // プロセスが終了していて、新しいバッファもない場合は完了
        if (!streamState.isActive && newBuffers.length === 0) {
            logger.info(`StreamingPipelineReader: Stream completed for ${this.executionId}`);
            this.push(null); // EOF
            this.cleanup();
        }
    }
    /**
     * ファイルに保存済みの最後のシーケンス番号を推定
     */
    estimateLastFileSequence(latestBuffers) {
        // 簡単な推定: ファイルサイズからバッファサイズを逆算
        // より正確な実装では、FileStorageSubscriberとの連携が必要
        let estimatedBytes = 0;
        for (let i = latestBuffers.length - 1; i >= 0; i--) {
            const buffer = latestBuffers[i];
            if (buffer) {
                estimatedBytes += buffer.data.length;
                if (estimatedBytes >= this.filePosition) {
                    return Math.max(0, buffer.sequenceNumber - 1);
                }
            }
        }
        return -1;
    }
    /**
     * リソースのクリーンアップ
     */
    cleanup() {
        if (this.readTimer) {
            clearInterval(this.readTimer);
            this.readTimer = null;
        }
        this.isDestroyed = true;
    }
    /**
     * Stream destroy implementation
     */
    _destroy(error, callback) {
        this.cleanup();
        logger.info(`StreamingPipelineReader: Destroyed ${this.outputId}${error ? ` with error: ${error.message}` : ''}`);
        callback(error);
    }
}
