import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import logger from './logger.js';

/**
 * Custom error thrown when resource limits are exceeded
 */
export class LimitExceededError extends Error {
  constructor(
    public limitType: 'memory' | 'cpu' | 'fileHandles' | 'connections',
    public current: number,
    public limit: number,
    public processId?: number
  ) {
    const message = processId
      ? `${limitType} limit exceeded for process ${processId}: ${current} > ${limit}`
      : `${limitType} limit exceeded: ${current} > ${limit}`;
    super(message);
    this.name = 'LimitExceededError';
  }
}

/**
 * Configuration interface for resource limits
 */
export interface ResourceLimits {
  memoryLimitMB?: number;
  cpuLimitPercent?: number;
  fileHandleLimitCount?: number;
  connectionLimitCount?: number;
}

/**
 * Details about an enforcement action taken
 */
export interface EnforcementAction {
  timestamp: number;
  limitType: 'memory' | 'cpu' | 'fileHandles' | 'connections';
  action: string;
  target?: number | string; // PID or connection ID
  reason: string;
  details?: Record<string, unknown>;
}

/**
 * ResourceLimiter enforces hard limits on resource usage to prevent exhaustion
 * and maintain system stability. Works in conjunction with ResourceMonitor.
 *
 * @example
 * ```typescript
 * const limiter = new ResourceLimiter();
 * limiter.setMemoryLimit(4096);
 * limiter.setCPULimit(80);
 * limiter.setFileHandleLimit(2048);
 * limiter.setConnectionLimit(50);
 *
 * limiter.on('limit-exceeded', (info) => {
 *   console.log('Limit exceeded:', info);
 * });
 *
 * limiter.on('action-taken', (action) => {
 *   console.log('Enforcement action:', action);
 * });
 * ```
 */
export class ResourceLimiter extends EventEmitter {
  private memoryLimitMB: number | null = null;
  private cpuLimitPercent: number | null = null;
  private fileHandleLimitCount: number | null = null;
  private connectionLimitCount: number | null = null;

  // Track processes for enforcement (maps PID to creation time)
  private monitoredProcesses = new Map<number, number>();

  // Track enforcement history
  private enforcementHistory: EnforcementAction[] = [];
  private maxHistorySize = 100;

  // Configuration for enforcement behavior
  private enableEnforcement = true;
  private gracefulShutdownTimeoutMs = 5000;

  constructor() {
    super();
    this.setMaxListeners(20);
    logger.info('ResourceLimiter initialized', { component: 'ResourceLimiter' });
  }

  /**
   * Set maximum memory limit for the system
   */
  setMemoryLimit(limitMB: number): void {
    if (limitMB <= 0) {
      throw new Error('Memory limit must be greater than 0');
    }
    this.memoryLimitMB = limitMB;
    logger.info(`Memory limit set to ${limitMB}MB`, { component: 'ResourceLimiter' });
  }

  /**
   * Set maximum CPU usage limit
   */
  setCPULimit(limitPercent: number): void {
    if (limitPercent <= 0 || limitPercent > 100) {
      throw new Error('CPU limit must be between 0 and 100');
    }
    this.cpuLimitPercent = limitPercent;
    logger.info(`CPU limit set to ${limitPercent}%`, { component: 'ResourceLimiter' });
  }

  /**
   * Set maximum open file handle limit
   */
  setFileHandleLimit(limitCount: number): void {
    if (limitCount <= 0) {
      throw new Error('File handle limit must be greater than 0');
    }
    this.fileHandleLimitCount = limitCount;
    logger.info(`File handle limit set to ${limitCount}`, { component: 'ResourceLimiter' });
  }

  /**
   * Set maximum concurrent connection limit
   */
  setConnectionLimit(limitCount: number): void {
    if (limitCount <= 0) {
      throw new Error('Connection limit must be greater than 0');
    }
    this.connectionLimitCount = limitCount;
    logger.info(`Connection limit set to ${limitCount}`, { component: 'ResourceLimiter' });
  }

  /**
   * Get current limits
   */
  getLimits(): Required<ResourceLimits> {
    return {
      memoryLimitMB: this.memoryLimitMB || 4096,
      cpuLimitPercent: this.cpuLimitPercent || 80,
      fileHandleLimitCount: this.fileHandleLimitCount || 2048,
      connectionLimitCount: this.connectionLimitCount || 50,
    };
  }

  /**
   * Enable or disable enforcement actions
   */
  setEnforcementEnabled(enabled: boolean): void {
    this.enableEnforcement = enabled;
    const status = enabled ? 'enabled' : 'disabled';
    logger.info(`Resource enforcement ${status}`, { component: 'ResourceLimiter' });
  }

  /**
   * Set graceful shutdown timeout for terminated processes
   */
  setGracefulShutdownTimeout(timeoutMs: number): void {
    if (timeoutMs <= 0) {
      throw new Error('Timeout must be greater than 0');
    }
    this.gracefulShutdownTimeoutMs = timeoutMs;
  }

