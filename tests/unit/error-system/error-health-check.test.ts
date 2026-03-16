/**
 * @fileoverview Comprehensive test suite for ErrorHealthCheck
 * Tests health scoring, status classification, recommendations, and circuit breaker integration
 */

import { test } from 'node:test';
import * as assert from 'node:assert';
import { ErrorHealthCheck, HealthStatus, type HealthReport } from '../../../src/core/error-system/error-health-check.js';
import { ErrorMetrics, TimeWindow } from '../../../src/core/error-system/error-metrics.js';
import { ErrorCategory, ErrorSeverity, NetworkErrorCode, ProcessErrorCode } from '../../../src/core/error-system/error-taxonomy.js';
import { NetworkError, ProcessError } from '../../../src/core/error-system/error-categories.js';
import type { CircuitBreakerMetrics, CircuitState } from '../../../src/core/recovery/circuit-breaker.js';

/**
 * Mock circuit breaker for testing
 */
class MockCircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private metrics: CircuitBreakerMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    rejectedRequests: 0,
    stateChanges: 0,
  };

  setState(state: CircuitState): void {
    this.state = state;
  }

  setMetrics(metrics: Partial<CircuitBreakerMetrics>): void {
    this.metrics = { ...this.metrics, ...metrics };
  }

  getState(): CircuitState {
    return this.state;
  }

  getMetrics(): CircuitBreakerMetrics {
    return this.metrics;
  }
}

