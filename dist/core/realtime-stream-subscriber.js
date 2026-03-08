/**
 * Issue #13: リアルタイムストリーミング機能
 * リアルタイム出力配信のためのSubscriber
 */
import { generateId, getCurrentTimestamp } from '../utils/shell-helpers.js'; // Adapted import
import logger from './logger.js'; // Use our central logger
/**
 * リアルタイムストリーミング用のSubscriber
 * プロセス出力をメモリ内にバッファして、リアルタイム配信を可能にする
 */
export class RealtimeStreamSubscriber {
    constructor(options = {}) {
        this.streams = new Map();
        this.cleanupInterval = null;
        this.id = `realtime-stream-${generateId()}`;
        this.options = {
            bufferSize: 8192,
            notificationInterval: 100,
            maxRetentionSeconds: 3600, // 1時間
            maxBuffers: 1000,
            ...options,
        };
        // 定期的なクリーンアップを開始
        this.startCleanupTimer();
    }
    async onProcessStart(executionId, command) {
        const streamState = {
            executionId,
            command,
            startTime: getCurrentTimestamp(),
            buffers: [],
            isActive: true,
            lastUpdateTime: getCurrentTimestamp(),
            totalBytesReceived: 0,
            sequenceCounter: 0,
        };
        this.streams.set(executionId, streamState);
        logger.info(`RealtimeStreamSubscriber: Started streaming for ${executionId}`);
    }
    async onOutputData(executionId, data, isStderr = false) {
        const streamState = this.streams.get(executionId);
        if (!streamState) {
            logger.warn(`RealtimeStreamSubscriber: No stream state found for ${executionId}. Output data lost.`);
            return;
        }
        // バッファを作成
        const buffer = {
            timestamp: getCurrentTimestamp(),
            data,
            isStderr,
            sequenceNumber: streamState.sequenceCounter++,
        };
        // バッファを追加（サイズ制限チェック）
        streamState.buffers.push(buffer);
        streamState.totalBytesReceived += data.length;
        streamState.lastUpdateTime = getCurrentTimestamp();
        // バッファ数の制限チェック
        if (streamState.buffers.length > this.options.maxBuffers) {
            // 古いバッファを削除
            const removed = streamState.buffers.splice(0, streamState.buffers.length - this.options.maxBuffers);
            logger.warn(`RealtimeStreamSubscriber: Removed ${removed.length} old buffers for ${executionId} due to maxBuffers limit.`);
        }
    }
    async onProcessEnd(executionId, exitCode) {
        const streamState = this.streams.get(executionId);
        if (streamState) {
            streamState.isActive = false;
            streamState.lastUpdateTime = getCurrentTimestamp();
            logger.info(`RealtimeStreamSubscriber: Process ${executionId} ended with code ${exitCode}`);
        }
    }
    async onError(executionId, error) {
        const streamState = this.streams.get(executionId);
        if (streamState) {
            streamState.isActive = false;
            streamState.lastUpdateTime = getCurrentTimestamp();
            // エラー情報をバッファに追加
            const errorBuffer = {
                timestamp: getCurrentTimestamp(),
                data: `\n[ERROR] ${error.message}\n`,
                isStderr: true,
                sequenceNumber: streamState.sequenceCounter++,
            };
            streamState.buffers.push(errorBuffer);
            logger.error(`RealtimeStreamSubscriber: Error in process ${executionId}:`, { error: error.message });
        }
    }
    /**
     * 指定された実行のストリーム状態を取得
     */
    getStreamState(executionId) {
        return this.streams.get(executionId);
    }
    /**
     * 指定された実行の最新バッファを取得
     */
    getLatestBuffers(executionId, count = 10) {
        const streamState = this.streams.get(executionId);
        if (!streamState) {
            return [];
        }
        return streamState.buffers.slice(-count);
    }
    /**
     * 指定された実行の指定された位置からのバッファを取得
     */
    getBuffersFromSequence(executionId, fromSequence, maxCount = 100) {
        const streamState = this.streams.get(executionId);
        if (!streamState) {
            return [];
        }
        const buffers = streamState.buffers.filter((buffer) => buffer.sequenceNumber >= fromSequence);
        return buffers.slice(0, maxCount);
    }
    /**
     * アクティブなストリーム一覧を取得
     */
    getActiveStreams() {
        return Array.from(this.streams.entries())
            .filter(([_, state]) => state.isActive)
            .map(([executionId]) => executionId);
    }
    /**
     * 全ストリーム一覧を取得
     */
    getAllStreams() {
        return Array.from(this.streams.keys());
    }
    /**
     * 指定されたストリームを削除
     */
    removeStream(executionId) {
        return this.streams.delete(executionId);
    }
    /**
     * 統計情報を取得
     */
    getStats() {
        let totalBuffers = 0;
        let totalBytesReceived = 0;
        let activeStreams = 0;
        for (const state of this.streams.values()) {
            totalBuffers += state.buffers.length;
            totalBytesReceived += state.totalBytesReceived;
            if (state.isActive) {
                activeStreams++;
            }
        }
        return {
            totalStreams: this.streams.size,
            activeStreams,
            totalBuffers,
            totalBytesReceived,
        };
    }
    /**
     * 定期的なクリーンアップタイマーを開始
     */
    startCleanupTimer() {
        // 5分ごとにクリーンアップを実行
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, 5 * 60 * 1000);
    }
    /**
     * 古いストリームをクリーンアップ
     */
    cleanup() {
        const now = Date.now();
        const maxRetentionMs = this.options.maxRetentionSeconds * 1000;
        const toRemove = [];
        for (const [executionId, state] of this.streams.entries()) {
            const lastUpdateTime = new Date(state.lastUpdateTime).getTime();
            // 非アクティブで保持期間を超えている場合は削除対象
            if (!state.isActive && now - lastUpdateTime > maxRetentionMs) {
                toRemove.push(executionId);
            }
        }
        for (const executionId of toRemove) {
            this.streams.delete(executionId);
            logger.info(`RealtimeStreamSubscriber: Cleaned up old stream ${executionId}`);
        }
        if (toRemove.length > 0) {
            logger.info(`RealtimeStreamSubscriber: Cleanup completed, removed ${toRemove.length} streams`);
        }
    }
    /**
     * リソースをクリーンアップして終了
     */
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.streams.clear();
        logger.info(`RealtimeStreamSubscriber: Subscriber ${this.id} destroyed`);
    }
}
