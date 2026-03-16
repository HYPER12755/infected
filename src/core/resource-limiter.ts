import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { CircuitBreaker } from './recovery/circuit-breaker.js';
import { RecoveryHandler } from './recovery/recovery-handler.js';
import type { RecoveryContext } from './recovery/recovery-handler.js';
import { ResourceError } from './error-system/error-categories.js';
import { ResourceErrorCode, ErrorSeverity } from './error-system/error-taxonomy.js';
import { LoggingContext, CorrelationContext, type ICorrelationContext } from './logging/index.js';

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

  // Phase 2.3: Recovery strategies
  private enforcementCircuitBreaker!: CircuitBreaker;
  private recoveryHandlers = new Map<string, (error: Error, context: RecoveryContext) => Promise<void>>();

  // Configuration for enforcement behavior
  private enableEnforcement = true;
  private gracefulShutdownTimeoutMs = 5000;

  // Correlation ID system
  private loggingContext: LoggingContext;

  constructor() {
    super();
    // Initialize logging context
    this.loggingContext = new LoggingContext();
    this.setMaxListeners(20);
    // Phase 2.3: Initialize enforcement circuit breaker
    this.enforcementCircuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 30000,
      windowSize: 60000
    });
    const initContext = CorrelationContext.generate();
    CorrelationContext.run(initContext, () => {
      this.loggingContext.info('ResourceLimiter initialized', { component: 'ResourceLimiter' });
    });
  }

  /**
   * Set maximum memory limit for the system
   */
  setMemoryLimit(limitMB: number): void {
    if (limitMB <= 0) {
      throw new Error('Memory limit must be greater than 0');
    }
    this.memoryLimitMB = limitMB;
    
    const limitContext = CorrelationContext.generate();
    CorrelationContext.run(limitContext, () => {
      this.loggingContext.info(`Memory limit set to ${limitMB}MB`, { 
        component: 'ResourceLimiter',
        resourceType: 'memory',
        limit: limitMB,
        action: 'set-limit',
      });
    });
  }

  /**
   * Set maximum CPU usage limit
   */
  setCPULimit(limitPercent: number): void {
    if (limitPercent <= 0 || limitPercent > 100) {
      throw new Error('CPU limit must be between 0 and 100');
    }
    this.cpuLimitPercent = limitPercent;
    
    const limitContext = CorrelationContext.generate();
    CorrelationContext.run(limitContext, () => {
      this.loggingContext.info(`CPU limit set to ${limitPercent}%`, { 
        component: 'ResourceLimiter',
        resourceType: 'cpu',
        limit: limitPercent,
        action: 'set-limit',
      });
    });
  }

  /**
   * Set maximum open file handle limit
   */
  setFileHandleLimit(limitCount: number): void {
    if (limitCount <= 0) {
      throw new Error('File handle limit must be greater than 0');
    }
    this.fileHandleLimitCount = limitCount;
    
    const limitContext = CorrelationContext.generate();
    CorrelationContext.run(limitContext, () => {
      this.loggingContext.info(`File handle limit set to ${limitCount}`, { 
        component: 'ResourceLimiter',
        resourceType: 'fileHandles',
        limit: limitCount,
        action: 'set-limit',
      });
    });
  }

  /**
   * Set maximum concurrent connection limit
   */
  setConnectionLimit(limitCount: number): void {
    if (limitCount <= 0) {
      throw new Error('Connection limit must be greater than 0');
    }
    this.connectionLimitCount = limitCount;
    
    const limitContext = CorrelationContext.generate();
    CorrelationContext.run(limitContext, () => {
      this.loggingContext.info(`Connection limit set to ${limitCount}`, { 
        component: 'ResourceLimiter',
        resourceType: 'connections',
        limit: limitCount,
        action: 'set-limit',
      });
    });
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
    
    const enforcementContext = CorrelationContext.generate();
    CorrelationContext.run(enforcementContext, () => {
      this.loggingContext.info(`Resource enforcement ${status}`, { 
        component: 'ResourceLimiter',
        enforcementEnabled: enabled,
        action: 'set-enforcement-status',
      });
    });
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
    
    const processContext = CorrelationContext.generate();
    CorrelationContext.run(processContext, () => {
      this.loggingContext.debug(`Process ${pid} registered with limiter`, { 
        component: 'ResourceLimiter',
        processId: pid,
        action: 'register-process',
      });
    });
  }

  /**
   * Unregister a process from monitoring
   */
  unregisterProcess(pid: number): void {
    this.monitoredProcesses.delete(pid);
    
    const processContext = CorrelationContext.generate();
    CorrelationContext.run(processContext, () => {
      this.loggingContext.debug(`Process ${pid} unregistered from limiter`, { 
        component: 'ResourceLimiter',
        processId: pid,
        action: 'unregister-process',
      });
    });
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
    
    const limitContext = CorrelationContext.generate();
    CorrelationContext.run(limitContext, () => {
      this.loggingContext.warn(`Memory limit exceeded: ${currentUsageMB}MB > ${this.memoryLimitMB}MB`, {
        component: 'ResourceLimiter',
        resourceType: 'memory',
        current: currentUsageMB,
        limit: this.memoryLimitMB,
        violation: true,
      });
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
    
    const limitContext = CorrelationContext.generate();
    CorrelationContext.run(limitContext, () => {
      this.loggingContext.warn(
        `CPU limit exceeded${processId ? ` for process ${processId}` : ''}: ${currentUsagePercent.toFixed(2)}% > ${this.cpuLimitPercent}%`,
        { 
          component: 'ResourceLimiter',
          resourceType: 'cpu',
          processId,
          current: currentUsagePercent,
          limit: this.cpuLimitPercent,
          violation: true,
        }
      );
    });

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
    
    const limitContext = CorrelationContext.generate();
    CorrelationContext.run(limitContext, () => {
      this.loggingContext.warn(
        `File handle limit exceeded${processId ? ` for process ${processId}` : ''}: ${currentCount} > ${this.fileHandleLimitCount}`,
        { 
          component: 'ResourceLimiter',
          resourceType: 'fileHandles',
          processId,
          current: currentCount,
          limit: this.fileHandleLimitCount,
          violation: true,
        }
      );
    });

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
    
    const limitContext = CorrelationContext.generate();
    CorrelationContext.run(limitContext, () => {
      this.loggingContext.warn(`Connection limit exceeded: ${currentCount} > ${this.connectionLimitCount}`, {
        component: 'ResourceLimiter',
        resourceType: 'connections',
        current: currentCount,
        limit: this.connectionLimitCount,
        violation: true,
      });
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
      const warningContext = CorrelationContext.generate();
      CorrelationContext.run(warningContext, () => {
        this.loggingContext.warn('Memory limit exceeded but no processes to terminate', { 
          component: 'ResourceLimiter',
          resourceType: 'memory',
          action: 'enforce-memory-limit',
        });
      });
      return;
    }

    // Terminate the oldest process
    const [oldestPid] = sorted[0];
    const actionContext = CorrelationContext.generate();
    CorrelationContext.run(actionContext, () => {
      const action = this._terminateProcess(oldestPid, `Memory limit exceeded (${currentUsageMB}MB > ${this.memoryLimitMB}MB)`);
      this.emit('action-taken', action);
    });
  }

  /**
   * Enforce CPU limit by warning or throttling
   */
  private _enforceCPULimit(currentUsagePercent: number, processId?: number): void {
    const actionContext = CorrelationContext.generate();
    CorrelationContext.run(actionContext, () => {
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
      this.loggingContext.info(`CPU threshold enforcement: Warning issued${processId ? ` for process ${processId}` : ''}`, {
        component: 'ResourceLimiter',
        resourceType: 'cpu',
        processId,
        action: 'warning-issued',
        currentUsage: currentUsagePercent,
        limit: this.cpuLimitPercent,
      });
    });
  }

  /**
   * Enforce file handle limit by preventing new process spawns
   */
  private _enforceFileHandleLimit(currentCount: number, processId?: number): void {
    const actionContext = CorrelationContext.generate();
    CorrelationContext.run(actionContext, () => {
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
      this.loggingContext.warn('File handle limit enforcement: New process spawn blocked', { 
        component: 'ResourceLimiter',
        resourceType: 'fileHandles',
        processId,
        action: 'new-spawn-blocked',
        currentCount,
        limit: this.fileHandleLimitCount,
      });
    });
  }

  /**
   * Enforce connection limit by rejecting new connections
   */
  private _enforceConnectionLimit(currentCount: number): void {
    const actionContext = CorrelationContext.generate();
    CorrelationContext.run(actionContext, () => {
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
      this.loggingContext.warn('Connection limit enforcement: New connection rejected', { 
        component: 'ResourceLimiter',
        resourceType: 'connections',
        action: 'connection-rejected',
        currentCount,
        limit: this.connectionLimitCount,
      });
    });
  }

  /**
   * Terminate a process gracefully
   */
  private _terminateProcess(pid: number, reason: string): EnforcementAction {
    const terminationContext = CorrelationContext.generate();
    
    const action: EnforcementAction = {
      timestamp: Date.now(),
      limitType: 'memory',
      action: 'process-terminated',
      target: pid,
      reason,
    };

    CorrelationContext.run(terminationContext, () => {
      this.loggingContext.info(`Terminating process ${pid}: ${reason}`, { 
        component: 'ResourceLimiter',
        processId: pid,
        reason,
        action: 'process-terminated',
      });
    });

    try {
      // Try graceful shutdown first
      process.kill(pid, 'SIGTERM');

      // Set timeout for force kill if graceful doesn't work
      const forceKillTimeout = setTimeout(() => {
        try {
          process.kill(pid, 'SIGKILL');
          const forceKillContext = CorrelationContext.generate();
          CorrelationContext.run(forceKillContext, () => {
            this.loggingContext.info(`Force killed process ${pid}`, { 
              component: 'ResourceLimiter',
              processId: pid,
              action: 'force-kill',
            });
          });
        } catch (error) {
          const forceKillErrorContext = CorrelationContext.generate();
          CorrelationContext.run(forceKillErrorContext, () => {
            this.loggingContext.debug(`Could not force kill process ${pid}: ${error instanceof Error ? error.message : String(error)}`, {
              component: 'ResourceLimiter',
              processId: pid,
              errorType: error instanceof Error ? error.constructor.name : 'Unknown',
            });
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
      const terminationErrorContext = CorrelationContext.generate();
      CorrelationContext.run(terminationErrorContext, () => {
        this.loggingContext.debug(`Could not terminate process ${pid}: ${error instanceof Error ? error.message : String(error)}`, {
          component: 'ResourceLimiter',
          processId: pid,
          errorType: error instanceof Error ? error.constructor.name : 'Unknown',
        });
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
    
    const clearContext = CorrelationContext.generate();
    CorrelationContext.run(clearContext, () => {
      this.loggingContext.debug('Cleared all monitored processes', { 
        component: 'ResourceLimiter',
        action: 'clear-processes',
      });
    });
  }

  /**
   * Reset enforcement history
   */
  clearHistory(): void {
    this.enforcementHistory = [];
  }

  /**
   * Register a recovery handler for specific enforcement actions
   */
  registerRecoveryHandler(
    action: string,
    handler: (error: Error, context: RecoveryContext) => Promise<void>
  ): void {
    this.recoveryHandlers.set(action, handler);
  }

  /**
   * Invoke recovery handler for enforcement action
   */
   private async invokeRecoveryHandler(action: string, error: Error, context: RecoveryContext): Promise<void> {
     const handler = this.recoveryHandlers.get(action);
     if (handler) {
       try {
         await handler(error, context);
       } catch (e) {
         const handlerErrorContext = CorrelationContext.generate();
         CorrelationContext.run(handlerErrorContext, () => {
           this.loggingContext.warn(`Recovery handler failed for ${action}`, { 
             component: 'ResourceLimiter',
             handlerAction: action,
             errorType: e instanceof Error ? e.constructor.name : 'Unknown',
             error: String(e),
           });
         });
       }
     }
   }

}

export default new ResourceLimiter();
