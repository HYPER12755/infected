import { EventEmitter } from 'node:events';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import logger from './logger.js';
import { CircuitBreaker } from './recovery/circuit-breaker.js';
/**
 * ResourceMonitor provides real-time monitoring of system and process resource usage
 * with configurable thresholds and event-based alerting.
 *
 * Uses singleton pattern to ensure single monitoring instance across the application.
 *
 * @example
 * ```typescript
 * const monitor = ResourceMonitor.getInstance();
 * monitor.startMonitoring(5000);
 *
 * monitor.on('memory-threshold', (metrics) => {
 *   console.log('Memory threshold exceeded:', metrics);
 * });
 *
 * const systemMetrics = monitor.getSystemMetrics();
 * const processMetrics = monitor.getProcessMetrics(process.pid);
 * ```
 */
export class ResourceMonitor extends EventEmitter {
    getProcessCircuitBreaker(pid) {
        if (!this.processCircuitBreakers.has(pid)) {
            this.processCircuitBreakers.set(pid, new CircuitBreaker({
                failureThreshold: 3,
                successThreshold: 2,
                timeout: 20000,
                windowSize: 60000
            }));
        }
        return this.processCircuitBreakers.get(pid);
    }
    constructor() {
        super();
        this.monitoringInterval = null;
        this.isMonitoring = false;
        this.processMetrics = new Map();
        this.previousSystemCpuUsage = null;
        this.previousSystemCpuUpdateTime = Date.now();
        this.lastSystemMetrics = null;
        // Configuration (populated from infected.config.json)
        this.memoryThresholdPercent = 85;
        this.cpuThresholdPercent = 80;
        this.fileHandleThresholdPercent = 90;
        this.monitoringIntervalMs = 5000;
        this.processCircuitBreakers = new Map();
        this.recoveryHandlers = new Map();
        // Phase 2.3: Initialize monitoring circuit breaker
        this.monitoringCircuitBreaker = new CircuitBreaker({
            failureThreshold: 5,
            successThreshold: 2,
            timeout: 30000,
            windowSize: 60000
        });
        this.setMaxListeners(20); // Allow multiple listeners for resource events
    }
    /**
     * Get the singleton instance of ResourceMonitor
     */
    static getInstance() {
        if (!ResourceMonitor.instance) {
            ResourceMonitor.instance = new ResourceMonitor();
        }
        return ResourceMonitor.instance;
    }
    /**
     * Configure monitoring thresholds from configuration
     */
    configure(config) {
        if (config.memoryThresholdPercent !== undefined) {
            this.memoryThresholdPercent = config.memoryThresholdPercent;
        }
        if (config.cpuThresholdPercent !== undefined) {
            this.cpuThresholdPercent = config.cpuThresholdPercent;
        }
        if (config.fileHandleThresholdPercent !== undefined) {
            this.fileHandleThresholdPercent = config.fileHandleThresholdPercent;
        }
        if (config.monitoringIntervalMs !== undefined) {
            this.monitoringIntervalMs = config.monitoringIntervalMs;
        }
        logger.debug(`ResourceMonitor configured with thresholds - Memory: ${this.memoryThresholdPercent}%, CPU: ${this.cpuThresholdPercent}%, FileHandles: ${this.fileHandleThresholdPercent}%`, { component: 'ResourceMonitor' });
    }
    /**
     * Start monitoring system resources at regular intervals
     */
    startMonitoring(intervalMs) {
        if (this.isMonitoring) {
            logger.warn('ResourceMonitor is already running', { component: 'ResourceMonitor' });
            return;
        }
        const interval = intervalMs || this.monitoringIntervalMs;
        this.isMonitoring = true;
        // Initial CPU baseline
        this.previousSystemCpuUsage = process.cpuUsage();
        this.previousSystemCpuUpdateTime = Date.now();
        logger.info(`ResourceMonitor started with ${interval}ms interval`, { component: 'ResourceMonitor' });
        // Start monitoring loop
        this.monitoringInterval = setInterval(() => {
            try {
                this._updateMetrics();
            }
            catch (error) {
                logger.error(`Error during resource monitoring: ${error instanceof Error ? error.message : String(error)}`, {
                    component: 'ResourceMonitor',
                });
            }
        }, interval);
    }
    /**
     * Stop monitoring and cleanup resources
     */
    stopMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
        this.isMonitoring = false;
        this.processMetrics.clear();
        this.previousSystemCpuUsage = null;
        this.lastSystemMetrics = null;
        logger.info('ResourceMonitor stopped', { component: 'ResourceMonitor' });
    }
    /**
     * Add a process to monitoring
     */
    trackProcess(pid) {
        if (!this.processMetrics.has(pid)) {
            this.processMetrics.set(pid, {
                pid,
                lastCpuUsage: null,
                lastCpuUpdateTime: Date.now(),
                fileHandles: 0,
                childProcessCount: 0,
                timestamp: Date.now(),
            });
            this.emit('process-added', { pid, timestamp: Date.now() });
            logger.debug(`Tracking process ${pid}`, { component: 'ResourceMonitor' });
        }
    }
    /**
     * Remove a process from monitoring
     */
    untrackProcess(pid) {
        if (this.processMetrics.has(pid)) {
            this.processMetrics.delete(pid);
            this.emit('process-removed', { pid, timestamp: Date.now() });
            logger.debug(`Stopped tracking process ${pid}`, { component: 'ResourceMonitor' });
        }
    }
    /**
     * Get current system-wide metrics
     */
    getSystemMetrics() {
        if (!this.lastSystemMetrics) {
            return this._calculateSystemMetrics();
        }
        return this.lastSystemMetrics;
    }
    /**
     * Get metrics for a specific process
     */
    getProcessMetrics(pid) {
        const tracking = this.processMetrics.get(pid);
        if (!tracking) {
            return null;
        }
        try {
            const metrics = this._calculateProcessMetrics(tracking);
            return metrics;
        }
        catch (error) {
            logger.debug(`Could not get metrics for process ${pid}: ${error instanceof Error ? error.message : String(error)}`, {
                component: 'ResourceMonitor',
            });
            return null;
        }
    }
    /**
     * Get metrics for all tracked processes
     */
    getAllProcessMetrics() {
        const allMetrics = [];
        for (const [, tracking] of this.processMetrics) {
            try {
                const metrics = this._calculateProcessMetrics(tracking);
                allMetrics.push(metrics);
            }
            catch (error) {
                // Process might be gone, skip it
                logger.debug(`Could not get metrics for process ${tracking.pid}: ${error instanceof Error ? error.message : String(error)}`, { component: 'ResourceMonitor' });
            }
        }
        return allMetrics;
    }
    /**
     * Get file descriptor count for a process
     */
    async getFileDescriptorCount(pid) {
        try {
            const fdPath = `/proc/${pid}/fd`;
            const entries = await fs.readdir(fdPath);
            return entries.length;
        }
        catch (error) {
            // If /proc isn't available (e.g., macOS), return 0
            return 0;
        }
    }
    /**
     * Get child process count for a process
     */
    getChildProcessCount(pid) {
        try {
            const statusPath = `/proc/${pid}/status`;
            if (!fsSync.existsSync(statusPath)) {
                return 0;
            }
            const content = fsSync.readFileSync(statusPath, 'utf8');
            const match = content.match(/Threads:\s+(\d+)/);
            return match ? parseInt(match[1], 10) - 1 : 0; // Subtract main thread
        }
        catch (error) {
            return 0;
        }
    }
    /**
     * Internal: Calculate current system metrics
     */
    _calculateSystemMetrics() {
        const totalMemory = os.totalmem();
        const freeMemory = os.freemem();
        const usedMemory = totalMemory - freeMemory;
        const memoryPercent = (usedMemory / totalMemory) * 100;
        const currentCpuUsage = process.cpuUsage();
        const cpuUsage = {
            user: currentCpuUsage.user,
            system: currentCpuUsage.system,
        };
        const metrics = {
            timestamp: Date.now(),
            totalMemory,
            usedMemory,
            freeMemory,
            memoryPercent,
            cpuUsage,
            loadAverage: os.loadavg(),
            uptime: os.uptime(),
            processors: os.cpus().length,
        };
        this.lastSystemMetrics = metrics;
        return metrics;
    }
    /**
     * Internal: Calculate metrics for a specific process
     */
    _calculateProcessMetrics(tracking) {
        const currentCpuUsage = process.cpuUsage();
        // Calculate CPU usage percentage
        let cpuUsagePercent = 0;
        if (tracking.lastCpuUsage) {
            const userDiff = currentCpuUsage.user - tracking.lastCpuUsage.user;
            const systemDiff = currentCpuUsage.system - tracking.lastCpuUsage.system;
            const timeDiff = Date.now() - tracking.lastCpuUpdateTime;
            // CPU usage as percentage of available cores
            const cpuCount = os.cpus().length;
            cpuUsagePercent = ((userDiff + systemDiff) / (timeDiff * 1000 * cpuCount)) * 100;
        }
        // Get memory usage
        const memUsage = process.memoryUsage();
        const memoryUsageMB = memUsage.rss / 1024 / 1024;
        const memoryPercent = (memoryUsageMB / (os.totalmem() / 1024 / 1024)) * 100;
        // Update tracking for next calculation
        tracking.lastCpuUsage = currentCpuUsage;
        tracking.lastCpuUpdateTime = Date.now();
        const metrics = {
            pid: tracking.pid,
            cpuUsagePercent: Math.max(0, cpuUsagePercent),
            memoryUsageMB,
            memoryPercent,
            fileHandles: tracking.fileHandles,
            childProcesses: tracking.childProcessCount,
            timestamp: Date.now(),
        };
        return metrics;
    }
    /**
     * Internal: Update all metrics and check thresholds
     */
    async _updateMetrics() {
        // Update system metrics
        const systemMetrics = this._calculateSystemMetrics();
        // Check memory threshold
        if (systemMetrics.memoryPercent > this.memoryThresholdPercent) {
            this.emit('memory-threshold', {
                current: systemMetrics.memoryPercent,
                threshold: this.memoryThresholdPercent,
                metrics: systemMetrics,
            });
            logger.warn(`Memory threshold exceeded: ${systemMetrics.memoryPercent.toFixed(2)}% > ${this.memoryThresholdPercent}%`, {
                component: 'ResourceMonitor',
            });
        }
        // Update process metrics and check thresholds
        for (const [pid, tracking] of this.processMetrics) {
            try {
                // Update file handles count
                tracking.fileHandles = await this.getFileDescriptorCount(pid);
                tracking.childProcessCount = this.getChildProcessCount(pid);
                tracking.timestamp = Date.now();
                const processMetrics = this._calculateProcessMetrics(tracking);
                // Check CPU threshold
                if (processMetrics.cpuUsagePercent > this.cpuThresholdPercent) {
                    this.emit('cpu-threshold', {
                        pid,
                        current: processMetrics.cpuUsagePercent,
                        threshold: this.cpuThresholdPercent,
                        metrics: processMetrics,
                    });
                    logger.warn(`CPU threshold exceeded for process ${pid}: ${processMetrics.cpuUsagePercent.toFixed(2)}% > ${this.cpuThresholdPercent}%`, { component: 'ResourceMonitor' });
                }
                // Check file handles threshold (on Linux, default is usually 1024)
                const maxFileHandles = 1024; // Default limit, could be made configurable
                const fileHandlePercent = (tracking.fileHandles / maxFileHandles) * 100;
                if (fileHandlePercent > this.fileHandleThresholdPercent) {
                    this.emit('file-handles-threshold', {
                        pid,
                        current: tracking.fileHandles,
                        maxAllowed: maxFileHandles,
                        percent: fileHandlePercent,
                        threshold: this.fileHandleThresholdPercent,
                        metrics: processMetrics,
                    });
                    logger.warn(`File handles threshold exceeded for process ${pid}: ${tracking.fileHandles} > ${maxFileHandles} (${fileHandlePercent.toFixed(2)}%)`, { component: 'ResourceMonitor' });
                }
            }
            catch (error) {
                // Process might have exited, will be removed by limiter
                logger.debug(`Error updating metrics for process ${pid}: ${error instanceof Error ? error.message : String(error)}`, {
                    component: 'ResourceMonitor',
                });
            }
        }
    }
    /**
     * Check if monitoring is currently active
     */
    isActive() {
        return this.isMonitoring;
    }
    /**
     * Get count of tracked processes
     */
    getTrackedProcessCount() {
        return this.processMetrics.size;
    }
    /**
     * Clear all process tracking (for cleanup)
     */
    clearTracking() {
        this.processMetrics.clear();
        logger.debug('Cleared all process tracking', { component: 'ResourceMonitor' });
    }
    /**
     * Register a recovery handler for monitoring alerts
     */
    registerRecoveryHandler(alertType, handler) {
        this.recoveryHandlers.set(alertType, handler);
    }
    /**
     * Invoke recovery handler for alert
     */
    async invokeRecoveryHandler(alertType, error, context) {
        const handler = this.recoveryHandlers.get(alertType);
        if (handler) {
            try {
                await handler(error, context);
            }
            catch (e) {
                logger.warn(`Recovery handler failed for ${alertType}`, { error: String(e) });
            }
        }
    }
}
export default ResourceMonitor.getInstance();
