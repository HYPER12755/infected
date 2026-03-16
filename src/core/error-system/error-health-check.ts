/**
 * Error System Health Check and Monitoring
 * 
 * Provides comprehensive health status monitoring with:
 * - Health score calculation (0-100)
 * - Status classification (HEALTHY, DEGRADED, CRITICAL)
 * - Circuit breaker state integration
 * - Actionable recommendations
 * - Category-level health analysis
 */

import { ErrorMetrics, TimeWindow, type ErrorMetricsSnapshot, type CategoryHealth } from './error-metrics.js';
import { ErrorCategory, ErrorSeverity } from './error-taxonomy.js';
import type { CircuitBreakerMetrics, CircuitState } from '../recovery/circuit-breaker.js';

/**
 * Health status enum
 * @enum {string}
 */
export enum HealthStatus {
  /** System is operating normally */
  HEALTHY = 'HEALTHY',
  /** System is experiencing issues but still functional */
  DEGRADED = 'DEGRADED',
  /** System is in critical condition and needs immediate attention */
  CRITICAL = 'CRITICAL',
}

/**
 * Detailed health report
 */
export interface HealthReport {
  /** Current health status */
  status: HealthStatus;
  /** Health score 0-100 (100 = healthy) */
  score: number;
  /** ISO timestamp of health check */
  timestamp: string;
  /** Detailed health reasons and issues */
  issues: string[];
  /** Recommended actions to improve health */
  recommendations: string[];
  /** Breakdown by error category */
  categoryHealth: Record<ErrorCategory, {
    status: HealthStatus;
    score: number;
  }>;
  /** Error metrics snapshot */
  metrics: ErrorMetricsSnapshot;
  /** Circuit breaker states being monitored */
  circuitBreakerStates?: Record<string, CircuitState>;
}

/**
 * Health check configuration
 */
export interface HealthCheckConfig {
  /** Error rate threshold (errors/min) to trigger DEGRADED (default: 5) */
  degradedErrorRateThreshold?: number;
  /** Error rate threshold (errors/min) to trigger CRITICAL (default: 10) */
  criticalErrorRateThreshold?: number;
  /** Unrecovered error percentage threshold for DEGRADED (default: 20) */
  degradedRecoveryThreshold?: number;
  /** Unrecovered error percentage threshold for CRITICAL (default: 50) */
  criticalRecoveryThreshold?: number;
  /** Circuit breaker rejection rate threshold for DEGRADED (default: 10) */
  degradedRejectionThreshold?: number;
  /** Circuit breaker rejection rate threshold for CRITICAL (default: 25) */
  criticalRejectionThreshold?: number;
  /** Time window for error rate calculation (default: 5m) */
  metricsWindow?: TimeWindow;
}

/**
 * ErrorHealthCheck - Monitors system health based on error metrics
 * 
 * Tracks error patterns, circuit breaker states, and recovery effectiveness
 * to provide a comprehensive health status and actionable recommendations.
 * 
 * @example
 * ```typescript
 * const metrics = new ErrorMetrics();
 * const healthCheck = new ErrorHealthCheck(metrics);
 * 
 * // Register circuit breaker for monitoring
 * healthCheck.registerCircuitBreaker('api', circuitBreakerInstance);
 * 
 * // Perform health check
 * const health = await healthCheck.checkHealth();
 * console.log(`Health Status: ${health.status}`);
 * console.log(`Health Score: ${health.score}/100`);
 * 
 * // Get recommendations
 * if (health.status === HealthStatus.CRITICAL) {
 *   health.recommendations.forEach(rec => console.warn(rec));
 * }
 * 
 * // Monitor specific category
 * const networkHealth = healthCheck.getErrorCategorySummary()[ErrorCategory.NETWORK];
 * if (networkHealth.score < 50) {
 *   console.log('Network health is degraded');
 * }
 * ```
 */
export class ErrorHealthCheck {
  private metrics: ErrorMetrics;
  private config: Required<HealthCheckConfig>;
  private circuitBreakers: Map<string, { getMetrics: () => CircuitBreakerMetrics; getState: () => CircuitState }>;
  private lastHealthStatus: HealthStatus = HealthStatus.HEALTHY;
  private healthCheckHistory: { timestamp: number; status: HealthStatus; score: number }[] = [];
  private maxHistorySize = 100;

