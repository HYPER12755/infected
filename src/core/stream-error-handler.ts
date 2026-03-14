/**
 * Stream Error Handler & Timeout Manager
 * Handles error management, timeouts, backpressure, and stream cleanup
 */

import logger from './logger.js';
import { EventEmitter } from 'node:events';

export interface StreamError {
  type: 'timeout' | 'overflow' | 'disconnected' | 'execution_error' | 'cleanup_error';
  message: string;
  executionId: string;
  timestamp: number;
  severity: 'warning' | 'error' | 'critical';
  metadata?: Record<string, unknown>;
}

export interface StreamMetrics {
  executionId: string;
  bytesTransferred: number;
  chunksEmitted: number;
  duration: number;
  startTime: number;
  endTime?: number;
  errors: StreamError[];
  timeoutTriggered: boolean;
}

/**
 * Manages stream execution with timeout and error handling
 */
export class StreamErrorHandler extends EventEmitter {
  private activeStreams = new Map<string, StreamMetrics>();
  private streamTimeouts = new Map<string, NodeJS.Timeout>();
  private readonly MAX_STREAM_BUFFER = 10 * 1024 * 1024; // 10MB
  private readonly DEFAULT_TIMEOUT = 30000; // 30 seconds
  private readonly CLEANUP_INTERVAL = 60000; // Clean up every minute

  constructor() {
    super();
    this.startCleanupInterval();
    logger.debug('StreamErrorHandler initialized', {
      maxBuffer: this.MAX_STREAM_BUFFER,
      defaultTimeout: this.DEFAULT_TIMEOUT,
    });
  }

  /**
   * Register a new stream execution
   */
  registerStream(executionId: string, timeoutMs?: number): StreamMetrics {
    const metrics: StreamMetrics = {
      executionId,
      bytesTransferred: 0,
      chunksEmitted: 0,
      duration: 0,
      startTime: Date.now(),
      errors: [],
      timeoutTriggered: false,
    };

    this.activeStreams.set(executionId, metrics);

    // Set timeout if specified
    if (timeoutMs) {
      this.setStreamTimeout(executionId, timeoutMs);
    }

    logger.debug('Stream registered', { executionId, timeoutMs });
    return metrics;
  }

  /**
   * Update stream metrics after emitting data
   */
  recordChunk(executionId: string, dataSize: number): boolean {
    const metrics = this.activeStreams.get(executionId);
    if (!metrics) {
      logger.warn('Recording chunk for unknown stream', { executionId });
      return false;
    }

    metrics.bytesTransferred += dataSize;
    metrics.chunksEmitted += 1;
    metrics.duration = Date.now() - metrics.startTime;

    // Check for buffer overflow
    if (metrics.bytesTransferred > this.MAX_STREAM_BUFFER) {
      this.emitError({
        type: 'overflow',
        message: `Stream buffer overflow: ${metrics.bytesTransferred} bytes exceeds max ${this.MAX_STREAM_BUFFER}`,
        executionId,
        timestamp: Date.now(),
        severity: 'critical',
        metadata: { bytesTransferred: metrics.bytesTransferred },
      });
      return false;
    }

    return true;
  }

