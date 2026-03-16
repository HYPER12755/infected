/**
 * Error Metrics Aggregator
 *
 * Aggregates error and health metrics from multiple sources:
 * - ErrorMetrics: error tracking and trends
 * - RecoveryHandler: recovery execution statistics
 * - CircuitBreaker: circuit state and rejection rates
 * - ResourceLimiter/ResourceMonitor: resource utilization
 *
 * Provides unified system health view and anomaly detection.
 */
/**
 * ErrorMetricsAggregator - Unified metrics aggregation
 *
 * Combines metrics from multiple sources to provide a comprehensive
 * view of system health, performance, and error patterns.
 *
 * @example
 * ```typescript
 * const aggregator = new ErrorMetricsAggregator(
 *   errorHealthCheck,
 *   errorMetrics
 * );
 *
 * // Register additional metrics sources
 * aggregator.registerRecoveryMetrics(recoveryHandler);
 * aggregator.registerCircuitBreaker('api', circuitBreaker);
 * aggregator.registerResourceMetrics(resourceMonitor);
 *
 * // Collect and analyze metrics
 * const metrics = await aggregator.collectMetrics();
 * console.log(`System health: ${metrics.systemHealthScore}/100`);
 *
 * // Detect anomalies
 * const anomalies = aggregator.detectAnomalies();
 * anomalies.forEach(anomaly => {
 *   console.warn(`${anomaly.severity}: ${anomaly.description}`);
 * });
 *
 * // Get component breakdown
 * const components = aggregator.getMetricsByComponent();
 * components.forEach(comp => {
 *   console.log(`${comp.name}: ${comp.healthScore}/100`);
 * });
 * ```
 */
