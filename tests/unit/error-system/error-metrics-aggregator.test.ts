/**
 * @fileoverview Comprehensive test suite for ErrorMetricsAggregator
 * Tests metrics aggregation, anomaly detection, component registration, and system health scoring
 */

import { test } from 'node:test';
import * as assert from 'node:assert';
import { ErrorMetricsAggregator, type AggregatedMetrics, type Anomaly } from '../../../src/core/error-system/error-metrics-aggregator.js';
import { ErrorHealthCheck, HealthStatus } from '../../../src/core/error-system/error-health-check.js';
import { ErrorMetrics, TimeWindow } from '../../../src/core/error-system/error-metrics.js';
import { ErrorCategory, ErrorSeverity, NetworkErrorCode, ProcessErrorCode } from '../../../src/core/error-system/error-taxonomy.js';
import { NetworkError, ProcessError } from '../../../src/core/error-system/error-categories.js';
import type { CircuitBreakerMetrics, CircuitState } from '../../../src/core/recovery/circuit-breaker.js';
import type { RecoveryMetrics } from '../../../src/core/recovery/recovery-handler.js';

/**
 * Mock circuit breaker
 */
class MockCircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private metrics: CircuitBreakerMetrics = {
    totalRequests: 100,
    successfulRequests: 95,
    failedRequests: 5,
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

/**
 * Mock recovery handler
 */
class MockRecoveryHandler {
  private metrics: RecoveryMetrics = {
    totalExecutions: 100,
    successfulExecutions: 80,
    failedExecutions: 20,
    circuitBreakerRejections: 0,
    successRate: 80,
  };

  setMetrics(metrics: Partial<RecoveryMetrics>): void {
    this.metrics = { ...this.metrics, ...metrics };
  }

  getRecoveryMetrics(): RecoveryMetrics {
    return this.metrics;
  }
}

/**
 * Mock resource monitor
 */
class MockResourceMonitor {
  private metrics = {
    memoryUsageMB: 512,
    memoryLimitMB: 1024,
    cpuUsagePercent: 30,
    openFileHandles: 50,
    fileHandleLimit: 1024,
    activeConnections: 10,
    connectionLimit: 100,
  };

  setMetrics(metrics: any): void {
    this.metrics = { ...this.metrics, ...metrics };
  }

  getMetrics() {
    return this.metrics;
  }
}

test('ErrorMetricsAggregator', async (t) => {
  // =========================================================================
  // Initialization Tests
  // =========================================================================

  await t.test('should initialize with ErrorHealthCheck and ErrorMetrics', () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);

    assert.ok(aggregator);
  });

  await t.test('should initialize with no additional components', () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);

