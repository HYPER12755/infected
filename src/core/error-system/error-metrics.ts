/**
 * Error Metrics Tracking System
 * 
 * Provides comprehensive error statistics tracking with support for:
 * - Error categorization and severity tracking
 * - Recovery success/failure rate calculation
 * - Time-window based rolling metrics (1m, 5m, 15m)
 * - Trend analysis and pattern detection
 * - Integration with recovery handler metrics
 * 
 * Thread-safe implementation with no shared mutable state.
 */

import { BaseError, ErrorCategory, ErrorSeverity } from './error-taxonomy.js';

/**
 * Time window options for rolling metrics
 * @enum {string}
 */
export enum TimeWindow {
  ONE_MINUTE = '1m',
  FIVE_MINUTES = '5m',
  FIFTEEN_MINUTES = '15m',
}

/**
 * Error record for tracking individual error occurrences
 */
interface ErrorRecord {
  /** Timestamp when error occurred */
  timestamp: number;
  /** Error category */
  category: ErrorCategory;
  /** Error code identifier */
  code: string;
  /** Error severity */
  severity: ErrorSeverity;
  /** Whether error was recovered successfully */
  recovered: boolean;
}

/**
 * Snapshot of error metrics at a point in time
 */
export interface ErrorMetricsSnapshot {
  /** Total errors recorded */
  totalErrors: number;
  /** Errors by category breakdown */
  errorsByCategory: Record<ErrorCategory, number>;
  /** Errors by severity breakdown */
  errorsBySeverity: Record<ErrorSeverity, number>;
  /** Errors by code breakdown (top 20) */
  errorsByCode: Record<string, number>;
  /** Total errors recovered */
  recoveredErrors: number;
  /** Total errors not recovered */
  unrecoveredErrors: number;
  /** Recovery rate as percentage (0-100) */
  recoveryRate: number;
  /** Timestamp of snapshot */
  timestamp: number;
}

/**
 * Error trend analysis result
 */
export interface ErrorTrend {
  /** Category of the trend */
  category: ErrorCategory;
  /** Error code (if specific to a code) */
  code?: string;
  /** Current rate per minute */
  ratePerMinute: number;
  /** Previous rate per minute for comparison */
  previousRatePerMinute: number;
  /** Trend direction: 'increasing', 'decreasing', 'stable' */
  trend: 'increasing' | 'decreasing' | 'stable';
  /** Percentage change from previous rate */
  percentageChange: number;
}

/**
 * Category health summary
 */
export interface CategoryHealth {
  /** Total errors in category */
  totalErrors: number;
  /** Recovery rate for category */
  recoveryRate: number;
  /** Most common error code */
  mostCommonCode: string;
  /** Most common severity */
  mostCommonSeverity: ErrorSeverity;
}

/**
 * Recovery metrics from recovery handler
 */
export interface RecoveryHandlerMetrics {
  /** Total executions */
  totalExecutions: number;
  /** Successful executions */
  successfulExecutions: number;
  /** Failed executions */
  failedExecutions: number;
  /** Circuit breaker rejections */
  circuitBreakerRejections: number;
  /** Success rate as percentage */
  successRate: number;
}

/**
 * ErrorMetrics - Tracks and analyzes error statistics
 * 
 * Maintains a rolling window of error records and provides methods to:
 * - Record new errors
 * - Calculate error rates and trends
 * - Analyze recovery effectiveness
 * - Generate health status snapshots
 * 
 * @example
 * ```typescript
 * const metrics = new ErrorMetrics();
 * 
 * try {
 *   // Some operation
 * } catch (error) {
 *   if (error instanceof BaseError) {
 *     metrics.recordError(error);
 *     const recovered = await attemptRecovery();
 *     if (recovered) {
 *       metrics.recordRecovery(error.code, true);
 *     }
 *   }
 * }
 * 
 * // Get current metrics
 * const snapshot = metrics.getMetrics();
 * console.log(`Error rate: ${metrics.getErrorRate()} errors/min`);
 * console.log(`Recovery rate: ${metrics.getRecoveryRate()}%`);
 * 
 * // Analyze trends
 * const trends = metrics.getTrendAnalysis();
 * trends.forEach(trend => {
 *   if (trend.trend === 'increasing') {
 *     console.warn(`Increasing trend in ${trend.category}`);
 *   }
 * });
 * ```
 */