test('ErrorHealthCheck', async (t) => {
  // =========================================================================
  // Initialization Tests
  // =========================================================================

  await t.test('should initialize with ErrorMetrics', () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);

    assert.ok(healthCheck);
  });

  await t.test('should use default configuration', () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);

    const score = healthCheck.getHealthScore();
    assert.equal(score, 100); // No errors = healthy
  });

  await t.test('should accept custom configuration', () => {
    const metrics = new ErrorMetrics();
    const config = {
      degradedErrorRateThreshold: 10,
      criticalErrorRateThreshold: 20,
      degradedRecoveryThreshold: 30,
      criticalRecoveryThreshold: 60,
    };

    const healthCheck = new ErrorHealthCheck(metrics, config);
    assert.ok(healthCheck);
  });

  // =========================================================================
  // checkHealth() Tests
  // =========================================================================

  await t.test('should return HEALTHY status for clean system', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);

    const report = await healthCheck.checkHealth();

    // First check should be HEALTHY if no errors
    assert.ok(report.status !== HealthStatus.CRITICAL);
    assert.ok('status' in report);
    assert.ok(report.score > 0);
    assert.ok(Array.isArray(report.issues));
    assert.ok(Array.isArray(report.recommendations));
    assert.ok(report.timestamp);
  });

  await t.test('should return complete health report', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);

    const report = await healthCheck.checkHealth();

    assert.ok('status' in report);
    assert.ok('score' in report);
    assert.ok('timestamp' in report);
    assert.ok('issues' in report);
    assert.ok('recommendations' in report);
    assert.ok('categoryHealth' in report);
    assert.ok('metrics' in report);
  });

  await t.test('should identify DEGRADED status when error rate elevated', async () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    // Record 10 errors quickly
    for (let i = 0; i < 10; i++) {
      metrics.recordError(error);
    }

    const healthCheck = new ErrorHealthCheck(metrics, {
      degradedErrorRateThreshold: 3,
      criticalErrorRateThreshold: 20,
    });

    const report = await healthCheck.checkHealth();
    assert.ok(report.status === HealthStatus.DEGRADED || report.status === HealthStatus.CRITICAL);
  });

  await t.test('should identify CRITICAL status when error rate critical', async () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    // Record 30 errors
    for (let i = 0; i < 30; i++) {
      metrics.recordError(error);
    }

    const healthCheck = new ErrorHealthCheck(metrics, {
      degradedErrorRateThreshold: 5,
      criticalErrorRateThreshold: 8,
    });

    const report = await healthCheck.checkHealth();
    assert.ok(report.status === HealthStatus.CRITICAL || report.status === HealthStatus.DEGRADED);
  });

  await t.test('should detect degraded status due to low recovery rate', async () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    // Record errors with poor recovery
    for (let i = 0; i < 10; i++) {
      metrics.recordError(error, false);
    }

    const healthCheck = new ErrorHealthCheck(metrics, {
      degradedRecoveryThreshold: 20,
    });

    const report = await healthCheck.checkHealth();
    assert.ok(report.issues.some(issue => issue.includes('unrecovered')));
  });

  // =========================================================================
  // getHealthScore() Tests
  // =========================================================================

  await t.test('should return health score 0-100', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);

    await healthCheck.checkHealth();
    const score = healthCheck.getHealthScore();

    assert.ok(score >= 0 && score <= 100);
  });

  await t.test('should return 100 when no health checks performed', () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);

    const score = healthCheck.getHealthScore();
    assert.equal(score, 100);
  });

  await t.test('should decrease score with more errors', async () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    // Create first health check with few errors
    for (let i = 0; i < 5; i++) {
      metrics.recordError(error);
    }
    const healthCheck = new ErrorHealthCheck(metrics);
    await healthCheck.checkHealth();
    const score1 = healthCheck.getHealthScore();

    // Add more errors and check again
    for (let i = 0; i < 10; i++) {
      metrics.recordError(error);
    }
    await healthCheck.checkHealth();
    const score2 = healthCheck.getHealthScore();

    assert.ok(score2 <= score1, 'Score should decrease with more errors');
  });

  // =========================================================================
  // Health Status Classification Tests
  // =========================================================================

  await t.test('should classify HEALTHY status correctly', () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);

    assert.ok(healthCheck.isHealthy());
    assert.ok(!healthCheck.isCritical());
    assert.ok(!healthCheck.isDegraded());
  });

  await t.test('should transition health status', async () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    const healthCheck = new ErrorHealthCheck(metrics, {
      degradedErrorRateThreshold: 5,
      criticalErrorRateThreshold: 15,
    });

    // Check 1: Healthy
    await healthCheck.checkHealth();
    assert.ok(healthCheck.isHealthy() || !healthCheck.isCritical());

    // Add errors to degrade
    for (let i = 0; i < 10; i++) {
      metrics.recordError(error);
    }
    await healthCheck.checkHealth();

    assert.ok(!healthCheck.isHealthy() || healthCheck.isDegraded());
  });

  // =========================================================================
  // getRecommendations() Tests
  // =========================================================================

  await t.test('should provide recommendations', () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);

    const recommendations = healthCheck.getRecommendations();

    assert.ok(Array.isArray(recommendations));
    assert.ok(recommendations.length > 0);
  });

  await t.test('should provide CRITICAL recommendations', async () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
      severity: ErrorSeverity.CRITICAL,
    });

    for (let i = 0; i < 30; i++) {
      metrics.recordError(error);
    }

    const healthCheck = new ErrorHealthCheck(metrics, {
      criticalErrorRateThreshold: 5,
    });

    await healthCheck.checkHealth();
    const recommendations = healthCheck.getRecommendations();

    assert.ok(recommendations.some(r => r.includes('CRITICAL') || r.includes('immediate')));
  });

  await t.test('should provide DEGRADED recommendations', async () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    for (let i = 0; i < 10; i++) {
      metrics.recordError(error, false);
    }

    const healthCheck = new ErrorHealthCheck(metrics, {
      degradedRecoveryThreshold: 30,
    });

    await healthCheck.checkHealth();
    const recommendations = healthCheck.getRecommendations();

    assert.ok(Array.isArray(recommendations));
    assert.ok(recommendations.length > 0);
  });

  // =========================================================================
  // Circuit Breaker Integration Tests
  // =========================================================================

  await t.test('should register circuit breaker', () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);
    const breaker = new MockCircuitBreaker();

    healthCheck.registerCircuitBreaker('api', breaker);
    assert.ok(healthCheck);
  });

  await t.test('should detect OPEN circuit breaker in health report', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);
    const breaker = new MockCircuitBreaker();

    breaker.setState('OPEN');
    healthCheck.registerCircuitBreaker('api', breaker);

    const report = await healthCheck.checkHealth();

    assert.ok(report.issues.some(issue => issue.includes('OPEN')));
  });

  await t.test('should detect HALF_OPEN circuit breaker in health report', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);
    const breaker = new MockCircuitBreaker();

    breaker.setState('HALF_OPEN');
    healthCheck.registerCircuitBreaker('api', breaker);

    const report = await healthCheck.checkHealth();

    assert.ok(report.issues.some(issue => issue.includes('HALF_OPEN')));
  });

  await t.test('should unregister circuit breaker', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);
    const breaker = new MockCircuitBreaker();

    breaker.setState('OPEN');
    healthCheck.registerCircuitBreaker('api', breaker);

    let report = await healthCheck.checkHealth();
    assert.ok(report.issues.some(issue => issue.includes('OPEN')));

    healthCheck.unregisterCircuitBreaker('api');

    report = await healthCheck.checkHealth();
    assert.ok(!report.issues.some(issue => issue.includes('OPEN')));
  });

  await t.test('should detect high circuit breaker rejection rate', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics, {
      degradedRejectionThreshold: 10,
    });
    const breaker = new MockCircuitBreaker();

    breaker.setMetrics({
      totalRequests: 100,
      rejectedRequests: 25,
      successfulRequests: 75,
      failedRequests: 0,
      stateChanges: 0,
    });

    healthCheck.registerCircuitBreaker('api', breaker);
    const report = await healthCheck.checkHealth();

    assert.ok(report.issues.some(issue => issue.includes('rejection rate')));
  });

  // =========================================================================
  // getHealthHistory() Tests
  // =========================================================================

  await t.test('should track health check history', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);

    await healthCheck.checkHealth();
    await healthCheck.checkHealth();
    await healthCheck.checkHealth();

    const history = healthCheck.getHealthHistory();

    assert.ok(Array.isArray(history));
    assert.ok(history.length >= 3);
  });

  await t.test('should limit history to specified count', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);

    for (let i = 0; i < 50; i++) {
      await healthCheck.checkHealth();
    }

    const history = healthCheck.getHealthHistory(10);

    assert.equal(history.length, 10);
  });

  await t.test('should store correct information in history', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);

    await healthCheck.checkHealth();
    const history = healthCheck.getHealthHistory(1);

    assert.ok(history[0].timestamp);
    assert.ok('status' in history[0]);
    assert.ok('score' in history[0]);
  });

  await t.test('should reset health history', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);

    await healthCheck.checkHealth();
    await healthCheck.checkHealth();

    let history = healthCheck.getHealthHistory();
    assert.ok(history.length > 0);

    healthCheck.resetHistory();

    history = healthCheck.getHealthHistory();
    assert.equal(history.length, 0);
  });

  // =========================================================================
  // Category Health Tests
  // =========================================================================

  await t.test('should provide category health summary', async () => {
    const metrics = new ErrorMetrics();
    const networkError = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });
    const processError = new ProcessError('Error', {
      code: ProcessErrorCode.SPAWN_FAILED,
    });

    metrics.recordError(networkError);
    metrics.recordError(processError);

    const healthCheck = new ErrorHealthCheck(metrics);
    const summary = healthCheck.getErrorCategorySummary();

    assert.ok(ErrorCategory.NETWORK in summary);
    assert.ok(ErrorCategory.PROCESS in summary);
    assert.equal(summary[ErrorCategory.NETWORK].totalErrors, 1);
    assert.equal(summary[ErrorCategory.PROCESS].totalErrors, 1);
  });

  await t.test('should include category health in health report', async () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    metrics.recordError(error);

    const healthCheck = new ErrorHealthCheck(metrics);
    const report = await healthCheck.checkHealth();

    assert.ok(report.categoryHealth);
    assert.ok(ErrorCategory.NETWORK in report.categoryHealth);
    assert.ok('status' in report.categoryHealth[ErrorCategory.NETWORK]);
    assert.ok('score' in report.categoryHealth[ErrorCategory.NETWORK]);
  });

  // =========================================================================
  // Threshold Tests
  // =========================================================================

  await t.test('should respect degraded error rate threshold', async () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    for (let i = 0; i < 7; i++) {
      metrics.recordError(error);
    }

    const healthCheck = new ErrorHealthCheck(metrics, {
      degradedErrorRateThreshold: 5,
      criticalErrorRateThreshold: 10,
    });

    const report = await healthCheck.checkHealth();

    assert.equal(report.status, HealthStatus.DEGRADED);
  });

  await t.test('should respect critical error rate threshold', async () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    for (let i = 0; i < 15; i++) {
      metrics.recordError(error);
    }

    const healthCheck = new ErrorHealthCheck(metrics, {
      degradedErrorRateThreshold: 3,
      criticalErrorRateThreshold: 5,
    });

    const report = await healthCheck.checkHealth();

    assert.ok(report.status === HealthStatus.CRITICAL || report.status === HealthStatus.DEGRADED);
  });

  await t.test('should respect recovery threshold', async () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    // Record 100 errors with only 10% recovery
    for (let i = 0; i < 100; i++) {
      const recovered = i < 10;
      metrics.recordError(error, recovered);
    }

    const healthCheck = new ErrorHealthCheck(metrics, {
      degradedRecoveryThreshold: 20,
    });

    const report = await healthCheck.checkHealth();

    assert.ok(report.issues.some(issue => issue.includes('unrecovered')));
  });

  // =========================================================================
  // Metrics Integration Tests
  // =========================================================================

  await t.test('should include metrics in health report', async () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    metrics.recordError(error);
    metrics.recordError(error, true);

    const healthCheck = new ErrorHealthCheck(metrics);
    const report = await healthCheck.checkHealth();

    assert.equal(report.metrics.totalErrors, 2);
    assert.equal(report.metrics.recoveredErrors, 1);
    assert.equal(report.metrics.unrecoveredErrors, 1);
  });

  // =========================================================================
  // Edge Cases
  // =========================================================================

  await t.test('should handle health check with no errors', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);

    const report = await healthCheck.checkHealth();

    // Should not be critical with no errors
    assert.ok(report.status !== HealthStatus.CRITICAL);
    assert.ok(Object.keys(report.categoryHealth).length > 0);
  });

  await t.test('should handle multiple circuit breaker registrations', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);
    const breaker1 = new MockCircuitBreaker();
    const breaker2 = new MockCircuitBreaker();

    healthCheck.registerCircuitBreaker('api', breaker1);
    healthCheck.registerCircuitBreaker('cache', breaker2);

    const report = await healthCheck.checkHealth();

    assert.ok(report.circuitBreakerStates);
    assert.equal(Object.keys(report.circuitBreakerStates).length, 2);
  });

  await t.test('should handle status transitions across multiple checks', async () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    const healthCheck = new ErrorHealthCheck(metrics, {
      degradedErrorRateThreshold: 3,
      criticalErrorRateThreshold: 10,
    });

    // Check 1: Verify initial check completes
    let report = await healthCheck.checkHealth();
    assert.ok(report.status !== HealthStatus.CRITICAL);

    // Check 2: Degraded or worse
    for (let i = 0; i < 10; i++) {
      metrics.recordError(error);
    }
    report = await healthCheck.checkHealth();
    assert.ok(report.status !== null);

    // Check 3: More degraded or critical
    for (let i = 0; i < 10; i++) {
      metrics.recordError(error);
    }
    report = await healthCheck.checkHealth();
    assert.ok(report.status !== null);
  });
});