  /**
   * Create a new ErrorHealthCheck instance
   * 
   * @param metrics - ErrorMetrics instance to monitor
   * @param config - Optional configuration overrides
   */
  constructor(
    metrics: ErrorMetrics,
    config: HealthCheckConfig = {}
  ) {
    this.metrics = metrics;
    this.circuitBreakers = new Map();
    
    this.config = {
      degradedErrorRateThreshold: config.degradedErrorRateThreshold ?? 5,
      criticalErrorRateThreshold: config.criticalErrorRateThreshold ?? 10,
      degradedRecoveryThreshold: config.degradedRecoveryThreshold ?? 20,
      criticalRecoveryThreshold: config.criticalRecoveryThreshold ?? 50,
      degradedRejectionThreshold: config.degradedRejectionThreshold ?? 10,
      criticalRejectionThreshold: config.criticalRejectionThreshold ?? 25,
      metricsWindow: config.metricsWindow ?? TimeWindow.FIVE_MINUTES,
    };
  }

  /**
   * Perform a comprehensive health check
   * 
   * Analyzes error metrics, recovery rates, and circuit breaker states
   * to determine overall system health.
   * 
   * @returns Promise resolving to detailed health report
   * 
   * @example
   * ```typescript
   * const report = await healthCheck.checkHealth();
   * if (report.status === HealthStatus.CRITICAL) {
   *   await takeEmergencyAction();
   * }
   * ```
   */
  async checkHealth(): Promise<HealthReport> {
    const metricsSnapshot = this.metrics.getMetrics();
    const issues: string[] = [];
    const categoryHealth: Record<ErrorCategory, { status: HealthStatus; score: number }> = 
      {} as Record<ErrorCategory, { status: HealthStatus; score: number }>;

    // Analyze error rate
    const errorRate = this.metrics.getErrorRate(this.config.metricsWindow);
    if (errorRate >= this.config.criticalErrorRateThreshold) {
      issues.push(`Critical error rate: ${errorRate.toFixed(2)} errors/min (threshold: ${this.config.criticalErrorRateThreshold})`);
    } else if (errorRate >= this.config.degradedErrorRateThreshold) {
      issues.push(`Elevated error rate: ${errorRate.toFixed(2)} errors/min (threshold: ${this.config.degradedErrorRateThreshold})`);
    }

    // Analyze recovery rate
    const recoveryRate = this.metrics.getRecoveryRate();
    const unrecoveredPercentage = 100 - recoveryRate;
    if (unrecoveredPercentage >= this.config.criticalRecoveryThreshold) {
      issues.push(`Critical unrecovered error rate: ${unrecoveredPercentage.toFixed(1)}% (threshold: ${this.config.criticalRecoveryThreshold}%)`);
    } else if (unrecoveredPercentage >= this.config.degradedRecoveryThreshold) {
      issues.push(`Elevated unrecovered error rate: ${unrecoveredPercentage.toFixed(1)}% (threshold: ${this.config.degradedRecoveryThreshold}%)`);
    }

    // Analyze circuit breakers
    for (const [name, breaker] of Array.from(this.circuitBreakers)) {
      const cbMetrics = breaker.getMetrics();
      const cbState = breaker.getState();
      
      if (cbState === 'OPEN') {
        issues.push(`Circuit breaker '${name}' is OPEN - service is blocked`);
      } else if (cbState === 'HALF_OPEN') {
        issues.push(`Circuit breaker '${name}' is HALF_OPEN - testing recovery`);
      }

      const rejectionRate = cbMetrics.totalRequests > 0 
        ? (cbMetrics.rejectedRequests / cbMetrics.totalRequests) * 100 
        : 0;
      
      if (rejectionRate >= this.config.criticalRejectionThreshold) {
        issues.push(`Circuit breaker '${name}' rejection rate critical: ${rejectionRate.toFixed(1)}%`);
      } else if (rejectionRate >= this.config.degradedRejectionThreshold) {
        issues.push(`Circuit breaker '${name}' rejection rate elevated: ${rejectionRate.toFixed(1)}%`);
      }
    }

    // Calculate category health
    const categoryHealthSummary = this.metrics.getCategoryHealthSummary();
    for (const category of Object.values(ErrorCategory)) {
      const catHealth = categoryHealthSummary[category];
      const score = this.calculateCategoryScore(catHealth);
      const status = this.getStatusFromScore(score);
      categoryHealth[category] = { status, score };
    }

    // Determine overall status and score
    const overallScore = this.calculateOverallScore(metricsSnapshot, categoryHealthSummary);
    const status = this.getStatusFromScore(overallScore);

    // Generate recommendations
    const recommendations = this.generateRecommendations(
      status,
      issues,
      metricsSnapshot,
      categoryHealthSummary
    );

    const report: HealthReport = {
      status,
      score: overallScore,
      timestamp: new Date().toISOString(),
      issues,
      recommendations,
      categoryHealth,
      metrics: metricsSnapshot,
      circuitBreakerStates: this.getCircuitBreakerStates(),
    };

    // Update history
    this.healthCheckHistory.push({
      timestamp: Date.now(),
      status,
      score: overallScore,
    });

    if (this.healthCheckHistory.length > this.maxHistorySize) {
      this.healthCheckHistory = this.healthCheckHistory.slice(-this.maxHistorySize);
    }

    this.lastHealthStatus = status;

    return report;
  }

