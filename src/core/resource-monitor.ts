import { EventEmitter } from 'node:events';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import { CircuitBreaker } from './recovery/circuit-breaker.js';
import { RecoveryHandler } from './recovery/recovery-handler.js';
import type { RecoveryContext } from './recovery/recovery-handler.js';
import { ResourceError } from './error-system/error-categories.js';
import { ResourceErrorCode, ErrorSeverity } from './error-system/error-taxonomy.js';
import { LoggingContext, CorrelationContext, type ICorrelationContext } from './logging/index.js';

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

  // Phase 2.3: Recovery strategies
  private monitoringCircuitBreaker!: CircuitBreaker;
  private processCircuitBreakers = new Map<number, CircuitBreaker>();
  private recoveryHandlers = new Map<string, (error: Error, context: RecoveryContext) => Promise<void>>();

  // Correlation ID system
  private loggingContext: LoggingContext;
  private monitoringCycleContext: ICorrelationContext | null = null;

  private getProcessCircuitBreaker(pid: number): CircuitBreaker {
    if (!this.processCircuitBreakers.has(pid)) {
      this.processCircuitBreakers.set(pid, new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 20000,
        windowSize: 60000
      }));
    }
    return this.processCircuitBreakers.get(pid)!;
  }

  private constructor() {
    super();
    // Initialize logging context
    this.loggingContext = new LoggingContext();
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

    // Create correlation context for configuration change
    const configContext = CorrelationContext.generate();
    CorrelationContext.run(configContext, () => {
      this.loggingContext.debug(
        `ResourceMonitor configured with thresholds - Memory: ${this.memoryThresholdPercent}%, CPU: ${this.cpuThresholdPercent}%, FileHandles: ${this.fileHandleThresholdPercent}%`,
        { 
          component: 'ResourceMonitor',
          configChange: true,
          memoryThreshold: this.memoryThresholdPercent,
          cpuThreshold: this.cpuThresholdPercent,
          fileHandleThreshold: this.fileHandleThresholdPercent,
          monitoringInterval: this.monitoringIntervalMs,
        }
      );
    });
  }

  /**
   * Start monitoring system resources at regular intervals
   */
  startMonitoring(intervalMs?: number): void {
    if (this.isMonitoring) {
      this.loggingContext.warn('ResourceMonitor is already running', { component: 'ResourceMonitor' });
      return;
    }

    const interval = intervalMs || this.monitoringIntervalMs;
    this.isMonitoring = true;

    // Initial CPU baseline
    this.previousSystemCpuUsage = process.cpuUsage();
    this.previousSystemCpuUpdateTime = Date.now();

    // Create correlation context for monitoring session
    this.monitoringCycleContext = CorrelationContext.generate();
    CorrelationContext.run(this.monitoringCycleContext, () => {
      this.loggingContext.info(`ResourceMonitor started with ${interval}ms interval`, { 
        component: 'ResourceMonitor',
        monitoringInterval: interval,
      });
    });

    // Start monitoring loop
    this.monitoringInterval = setInterval(() => {
      try {
        this._updateMetrics();
      } catch (error) {
        const errorContext = CorrelationContext.generate();
        CorrelationContext.run(errorContext, () => {
          this.loggingContext.error(`Error during resource monitoring: ${error instanceof Error ? error.message : String(error)}`, {
            component: 'ResourceMonitor',
            errorType: error instanceof Error ? error.constructor.name : 'Unknown',
            stack: error instanceof Error ? error.stack : undefined,
          });
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
    
    // Log stop with correlation context
    const stopContext = CorrelationContext.generate();
    CorrelationContext.run(stopContext, () => {
      this.loggingContext.info('ResourceMonitor stopped', { component: 'ResourceMonitor' });
    });
    
    this.monitoringCycleContext = null;
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
      
      const processContext = CorrelationContext.generate();
      CorrelationContext.run(processContext, () => {
        this.loggingContext.debug(`Tracking process ${pid}`, { 
          component: 'ResourceMonitor',
          processId: pid,
          action: 'process-added',
        });
      });
    }
  }

  /**
   * Remove a process from monitoring
   */
  untrackProcess(pid: number): void {
    if (this.processMetrics.has(pid)) {
      this.processMetrics.delete(pid);
      this.emit('process-removed', { pid, timestamp: Date.now() });
      
      const processContext = CorrelationContext.generate();
      CorrelationContext.run(processContext, () => {
        this.loggingContext.debug(`Stopped tracking process ${pid}`, { 
          component: 'ResourceMonitor',
          processId: pid,
          action: 'process-removed',
        });
      });
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
      const metricsContext = CorrelationContext.generate();
      let result: ProcessMetrics | null = null;
      
      CorrelationContext.run(metricsContext, () => {
        result = this._calculateProcessMetrics(tracking);
        this.loggingContext.debug(`Collected metrics for process ${pid}`, {
          component: 'ResourceMonitor',
          processId: pid,
          cpuUsagePercent: result?.cpuUsagePercent,
          memoryUsageMB: result?.memoryUsageMB,
          fileHandles: result?.fileHandles,
        });
      });
      
      return result;
    } catch (error) {
      const errorContext = CorrelationContext.generate();
      CorrelationContext.run(errorContext, () => {
        this.loggingContext.debug(`Could not get metrics for process ${pid}: ${error instanceof Error ? error.message : String(error)}`, {
          component: 'ResourceMonitor',
          processId: pid,
          errorType: error instanceof Error ? error.constructor.name : 'Unknown',
        });
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
        const metricsContext = CorrelationContext.generate();
        CorrelationContext.run(metricsContext, () => {
          const metrics = this._calculateProcessMetrics(tracking);
          allMetrics.push(metrics);
          this.loggingContext.debug(`Collected metrics for all processes`, {
            component: 'ResourceMonitor',
            processId: tracking.pid,
            processCount: this.processMetrics.size,
          });
        });
      } catch (error) {
        // Process might be gone, skip it
        const errorContext = CorrelationContext.generate();
        CorrelationContext.run(errorContext, () => {
          this.loggingContext.debug(
            `Could not get metrics for process ${tracking.pid}: ${error instanceof Error ? error.message : String(error)}`,
            { 
              component: 'ResourceMonitor',
              processId: tracking.pid,
              errorType: error instanceof Error ? error.constructor.name : 'Unknown',
            }
          );
        });
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
    const cycleContext = CorrelationContext.generate();
    
    await CorrelationContext.runAsync(cycleContext, async () => {
      // Update system metrics
      const systemMetrics = this._calculateSystemMetrics();
      this.loggingContext.debug('System metrics updated', {
        component: 'ResourceMonitor',
        resourceType: 'system',
        memoryPercent: systemMetrics.memoryPercent,
        usedMemory: systemMetrics.usedMemory,
        totalMemory: systemMetrics.totalMemory,
      });

      // Check memory threshold
      if (systemMetrics.memoryPercent > this.memoryThresholdPercent) {
        this.emit('memory-threshold', {
          current: systemMetrics.memoryPercent,
          threshold: this.memoryThresholdPercent,
          metrics: systemMetrics,
        });
        this.loggingContext.warn(`Memory threshold exceeded: ${systemMetrics.memoryPercent.toFixed(2)}% > ${this.memoryThresholdPercent}%`, {
          component: 'ResourceMonitor',
          resourceType: 'memory',
          current: systemMetrics.memoryPercent,
          threshold: this.memoryThresholdPercent,
          violation: true,
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
          this.loggingContext.debug('Process metrics collected', {
            component: 'ResourceMonitor',
            resourceType: 'process',
            processId: pid,
            cpuUsagePercent: processMetrics.cpuUsagePercent,
            memoryUsageMB: processMetrics.memoryUsageMB,
            fileHandles: processMetrics.fileHandles,
          });

          // Check CPU threshold
          if (processMetrics.cpuUsagePercent > this.cpuThresholdPercent) {
            this.emit('cpu-threshold', {
              pid,
              current: processMetrics.cpuUsagePercent,
              threshold: this.cpuThresholdPercent,
              metrics: processMetrics,
            });
            this.loggingContext.warn(
              `CPU threshold exceeded for process ${pid}: ${processMetrics.cpuUsagePercent.toFixed(2)}% > ${this.cpuThresholdPercent}%`,
              { 
                component: 'ResourceMonitor',
                resourceType: 'cpu',
                processId: pid,
                current: processMetrics.cpuUsagePercent,
                threshold: this.cpuThresholdPercent,
                violation: true,
              }
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
            this.loggingContext.warn(
              `File handles threshold exceeded for process ${pid}: ${tracking.fileHandles} > ${maxFileHandles} (${fileHandlePercent.toFixed(2)}%)`,
              { 
                component: 'ResourceMonitor',
                resourceType: 'fileHandles',
                processId: pid,
                current: tracking.fileHandles,
                max: maxFileHandles,
                percent: fileHandlePercent,
                threshold: this.fileHandleThresholdPercent,
                violation: true,
              }
            );
          }
        } catch (error) {
          // Process might have exited, will be removed by limiter
          const processErrorContext = CorrelationContext.generate();
          CorrelationContext.run(processErrorContext, () => {
            this.loggingContext.debug(`Error updating metrics for process ${pid}: ${error instanceof Error ? error.message : String(error)}`, {
              component: 'ResourceMonitor',
              processId: pid,
              errorType: error instanceof Error ? error.constructor.name : 'Unknown',
            });
          });
        }
      }
    });
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
    const clearContext = CorrelationContext.generate();
    CorrelationContext.run(clearContext, () => {
      this.loggingContext.debug('Cleared all process tracking', { 
        component: 'ResourceMonitor',
        action: 'clear-tracking',
      });
    });
  }

  /**
   * Register a recovery handler for monitoring alerts
   */
  registerRecoveryHandler(
    alertType: string,
    handler: (error: Error, context: RecoveryContext) => Promise<void>
  ): void {
    this.recoveryHandlers.set(alertType, handler);
  }

  /**
   * Invoke recovery handler for alert
   */
   private async invokeRecoveryHandler(alertType: string, error: Error, context: RecoveryContext): Promise<void> {
     const handler = this.recoveryHandlers.get(alertType);
     if (handler) {
       try {
         await handler(error, context);
       } catch (e) {
         const handlerErrorContext = CorrelationContext.generate();
         CorrelationContext.run(handlerErrorContext, () => {
           this.loggingContext.warn(`Recovery handler failed for ${alertType}`, { 
             component: 'ResourceMonitor',
             handlerType: alertType,
             errorType: e instanceof Error ? e.constructor.name : 'Unknown',
             error: String(e),
           });
         });
       }
     }
   }

}

export default ResourceMonitor.getInstance();