export class ErrorMetrics {
  private errorRecords: ErrorRecord[] = [];
  private recoveryRecords: Map<string, { recovered: number; failed: number }> = new Map();
  private readonly maxRecords = 10000;
  private readonly cleanupInterval = 60000; // 1 minute
  private lastCleanup = Date.now();
  
  /**
   * Window size in milliseconds for each time window
   */
  private readonly windowSizes: Record<TimeWindow, number> = {
    [TimeWindow.ONE_MINUTE]: 60 * 1000,
    [TimeWindow.FIVE_MINUTES]: 5 * 60 * 1000,
    [TimeWindow.FIFTEEN_MINUTES]: 15 * 60 * 1000,
  };

  /**
   * Record a new error occurrence
   * 
   * @param error - The BaseError to record
   * @param recovered - Optional: whether error was recovered (default: false)
   */
  recordError(error: BaseError, recovered = false): void {
    const record: ErrorRecord = {
      timestamp: Date.now(),
      category: error.category,
      code: error.code,
      severity: error.severity,
      recovered,
    };

    this.errorRecords.push(record);

    // Track recovery separately for detailed analysis
    if (recovered || !recovered) {
      const existing = this.recoveryRecords.get(error.code) || { recovered: 0, failed: 0 };
      if (recovered) {
        existing.recovered++;
      } else {
        existing.failed++;
      }
      this.recoveryRecords.set(error.code, existing);
    }

    // Cleanup if needed
    this.performCleanup();
  }

  /**
   * Record recovery result for a specific error code
   * 
   * Note: recordError with recovered flag is preferred, but this provides
   * an alternative way to update recovery metrics after the fact.
   * 
   * @param errorCode - The error code to record recovery for
   * @param recovered - Whether recovery was successful
   */
  recordRecovery(errorCode: string, recovered: boolean): void {
    const existing = this.recoveryRecords.get(errorCode) || { recovered: 0, failed: 0 };
    if (recovered) {
      existing.recovered++;
    } else {
      existing.failed++;
    }
    this.recoveryRecords.set(errorCode, existing);
  }

  /**
   * Get complete metrics snapshot
   * 
   * @param category - Optional: filter by error category
   * @returns Snapshot of current metrics
   * 
   * @example
   * ```typescript
   * const allMetrics = metrics.getMetrics();
   * const networkMetrics = metrics.getMetrics(ErrorCategory.NETWORK);
   * ```
   */
  getMetrics(category?: ErrorCategory): ErrorMetricsSnapshot {
    const filtered = category
      ? this.errorRecords.filter(r => r.category === category)
      : this.errorRecords;

    const errorsByCategory: Record<ErrorCategory, number> = {
      [ErrorCategory.NETWORK]: 0,
      [ErrorCategory.PROCESS]: 0,
      [ErrorCategory.SSH]: 0,
      [ErrorCategory.RESOURCE]: 0,
      [ErrorCategory.SECURITY]: 0,
      [ErrorCategory.TIMEOUT]: 0,
      [ErrorCategory.FILESYSTEM]: 0,
    };

    const errorsBySeverity: Record<ErrorSeverity, number> = {
      [ErrorSeverity.CRITICAL]: 0,
      [ErrorSeverity.HIGH]: 0,
      [ErrorSeverity.MEDIUM]: 0,
      [ErrorSeverity.LOW]: 0,
    };

    const errorsByCode: Record<string, number> = {};

    for (const record of filtered) {
      errorsByCategory[record.category]++;
      errorsBySeverity[record.severity]++;
      errorsByCode[record.code] = (errorsByCode[record.code] || 0) + 1;
    }

    const recoveredCount = filtered.filter(r => r.recovered).length;
    const unrecoveredCount = filtered.length - recoveredCount;
    const recoveryRate = filtered.length > 0 ? (recoveredCount / filtered.length) * 100 : 0;

    // Sort and limit error codes to top 20
    const sortedCodes = Object.entries(errorsByCode)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .reduce((acc, [code, count]) => {
        acc[code] = count;
        return acc;
      }, {} as Record<string, number>);

    return {
      totalErrors: filtered.length,
      errorsByCategory,
      errorsBySeverity,
      errorsByCode: sortedCodes,
      recoveredErrors: recoveredCount,
      unrecoveredErrors: unrecoveredCount,
      recoveryRate,
      timestamp: Date.now(),
    };
  }