  /**
   * Get current health score (0-100)
   * 
   * Quick method to get just the health score without full report.
   * Uses cached score from last health check.
   * 
   * @returns Health score 0-100
   */
  getHealthScore(): number {
    if (this.healthCheckHistory.length === 0) return 100;
    return this.healthCheckHistory[this.healthCheckHistory.length - 1].score;
  }

  /**
   * Get recommendations for improving health
   * 
   * @returns Array of actionable recommendations
   */
  getRecommendations(): string[] {
    // Run a quick health check to get recommendations
    const metricsSnapshot = this.metrics.getMetrics();
    const categoryHealthSummary = this.metrics.getCategoryHealthSummary();
    const errorRate = this.metrics.getErrorRate(this.config.metricsWindow);
    const status = errorRate >= this.config.criticalErrorRateThreshold
      ? HealthStatus.CRITICAL
      : errorRate >= this.config.degradedErrorRateThreshold
      ? HealthStatus.DEGRADED
      : HealthStatus.HEALTHY;

    return this.generateRecommendations(
      status,
      [],
      metricsSnapshot,
      categoryHealthSummary
    );
  }

  /**
   * Get error category health summary
   * 
   * @returns Health status and score for each error category
   */
  getErrorCategorySummary(): Record<ErrorCategory, CategoryHealth> {
    return this.metrics.getCategoryHealthSummary();
  }

  /**
   * Check if system is healthy
   * 
   * @returns True if health status is HEALTHY
   */
  isHealthy(): boolean {
    return this.lastHealthStatus === HealthStatus.HEALTHY;
  }

  /**
   * Check if system is in critical condition
   * 
   * @returns True if health status is CRITICAL
   */
  isCritical(): boolean {
    return this.lastHealthStatus === HealthStatus.CRITICAL;
  }

  /**
   * Check if system is degraded
   * 
   * @returns True if health status is DEGRADED
   */
  isDegraded(): boolean {
    return this.lastHealthStatus === HealthStatus.DEGRADED;
  }

  /**
   * Register a circuit breaker for monitoring
   * 
   * @param name - Name of the circuit breaker
   * @param breaker - Circuit breaker instance with getMetrics() and getState() methods
   */
  registerCircuitBreaker(
    name: string,
    breaker: { getMetrics: () => CircuitBreakerMetrics; getState: () => CircuitState }
  ): void {
    this.circuitBreakers.set(name, breaker);
  }

  /**
   * Unregister a circuit breaker
   * 
   * @param name - Name of the circuit breaker to unregister
   */
  unregisterCircuitBreaker(name: string): void {
    this.circuitBreakers.delete(name);
  }

  /**
   * Get health check history
   * 
   * @param limit - Maximum number of history entries to return
   * @returns Array of health check records
   */
  getHealthHistory(limit: number = 20): Array<{ timestamp: number; status: HealthStatus; score: number }> {
    return this.healthCheckHistory.slice(-limit);
  }

  /**
   * Reset health check history
   */
  resetHistory(): void {
    this.healthCheckHistory = [];
  }