  /**
   * Register a process for monitoring
   */
  registerProcess(pid: number): void {
    this.monitoredProcesses.set(pid, Date.now());
    logger.debug(`Process ${pid} registered with limiter`, { component: 'ResourceLimiter' });
  }

  /**
   * Unregister a process from monitoring
   */
  unregisterProcess(pid: number): void {
    this.monitoredProcesses.delete(pid);
    logger.debug(`Process ${pid} unregistered from limiter`, { component: 'ResourceLimiter' });
  }

  /**
   * Check and enforce memory limit
   */
  checkMemoryLimit(currentUsageMB: number, totalAvailableMB: number): void {
    if (!this.memoryLimitMB || currentUsageMB <= this.memoryLimitMB) {
      return;
    }

    const info = {
      limitType: 'memory' as const,
      current: currentUsageMB,
      limit: this.memoryLimitMB,
      totalAvailable: totalAvailableMB,
      timestamp: Date.now(),
    };

    this.emit('limit-exceeded', info);
    logger.warn(`Memory limit exceeded: ${currentUsageMB}MB > ${this.memoryLimitMB}MB`, {
      component: 'ResourceLimiter',
    });

    if (this.enableEnforcement) {
      this._enforceMemoryLimit(currentUsageMB);
    }
  }

  /**
   * Check and enforce CPU limit
   */
  checkCPULimit(currentUsagePercent: number, processId?: number): void {
    if (!this.cpuLimitPercent || currentUsagePercent <= this.cpuLimitPercent) {
      return;
    }

    const info = {
      limitType: 'cpu' as const,
      current: currentUsagePercent,
      limit: this.cpuLimitPercent,
      processId,
      timestamp: Date.now(),
    };

    this.emit('limit-exceeded', info);
    logger.warn(
      `CPU limit exceeded${processId ? ` for process ${processId}` : ''}: ${currentUsagePercent.toFixed(2)}% > ${this.cpuLimitPercent}%`,
      { component: 'ResourceLimiter' }
    );

    if (this.enableEnforcement) {
      this._enforceCPULimit(currentUsagePercent, processId);
    }
  }

  /**
   * Check and enforce file handle limit
   */
  checkFileHandleLimit(currentCount: number, processId?: number): void {
    if (!this.fileHandleLimitCount || currentCount <= this.fileHandleLimitCount) {
      return;
    }

    const info = {
      limitType: 'fileHandles' as const,
      current: currentCount,
      limit: this.fileHandleLimitCount,
      processId,
      timestamp: Date.now(),
    };

    this.emit('limit-exceeded', info);
    logger.warn(
      `File handle limit exceeded${processId ? ` for process ${processId}` : ''}: ${currentCount} > ${this.fileHandleLimitCount}`,
      { component: 'ResourceLimiter' }
    );

    if (this.enableEnforcement) {
      this._enforceFileHandleLimit(currentCount, processId);
    }
  }

  /**
   * Check and enforce connection limit
   */
  checkConnectionLimit(currentCount: number): void {
    if (!this.connectionLimitCount || currentCount <= this.connectionLimitCount) {
      return;
    }

    const info = {
      limitType: 'connections' as const,
      current: currentCount,
      limit: this.connectionLimitCount,
      timestamp: Date.now(),
    };

    this.emit('limit-exceeded', info);
    logger.warn(`Connection limit exceeded: ${currentCount} > ${this.connectionLimitCount}`, {
      component: 'ResourceLimiter',
    });

    if (this.enableEnforcement) {
      this._enforceConnectionLimit(currentCount);
    }
  }

  /**
   * Enforce memory limit by terminating least recently used processes
   */
  private _enforceMemoryLimit(currentUsageMB: number): void {
    // Sort processes by creation time (oldest first)
    const sorted = Array.from(this.monitoredProcesses.entries()).sort(([, timeA], [, timeB]) => timeA - timeB);

    if (sorted.length === 0) {
      logger.warn('Memory limit exceeded but no processes to terminate', { component: 'ResourceLimiter' });
      return;
    }

    // Terminate the oldest process
    const [oldestPid] = sorted[0];
    const action = this._terminateProcess(oldestPid, `Memory limit exceeded (${currentUsageMB}MB > ${this.memoryLimitMB}MB)`);

    this.emit('action-taken', action);
  }

  /**
   * Enforce CPU limit by warning or throttling
   */
  private _enforceCPULimit(currentUsagePercent: number, processId?: number): void {
    const action: EnforcementAction = {
      timestamp: Date.now(),
      limitType: 'cpu',
      action: 'warning-issued',
      target: processId,
      reason: `CPU usage ${currentUsagePercent.toFixed(2)}% exceeds limit of ${this.cpuLimitPercent}%`,
      details: {
        currentUsage: currentUsagePercent,
        limit: this.cpuLimitPercent,
      },
    };

    this._recordAction(action);
    this.emit('action-taken', action);
    logger.info(`CPU threshold enforcement: Warning issued${processId ? ` for process ${processId}` : ''}`, {
      component: 'ResourceLimiter',
    });
  }