  /**
   * Calculate error rate over a time window
   * 
   * @param window - Time window to calculate for (default: ONE_MINUTE)
   * @returns Errors per minute
   * 
   * @example
   * ```typescript
   * const rate1m = metrics.getErrorRate(TimeWindow.ONE_MINUTE);
   * const rate5m = metrics.getErrorRate(TimeWindow.FIVE_MINUTES);
   * const rate15m = metrics.getErrorRate(TimeWindow.FIFTEEN_MINUTES);
   * ```
   */
  getErrorRate(window: TimeWindow = TimeWindow.ONE_MINUTE): number {
    const windowMs = this.windowSizes[window];
    const cutoff = Date.now() - windowMs;
    const recentErrors = this.errorRecords.filter(r => r.timestamp > cutoff);
    const minutes = windowMs / 60000;
    return recentErrors.length / minutes;
  }

  /**
   * Calculate recovery rate for specific error code or overall
   * 
   * @param errorCode - Optional: specific error code to check
   * @returns Recovery rate as percentage (0-100)
   * 
   * @example
   * ```typescript
   * const overallRate = metrics.getRecoveryRate();
   * const networkRecoveryRate = metrics.getRecoveryRate('NET_CONN_TIMEOUT');
   * ```
   */
  getRecoveryRate(errorCode?: string): number {
    if (errorCode) {
      const stats = this.recoveryRecords.get(errorCode);
      if (!stats) return 0;
      const total = stats.recovered + stats.failed;
      return total > 0 ? (stats.recovered / total) * 100 : 0;
    }

    // Overall recovery rate from error records
    const filtered = this.errorRecords;
    if (filtered.length === 0) return 0;
    const recovered = filtered.filter(r => r.recovered).length;
    return (recovered / filtered.length) * 100;
  }

