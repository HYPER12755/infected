/**
 * @fileoverview Comprehensive test suite for CircuitBreaker
 * Tests state machine transitions, failure/success tracking, event emission, and metrics
 */

import { test } from 'node:test';
import * as assert from 'node:assert';
import {
  CircuitBreaker,
  CircuitState,
  CircuitBreakerOpenError,
  CircuitBreakerEventType,
} from '../../../src/core/recovery/circuit-breaker.js';
import { NetworkError } from '../../../src/core/error-system/error-categories.js';
import { NetworkErrorCode, ErrorSeverity } from '../../../src/core/error-system/error-taxonomy.js';
import { wait } from '../../helpers/test-utils.js';

test('CircuitBreaker', async (t) => {
  // =========================================================================
  // Initialization Tests
  // =========================================================================

  await t.test('should initialize in CLOSED state', () => {
    const breaker = new CircuitBreaker();
    assert.equal(breaker.getState(), CircuitState.CLOSED);
  });

  await t.test('should initialize with default configuration', () => {
    const breaker = new CircuitBreaker();
    const metrics = breaker.getMetrics();

    assert.equal(metrics.totalRequests, 0);
    assert.equal(metrics.successfulRequests, 0);
    assert.equal(metrics.failedRequests, 0);
    assert.equal(metrics.rejectedRequests, 0);
    assert.equal(metrics.stateChanges, 0); // No state changes on initialization
  });

  await t.test('should accept custom configuration', () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 10,
      successThreshold: 5,
      timeout: 30000,
      windowSize: 30000,
    });

    assert.equal(breaker.getState(), CircuitState.CLOSED);
  });

  // =========================================================================
  // State Machine Tests: CLOSED → OPEN
  // =========================================================================

  await t.test('should transition from CLOSED to OPEN on failure threshold exceeded', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      timeout: 100,
    });

    let stateChangeCount = 0;
    breaker.on((eventType, state) => {
      if (eventType === CircuitBreakerEventType.STATE_CHANGE) {
        stateChangeCount++;
      }
    });

    // Trigger 3 failures
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(async () => {
          throw new NetworkError('Fail', {
            code: NetworkErrorCode.CONNECTION_TIMEOUT,
          });
        });
      } catch (error) {
        // Expected
      }
    }

    assert.equal(breaker.getState(), CircuitState.OPEN);
    assert.ok(stateChangeCount > 0); // Should have transitioned
  });

  await t.test('should reject requests when OPEN', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      timeout: 100,
    });

    // Trigger failure
    try {
      await breaker.execute(async () => {
        throw new NetworkError('Fail', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
        });
      });
    } catch (error) {
      // Expected
    }

    assert.equal(breaker.getState(), CircuitState.OPEN);

    // Try to execute while open
    try {
      await breaker.execute(async () => 'success');
      assert.fail('Should have thrown CircuitBreakerOpenError');
    } catch (error) {
      assert.ok(error instanceof CircuitBreakerOpenError);
    }
  });

  // =========================================================================
  // State Machine Tests: OPEN → HALF_OPEN
  // =========================================================================

  await t.test('should transition from OPEN to HALF_OPEN after timeout', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      timeout: 50, // Short timeout for testing
      successThreshold: 1,
    });

    // Open the circuit
    try {
      await breaker.execute(async () => {
        throw new NetworkError('Fail', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
        });
      });
    } catch (error) {
      // Expected
    }

    assert.equal(breaker.getState(), CircuitState.OPEN);

    // Wait for timeout to expire
    await wait(100);

    // Check state (should transition to HALF_OPEN on next attempt)
    assert.equal(breaker.getState(), CircuitState.HALF_OPEN);
  });

  await t.test('should return getRemainingTimeout when OPEN', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      timeout: 1000,
    });

    // Open the circuit
    try {
      await breaker.execute(async () => {
        throw new NetworkError('Fail', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
        });
      });
    } catch (error) {
      // Expected
    }

    const remaining = breaker.getRemainingTimeout();
    assert.ok(remaining > 0);
    assert.ok(remaining <= 1000);
  });

  // =========================================================================
  // State Machine Tests: HALF_OPEN → CLOSED
  // =========================================================================

  await t.test('should transition from HALF_OPEN to CLOSED on success threshold', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      successThreshold: 2,
      timeout: 50,
    });

    // Open the circuit
    try {
      await breaker.execute(async () => {
        throw new NetworkError('Fail', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
        });
      });
    } catch (error) {
      // Expected
    }

    assert.equal(breaker.getState(), CircuitState.OPEN);

    // Wait for timeout
    await wait(100);

    // Should be in HALF_OPEN now
    assert.equal(breaker.getState(), CircuitState.HALF_OPEN);

    // Execute 2 successful operations
    await breaker.execute(async () => 'success1');
    await breaker.execute(async () => 'success2');

    assert.equal(breaker.getState(), CircuitState.CLOSED);
  });

  // =========================================================================
  // State Machine Tests: HALF_OPEN → OPEN
  // =========================================================================

  await t.test('should transition from HALF_OPEN back to OPEN on failure', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      successThreshold: 2,
      timeout: 50,
    });

    // Open the circuit
    try {
      await breaker.execute(async () => {
        throw new NetworkError('Fail', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
        });
      });
    } catch (error) {
      // Expected
    }

    assert.equal(breaker.getState(), CircuitState.OPEN);

    // Wait for timeout
    await wait(100);

    // Should be in HALF_OPEN now
    assert.equal(breaker.getState(), CircuitState.HALF_OPEN);

    // Execute a failing operation
    try {
      await breaker.execute(async () => {
        throw new NetworkError('Fail', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
        });
      });
    } catch (error) {
      // Expected
    }

    assert.equal(breaker.getState(), CircuitState.OPEN);
  });

  // =========================================================================
  // Failure Tracking and Rolling Window Tests
  // =========================================================================

  await t.test('should track failures within time window', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      windowSize: 100, // 100ms window
      timeout: 50,
    });

    // Trigger first failure
    try {
      await breaker.execute(async () => {
        throw new NetworkError('Fail1', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
        });
      });
    } catch (error) {
      // Expected
    }

    let metrics = breaker.getMetrics();
    assert.equal(metrics.currentFailureCount, 1);

    // Wait for window to expire
    await wait(150);

    // Trigger another failure after window expired
    try {
      await breaker.execute(async () => {
        throw new NetworkError('Fail2', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
        });
      });
    } catch (error) {
      // Expected
    }

    // Old failure should be cleaned up, only new one counted
    metrics = breaker.getMetrics();
    assert.equal(metrics.currentFailureCount, 1);
  });

  await t.test('should clean up old failures outside window', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 5,
      windowSize: 50, // Short window
      timeout: 200,
    });

    // Trigger 2 failures
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(async () => {
          throw new NetworkError(`Fail${i}`, {
            code: NetworkErrorCode.CONNECTION_TIMEOUT,
          });
        });
      } catch (error) {
        // Expected
      }
    }

    let metrics = breaker.getMetrics();
    assert.equal(metrics.currentFailureCount, 2);

    // Wait for window to expire
    await wait(100);

    // Trigger another failure after window expired to trigger cleanup
    try {
      await breaker.execute(async () => {
        throw new NetworkError('NewFail', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
        });
      });
    } catch (error) {
      // Expected
    }

    metrics = breaker.getMetrics();
    // After cleanup, should have only 1 failure (the new one)
    assert.equal(metrics.currentFailureCount, 1);
  });

  // =========================================================================
  // Metrics Tests
  // =========================================================================

  await t.test('should track totalRequests metric', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 5,
    });

    // Execute 3 requests
    for (let i = 0; i < 3; i++) {
      await breaker.execute(async () => 'success');
    }

    const metrics = breaker.getMetrics();
    assert.equal(metrics.totalRequests, 3);
  });

  await t.test('should track successfulRequests metric', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 5,
    });

    for (let i = 0; i < 5; i++) {
      await breaker.execute(async () => 'success');
    }

    const metrics = breaker.getMetrics();
    assert.equal(metrics.successfulRequests, 5);
  });

  await t.test('should track failedRequests metric', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 5,
    });

    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(async () => {
          throw new NetworkError('Fail', {
            code: NetworkErrorCode.CONNECTION_TIMEOUT,
          });
        });
      } catch (error) {
        // Expected
      }
    }

    const metrics = breaker.getMetrics();
    assert.equal(metrics.failedRequests, 3);
  });

  await t.test('should track rejectedRequests metric when OPEN', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      timeout: 100,
    });

    // Open the circuit
    try {
      await breaker.execute(async () => {
        throw new NetworkError('Fail', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
        });
      });
    } catch (error) {
      // Expected
    }

    assert.equal(breaker.getState(), CircuitState.OPEN);

    // Attempt to execute (should be rejected)
    try {
      await breaker.execute(async () => 'success');
    } catch (error) {
      // Expected
    }

    const metrics = breaker.getMetrics();
    assert.equal(metrics.rejectedRequests, 1);
  });

  await t.test('should track stateChanges metric', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      successThreshold: 1,
      timeout: 50,
    });

    let initialStateChanges = breaker.getMetrics().stateChanges;

    // Open circuit
    try {
      await breaker.execute(async () => {
        throw new NetworkError('Fail', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
        });
      });
    } catch (error) {
      // Expected
    }

    let stateChanges = breaker.getMetrics().stateChanges;
    assert.ok(stateChanges > initialStateChanges);

    // Wait and recover
    await wait(100);
    await breaker.execute(async () => 'success');

    stateChanges = breaker.getMetrics().stateChanges;
    assert.ok(stateChanges > initialStateChanges);
  });

  await t.test('should track lastFailureTime and lastErrorCode', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 5,
    });

    try {
      await breaker.execute(async () => {
        throw new NetworkError('Fail', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
        });
      });
    } catch (error) {
      // Expected
    }

    const metrics = breaker.getMetrics();
    assert.ok(metrics.lastFailureTime > 0);
    assert.equal(metrics.lastErrorCode, NetworkErrorCode.CONNECTION_TIMEOUT);
  });

  await t.test('should calculate success rate percentage', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 10,
    });

    // 7 successes, 3 failures
    for (let i = 0; i < 7; i++) {
      await breaker.execute(async () => 'success');
    }

    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(async () => {
          throw new NetworkError('Fail', {
            code: NetworkErrorCode.CONNECTION_TIMEOUT,
          });
        });
      } catch (error) {
        // Expected
      }
    }

    const successRate = breaker.getSuccessRate();
    assert.equal(successRate, 70); // 7/10 = 70%
  });

  await t.test('should calculate failure rate percentage', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 10,
    });

    // 7 successes, 3 failures
    for (let i = 0; i < 7; i++) {
      await breaker.execute(async () => 'success');
    }

    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(async () => {
          throw new NetworkError('Fail', {
            code: NetworkErrorCode.CONNECTION_TIMEOUT,
          });
        });
      } catch (error) {
        // Expected
      }
    }

    const failureRate = breaker.getFailureRate();
    assert.equal(failureRate, 30); // 3/10 = 30%
  });

  await t.test('should calculate rejection rate percentage', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      timeout: 100,
    });

    // Open circuit with 1 failure
    try {
      await breaker.execute(async () => {
        throw new NetworkError('Fail', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
        });
      });
    } catch (error) {
      // Expected
    }

    // Try 3 times while open
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(async () => 'success');
      } catch (error) {
        // Expected
      }
    }

    const rejectionRate = breaker.getRejectionRate();
    assert.equal(rejectionRate, 75); // 3/4 = 75%
  });

  // =========================================================================
  // Event Emission Tests
  // =========================================================================

  await t.test('should emit stateChange event on transition', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      timeout: 50,
    });

    let stateChangeEvents: any[] = [];

    breaker.on((eventType, state, details) => {
      if (eventType === CircuitBreakerEventType.STATE_CHANGE) {
        stateChangeEvents.push({ state, details });
      }
    });

    // Trigger failure to open circuit
    try {
      await breaker.execute(async () => {
        throw new NetworkError('Fail', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
        });
      });
    } catch (error) {
      // Expected
    }

    assert.ok(stateChangeEvents.length > 0);
  });

  await t.test('should emit requestRejected event when OPEN', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      timeout: 100,
    });

    // Open circuit
    try {
      await breaker.execute(async () => {
        throw new NetworkError('Fail', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
        });
      });
    } catch (error) {
      // Expected
    }

    let rejectionEvent: any = null;

    breaker.on((eventType, state, details) => {
      if (eventType === CircuitBreakerEventType.REQUEST_REJECTED) {
        rejectionEvent = { state, details };
      }
    });

    try {
      await breaker.execute(async () => 'success');
    } catch (error) {
      // Expected
    }

    assert.ok(rejectionEvent !== null);
  });

  await t.test('should emit executionSuccess event', async () => {
    const breaker = new CircuitBreaker();

    let successEvent: any = null;

    breaker.on((eventType, state, details) => {
      if (eventType === CircuitBreakerEventType.EXECUTION_SUCCESS) {
        successEvent = { state, details };
      }
    });

    await breaker.execute(async () => 'success');

    assert.ok(successEvent !== null);
  });

  await t.test('should emit executionFailure event', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 5,
    });

    let failureEvent: any = null;

    breaker.on((eventType, state, details) => {
      if (eventType === CircuitBreakerEventType.EXECUTION_FAILURE) {
        failureEvent = { state, details };
      }
    });

    try {
      await breaker.execute(async () => {
        throw new NetworkError('Fail', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
        });
      });
    } catch (error) {
      // Expected
    }

    assert.ok(failureEvent !== null);
  });

  await t.test('should allow removing event handlers', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 5,
    });

    let eventsFired = 0;

    const handler = () => {
      eventsFired++;
    };

    breaker.on(handler);
    breaker.off(handler);

    await breaker.execute(async () => 'success');

    assert.equal(eventsFired, 0);
  });

  // =========================================================================
  // Manual Control Tests
  // =========================================================================

  await t.test('should reset circuit with reset() method', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
    });

    // Open circuit
    try {
      await breaker.execute(async () => {
        throw new NetworkError('Fail', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
        });
      });
    } catch (error) {
      // Expected
    }

    assert.equal(breaker.getState(), CircuitState.OPEN);

    // Reset
    breaker.reset();

    assert.equal(breaker.getState(), CircuitState.CLOSED);
    const metrics = breaker.getMetrics();
    assert.equal(metrics.totalRequests, 0);
    assert.equal(metrics.failedRequests, 0);
  });

  await t.test('should force open with forceOpen() method', () => {
    const breaker = new CircuitBreaker();

    assert.equal(breaker.getState(), CircuitState.CLOSED);

    breaker.forceOpen();

    assert.equal(breaker.getState(), CircuitState.OPEN);
  });

  // =========================================================================
  // Error Type Tracking Tests
  // =========================================================================

  await t.test('should track error types when enabled', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 5,
      monitorErrorType: true,
    });

    try {
      await breaker.execute(async () => {
        throw new NetworkError('Network error', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
        });
      });
    } catch (error) {
      // Expected
    }

    const metrics = breaker.getMetrics();
    assert.ok(metrics.lastErrorCode);
  });

  await t.test('should not track error types when disabled', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 5,
      monitorErrorType: false,
    });

    try {
      await breaker.execute(async () => {
        throw new NetworkError('Network error', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
        });
      });
    } catch (error) {
      // Expected
    }

    const metrics = breaker.getMetrics();
    assert.ok(metrics); // Should still work
  });

  // =========================================================================
  // Edge Case Tests
  // =========================================================================

  await t.test('should handle success rate with zero requests', () => {
    const breaker = new CircuitBreaker();

    const successRate = breaker.getSuccessRate();
    assert.equal(successRate, 0);
  });

  await t.test('should handle failure rate with zero requests', () => {
    const breaker = new CircuitBreaker();

    const failureRate = breaker.getFailureRate();
    assert.equal(failureRate, 0);
  });

  await t.test('should handle rejection rate with zero requests', () => {
    const breaker = new CircuitBreaker();

    const rejectionRate = breaker.getRejectionRate();
    assert.equal(rejectionRate, 0);
  });

  await t.test('should return 0 timeout when not OPEN', () => {
    const breaker = new CircuitBreaker({
      timeout: 1000,
    });

    const remaining = breaker.getRemainingTimeout();
    assert.equal(remaining, 0);
  });

  await t.test('should handle rapid state transitions', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      successThreshold: 1,
      timeout: 50,
    });

    // Rapidly open and close
    try {
      await breaker.execute(async () => {
        throw new NetworkError('Fail', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
        });
      });
    } catch (error) {
      // Expected
    }

    assert.equal(breaker.getState(), CircuitState.OPEN);

    await wait(100);

    assert.equal(breaker.getState(), CircuitState.HALF_OPEN);

    await breaker.execute(async () => 'success');

    assert.equal(breaker.getState(), CircuitState.CLOSED);
  });
});
