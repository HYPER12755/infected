import { EventEmitter } from 'node:events';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import logger from './logger.js';

/**
 * Interface for system-wide resource metrics
 */
export interface SystemMetrics {
  timestamp: number;
  totalMemory: number;
  usedMemory: number;
  freeMemory: number;
  memoryPercent: number;
  cpuUsage: NodeJS.CpuUsage;
  loadAverage: number[];
  uptime: number;
  processors: number;
}

/**
 * Interface for per-process resource metrics
 */
export interface ProcessMetrics {
  pid: number;
  cpuUsagePercent: number;
  memoryUsageMB: number;
  memoryPercent: number;
  fileHandles: number;
  childProcesses: number;
  timestamp: number;
}

/**
 * Internal process tracking data
 */
interface ProcessTrackingData {
  pid: number;
  lastCpuUsage: NodeJS.CpuUsage | null;
  lastCpuUpdateTime: number;
  fileHandles: number;
  childProcessCount: number;
  timestamp: number;
}

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
  private static instance: ResourceMonitor;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private isMonitoring = false;
  private processMetrics = new Map<number, ProcessTrackingData>();
  private previousSystemCpuUsage: NodeJS.CpuUsage | null = null;
  private previousSystemCpuUpdateTime = Date.now();
  private lastSystemMetrics: SystemMetrics | null = null;

  // Configuration (populated from infected.config.json)
  private memoryThresholdPercent = 85;
  private cpuThresholdPercent = 80;
  private fileHandleThresholdPercent = 90;
  private monitoringIntervalMs = 5000;

  private constructor() {
    super();
    this.setMaxListeners(20); // Allow multiple listeners for resource events
  }

  /**
   * Get the singleton instance of ResourceMonitor
   */
  static getInstance(): ResourceMonitor {
    if (!ResourceMonitor.instance) {
      ResourceMonitor.instance = new ResourceMonitor();
    }
    return ResourceMonitor.instance;
  }

  /**
   * Configure monitoring thresholds from configuration
   */
  configure(config: {
    memoryThresholdPercent?: number;
    cpuThresholdPercent?: number;
    fileHandleThresholdPercent?: number;
    monitoringIntervalMs?: number;
  }): void {
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

    logger.debug(
      `ResourceMonitor configured with thresholds - Memory: ${this.memoryThresholdPercent}%, CPU: ${this.cpuThresholdPercent}%, FileHandles: ${this.fileHandleThresholdPercent}%`,
      { component: 'ResourceMonitor' }
    );
  }

  /**
   * Start monitoring system resources at regular intervals
   */
  startMonitoring(intervalMs?: number): void {
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
      } catch (error) {
        logger.error(`Error during resource monitoring: ${error instanceof Error ? error.message : String(error)}`, {
          component: 'ResourceMonitor',
        });
      }
    }, interval);
  }

  /**
   * Stop monitoring and cleanup resources
   */
  stopMonitoring(): void {
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
  trackProcess(pid: number): void {
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
  untrackProcess(pid: number): void {
    if (this.processMetrics.has(pid)) {
      this.processMetrics.delete(pid);
      this.emit('process-removed', { pid, timestamp: Date.now() });
      logger.debug(`Stopped tracking process ${pid}`, { component: 'ResourceMonitor' });
    }
  }

  /**
   * Get current system-wide metrics
   */
  getSystemMetrics(): SystemMetrics {
    if (!this.lastSystemMetrics) {
      return this._calculateSystemMetrics();
    }
    return this.lastSystemMetrics;
  }

  /**
   * Get metrics for a specific process
   */
  getProcessMetrics(pid: number): ProcessMetrics | null {
    const tracking = this.processMetrics.get(pid);
    if (!tracking) {
      return null;
    }

    try {
      const metrics = this._calculateProcessMetrics(tracking);
      return metrics;
    } catch (error) {
      logger.debug(`Could not get metrics for process ${pid}: ${error instanceof Error ? error.message : String(error)}`, {
        component: 'ResourceMonitor',
      });
      return null;
    }
  }

  /**
   * Get metrics for all tracked processes
   */
  getAllProcessMetrics(): ProcessMetrics[] {
    const allMetrics: ProcessMetrics[] = [];

    for (const [, tracking] of this.processMetrics) {
      try {
        const metrics = this._calculateProcessMetrics(tracking);
        allMetrics.push(metrics);
      } catch (error) {
        // Process might be gone, skip it
        logger.debug(
          `Could not get metrics for process ${tracking.pid}: ${error instanceof Error ? error.message : String(error)}`,
          { component: 'ResourceMonitor' }
        );
      }
    }

    return allMetrics;
  }

  /**
   * Get file descriptor count for a process
   */
  async getFileDescriptorCount(pid: number): Promise<number> {
    try {
      const fdPath = `/proc/${pid}/fd`;
      const entries = await fs.readdir(fdPath);
      return entries.length;
    } catch (error) {
      // If /proc isn't available (e.g., macOS), return 0
      return 0;
    }
  }

  /**
   * Get child process count for a process
   */
  getChildProcessCount(pid: number): number {
    try {
      const statusPath = `/proc/${pid}/status`;
      if (!fsSync.existsSync(statusPath)) {
        return 0;
      }

      const content = fsSync.readFileSync(statusPath, 'utf8');
      const match = content.match(/Threads:\s+(\d+)/);
      return match ? parseInt(match[1], 10) - 1 : 0; // Subtract main thread
    } catch (error) {
      return 0;
    }
  }

  /**
   * Internal: Calculate current system metrics
   */
  private _calculateSystemMetrics(): SystemMetrics {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const memoryPercent = (usedMemory / totalMemory) * 100;

    const currentCpuUsage = process.cpuUsage();
    const cpuUsage = {
      user: currentCpuUsage.user,
      system: currentCpuUsage.system,
    };

    const metrics: SystemMetrics = {
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
  private _calculateProcessMetrics(tracking: ProcessTrackingData): ProcessMetrics {
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

    const metrics: ProcessMetrics = {
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
  private async _updateMetrics(): Promise<void> {
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
          logger.warn(
            `CPU threshold exceeded for process ${pid}: ${processMetrics.cpuUsagePercent.toFixed(2)}% > ${this.cpuThresholdPercent}%`,
            { component: 'ResourceMonitor' }
          );
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
          logger.warn(
            `File handles threshold exceeded for process ${pid}: ${tracking.fileHandles} > ${maxFileHandles} (${fileHandlePercent.toFixed(2)}%)`,
            { component: 'ResourceMonitor' }
          );
        }
      } catch (error) {
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
  isActive(): boolean {
    return this.isMonitoring;
  }

  /**
   * Get count of tracked processes
   */
  getTrackedProcessCount(): number {
    return this.processMetrics.size;
  }

  /**
   * Clear all process tracking (for cleanup)
   */
  clearTracking(): void {
    this.processMetrics.clear();
    logger.debug('Cleared all process tracking', { component: 'ResourceMonitor' });
  }
}

export default ResourceMonitor.getInstance();