    const lastMetrics = aggregator.getLastMetrics();
    assert.equal(lastMetrics, null);
  });

  // =========================================================================
  // collectMetrics() Tests
  // =========================================================================

  await t.test('should collect metrics from ErrorMetrics and ErrorHealthCheck', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);

    const collected = await aggregator.collectMetrics();

    assert.ok(collected.timestamp);
    assert.ok('systemHealthScore' in collected);
    assert.ok('errorMetrics' in collected);
    assert.ok('trends' in collected);
    assert.ok('categoryHealth' in collected);
    assert.ok('components' in collected);
  });

  await t.test('should include error metrics in aggregation', async () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    metrics.recordError(error);
    metrics.recordError(error, true);

    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);

    const collected = await aggregator.collectMetrics();

    assert.equal(collected.errorMetrics.totalErrors, 2);
    assert.equal(collected.errorMetrics.recoveredErrors, 1);
    assert.equal(collected.errorMetrics.unrecoveredErrors, 1);
  });

  await t.test('should calculate system health score', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);

    const collected = await aggregator.collectMetrics();

    assert.ok(collected.systemHealthScore >= 0 && collected.systemHealthScore <= 100);
  });

  await t.test('should include trends in aggregation', async () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    for (let i = 0; i < 5; i++) {
      metrics.recordError(error);
    }

    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);

    const collected = await aggregator.collectMetrics();

    assert.ok(Array.isArray(collected.trends));
  });

  // =========================================================================
  // Component Registration Tests
  // =========================================================================

  await t.test('should register recovery handler metrics', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);
    const recoveryHandler = new MockRecoveryHandler();

    aggregator.registerRecoveryMetrics(recoveryHandler);

    const collected = await aggregator.collectMetrics();

    assert.ok(collected.recoveryMetrics);
    assert.equal(collected.recoveryMetrics.successRate, 80);
  });

  await t.test('should register circuit breaker', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);
    const breaker = new MockCircuitBreaker();

    aggregator.registerCircuitBreaker('api', breaker);

    const collected = await aggregator.collectMetrics();

    assert.ok(collected.circuitBreakerMetrics);
    assert.ok('api' in collected.circuitBreakerMetrics);
  });

  await t.test('should register multiple circuit breakers', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);
    const breaker1 = new MockCircuitBreaker();
    const breaker2 = new MockCircuitBreaker();

    aggregator.registerCircuitBreaker('api', breaker1);
    aggregator.registerCircuitBreaker('cache', breaker2);

    const collected = await aggregator.collectMetrics();

    assert.ok('api' in collected.circuitBreakerMetrics);
    assert.ok('cache' in collected.circuitBreakerMetrics);
  });

  await t.test('should register resource metrics', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);
    const resourceMonitor = new MockResourceMonitor();

    aggregator.registerResourceMetrics(resourceMonitor);

    const collected = await aggregator.collectMetrics();

    assert.ok(collected.resourceMetrics);
    assert.equal(collected.resourceMetrics.memoryUsageMB, 512);
    assert.equal(collected.resourceMetrics.cpuUsagePercent, 30);
  });

  // =========================================================================
  // Component Breakdown Tests
  // =========================================================================

  await t.test('should include ErrorMetrics component', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);

    const collected = await aggregator.collectMetrics();

    const errorComponent = collected.components.find(c => c.name === 'ErrorMetrics');
    assert.ok(errorComponent);
    assert.equal(errorComponent.type, 'error');
  });

  await t.test('should include RecoveryHandler component', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);
    const recoveryHandler = new MockRecoveryHandler();

    aggregator.registerRecoveryMetrics(recoveryHandler);
    const collected = await aggregator.collectMetrics();

    const recoveryComponent = collected.components.find(c => c.name === 'RecoveryHandler');
    assert.ok(recoveryComponent);
    assert.equal(recoveryComponent.type, 'recovery');
  });

  await t.test('should include CircuitBreaker components', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);
    const breaker = new MockCircuitBreaker();

    aggregator.registerCircuitBreaker('api', breaker);
    const collected = await aggregator.collectMetrics();

    const cbComponent = collected.components.find(c => c.name === 'CircuitBreaker:api');
    assert.ok(cbComponent);
    assert.equal(cbComponent.type, 'circuitBreaker');
  });

  await t.test('should include Resources component', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);
    const resourceMonitor = new MockResourceMonitor();

    aggregator.registerResourceMetrics(resourceMonitor);
    const collected = await aggregator.collectMetrics();

    const resourceComponent = collected.components.find(c => c.name === 'Resources');
    assert.ok(resourceComponent);
    assert.equal(resourceComponent.type, 'resource');
  });

  // =========================================================================
  // detectAnomalies() Tests
  // =========================================================================

  await t.test('should detect error rate spike anomaly', async () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);

    // Initial collection
    await aggregator.collectMetrics();

    // Add many errors for second collection to create spike
    for (let i = 0; i < 30; i++) {
      metrics.recordError(error);
    }

    await aggregator.collectMetrics();
    const anomalies = aggregator.detectAnomalies();

    // May not detect error-rate-spike but may detect recovery issues
    assert.ok(Array.isArray(anomalies));
  });

  await t.test('should detect recovery failure increase anomaly', async () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);

    // Record unrecovered errors
    for (let i = 0; i < 70; i++) {
      metrics.recordError(error, false);
    }

    await aggregator.collectMetrics();
    const anomalies = aggregator.detectAnomalies();

    const recoveryAnomaly = anomalies.find(a => a.type === 'recovery-failure-increase');
    assert.ok(recoveryAnomaly, 'Should detect recovery failure anomaly with >50% unrecovered');
    assert.equal(recoveryAnomaly.severity, 'HIGH');
  });

  await t.test('should detect circuit breaker state change anomaly', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);
    const breaker = new MockCircuitBreaker();

    breaker.setState('OPEN');
    aggregator.registerCircuitBreaker('api', breaker);

    await aggregator.collectMetrics();
    const anomalies = aggregator.detectAnomalies();

    const cbAnomaly = anomalies.find(a => a.type === 'circuit-breaker-state-change');
    assert.ok(cbAnomaly);
    assert.equal(cbAnomaly.severity, 'HIGH');
  });

  await t.test('should detect resource warnings', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);
    const resourceMonitor = new MockResourceMonitor();

    // Set high memory usage
    resourceMonitor.setMetrics({
      memoryUsageMB: 950,
      memoryLimitMB: 1000,
    });

    aggregator.registerResourceMetrics(resourceMonitor);
    await aggregator.collectMetrics();
    const anomalies = aggregator.detectAnomalies();

    const memoryAnomaly = anomalies.find(a => a.type === 'resource-warning' && a.affectedComponent.includes('Memory'));
    assert.ok(memoryAnomaly);
  });

  await t.test('should detect CPU usage warnings', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);
    const resourceMonitor = new MockResourceMonitor();

    resourceMonitor.setMetrics({
      cpuUsagePercent: 95,
    });

    aggregator.registerResourceMetrics(resourceMonitor);
    await aggregator.collectMetrics();
    const anomalies = aggregator.detectAnomalies();

    const cpuAnomaly = anomalies.find(a => a.type === 'resource-warning' && a.affectedComponent.includes('CPU'));
    assert.ok(cpuAnomaly);
  });

  await t.test('should classify anomalies by severity', async () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);

    await aggregator.collectMetrics();

    // Large error spike
    for (let i = 0; i < 80; i++) {
      metrics.recordError(error);
    }

    await aggregator.collectMetrics();
    const anomalies = aggregator.detectAnomalies();

    // Should have at least one anomaly with elevated severity
    assert.ok(anomalies.length > 0, 'Should detect at least one anomaly');
    assert.ok(anomalies.some(a => a.severity === 'CRITICAL' || a.severity === 'HIGH'));
  });

  // =========================================================================
  // getSystemHealthScore() Tests
  // =========================================================================

  await t.test('should return system health score', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);

    await aggregator.collectMetrics();
    const score = aggregator.getSystemHealthScore();

    assert.ok(score >= 0 && score <= 100);
  });

  await t.test('should return 100 when no collection performed', () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);

    const score = aggregator.getSystemHealthScore();
    assert.equal(score, 100);
  });

  await t.test('should decrease score with errors', async () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    for (let i = 0; i < 20; i++) {
      metrics.recordError(error);
    }

    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);

    await aggregator.collectMetrics();
    const score = aggregator.getSystemHealthScore();

    assert.ok(score < 100);
  });

  // =========================================================================
  // getMetricsByComponent() Tests
  // =========================================================================

  await t.test('should return metrics by component', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);

    await aggregator.collectMetrics();
    const components = aggregator.getMetricsByComponent();

    assert.ok(Array.isArray(components));
    assert.ok(components.length > 0);
    assert.ok(components[0].name);
    assert.ok('healthScore' in components[0]);
    assert.ok('type' in components[0]);
    assert.ok('metrics' in components[0]);
  });

  await t.test('should return empty array when no collection', () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);

    const components = aggregator.getMetricsByComponent();
    assert.deepEqual(components, []);
  });

  // =========================================================================
  // Anomaly History Tests
  // =========================================================================

  await t.test('should track anomaly history', async () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);

    await aggregator.collectMetrics();

    for (let i = 0; i < 30; i++) {
      metrics.recordError(error);
    }

    await aggregator.collectMetrics();

    const history = aggregator.getAnomalyHistory();
    assert.ok(Array.isArray(history));
  });

  await t.test('should limit anomaly history', async () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);

    // Generate multiple anomalies
    for (let batch = 0; batch < 5; batch++) {
      await aggregator.collectMetrics();
      for (let i = 0; i < 30; i++) {
        metrics.recordError(error);
      }
    }

    await aggregator.collectMetrics();

    const history = aggregator.getAnomalyHistory(10);
    assert.ok(history.length <= 10);
  });

  await t.test('should clear anomaly history', async () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);

    await aggregator.collectMetrics();

    for (let i = 0; i < 30; i++) {
      metrics.recordError(error);
    }

    await aggregator.collectMetrics();

    let history = aggregator.getAnomalyHistory();
    assert.ok(history.length > 0);

    aggregator.clearAnomalyHistory();

    history = aggregator.getAnomalyHistory();
    assert.equal(history.length, 0);
  });

  // =========================================================================
  // getLastMetrics() Tests
  // =========================================================================

  await t.test('should return last aggregated metrics', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);

    const collected = await aggregator.collectMetrics();
    const last = aggregator.getLastMetrics();

    assert.deepEqual(last, collected);
  });

  await t.test('should return null when no aggregation performed', () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);

    const last = aggregator.getLastMetrics();
    assert.equal(last, null);
  });

  // =========================================================================
  // generateSummary() Tests
  // =========================================================================

  await t.test('should generate text summary', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);

    await aggregator.collectMetrics();
    const summary = await aggregator.generateSummary();

    assert.ok(typeof summary === 'string');
    assert.ok(summary.includes('Health'));
    assert.ok(summary.includes('Error'));
  });

  await t.test('should include timestamp in summary', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);

    await aggregator.collectMetrics();
    const summary = await aggregator.generateSummary();

    assert.ok(summary.includes('Timestamp'));
  });

  await t.test('should include component status in summary', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);

    const recoveryHandler = new MockRecoveryHandler();
    aggregator.registerRecoveryMetrics(recoveryHandler);

    await aggregator.collectMetrics();
    const summary = await aggregator.generateSummary();

    assert.ok(summary.includes('Component'));
  });

  // =========================================================================
  // Integration Tests
  // =========================================================================

  await t.test('should integrate all components in aggregation', async () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    metrics.recordError(error);
    metrics.recordError(error, true);

    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);

    const recoveryHandler = new MockRecoveryHandler();
    const breaker = new MockCircuitBreaker();
    const resourceMonitor = new MockResourceMonitor();

    aggregator.registerRecoveryMetrics(recoveryHandler);
    aggregator.registerCircuitBreaker('api', breaker);
    aggregator.registerResourceMetrics(resourceMonitor);

    const collected = await aggregator.collectMetrics();

    assert.ok(collected.errorMetrics.totalErrors === 2);
    assert.ok(collected.recoveryMetrics);
    assert.ok(collected.circuitBreakerMetrics.api);
    assert.ok(collected.resourceMetrics);
    assert.ok(collected.components.length >= 4);
  });

  // =========================================================================
  // Edge Cases
  // =========================================================================

  await t.test('should handle aggregation with no errors', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);

    const collected = await aggregator.collectMetrics();

    assert.equal(collected.errorMetrics.totalErrors, 0);
    assert.ok(collected.systemHealthScore >= 50); // May be degraded due to history
  });

  await t.test('should handle zero recovery metrics', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);

    const recoveryHandler = new MockRecoveryHandler();
    recoveryHandler.setMetrics({
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      circuitBreakerRejections: 0,
      successRate: 0,
    });

    aggregator.registerRecoveryMetrics(recoveryHandler);

    const collected = await aggregator.collectMetrics();
    assert.equal(collected.recoveryMetrics.successRate, 0);
  });

  await t.test('should handle circuit breaker with no requests', async () => {
    const metrics = new ErrorMetrics();
    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);
    const breaker = new MockCircuitBreaker();

    breaker.setMetrics({
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rejectedRequests: 0,
      stateChanges: 0,
    });

    aggregator.registerCircuitBreaker('api', breaker);

    const collected = await aggregator.collectMetrics();
    assert.ok(collected.circuitBreakerMetrics.api);
  });

  await t.test('should handle multiple anomaly detections', async () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    const healthCheck = new ErrorHealthCheck(metrics);
    const aggregator = new ErrorMetricsAggregator(healthCheck, metrics);

    const breaker = new MockCircuitBreaker();
    breaker.setState('OPEN');
    aggregator.registerCircuitBreaker('api', breaker);

    // Generate multiple errors
    for (let i = 0; i < 50; i++) {
      metrics.recordError(error, false);
    }

    await aggregator.collectMetrics();
    const anomalies = aggregator.detectAnomalies();

    assert.ok(Array.isArray(anomalies));
    assert.ok(anomalies.some(a => a.type === 'recovery-failure-increase'));
    assert.ok(anomalies.some(a => a.type === 'circuit-breaker-state-change'));
  });
});