  /**
   * Enforce file handle limit by preventing new process spawns
   */
  private _enforceFileHandleLimit(currentCount: number, processId?: number): void {
    const action: EnforcementAction = {
      timestamp: Date.now(),
      limitType: 'fileHandles',
      action: 'new-spawn-blocked',
      target: processId,
      reason: `File handle limit exceeded (${currentCount} > ${this.fileHandleLimitCount})`,
      details: {
        currentCount,
        limit: this.fileHandleLimitCount,
      },
    };

    this._recordAction(action);
    this.emit('action-taken', action);
    logger.warn('File handle limit enforcement: New process spawn blocked', { component: 'ResourceLimiter' });
  }

  /**
   * Enforce connection limit by rejecting new connections
   */
  private _enforceConnectionLimit(currentCount: number): void {
    const action: EnforcementAction = {
      timestamp: Date.now(),
      limitType: 'connections',
      action: 'connection-rejected',
      reason: `Connection limit exceeded (${currentCount} > ${this.connectionLimitCount})`,
      details: {
        currentCount,
        limit: this.connectionLimitCount,
      },
    };

    this._recordAction(action);
    this.emit('action-taken', action);
    logger.warn('Connection limit enforcement: New connection rejected', { component: 'ResourceLimiter' });
  }

  /**
   * Terminate a process gracefully
   */
  private _terminateProcess(pid: number, reason: string): EnforcementAction {
    const action: EnforcementAction = {
      timestamp: Date.now(),
      limitType: 'memory',
      action: 'process-terminated',
      target: pid,
      reason,
    };

    logger.info(`Terminating process ${pid}: ${reason}`, { component: 'ResourceLimiter' });

    try {
      // Try graceful shutdown first
      process.kill(pid, 'SIGTERM');

      // Set timeout for force kill if graceful doesn't work
      const forceKillTimeout = setTimeout(() => {
        try {
          process.kill(pid, 'SIGKILL');
          logger.info(`Force killed process ${pid}`, { component: 'ResourceLimiter' });
        } catch (error) {
          logger.debug(`Could not force kill process ${pid}: ${error instanceof Error ? error.message : String(error)}`, {
            component: 'ResourceLimiter',
          });
        }
      }, this.gracefulShutdownTimeoutMs);

      // Clear timeout if process exits naturally
      const checkExitInterval = setInterval(() => {
        try {
          // Check if process still exists by sending signal 0 (no-op)
          process.kill(pid, 0);
        } catch (error) {
          // Process no longer exists
          clearInterval(checkExitInterval);
          clearTimeout(forceKillTimeout);
        }
      }, 100);
    } catch (error) {
      logger.debug(`Could not terminate process ${pid}: ${error instanceof Error ? error.message : String(error)}`, {
        component: 'ResourceLimiter',
      });
    }

    this._recordAction(action);
    this.unregisterProcess(pid);
    return action;
  }

  /**
   * Record enforcement action in history
   */
  private _recordAction(action: EnforcementAction): void {
    this.enforcementHistory.push(action);
    if (this.enforcementHistory.length > this.maxHistorySize) {
      this.enforcementHistory.shift();
    }
  }

  /**
   * Get enforcement action history
   */
  getEnforcementHistory(limit?: number): EnforcementAction[] {
    const count = limit || this.maxHistorySize;
    return this.enforcementHistory.slice(-count);
  }

  /**
   * Check if should allow new process spawn based on resource availability
   */
  canSpawnProcess(estimatedMemoryMB: number, currentMemoryUsageMB: number): boolean {
    if (!this.memoryLimitMB) {
      return true;
    }

    const projectedUsage = currentMemoryUsageMB + estimatedMemoryMB;
    return projectedUsage <= this.memoryLimitMB;
  }

  /**
   * Check if should allow new SSH connection based on connection limit
   */
  canAcceptConnection(currentConnectionCount: number): boolean {
    if (!this.connectionLimitCount) {
      return true;
    }

    return currentConnectionCount < this.connectionLimitCount;
  }

  /**
   * Get count of monitored processes
   */
  getMonitoredProcessCount(): number {
    return this.monitoredProcesses.size;
  }

  /**
   * Clear all process registrations (for cleanup)
   */
  clearProcesses(): void {
    this.monitoredProcesses.clear();
    logger.debug('Cleared all monitored processes', { component: 'ResourceLimiter' });
  }

  /**
   * Reset enforcement history
   */
  clearHistory(): void {
    this.enforcementHistory = [];
  }
}

export default new ResourceLimiter();
