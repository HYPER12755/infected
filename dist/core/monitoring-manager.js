import { generateId, getCurrentTimestamp } from '../utils/shell-helpers.js'; // Adapted import
import { ResourceNotFoundError } from '../utils/shell-errors.js'; // Adapted import
import logger from './logger.js'; // Use our central logger
import { exec } from 'node:child_process'; // Node.js built-in module
import { promisify } from 'node:util'; // Node.js built-in module
import * as fs from 'node:fs/promises'; // Node.js built-in module
import { hostname, cpus, totalmem, freemem, uptime, loadavg } from 'node:os'; // For system metrics
// Promisified exec for internal use (moved outside class to workaround esbuild bug)
const getExecAsync = async () => {
    return promisify(exec);
};
export class MonitoringManager {
    constructor() {
        this.monitors = new Map();
        this.intervals = new Map();
        this.processMetrics = new Map();
        this.maxMetricsHistory = 1000;
        this.maxToolExecutionHistory = 100;
        this._toolExecutionRecords = [];
        // Constructor no longer takes toolLoader, toolCacheManager directly to break circular dep.
        // They will be set via setToolManagers method.
    }
    /**
     * Sets the ToolLoader and ToolCacheManager instances.
     * This is used to break circular dependencies during initialization.
     */
    setToolManagers(toolLoader, toolCacheManager) {
        this.toolLoader = toolLoader;
        this.toolCacheManager = toolCacheManager;
    }
    /**
     * Aggregates various metrics to determine an overall system status.
     * @returns 'healthy' | 'warning' | 'critical'
     */
    getOverallStatus() {
        const metrics = this.getDashboardMetrics(); // Get current metrics
        // Example logic:
        // If CPU or Memory usage is critical, overall status is critical.
        if (metrics.system.cpus.some(cpu => cpu.times.idle < 10) || // Example: if any CPU idle time is very low
            metrics.system.freeMemoryMB / metrics.system.totalMemoryMB < 0.05) { // Example: less than 5% free memory
            return 'critical';
        }
        // If there are recent failed tool calls or high error rate, status is warning.
        if (metrics.toolExecution.failedCalls > 0 || metrics.toolExecution.successRate < 80) {
            return 'warning';
        }
        // If cache is disabled but should be enabled, or has low hit rate.
        if (this.toolCacheManager && !this.toolCacheManager.getStats().enabled && this.toolCacheManager.getStats().totalRequests > 0) {
            return 'warning'; // Cache is disabled but in use
        }
        if (metrics.cache.totalRequests > 0 && metrics.cache.hitRate < 50) { // Example: low cache hit rate
            return 'warning';
        }
        // If no critical issues, default to healthy.
        return 'healthy';
    }
    /**
     * Public method for ToolLoader to report tool execution.
     */
    reportToolExecution(toolName, durationMs, success, isCached) {
        this._toolExecutionRecords.push({
            toolName,
            durationMs,
            success,
            timestamp: Date.now(),
            isCached
        });
        // Limit history size
        if (this._toolExecutionRecords.length > this.maxToolExecutionHistory) {
            this._toolExecutionRecords.shift();
        }
    }
    /**
     * Collects and returns a comprehensive set of dashboard metrics.
     */
    getDashboardMetrics() {
        const systemInfoCpus = cpus();
        const systemUptime = uptime();
        const systemLoadavg = loadavg();
        const totalMemMB = Math.round(totalmem() / (1024 * 1024));
        const freeMemMB = Math.round(freemem() / (1024 * 1024));
        // --- Tool Execution Stats ---
        const totalToolCalls = this._toolExecutionRecords.length;
        const successfulCalls = this._toolExecutionRecords.filter(r => r.success).length;
        const failedCalls = totalToolCalls - successfulCalls;
        const avgExecutionTimeMs = totalToolCalls > 0
            ? this._toolExecutionRecords.reduce((sum, r) => sum + r.durationMs, 0) / totalToolCalls
            : 0;
        const successRate = totalToolCalls > 0 ? (successfulCalls / totalToolCalls) * 100 : 100;
        // --- Cache Stats ---
        let cacheStats = { hits: 0, misses: 0, enabled: false, size: 0, maxSize: 0, totalRequests: 0 };
        if (this.toolCacheManager) { // Add null check here
            cacheStats = this.toolCacheManager.getStats();
        }
        const cacheTotalRequests = cacheStats.totalRequests;
        const cacheHitRate = cacheTotalRequests > 0 ? (cacheStats.hits / cacheTotalRequests) * 100 : 0;
        return {
            system: {
                hostname: hostname(),
                osType: process.platform,
                architecture: process.arch,
                cpus: systemInfoCpus.map(cpu => ({
                    model: cpu.model,
                    speed: cpu.speed,
                    times: { user: cpu.times.user, nice: cpu.times.nice, sys: cpu.times.sys, idle: cpu.times.idle, irq: cpu.times.irq }
                })),
                totalMemoryMB: totalMemMB,
                freeMemoryMB: freeMemMB,
                uptimeSeconds: Math.round(systemUptime),
                loadAverage: systemLoadavg,
                collectedAt: new Date().toISOString(),
            },
            toolExecution: {
                totalToolCalls,
                avgExecutionTimeMs: parseFloat(avgExecutionTimeMs.toFixed(2)),
                successfulCalls,
                failedCalls,
                successRate: parseFloat(successRate.toFixed(2)),
                recentlyExecuted: this._toolExecutionRecords
                    .slice(-5) // Last 5 executions
                    .map(r => ({
                    toolName: r.toolName,
                    durationMs: parseFloat(r.durationMs.toFixed(2)),
                    success: r.success,
                    timestamp: new Date(r.timestamp).toISOString()
                })),
            },
            cache: {
                totalRequests: cacheTotalRequests,
                hits: cacheStats.hits,
                misses: cacheStats.misses,
                hitRate: parseFloat(cacheHitRate.toFixed(2)),
                enabled: cacheStats.enabled,
                size: cacheStats.size,
                maxSize: cacheStats.maxSize
            },
            activeMonitors: this.monitors.size, // Still useful
        };
    }
    /**
     * Simplified system stats exposed to shell tools.
     */
    getSystemStats(timeRangeMinutes) {
        const load = loadavg();
        const totalMemoryMB = Math.round(totalmem() / (1024 * 1024));
        const freeMemoryMB = Math.round(freemem() / (1024 * 1024));
        const usedMemoryMB = Math.max(totalMemoryMB - freeMemoryMB, 0);
        return {
            active_processes: this.processMetrics.size,
            active_terminals: 0,
            total_files: 0,
            system_load: {
                load1: load[0],
                load5: load[1],
                load15: load[2],
            },
            memory_usage: {
                total_mb: totalMemoryMB,
                used_mb: usedMemoryMB,
                free_mb: freeMemoryMB,
                available_mb: freeMemoryMB,
            },
            uptime_seconds: Math.round(uptime()),
            collected_at: new Date().toISOString(),
        };
    }
    startProcessMonitor(processId, intervalMs = 1000, includeMetrics) {
        const monitorId = generateId();
        const now = getCurrentTimestamp();
        const monitorInfo = {
            monitor_id: monitorId,
            process_id: processId,
            status: 'active',
            started_at: now,
            last_update: now,
            metrics: {},
        };
        this.monitors.set(monitorId, monitorInfo);
        const interval = setInterval(() => {
            this.collectProcessMetrics(monitorId, processId, includeMetrics);
        }, intervalMs);
        this.intervals.set(monitorId, interval);
        return { ...monitorInfo };
    }
    async collectProcessMetrics(monitorId, processId, includeMetrics) {
        const monitor = this.monitors.get(monitorId);
        if (!monitor)
            return;
        try {
            const metrics = {};
            if (!includeMetrics || includeMetrics.includes('cpu')) {
                metrics.cpu_usage_percent = await this.getCpuUsage(processId);
            }
            if (!includeMetrics || includeMetrics.includes('memory')) {
                metrics.memory_usage_mb = await this.getMemoryUsage(processId);
            }
            if (!includeMetrics || includeMetrics.includes('io')) {
                const ioStats = await this.getIoStats(processId);
                metrics.io_read_bytes = ioStats.read_bytes;
                metrics.io_write_bytes = ioStats.write_bytes;
            }
            if (!includeMetrics || includeMetrics.includes('network')) {
                const networkStats = await this.getNetworkStats(processId);
                metrics.network_rx_bytes = networkStats.rx_bytes;
                metrics.network_tx_bytes = networkStats.tx_bytes;
            }
            this.storeProcessMetrics(processId, metrics);
            monitor.metrics = metrics;
            monitor.last_update = getCurrentTimestamp();
            this.monitors.set(monitorId, monitor);
        }
        catch (error) {
            logger.error(`Failed to collect metrics for process ${processId}:`, { error: error instanceof Error ? error.message : String(error) });
            this.stopProcessMonitor(monitorId);
        }
    }
    async getCpuUsage(processId) {
        try {
            if (process.platform === 'linux') {
                return await this.getLinuxCpuUsage(processId);
            }
            else if (process.platform === 'darwin') {
                return await this.getMacOsCpuUsage(processId);
            }
            else {
                return 0;
            }
        }
        catch {
            return 0;
        }
    }
    async getLinuxCpuUsage(processId) {
        try {
            const execAsync = await getExecAsync();
            const { stdout } = await execAsync(`ps -p ${processId} -o %cpu --no-headers`);
            return parseFloat(stdout.trim()) || 0;
        }
        catch {
            return 0;
        }
    }
    async getMacOsCpuUsage(processId) {
        try {
            const execAsync = await getExecAsync();
            const { stdout } = await execAsync(`ps -p ${processId} -o %cpu`);
            const lines = stdout.trim().split('\n');
            if (lines.length > 1 && lines[1]) {
                return parseFloat(lines[1].trim()) || 0;
            }
            return 0;
        }
        catch {
            return 0;
        }
    }
    async getMemoryUsage(processId) {
        try {
            if (process.platform === 'linux') {
                return await this.getLinuxMemoryUsage(processId);
            }
            else if (process.platform === 'darwin') {
                return await this.getMacOsMemoryUsage(processId);
            }
            else {
                return 0;
            }
        }
        catch {
            return 0;
        }
    }
    async getLinuxMemoryUsage(processId) {
        try {
            const execAsync = await getExecAsync();
            const { stdout } = await execAsync(`ps -p ${processId} -o rss --no-headers`);
            const rssKb = parseInt(stdout.trim()) || 0;
            return rssKb / 1024; // MB に変換
        }
        catch {
            return 0;
        }
    }
    async getMacOsMemoryUsage(processId) {
        try {
            const execAsync = await getExecAsync();
            const { stdout } = await execAsync(`ps -p ${processId} -o rss`);
            const lines = stdout.trim().split('\n');
            if (lines.length > 1 && lines[1]) {
                return parseFloat(lines[1].trim()) || 0;
            }
            return 0;
        }
        catch {
            return 0;
        }
    }
    async getIoStats(processId) {
        try {
            if (process.platform === 'linux') {
                const ioData = await fs.readFile(`/proc/${processId}/io`, 'utf-8');
                let readBytes = 0;
                let writeBytes = 0;
                for (const line of ioData.split('\n')) {
                    if (line.startsWith('read_bytes:')) {
                        readBytes = parseInt(line.split(':')[1]?.trim() || '0');
                    }
                    else if (line.startsWith('write_bytes:')) {
                        writeBytes = parseInt(line.split(':')[1]?.trim() || '0');
                    }
                }
                return { read_bytes: readBytes, write_bytes: writeBytes };
            }
        }
        catch {
            logger.warn(`Failed to get IO stats for process ${processId}. Returning default values.`, { error: 'Unknown or non-Linux platform' });
        }
        return { read_bytes: 0, write_bytes: 0 };
    }
    async getNetworkStats(_processId) {
        return { rx_bytes: 0, tx_bytes: 0 };
    }
    storeProcessMetrics(processId, metrics) {
        if (!this.processMetrics.has(processId)) {
            this.processMetrics.set(processId, []);
        }
        const metricsHistory = this.processMetrics.get(processId);
        if (metricsHistory) {
            metricsHistory.push(metrics);
            if (metricsHistory.length > this.maxMetricsHistory) {
                metricsHistory.shift();
            }
        }
    }
    stopProcessMonitor(monitorId) {
        const monitor = this.monitors.get(monitorId);
        if (!monitor) {
            throw new ResourceNotFoundError('monitor', monitorId);
        }
        const interval = this.intervals.get(monitorId);
        if (interval) {
            clearInterval(interval);
            this.intervals.delete(monitorId);
        }
        monitor.status = 'stopped';
        monitor.last_update = getCurrentTimestamp();
        this.monitors.set(monitorId, monitor);
        return true;
    }
    getMonitor(monitorId) {
        const monitor = this.monitors.get(monitorId);
        if (!monitor) {
            throw new ResourceNotFoundError('monitor', monitorId);
        }
        return { ...monitor };
    }
    listMonitors() {
        return Array.from(this.monitors.values()).map((monitor) => ({ ...monitor }));
    }
    cleanup() {
        for (const monitorId of this.monitors.keys()) {
            try {
                this.stopProcessMonitor(monitorId);
            }
            catch (error) {
                logger.error(`Failed to stop monitor ${monitorId}:`, { error: error instanceof Error ? error.message : String(error) });
            }
        }
        this.monitors.clear();
        this.intervals.clear();
        this.processMetrics.clear();
        this._toolExecutionRecords = []; // Clear tool execution history
    }
}