  /**
   * Private: Calculate category score
   */
  private calculateCategoryScore(categoryHealth: CategoryHealth): number {
    let score = 100;

    // Deduct for error count (max 30 points)
    if (categoryHealth.totalErrors > 0) {
      const errorDeduction = Math.min(30, categoryHealth.totalErrors / 10);
      score -= errorDeduction;
    }

    // Deduct for recovery rate (max 40 points)
    const unrecoveredPercentage = 100 - categoryHealth.recoveryRate;
    score -= (unrecoveredPercentage / 100) * 40;

    // Deduct for critical severity (max 30 points)
    if (categoryHealth.mostCommonSeverity === ErrorSeverity.CRITICAL) {
      score -= 30;
    } else if (categoryHealth.mostCommonSeverity === ErrorSeverity.HIGH) {
      score -= 15;
    } else if (categoryHealth.mostCommonSeverity === ErrorSeverity.MEDIUM) {
      score -= 5;
    }

    return Math.max(0, score);
  }

  /**
   * Private: Calculate overall health score
   */
  private calculateOverallScore(
    metrics: ErrorMetricsSnapshot,
    categoryHealth: Record<ErrorCategory, CategoryHealth>
  ): number {
    let score = 100;

    // Deduct for total errors (max 25 points)
    if (metrics.totalErrors > 0) {
      const errorDeduction = Math.min(25, metrics.totalErrors / 20);
      score -= errorDeduction;
    }

    // Deduct for unrecovered errors (max 40 points)
    const unrecoveredPercentage = 100 - metrics.recoveryRate;
    score -= (unrecoveredPercentage / 100) * 40;

    // Deduct for critical severity errors (max 35 points)
    const criticalCount = metrics.errorsBySeverity[ErrorSeverity.CRITICAL] || 0;
    const criticalDeduction = Math.min(35, criticalCount * 5);
    score -= criticalDeduction;

    // Bonus for consistent recovery (max 10 points)
    if (metrics.recoveryRate > 90) {
      score = Math.min(100, score + 10);
    }

    return Math.max(0, score);
  }

  /**
   * Private: Get status from health score
   */
  private getStatusFromScore(score: number): HealthStatus {
    if (score >= 75) return HealthStatus.HEALTHY;
    if (score >= 40) return HealthStatus.DEGRADED;
    return HealthStatus.CRITICAL;
  }

  /**
   * Private: Get circuit breaker states
   */
  private getCircuitBreakerStates(): Record<string, CircuitState> {
    const states: Record<string, CircuitState> = {};
    for (const [name, breaker] of Array.from(this.circuitBreakers)) {
      states[name] = breaker.getState();
    }
    return states;
  }

  /**
   * Private: Generate recommendations
   */
  private generateRecommendations(
    status: HealthStatus,
    issues: string[],
    metrics: ErrorMetricsSnapshot,
    categoryHealth: Record<ErrorCategory, CategoryHealth>
  ): string[] {
    const recommendations: string[] = [];

    if (status === HealthStatus.CRITICAL) {
      recommendations.push('⚠️  CRITICAL: Immediate action required');
      recommendations.push('1. Review error logs for root causes');
      recommendations.push('2. Check circuit breaker status and consider resetting');
      recommendations.push('3. Verify external service connectivity');
      recommendations.push('4. Increase monitoring and alerting');
    } else if (status === HealthStatus.DEGRADED) {
      recommendations.push('⚠️  System is degraded, action recommended');
      recommendations.push('1. Monitor error trends closely');
      recommendations.push('2. Review recent deployments or changes');
      recommendations.push('3. Check resource utilization');
    } else {
      recommendations.push('✓ System is operating normally');
    }

    // Category-specific recommendations
    for (const [category, health] of Object.entries(categoryHealth)) {
      const categoryScore = this.calculateCategoryScore(health);
      if (categoryScore < 50) {
        recommendations.push(`• ${category}: Recovery rate only ${health.recoveryRate.toFixed(1)}% - review recovery strategies`);
      }
    }

    // Recovery-specific recommendations
    const unrecoveredPercentage = 100 - metrics.recoveryRate;
    if (unrecoveredPercentage > 25) {
      recommendations.push(`• ${unrecoveredPercentage.toFixed(1)}% of errors remain unrecovered - improve error handling`);
    }

    // High error count recommendations
    if (metrics.totalErrors > 100) {
      recommendations.push(`• High error count (${metrics.totalErrors}) - investigate root causes`);
      
      // Find most problematic category
      const categoryName = Object.entries(metrics.errorsByCategory)
        .sort((a, b) => b[1] - a[1])[0]?.[0];
      if (categoryName) {
        recommendations.push(`  - Highest errors in: ${categoryName}`);
      }
    }

    return recommendations;
  }
}