export class ErrorMetricsAggregator {
    /**
     * Create a new ErrorMetricsAggregator
     *
     * @param healthCheck - ErrorHealthCheck instance
     * @param errorMetrics - ErrorMetrics instance
     */
    constructor(healthCheck, errorMetrics) {
        this.lastAggregation = null;
        this.anomalyHistory = [];
        this.maxAnomalyHistory = 100;
        this.lastMetrics = null;
        this.healthCheck = healthCheck;
        this.errorMetrics = errorMetrics;
        this.circuitBreakers = new Map();
    }
    /**
     * Collect and aggregate metrics from all sources
     *
     * @returns Promise resolving to aggregated metrics
     *
     * @example
     * ```typescript
     * const aggregated = await aggregator.collectMetrics();
     * console.log(`Health score: ${aggregated.systemHealthScore}`);
     * console.log(`Error rate: ${aggregated.errorMetrics.totalErrors} total`);
     * ```
     */
    async collectMetrics() {
        const timestamp = new Date().toISOString();
        const healthReport = await this.healthCheck.checkHealth();
        const errorMetricsSnapshot = this.errorMetrics.getMetrics();
        const trends = this.errorMetrics.getTrendAnalysis();
        const categoryHealth = this.errorMetrics.getCategoryHealthSummary();
        const circuitBreakerMetrics = {};
        for (const [name, breaker] of Array.from(this.circuitBreakers)) {
            const metrics = breaker.getMetrics();
            const state = breaker.getState();
            circuitBreakerMetrics[name] = { ...metrics, state };
        }
        const recoveryMetrics = this.recoveryHandler?.getRecoveryMetrics();
        const resourceMetrics = this.resourceMetrics?.getMetrics();
        const components = [];
        // Error metrics component
        components.push({
            name: 'ErrorMetrics',
            type: 'error',
            healthScore: Math.round(healthReport.score),
            metrics: {
                totalErrors: errorMetricsSnapshot.totalErrors,
                recoveryRate: errorMetricsSnapshot.recoveryRate,
                errorRate: trends.length > 0 ? trends[0].ratePerMinute : 0,
            },
        });
        // Recovery metrics component
        if (recoveryMetrics) {
            components.push({
                name: 'RecoveryHandler',
                type: 'recovery',
                healthScore: Math.round(recoveryMetrics.successRate),
                metrics: {
                    totalExecutions: recoveryMetrics.totalExecutions,
                    successRate: recoveryMetrics.successRate,
                    circuitBreakerRejections: recoveryMetrics.circuitBreakerRejections,
                },
            });
        }
        // Circuit breaker components
        for (const [name, metrics] of Object.entries(circuitBreakerMetrics)) {
            const healthScore = Math.round(((metrics.successfulRequests || 0) / (metrics.totalRequests || 1)) * 100);
            components.push({
                name: `CircuitBreaker:${name}`,
                type: 'circuitBreaker',
                healthScore,
                metrics: {
                    state: metrics.state,
                    successRate: healthScore,
                    rejectionRate: ((metrics.rejectedRequests || 0) / (metrics.totalRequests || 1)) * 100,
                },
            });
        }
        // Resource metrics component
        if (resourceMetrics) {
            const resourceScore = this.calculateResourceScore(resourceMetrics);
            components.push({
                name: 'Resources',
                type: 'resource',
                healthScore: resourceScore,
                metrics: {
                    memoryUsageMB: resourceMetrics.memoryUsageMB,
                    cpuUsagePercent: resourceMetrics.cpuUsagePercent,
                    openFileHandles: resourceMetrics.openFileHandles,
                    activeConnections: resourceMetrics.activeConnections,
                },
            });
        }
        const aggregated = {
            timestamp,
            systemHealthScore: Math.round(healthReport.score),
            errorMetrics: errorMetricsSnapshot,
            recoveryMetrics,
            circuitBreakerMetrics,
            resourceMetrics,
            trends,
            categoryHealth,
            components,
        };
        this.lastAggregation = aggregated;
        this.lastMetrics = aggregated;
        // Detect anomalies
        this.detectAnomalies();
        return aggregated;
    }
    /**
     * Detect anomalies in current metrics
     *
     * Compares current metrics with previous baseline to identify:
     * - Error rate spikes
     * - Recovery failure increases
     * - Circuit breaker state changes
     * - Resource warnings
     *
     * @returns Array of detected anomalies
     *
     * @example
     * ```typescript
     * const anomalies = aggregator.detectAnomalies();
     * anomalies
     *   .filter(a => a.severity === 'CRITICAL')
     *   .forEach(a => console.error(a.description));
     * ```
     */
    detectAnomalies() {
        const anomalies = [];
        if (!this.lastAggregation) {
            return anomalies;
        }
        const now = new Date().toISOString();
        // Check for error rate spike
        if (this.lastMetrics && this.lastAggregation) {
            const currentErrorCount = this.lastAggregation.errorMetrics.totalErrors;
            const previousErrorCount = this.lastMetrics.errorMetrics.totalErrors;
            const increase = currentErrorCount - previousErrorCount;
            if (increase > 10) {
                anomalies.push({
                    type: 'error-rate-spike',
                    severity: increase > 50 ? 'CRITICAL' : 'MEDIUM',
                    description: `Error count increased by ${increase} in last collection cycle`,
                    affectedComponent: 'ErrorMetrics',
                    timestamp: now,
                    suggestedAction: 'Review error logs for root causes',
                });
            }
        }
        // Check for unrecovered error increase
        const unrecoveredPercentage = 100 - this.lastAggregation.errorMetrics.recoveryRate;
        if (unrecoveredPercentage > 50) {
            anomalies.push({
                type: 'recovery-failure-increase',
                severity: 'HIGH',
                description: `${unrecoveredPercentage.toFixed(1)}% of errors remain unrecovered`,
                affectedComponent: 'Recovery',
                timestamp: now,
                suggestedAction: 'Improve error handling and recovery strategies',
            });
        }
        // Check circuit breaker states
        for (const [name, cbMetrics] of Object.entries(this.lastAggregation.circuitBreakerMetrics)) {
            if (cbMetrics.state === 'OPEN') {
                anomalies.push({
                    type: 'circuit-breaker-state-change',
                    severity: 'HIGH',
                    description: `Circuit breaker '${name}' is OPEN`,
                    affectedComponent: `CircuitBreaker:${name}`,
                    timestamp: now,
                    suggestedAction: 'Check service health and verify recovery conditions',
                });
            }
            const rejectionRate = cbMetrics.totalRequests > 0
                ? (cbMetrics.rejectedRequests / cbMetrics.totalRequests) * 100
                : 0;
            if (rejectionRate > 25) {
                anomalies.push({
                    type: 'circuit-breaker-state-change',
                    severity: 'MEDIUM',
                    description: `Circuit breaker '${name}' rejection rate: ${rejectionRate.toFixed(1)}%`,
                    affectedComponent: `CircuitBreaker:${name}`,
                    timestamp: now,
                    suggestedAction: 'Monitor service recovery attempts',
                });
            }
        }
        // Check resource metrics
        if (this.lastAggregation.resourceMetrics) {
            const res = this.lastAggregation.resourceMetrics;
            if (res.memoryLimitMB && res.memoryUsageMB > res.memoryLimitMB * 0.9) {
                anomalies.push({
                    type: 'resource-warning',
                    severity: 'HIGH',
                    description: `Memory usage at ${(res.memoryUsageMB / (res.memoryLimitMB || 1) * 100).toFixed(1)}% of limit`,
                    affectedComponent: 'Resources:Memory',
                    timestamp: now,
                    suggestedAction: 'Reduce memory-intensive operations or increase limit',
                });
            }
            if (res.cpuUsagePercent > 90) {
                anomalies.push({
                    type: 'resource-warning',
                    severity: 'MEDIUM',
                    description: `CPU usage at ${res.cpuUsagePercent.toFixed(1)}%`,
                    affectedComponent: 'Resources:CPU',
                    timestamp: now,
                    suggestedAction: 'Optimize CPU-intensive operations',
                });
            }
            if (res.fileHandleLimit && res.openFileHandles > res.fileHandleLimit * 0.8) {
                anomalies.push({
                    type: 'resource-warning',
                    severity: 'MEDIUM',
                    description: `File handles at ${(res.openFileHandles / (res.fileHandleLimit || 1) * 100).toFixed(1)}% of limit`,
                    affectedComponent: 'Resources:FileHandles',
                    timestamp: now,
                    suggestedAction: 'Close unused file handles',
                });
            }
        }
        // Store anomalies in history
        this.anomalyHistory.push(...anomalies);
        if (this.anomalyHistory.length > this.maxAnomalyHistory) {
            this.anomalyHistory = this.anomalyHistory.slice(-this.maxAnomalyHistory);
        }
        return anomalies;
    }
    /**
     * Get system health score
     *
     * Calculates overall health based on all components.
     *
     * @returns Health score 0-100
     */
    getSystemHealthScore() {
        if (!this.lastAggregation)
            return 100;
        return this.lastAggregation.systemHealthScore;
    }
    /**
     * Get metrics by component
     *
     * @returns Array of component metrics
     */
    getMetricsByComponent() {
        if (!this.lastAggregation)
            return [];
        return this.lastAggregation.components;
    }
    /**
     * Get anomaly history
     *
     * @param limit - Maximum number of anomalies to return
     * @returns Array of detected anomalies
     */
    getAnomalyHistory(limit = 20) {
        return this.anomalyHistory.slice(-limit);
    }
    /**
     * Clear anomaly history
     */
    clearAnomalyHistory() {
        this.anomalyHistory = [];
    }
    /**
     * Register recovery handler metrics
     *
     * @param recoveryHandler - RecoveryHandler with getRecoveryMetrics method
     */
    registerRecoveryMetrics(recoveryHandler) {
        this.recoveryHandler = recoveryHandler;
    }
    /**
     * Register circuit breaker for monitoring
     *
     * @param name - Name of the circuit breaker
     * @param breaker - CircuitBreaker instance
     */
    registerCircuitBreaker(name, breaker) {
        this.circuitBreakers.set(name, breaker);
    }
    /**
     * Register resource metrics
     *
     * @param resourceMonitor - Resource monitor with getMetrics method
     */
    registerResourceMetrics(resourceMonitor) {
        this.resourceMetrics = resourceMonitor;
    }
    /**
     * Get last aggregated metrics
     *
     * @returns Last aggregation result or null if none
     */
    getLastMetrics() {
        return this.lastAggregation;
    }
    /**
     * Generate summary report
     *
     * @returns Human-readable summary of system health
     */
    async generateSummary() {
        const metrics = this.lastAggregation || await this.collectMetrics();
        const lines = [
            '=== System Health Summary ===',
            `Timestamp: ${metrics.timestamp}`,
            `Overall Health Score: ${metrics.systemHealthScore}/100`,
            '',
            '--- Error Metrics ---',
            `Total Errors: ${metrics.errorMetrics.totalErrors}`,
            `Recovery Rate: ${metrics.errorMetrics.recoveryRate.toFixed(1)}%`,
            `Unrecovered: ${(100 - metrics.errorMetrics.recoveryRate).toFixed(1)}%`,
            '',
            '--- Component Status ---',
        ];
        for (const component of metrics.components) {
            const status = component.healthScore >= 75 ? '✓' : component.healthScore >= 40 ? '⚠' : '✗';
            lines.push(`${status} ${component.name}: ${component.healthScore}/100`);
        }
        if (metrics.trends.length > 0) {
            lines.push('', '--- Trends ---');
            metrics.trends.slice(0, 5).forEach(trend => {
                const arrow = trend.trend === 'increasing' ? '↑' : trend.trend === 'decreasing' ? '↓' : '→';
                lines.push(`${arrow} ${trend.category}${trend.code ? `:${trend.code}` : ''}: ${trend.ratePerMinute.toFixed(2)}/min`);
            });
        }
        return lines.join('\n');
    }
    /**
     * Private: Calculate resource health score
     */
    calculateResourceScore(resourceMetrics) {
        let score = 100;
        // Memory penalty
        if (resourceMetrics.memoryLimitMB) {
            const memoryPercent = (resourceMetrics.memoryUsageMB / resourceMetrics.memoryLimitMB) * 100;
            if (memoryPercent > 90)
                score -= 40;
            else if (memoryPercent > 75)
                score -= 20;
            else if (memoryPercent > 50)
                score -= 10;
        }
        // CPU penalty
        if (resourceMetrics.cpuUsagePercent > 90)
            score -= 30;
        else if (resourceMetrics.cpuUsagePercent > 75)
            score -= 15;
        else if (resourceMetrics.cpuUsagePercent > 50)
            score -= 5;
        // File handles penalty
        if (resourceMetrics.fileHandleLimit) {
            const handlesPercent = (resourceMetrics.openFileHandles / resourceMetrics.fileHandleLimit) * 100;
            if (handlesPercent > 90)
                score -= 30;
            else if (handlesPercent > 75)
                score -= 15;
        }
        // Connections penalty
        if (resourceMetrics.connectionLimit) {
            const connPercent = (resourceMetrics.activeConnections / resourceMetrics.connectionLimit) * 100;
            if (connPercent > 90)
                score -= 25;
            else if (connPercent > 75)
                score -= 12;
        }
        return Math.max(0, score);
    }
}
