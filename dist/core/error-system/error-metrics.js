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
import { ErrorCategory, ErrorSeverity } from './error-taxonomy.js';
/**
 * Time window options for rolling metrics
 * @enum {string}
 */
export var TimeWindow;
(function (TimeWindow) {
    TimeWindow["ONE_MINUTE"] = "1m";
    TimeWindow["FIVE_MINUTES"] = "5m";
    TimeWindow["FIFTEEN_MINUTES"] = "15m";
})(TimeWindow || (TimeWindow = {}));
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
    constructor() {
        this.errorRecords = [];
        this.recoveryRecords = new Map();
        this.maxRecords = 10000;
        this.cleanupInterval = 60000; // 1 minute
        this.lastCleanup = Date.now();
        /**
         * Window size in milliseconds for each time window
         */
        this.windowSizes = {
            [TimeWindow.ONE_MINUTE]: 60 * 1000,
            [TimeWindow.FIVE_MINUTES]: 5 * 60 * 1000,
            [TimeWindow.FIFTEEN_MINUTES]: 15 * 60 * 1000,
        };
    }
    /**
     * Record a new error occurrence
     *
     * @param error - The BaseError to record
     * @param recovered - Optional: whether error was recovered (default: false)
     */
    recordError(error, recovered = false) {
        const record = {
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
            }
            else {
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
    recordRecovery(errorCode, recovered) {
        const existing = this.recoveryRecords.get(errorCode) || { recovered: 0, failed: 0 };
        if (recovered) {
            existing.recovered++;
        }
        else {
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
    getMetrics(category) {
        const filtered = category
            ? this.errorRecords.filter(r => r.category === category)
            : this.errorRecords;
        const errorsByCategory = {
            [ErrorCategory.NETWORK]: 0,
            [ErrorCategory.PROCESS]: 0,
            [ErrorCategory.SSH]: 0,
            [ErrorCategory.RESOURCE]: 0,
            [ErrorCategory.SECURITY]: 0,
            [ErrorCategory.TIMEOUT]: 0,
            [ErrorCategory.FILESYSTEM]: 0,
        };
        const errorsBySeverity = {
            [ErrorSeverity.CRITICAL]: 0,
            [ErrorSeverity.HIGH]: 0,
            [ErrorSeverity.MEDIUM]: 0,
            [ErrorSeverity.LOW]: 0,
        };
        const errorsByCode = {};
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
        }, {});
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
    getErrorRate(window = TimeWindow.ONE_MINUTE) {
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
    getRecoveryRate(errorCode) {
        if (errorCode) {
            const stats = this.recoveryRecords.get(errorCode);
            if (!stats)
                return 0;
            const total = stats.recovered + stats.failed;
            return total > 0 ? (stats.recovered / total) * 100 : 0;
        }
        // Overall recovery rate from error records
        const filtered = this.errorRecords;
        if (filtered.length === 0)
            return 0;
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
    getTrendAnalysis() {
        const trends = [];
        const now = Date.now();
        // Analyze by category
        for (const category of Object.values(ErrorCategory)) {
            const trendData = this.calculateTrendForCategory(category, now);
            if (trendData) {
                trends.push(trendData);
            }
        }
        // Analyze top error codes
        const errorCounts = {};
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
    getCategoryHealthSummary() {
        const summary = {};
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
            const codeCounts = {};
            const severityCounts = {
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
            const mostCommonSeverity = Object.entries(severityCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || ErrorSeverity.LOW;
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
    reset() {
        this.errorRecords = [];
        this.recoveryRecords.clear();
        this.lastCleanup = Date.now();
    }
    /**
     * Get count of records currently stored
     *
     * @returns Number of error records in memory
     */
    getRecordCount() {
        return this.errorRecords.length;
    }
    /**
     * Integration helper: Calculate recovery rate from recovery handler metrics
     *
     * @param handlerMetrics - Metrics from RecoveryHandler
     * @returns Recovery rate based on successful vs failed executions
     */
    static calculateRecoveryRateFromHandler(handlerMetrics) {
        if (handlerMetrics.totalExecutions === 0)
            return 0;
        return handlerMetrics.successRate;
    }
    /**
     * Private: Clean up old records when reaching capacity
     */
    performCleanup() {
        const now = Date.now();
        if (now - this.lastCleanup < this.cleanupInterval)
            return;
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
    calculateTrendForCategory(category, now) {
        const currentRate = this.calculateCategoryRate(category, now, 60 * 1000);
        const previousRate = this.calculateCategoryRate(category, now - 60 * 1000, 60 * 1000);
        if (currentRate === 0 && previousRate === 0)
            return null;
        let trend = 'stable';
        let percentageChange = 0;
        if (previousRate > 0) {
            percentageChange = ((currentRate - previousRate) / previousRate) * 100;
            if (percentageChange > 10)
                trend = 'increasing';
            else if (percentageChange < -10)
                trend = 'decreasing';
        }
        else if (currentRate > 0) {
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
    calculateTrendForCode(code, now) {
        const currentCount = this.errorRecords.filter(r => r.code === code && r.timestamp > now - 60 * 1000).length;
        const previousCount = this.errorRecords.filter(r => r.code === code && r.timestamp > now - 120 * 1000 && r.timestamp <= now - 60 * 1000).length;
        const currentRate = currentCount;
        const previousRate = previousCount;
        if (currentRate === 0 && previousRate === 0)
            return null;
        let trend = 'stable';
        let percentageChange = 0;
        if (previousRate > 0) {
            percentageChange = ((currentRate - previousRate) / previousRate) * 100;
            if (percentageChange > 10)
                trend = 'increasing';
            else if (percentageChange < -10)
                trend = 'decreasing';
        }
        else if (currentRate > 0) {
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
    calculateCategoryRate(category, beforeTime, windowMs) {
        const startTime = beforeTime - windowMs;
        const count = this.errorRecords.filter(r => r.category === category && r.timestamp > startTime && r.timestamp <= beforeTime).length;
        return count / (windowMs / 60000);
    }
}