  /**
   * Set or update stream timeout
   */
  setStreamTimeout(executionId: string, timeoutMs: number): void {
    // Clear existing timeout
    const existingTimeout = this.streamTimeouts.get(executionId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Set new timeout
    const timeout = setTimeout(() => {
      const metrics = this.activeStreams.get(executionId);
      if (metrics && !metrics.endTime) {
        metrics.timeoutTriggered = true;
        this.emitError({
          type: 'timeout',
          message: `Stream execution timeout after ${timeoutMs}ms`,
          executionId,
          timestamp: Date.now(),
          severity: 'error',
          metadata: { timeoutMs, duration: metrics.duration },
        });
        this.cleanupStream(executionId);
      }
    }, timeoutMs);

    this.streamTimeouts.set(executionId, timeout);
    logger.debug('Stream timeout set', { executionId, timeoutMs });
  }

  /**
   * Record an execution error
   */
  recordError(executionId: string, error: Error, severity: 'warning' | 'error' | 'critical' = 'error'): void {
    const metrics = this.activeStreams.get(executionId);
    if (!metrics) {
      logger.warn('Recording error for unknown stream', { executionId });
      return;
    }

    const streamError: StreamError = {
      type: 'execution_error',
      message: error.message,
      executionId,
      timestamp: Date.now(),
      severity,
      metadata: { stack: error.stack },
    };

    metrics.errors.push(streamError);
    this.emit('error', streamError);
    logger.warn('Stream error recorded', { executionId, error: error.message });
  }

  /**
   * Complete stream execution
   */
  completeStream(executionId: string): StreamMetrics | null {
    const metrics = this.activeStreams.get(executionId);
    if (!metrics) {
      logger.warn('Completing unknown stream', { executionId });
      return null;
    }

    metrics.endTime = Date.now();
    metrics.duration = metrics.endTime - metrics.startTime;

    this.cleanupStream(executionId);

    logger.info('Stream completed', {
      executionId,
      duration: metrics.duration,
      bytesTransferred: metrics.bytesTransferred,
      chunksEmitted: metrics.chunksEmitted,
      errorCount: metrics.errors.length,
    });

    return metrics;
  }

  /**
   * Get stream metrics
   */
  getMetrics(executionId: string): StreamMetrics | null {
    return this.activeStreams.get(executionId) || null;
  }

  /**
   * Get all active streams
   */
  getActiveStreams(): StreamMetrics[] {
    return Array.from(this.activeStreams.values()).filter(m => !m.endTime);
  }

  /**
   * Clean up stream resources
   */
  private cleanupStream(executionId: string): void {
    // Clear timeout
    const timeout = this.streamTimeouts.get(executionId);
    if (timeout) {
      clearTimeout(timeout);
      this.streamTimeouts.delete(executionId);
    }

    // Keep metrics for a bit for querying, but don't actively manage
    logger.debug('Stream cleaned up', { executionId });
  }

  /**
   * Emit error event
   */
  private emitError(error: StreamError): void {
    const metrics = this.activeStreams.get(error.executionId);
    if (metrics) {
      metrics.errors.push(error);
    }
    this.emit('error', error);
  }

  /**
   * Periodically clean up old completed streams
   */
  private startCleanupInterval(): void {
    setInterval(() => {
      const now = Date.now();
      const MAX_RETENTION = 5 * 60 * 1000; // Keep completed streams for 5 minutes

      for (const [executionId, metrics] of this.activeStreams.entries()) {
        if (metrics.endTime && now - metrics.endTime > MAX_RETENTION) {
          this.activeStreams.delete(executionId);
          logger.debug('Old stream metrics removed', {
            executionId,
            age: now - metrics.endTime,
          });
        }
      }
    }, this.CLEANUP_INTERVAL);
  }

  /**
   * Shutdown handler - clean up all streams
   */
  async shutdown(): Promise<void> {
    logger.info('StreamErrorHandler shutting down');

    // Clear all timeouts
    for (const timeout of this.streamTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.streamTimeouts.clear();

    // Clean metrics
    this.activeStreams.clear();

    this.removeAllListeners();
  }
}

/**
 * Backpressure handler for stream buffering
 */
export class BackpressureHandler {
  private buffers = new Map<string, Buffer[]>();
  private bufferSizes = new Map<string, number>();
  private readonly MAX_BUFFER_SIZE = 5 * 1024 * 1024; // 5MB per stream
  private readonly DRAIN_THRESHOLD = 4 * 1024 * 1024; // Start draining at 4MB

  /**
   * Add data to buffer, return true if consumer should wait
   */
  addToBuffer(executionId: string, data: Buffer): boolean {
    if (!this.buffers.has(executionId)) {
      this.buffers.set(executionId, []);
      this.bufferSizes.set(executionId, 0);
    }

    const buffers = this.buffers.get(executionId)!;
    const currentSize = this.bufferSizes.get(executionId)!;

    // Check if adding this data would exceed max
    if (currentSize + data.length > this.MAX_BUFFER_SIZE) {
      logger.warn('Buffer overflow threshold reached', {
        executionId,
        currentSize,
        incomingData: data.length,
        maxSize: this.MAX_BUFFER_SIZE,
      });
      return true; // Signal backpressure
    }

    buffers.push(data);
    this.bufferSizes.set(executionId, currentSize + data.length);

    return currentSize + data.length > this.DRAIN_THRESHOLD;
  }

  /**
   * Drain buffer for a stream
   */
  drainBuffer(executionId: string): Buffer[] {
    const buffers = this.buffers.get(executionId) || [];
    if (buffers.length > 0) {
      this.buffers.set(executionId, []);
      this.bufferSizes.set(executionId, 0);
    }
    return buffers;
  }

  /**
   * Clear buffer for a stream
   */
  clearBuffer(executionId: string): void {
    this.buffers.delete(executionId);
    this.bufferSizes.delete(executionId);
  }

  /**
   * Get buffer status
   */
  getBufferStatus(executionId: string): { size: number; count: number; fullPercent: number } {
    const size = this.bufferSizes.get(executionId) || 0;
    const count = (this.buffers.get(executionId) || []).length;
    const fullPercent = (size / this.MAX_BUFFER_SIZE) * 100;
    return { size, count, fullPercent };
  }
}

export default StreamErrorHandler;