  /**
   * Analyze error trends over time
   * 
   * Compares error rates from two time windows to detect increasing,
   * decreasing, or stable trends.
   * 
   * @returns Array of trend analyses for categories and common error codes
   * 
   * @example
   * ```typescript
   * const trends = metrics.getTrendAnalysis();
   * trends.forEach(trend => {
   *   console.log(`${trend.category}: ${trend.trend} ` +
   *     `(${trend.percentageChange.toFixed(1)}% change)`);
   * });
   * ```
   */
  getTrendAnalysis(): ErrorTrend[] {
    const trends: ErrorTrend[] = [];
    const now = Date.now();

    // Analyze by category
    for (const category of Object.values(ErrorCategory)) {
      const trendData = this.calculateTrendForCategory(category, now);
      if (trendData) {
        trends.push(trendData);
      }
    }

    // Analyze top error codes
    const errorCounts: Record<string, number> = {};
    for (const record of this.errorRecords) {
      errorCounts[record.code] = (errorCounts[record.code] || 0) + 1;
    }

    const topCodes = Object.entries(errorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    for (const [code] of topCodes) {
      const trendData = this.calculateTrendForCode(code, now);
      if (trendData) {
        trends.push(trendData);
      }
    }

    return trends;
  }

  /**
   * Get health summary by error category
   * 
   * @returns Summary of health metrics for each category
   */
  getCategoryHealthSummary(): Record<ErrorCategory, CategoryHealth> {
    const summary: Record<ErrorCategory, CategoryHealth> = {} as Record<ErrorCategory, CategoryHealth>;

    for (const category of Object.values(ErrorCategory)) {
      const categoryRecords = this.errorRecords.filter(r => r.category === category);
      
      if (categoryRecords.length === 0) {
        summary[category] = {
          totalErrors: 0,
          recoveryRate: 0,
          mostCommonCode: 'N/A',
          mostCommonSeverity: ErrorSeverity.LOW,
        };
        continue;
      }

      const recovered = categoryRecords.filter(r => r.recovered).length;
      const codeCounts: Record<string, number> = {};
      const severityCounts: Record<ErrorSeverity, number> = {
        [ErrorSeverity.CRITICAL]: 0,
        [ErrorSeverity.HIGH]: 0,
        [ErrorSeverity.MEDIUM]: 0,
        [ErrorSeverity.LOW]: 0,
      };

      for (const record of categoryRecords) {
        codeCounts[record.code] = (codeCounts[record.code] || 0) + 1;
        severityCounts[record.severity]++;
      }

      const mostCommonCode = Object.entries(codeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';
      const mostCommonSeverity = (
        Object.entries(severityCounts).sort((a, b) => b[1] - a[1])[0]?.[0] as ErrorSeverity
      ) || ErrorSeverity.LOW;

      summary[category] = {
        totalErrors: categoryRecords.length,
        recoveryRate: (recovered / categoryRecords.length) * 100,
        mostCommonCode,
        mostCommonSeverity,
      };
    }

    return summary;
  }

  /**
   * Reset all metrics
   * 
   * Clears all recorded errors and recovery statistics.
   * Useful for testing or periodic metric reset.
   */
  reset(): void {
    this.errorRecords = [];
    this.recoveryRecords.clear();
    this.lastCleanup = Date.now();
  }

  /**
   * Get count of records currently stored
   * 
   * @returns Number of error records in memory
   */
  getRecordCount(): number {
    return this.errorRecords.length;
  }

  /**
   * Integration helper: Calculate recovery rate from recovery handler metrics
   * 
   * @param handlerMetrics - Metrics from RecoveryHandler
   * @returns Recovery rate based on successful vs failed executions
   */
  static calculateRecoveryRateFromHandler(handlerMetrics: RecoveryHandlerMetrics): number {
    if (handlerMetrics.totalExecutions === 0) return 0;
    return handlerMetrics.successRate;
  }

  /**
   * Private: Clean up old records when reaching capacity
   */
  private performCleanup(): void {
    const now = Date.now();
    if (now - this.lastCleanup < this.cleanupInterval) return;

    // Remove records older than 1 hour
    const oneHourAgo = now - 60 * 60 * 1000;
    this.errorRecords = this.errorRecords.filter(r => r.timestamp > oneHourAgo);

    // If still over capacity, keep only the most recent records
    if (this.errorRecords.length > this.maxRecords) {
      this.errorRecords = this.errorRecords.slice(-this.maxRecords);
    }

    this.lastCleanup = now;
  }

  /**
   * Private: Calculate trend for a specific category
   */
  private calculateTrendForCategory(category: ErrorCategory, now: number): ErrorTrend | null {
    const currentRate = this.calculateCategoryRate(category, now, 60 * 1000);
    const previousRate = this.calculateCategoryRate(category, now - 60 * 1000, 60 * 1000);

    if (currentRate === 0 && previousRate === 0) return null;

    let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
    let percentageChange = 0;

    if (previousRate > 0) {
      percentageChange = ((currentRate - previousRate) / previousRate) * 100;
      if (percentageChange > 10) trend = 'increasing';
      else if (percentageChange < -10) trend = 'decreasing';
    } else if (currentRate > 0) {
      trend = 'increasing';
      percentageChange = 100;
    }

    return {
      category,
      ratePerMinute: currentRate,
      previousRatePerMinute: previousRate,
      trend,
      percentageChange,
    };
  }

  /**
   * Private: Calculate trend for a specific error code
   */
  private calculateTrendForCode(code: string, now: number): ErrorTrend | null {
    const currentCount = this.errorRecords.filter(
      r => r.code === code && r.timestamp > now - 60 * 1000
    ).length;
    const previousCount = this.errorRecords.filter(
      r => r.code === code && r.timestamp > now - 120 * 1000 && r.timestamp <= now - 60 * 1000
    ).length;

    const currentRate = currentCount;
    const previousRate = previousCount;

    if (currentRate === 0 && previousRate === 0) return null;

    let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
    let percentageChange = 0;

    if (previousRate > 0) {
      percentageChange = ((currentRate - previousRate) / previousRate) * 100;
      if (percentageChange > 10) trend = 'increasing';
      else if (percentageChange < -10) trend = 'decreasing';
    } else if (currentRate > 0) {
      trend = 'increasing';
      percentageChange = 100;
    }

    // Find category for this code
    const record = this.errorRecords.find(r => r.code === code);
    const category = record?.category || ErrorCategory.NETWORK;

    return {
      category,
      code,
      ratePerMinute: currentRate,
      previousRatePerMinute: previousRate,
      trend,
      percentageChange,
    };
  }

  /**
   * Private: Calculate error rate for a category within a time window
   */
  private calculateCategoryRate(category: ErrorCategory, beforeTime: number, windowMs: number): number {
    const startTime = beforeTime - windowMs;
    const count = this.errorRecords.filter(
      r => r.category === category && r.timestamp > startTime && r.timestamp <= beforeTime
    ).length;
    return count / (windowMs / 60000);
  }
}
