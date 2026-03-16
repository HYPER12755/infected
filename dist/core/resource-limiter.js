import { EventEmitter } from 'node:events';
import logger from './logger.js';
import { CircuitBreaker } from './recovery/circuit-breaker.js';
import { LoggingContext, CorrelationContext } from './logging/index.js';
/**
 * Custom error thrown when resource limits are exceeded
 */
export class LimitExceededError extends Error {
    constructor(limitType, current, limit, processId) {
        const message = processId
            ? `${limitType} limit exceeded for process ${processId}: ${current} > ${limit}`
            : `${limitType} limit exceeded: ${current} > ${limit}`;
        super(message);
        this.limitType = limitType;
        this.current = current;
        this.limit = limit;
        this.processId = processId;
        this.name = 'LimitExceededError';
    }
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
    constructor() {
        super();
        this.memoryLimitMB = null;
        this.cpuLimitPercent = null;
        this.fileHandleLimitCount = null;
        this.connectionLimitCount = null;
        // Track processes for enforcement (maps PID to creation time)
        this.monitoredProcesses = new Map();
        // Track enforcement history
        this.enforcementHistory = [];
        this.maxHistorySize = 100;
        this.recoveryHandlers = new Map();
        // Configuration for enforcement behavior
        this.enableEnforcement = true;
        this.gracefulShutdownTimeoutMs = 5000;
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
    setMemoryLimit(limitMB) {
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
    setCPULimit(limitPercent) {
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
    setFileHandleLimit(limitCount) {
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
    setConnectionLimit(limitCount) {
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
    getLimits() {
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
    setEnforcementEnabled(enabled) {
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
    setGracefulShutdownTimeout(timeoutMs) {
        if (timeoutMs <= 0) {
            throw new Error('Timeout must be greater than 0');
        }
        this.gracefulShutdownTimeoutMs = timeoutMs;
    }
    /**
     * Register a process for monitoring
     */
    registerProcess(pid) {
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
    unregisterProcess(pid) {
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
    checkMemoryLimit(currentUsageMB, totalAvailableMB) {
        if (!this.memoryLimitMB || currentUsageMB <= this.memoryLimitMB) {
            return;
        }
        const info = {
            limitType: 'memory',
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
    checkCPULimit(currentUsagePercent, processId) {
        if (!this.cpuLimitPercent || currentUsagePercent <= this.cpuLimitPercent) {
            return;
        }
        const info = {
            limitType: 'cpu',
            current: currentUsagePercent,
            limit: this.cpuLimitPercent,
            processId,
            timestamp: Date.now(),
        };
        this.emit('limit-exceeded', info);
        const limitContext = CorrelationContext.generate();
        CorrelationContext.run(limitContext, () => {
            this.loggingContext.warn(`CPU limit exceeded${processId ? ` for process ${processId}` : ''}: ${currentUsagePercent.toFixed(2)}% > ${this.cpuLimitPercent}%`, {
                component: 'ResourceLimiter',
                resourceType: 'cpu',
                processId,
                current: currentUsagePercent,
                limit: this.cpuLimitPercent,
                violation: true,
            });
        });
        if (this.enableEnforcement) {
            this._enforceCPULimit(currentUsagePercent, processId);
        }
    }
    /**
     * Check and enforce file handle limit
     */
    checkFileHandleLimit(currentCount, processId) {
        if (!this.fileHandleLimitCount || currentCount <= this.fileHandleLimitCount) {
            return;
        }
        const info = {
            limitType: 'fileHandles',
            current: currentCount,
            limit: this.fileHandleLimitCount,
            processId,
            timestamp: Date.now(),
        };
        this.emit('limit-exceeded', info);
        const limitContext = CorrelationContext.generate();
        CorrelationContext.run(limitContext, () => {
            this.loggingContext.warn(`File handle limit exceeded${processId ? ` for process ${processId}` : ''}: ${currentCount} > ${this.fileHandleLimitCount}`, {
                component: 'ResourceLimiter',
                resourceType: 'fileHandles',
                processId,
                current: currentCount,
                limit: this.fileHandleLimitCount,
                violation: true,
            });
        });
        if (this.enableEnforcement) {
            this._enforceFileHandleLimit(currentCount, processId);
        }
    }
    /**
     * Check and enforce connection limit
     */
    checkConnectionLimit(currentCount) {
        if (!this.connectionLimitCount || currentCount <= this.connectionLimitCount) {
            return;
        }
        const info = {
            limitType: 'connections',
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
    _enforceMemoryLimit(currentUsageMB) {
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
    _enforceCPULimit(currentUsagePercent, processId) {
        const actionContext = CorrelationContext.generate();
        CorrelationContext.run(actionContext, () => {
            const action = {
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
    _enforceFileHandleLimit(currentCount, processId) {
        const actionContext = CorrelationContext.generate();
        CorrelationContext.run(actionContext, () => {
            const action = {
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
    _enforceConnectionLimit(currentCount) {
        const actionContext = CorrelationContext.generate();
        CorrelationContext.run(actionContext, () => {
            const action = {
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
    _terminateProcess(pid, reason) {
        const terminationContext = CorrelationContext.generate();
        const action = {
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
                }
                catch (error) {
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
                }
                catch (error) {
                    // Process no longer exists
                    clearInterval(checkExitInterval);
                    clearTimeout(forceKillTimeout);
                }
            }, 100);
        }
        catch (error) {
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
    _recordAction(action) {
        this.enforcementHistory.push(action);
        if (this.enforcementHistory.length > this.maxHistorySize) {
            this.enforcementHistory.shift();
        }
    }
    /**
     * Get enforcement action history
     */
    getEnforcementHistory(limit) {
        const count = limit || this.maxHistorySize;
        return this.enforcementHistory.slice(-count);
    }
    /**
     * Check if should allow new process spawn based on resource availability
     */
    canSpawnProcess(estimatedMemoryMB, currentMemoryUsageMB) {
        if (!this.memoryLimitMB) {
            return true;
        }
        const projectedUsage = currentMemoryUsageMB + estimatedMemoryMB;
        return projectedUsage <= this.memoryLimitMB;
    }
    /**
     * Check if should allow new SSH connection based on connection limit
     */
    canAcceptConnection(currentConnectionCount) {
        if (!this.connectionLimitCount) {
            return true;
        }
        return currentConnectionCount < this.connectionLimitCount;
    }
    /**
     * Get count of monitored processes
     */
    getMonitoredProcessCount() {
        return this.monitoredProcesses.size;
    }
    /**
     * Clear all process registrations (for cleanup)
     */
    clearProcesses() {
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
    clearHistory() {
        this.enforcementHistory = [];
    }
    /**
     * Register a recovery handler for specific enforcement actions
     */
    registerRecoveryHandler(action, handler) {
        this.recoveryHandlers.set(action, handler);
    }
    /**
     * Invoke recovery handler for enforcement action
     */
    async invokeRecoveryHandler(action, error, context) {
        const handler = this.recoveryHandlers.get(action);
        if (handler) {
            try {
                await handler(error, context);
            }
            catch (e) {
                logger.warn(`Recovery handler failed for ${action}`, { error: String(e) });
            }
        }
    }
}
export default new ResourceLimiter();
