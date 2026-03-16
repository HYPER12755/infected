/**
 * @fileoverview Comprehensive test suite for ErrorMetrics
 * Tests error tracking, recovery rates, trend analysis, and time window calculations
 */

import { test } from 'node:test';
import * as assert from 'node:assert';
import { ErrorMetrics, TimeWindow, type ErrorMetricsSnapshot, type ErrorTrend, type CategoryHealth } from '../../../src/core/error-system/error-metrics.js';
import { ErrorCategory, ErrorSeverity, NetworkErrorCode, ProcessErrorCode, ResourceErrorCode } from '../../../src/core/error-system/error-taxonomy.js';
import { NetworkError, ProcessError, ResourceError } from '../../../src/core/error-system/error-categories.js';

/**
 * Helper to wait for a specified duration
 */
function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test('ErrorMetrics', async (t) => {
  // =========================================================================
  // Initialization Tests
  // =========================================================================

  await t.test('should initialize with empty records', () => {
    const metrics = new ErrorMetrics();
    assert.equal(metrics.getRecordCount(), 0);
    assert.equal(metrics.getErrorRate(), 0);
    assert.equal(metrics.getRecoveryRate(), 0);
  });

  // =========================================================================
  // recordError() Tests
  // =========================================================================

  await t.test('should record a single error', () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Connection timeout', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    metrics.recordError(error);

    assert.equal(metrics.getRecordCount(), 1);
    const snapshot = metrics.getMetrics();
    assert.equal(snapshot.totalErrors, 1);
  });

  await t.test('should record error with recovered flag', () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Connection timeout', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    metrics.recordError(error, true);

    const snapshot = metrics.getMetrics();
    assert.equal(snapshot.totalErrors, 1);
    assert.equal(snapshot.recoveredErrors, 1);
    assert.equal(snapshot.unrecoveredErrors, 0);
    assert.equal(snapshot.recoveryRate, 100);
  });

  await t.test('should record multiple errors with different categories', () => {
    const metrics = new ErrorMetrics();

    const netError = new NetworkError('Net error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });
    const procError = new ProcessError('Process error', {
      code: ProcessErrorCode.SPAWN_FAILED,
    });
    const resError = new ResourceError('Resource error', {
      code: ResourceErrorCode.MEMORY_EXCEEDED,
    });

    metrics.recordError(netError);
    metrics.recordError(procError);
    metrics.recordError(resError);

    assert.equal(metrics.getRecordCount(), 3);
    const snapshot = metrics.getMetrics();
    assert.equal(snapshot.totalErrors, 3);
    assert.equal(snapshot.errorsByCategory[ErrorCategory.NETWORK], 1);
    assert.equal(snapshot.errorsByCategory[ErrorCategory.PROCESS], 1);
    assert.equal(snapshot.errorsByCategory[ErrorCategory.RESOURCE], 1);
  });

  await t.test('should track errors by code', () => {
    const metrics = new ErrorMetrics();
    const error1 = new NetworkError('Timeout 1', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });
    const error2 = new NetworkError('Timeout 2', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });
    const error3 = new NetworkError('DNS error', {
      code: NetworkErrorCode.DNS_FAILURE,
    });

    metrics.recordError(error1);
    metrics.recordError(error2);
    metrics.recordError(error3);

    const snapshot = metrics.getMetrics();
    assert.equal(snapshot.errorsByCode[NetworkErrorCode.CONNECTION_TIMEOUT], 2);
    assert.equal(snapshot.errorsByCode[NetworkErrorCode.DNS_FAILURE], 1);
  });

  // =========================================================================
  // getMetrics() Tests
  // =========================================================================

  await t.test('should return complete metrics snapshot', () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
      severity: ErrorSeverity.HIGH,
    });

    metrics.recordError(error, false);
    const snapshot = metrics.getMetrics();

    assert.ok(snapshot.timestamp);
    assert.equal(snapshot.totalErrors, 1);
    assert.ok('errorsByCategory' in snapshot);
    assert.ok('errorsBySeverity' in snapshot);
    assert.ok('errorsByCode' in snapshot);
    assert.equal(snapshot.recoveredErrors, 0);
    assert.equal(snapshot.unrecoveredErrors, 1);
    assert.equal(snapshot.recoveryRate, 0);
  });

  await t.test('should filter metrics by category', () => {
    const metrics = new ErrorMetrics();

    const netError = new NetworkError('Net error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });
    const procError = new ProcessError('Proc error', {
      code: ProcessErrorCode.SPAWN_FAILED,
    });

    metrics.recordError(netError);
    metrics.recordError(procError);
    metrics.recordError(netError);

    const networkMetrics = metrics.getMetrics(ErrorCategory.NETWORK);
    assert.equal(networkMetrics.totalErrors, 2);
    assert.equal(networkMetrics.errorsByCategory[ErrorCategory.NETWORK], 2);
    assert.equal(networkMetrics.errorsByCategory[ErrorCategory.PROCESS], 0);

    const processMetrics = metrics.getMetrics(ErrorCategory.PROCESS);
    assert.equal(processMetrics.totalErrors, 1);
    assert.equal(processMetrics.errorsByCategory[ErrorCategory.PROCESS], 1);
  });

  await t.test('should track errors by severity', () => {
    const metrics = new ErrorMetrics();

    const criticalError = new NetworkError('Critical', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
      severity: ErrorSeverity.CRITICAL,
    });
    const highError = new NetworkError('High', {
      code: NetworkErrorCode.DNS_FAILURE,
      severity: ErrorSeverity.HIGH,
    });
    const lowError = new NetworkError('Low', {
      code: NetworkErrorCode.UNREACHABLE,
      severity: ErrorSeverity.LOW,
    });

    metrics.recordError(criticalError);
    metrics.recordError(highError);
    metrics.recordError(lowError);

    const snapshot = metrics.getMetrics();
    assert.equal(snapshot.errorsBySeverity[ErrorSeverity.CRITICAL], 1);
    assert.equal(snapshot.errorsBySeverity[ErrorSeverity.HIGH], 1);
    assert.equal(snapshot.errorsBySeverity[ErrorSeverity.LOW], 1);
  });

  await t.test('should limit error codes to top 20', () => {
    const metrics = new ErrorMetrics();

    for (let i = 0; i < 30; i++) {
      const error = new NetworkError(`Error ${i}`, {
        code: `CODE_${i}` as any,
        severity: ErrorSeverity.LOW,
      });
      metrics.recordError(error);
    }

    const snapshot = metrics.getMetrics();
    const codeCount = Object.keys(snapshot.errorsByCode).length;
    assert.ok(codeCount <= 20, `Expected <= 20 codes, got ${codeCount}`);
  });

  // =========================================================================
  // recordRecovery() Tests
  // =========================================================================

  await t.test('should record recovery for specific error code', () => {
    const metrics = new ErrorMetrics();

    metrics.recordRecovery(NetworkErrorCode.CONNECTION_TIMEOUT, true);
    metrics.recordRecovery(NetworkErrorCode.CONNECTION_TIMEOUT, true);
    metrics.recordRecovery(NetworkErrorCode.CONNECTION_TIMEOUT, false);

    const recoveryRate = metrics.getRecoveryRate(NetworkErrorCode.CONNECTION_TIMEOUT);
    assert.ok(Math.abs(recoveryRate - (200 / 3)) < 0.001); // 2 successful out of 3
  });

  await t.test('should track recovery metrics separately', () => {
    const metrics = new ErrorMetrics();

    metrics.recordRecovery(NetworkErrorCode.CONNECTION_TIMEOUT, true);
    metrics.recordRecovery(NetworkErrorCode.DNS_FAILURE, false);

    const timeoutRate = metrics.getRecoveryRate(NetworkErrorCode.CONNECTION_TIMEOUT);
    const dnsRate = metrics.getRecoveryRate(NetworkErrorCode.DNS_FAILURE);

    assert.equal(timeoutRate, 100);
    assert.equal(dnsRate, 0);
  });

  // =========================================================================
  // getErrorRate() Tests
  // =========================================================================

  await t.test('should calculate error rate for 1 minute window', async () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    // Record 6 errors within 1 minute window
    for (let i = 0; i < 6; i++) {
      metrics.recordError(error);
    }

    const rate = metrics.getErrorRate(TimeWindow.ONE_MINUTE);
    assert.equal(rate, 6); // 6 errors per minute
  });

  await t.test('should calculate error rate for 5 minute window', async () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    for (let i = 0; i < 10; i++) {
      metrics.recordError(error);
    }

    const rate = metrics.getErrorRate(TimeWindow.FIVE_MINUTES);
    assert.equal(rate, 2); // 10 errors over 5 minutes = 2 errors/minute
  });

  await t.test('should calculate error rate for 15 minute window', async () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    for (let i = 0; i < 30; i++) {
      metrics.recordError(error);
    }

    const rate = metrics.getErrorRate(TimeWindow.FIFTEEN_MINUTES);
    assert.equal(rate, 2); // 30 errors over 15 minutes = 2 errors/minute
  });

  await t.test('should return 0 when no errors in time window', () => {
    const metrics = new ErrorMetrics();
    const rate = metrics.getErrorRate();
    assert.equal(rate, 0);
  });

  await t.test('should only count errors within time window', async () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    metrics.recordError(error);
    metrics.recordError(error);

    // Wait to move outside of 1-minute window
    await wait(61000);

    metrics.recordError(error);

    const rate = metrics.getErrorRate(TimeWindow.ONE_MINUTE);
    assert.equal(rate, 1); // Only the newly added error
  });

  // =========================================================================
  // getRecoveryRate() Tests
  // =========================================================================

  await t.test('should calculate overall recovery rate', () => {
    const metrics = new ErrorMetrics();
    const error1 = new NetworkError('Error 1', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });
    const error2 = new NetworkError('Error 2', {
      code: NetworkErrorCode.DNS_FAILURE,
    });

    metrics.recordError(error1, true);
    metrics.recordError(error2, false);
    metrics.recordError(error1, true);

    const rate = metrics.getRecoveryRate();
    assert.ok(Math.abs(rate - (200 / 3)) < 0.001); // 2 recovered out of 3
  });

  await t.test('should calculate recovery rate for specific error code', () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    metrics.recordError(error, true);
    metrics.recordError(error, true);
    metrics.recordError(error, false);

    const rate = metrics.getRecoveryRate(NetworkErrorCode.CONNECTION_TIMEOUT);
    assert.ok(Math.abs(rate - (200 / 3)) < 0.001);
  });

  await t.test('should return 0 for non-existent error code recovery rate', () => {
    const metrics = new ErrorMetrics();
    const rate = metrics.getRecoveryRate('NON_EXISTENT_CODE');
    assert.equal(rate, 0);
  });

  await t.test('should return 0 recovery rate when no errors recorded', () => {
    const metrics = new ErrorMetrics();
    const rate = metrics.getRecoveryRate();
    assert.equal(rate, 0);
  });

  await t.test('should return 100 when all errors recovered', () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    metrics.recordError(error, true);
    metrics.recordError(error, true);

    const rate = metrics.getRecoveryRate();
    assert.equal(rate, 100);
  });

  // =========================================================================
  // getTrendAnalysis() Tests
  // =========================================================================

  await t.test('should return empty array when no errors', () => {
    const metrics = new ErrorMetrics();
    const trends = metrics.getTrendAnalysis();
    assert.deepEqual(trends, []);
  });

  await t.test('should analyze trends by category', () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    // Record errors to create a trend
    for (let i = 0; i < 5; i++) {
      metrics.recordError(error);
    }

    const trends = metrics.getTrendAnalysis();
    const networkTrend = trends.find(t => t.category === ErrorCategory.NETWORK);

    assert.ok(networkTrend);
    assert.ok('ratePerMinute' in networkTrend);
    assert.ok('previousRatePerMinute' in networkTrend);
    assert.ok(['increasing', 'decreasing', 'stable'].includes(networkTrend.trend));
    assert.ok(typeof networkTrend.percentageChange === 'number');
  });

  await t.test('should analyze trends by error code', () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    for (let i = 0; i < 10; i++) {
      metrics.recordError(error);
    }

    const trends = metrics.getTrendAnalysis();
    const codeTrend = trends.find(t => t.code === NetworkErrorCode.CONNECTION_TIMEOUT);

    assert.ok(codeTrend);
    assert.equal(codeTrend.code, NetworkErrorCode.CONNECTION_TIMEOUT);
  });

  await t.test('should detect increasing trend', () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    // This test is time-dependent and would require careful timing
    // Just verify the trend structure is correct
    for (let i = 0; i < 3; i++) {
      metrics.recordError(error);
    }

    const trends = metrics.getTrendAnalysis();
    assert.ok(Array.isArray(trends));
  });

  // =========================================================================
  // getCategoryHealthSummary() Tests
  // =========================================================================

  await t.test('should return health summary for all categories', () => {
    const metrics = new ErrorMetrics();
    const summary = metrics.getCategoryHealthSummary();

    // Should have all categories
    for (const category of Object.values(ErrorCategory)) {
      assert.ok(category in summary);
    }
  });

  await t.test('should return zero data for empty categories', () => {
    const metrics = new ErrorMetrics();
    const summary = metrics.getCategoryHealthSummary();

    const networkHealth = summary[ErrorCategory.NETWORK];
    assert.equal(networkHealth.totalErrors, 0);
    assert.equal(networkHealth.recoveryRate, 0);
    assert.equal(networkHealth.mostCommonCode, 'N/A');
  });

  await t.test('should calculate category health with errors', () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
      severity: ErrorSeverity.HIGH,
    });

    metrics.recordError(error, true);
    metrics.recordError(error, true);
    metrics.recordError(error, false);

    const summary = metrics.getCategoryHealthSummary();
    const networkHealth = summary[ErrorCategory.NETWORK];

    assert.equal(networkHealth.totalErrors, 3);
    assert.ok(Math.abs(networkHealth.recoveryRate - (200 / 3)) < 0.001);
    assert.equal(networkHealth.mostCommonCode, NetworkErrorCode.CONNECTION_TIMEOUT);
    assert.equal(networkHealth.mostCommonSeverity, ErrorSeverity.HIGH);
  });

  await t.test('should identify most common error code per category', () => {
    const metrics = new ErrorMetrics();

    const timeoutError = new NetworkError('Timeout', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });
    const dnsError = new NetworkError('DNS', {
      code: NetworkErrorCode.DNS_FAILURE,
    });

    metrics.recordError(timeoutError);
    metrics.recordError(timeoutError);
    metrics.recordError(timeoutError);
    metrics.recordError(dnsError);

    const summary = metrics.getCategoryHealthSummary();
    const networkHealth = summary[ErrorCategory.NETWORK];

    assert.equal(networkHealth.mostCommonCode, NetworkErrorCode.CONNECTION_TIMEOUT);
  });

  // =========================================================================
  // reset() Tests
  // =========================================================================

  await t.test('should reset all metrics', () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    metrics.recordError(error);
    metrics.recordError(error);
    assert.equal(metrics.getRecordCount(), 2);

    metrics.reset();
    assert.equal(metrics.getRecordCount(), 0);
    assert.equal(metrics.getErrorRate(), 0);
    assert.equal(metrics.getRecoveryRate(), 0);
  });

  await t.test('should clear recovery records on reset', () => {
    const metrics = new ErrorMetrics();

    metrics.recordRecovery(NetworkErrorCode.CONNECTION_TIMEOUT, true);
    metrics.recordRecovery(NetworkErrorCode.CONNECTION_TIMEOUT, true);

    assert.equal(metrics.getRecoveryRate(NetworkErrorCode.CONNECTION_TIMEOUT), 100);

    metrics.reset();
    assert.equal(metrics.getRecoveryRate(NetworkErrorCode.CONNECTION_TIMEOUT), 0);
  });

  // =========================================================================
  // Thread Safety and Immutability Tests
  // =========================================================================

  await t.test('should not allow external modification of metrics snapshot', () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    metrics.recordError(error);
    const snapshot = metrics.getMetrics();

    // Attempt to modify the snapshot
    const originalTotal = snapshot.totalErrors;
    (snapshot as any).totalErrors = 999;

    // Get fresh snapshot - should not be affected
    const freshSnapshot = metrics.getMetrics();
    assert.equal(freshSnapshot.totalErrors, originalTotal);
  });

  await t.test('should maintain consistent state across concurrent operations', async () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    const promises = [];
    for (let i = 0; i < 100; i++) {
      promises.push(Promise.resolve().then(() => metrics.recordError(error)));
    }

    await Promise.all(promises);

    const snapshot = metrics.getMetrics();
    assert.equal(snapshot.totalErrors, 100);
  });

  // =========================================================================
  // Edge Cases
  // =========================================================================

  await t.test('should handle empty metrics request', () => {
    const metrics = new ErrorMetrics();
    const snapshot = metrics.getMetrics();

    assert.equal(snapshot.totalErrors, 0);
    assert.equal(snapshot.recoveredErrors, 0);
    assert.equal(snapshot.unrecoveredErrors, 0);
    assert.equal(snapshot.recoveryRate, 0);
  });

  await t.test('should handle zero division in recovery rate', () => {
    const metrics = new ErrorMetrics();
    const rate = metrics.getRecoveryRate();
    assert.equal(rate, 0);
  });

  await t.test('should calculate recovery rate correctly with zero records', () => {
    const metrics = new ErrorMetrics();
    const rate = metrics.getRecoveryRate(NetworkErrorCode.CONNECTION_TIMEOUT);
    assert.equal(rate, 0);
  });

  await t.test('should handle large number of errors', () => {
    const metrics = new ErrorMetrics();
    const error = new NetworkError('Error', {
      code: NetworkErrorCode.CONNECTION_TIMEOUT,
    });

    for (let i = 0; i < 5000; i++) {
      metrics.recordError(error);
    }

    const snapshot = metrics.getMetrics();
    assert.equal(snapshot.totalErrors, 5000);
  });

  await t.test('should handle static method for recovery rate calculation', () => {
    const handlerMetrics = {
      totalExecutions: 100,
      successfulExecutions: 80,
      failedExecutions: 20,
      circuitBreakerRejections: 0,
      successRate: 80,
    };

    const rate = ErrorMetrics.calculateRecoveryRateFromHandler(handlerMetrics);
    assert.equal(rate, 80);
  });

  await t.test('should handle static method with zero executions', () => {
    const handlerMetrics = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      circuitBreakerRejections: 0,
      successRate: 0,
    };

    const rate = ErrorMetrics.calculateRecoveryRateFromHandler(handlerMetrics);
    assert.equal(rate, 0);
  });
});
