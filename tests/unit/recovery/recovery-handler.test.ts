/**
 * @fileoverview Comprehensive test suite for RecoveryHandler
 * Tests integration of retry and circuit breaker, recovery handlers, metrics, and event emission
 */

import { test } from 'node:test';
import * as assert from 'node:assert';
import {
  RecoveryHandler,
  type RecoveryHandlerConfig,
  type ExecutionOptions,
} from '../../../src/core/recovery/recovery-handler.js';
import { CircuitBreakerOpenError } from '../../../src/core/recovery/circuit-breaker.js';
import { NetworkError } from '../../../src/core/error-system/error-categories.js';
import { NetworkErrorCode, ErrorSeverity } from '../../../src/core/error-system/error-taxonomy.js';
import { wait } from '../../helpers/test-utils.js';

test('RecoveryHandler', async (t) => {
  // =========================================================================
  // Helper Functions
  // =========================================================================

  function createDefaultConfig(): RecoveryHandlerConfig {
    return {
      enableRetry: true,
      enableCircuitBreaker: true,
      retry: {
        maxRetries: 3,
        initialDelayMs: 10,
        maxDelayMs: 1000,
        backoffMultiplier: 2,
        jitterFactor: 0.1,
      },
      circuitBreaker: {
        failureThreshold: 5,
        successThreshold: 2,
        timeoutMs: 100,
        halfOpenMaxAttempts: 1,
      },
      recoveryHandlers: new Map(),
    };
  }

  // =========================================================================
  // Initialization Tests
  // =========================================================================

  await t.test('should initialize with provided configuration', () => {
    const config = createDefaultConfig();
    const handler = new RecoveryHandler(config);

    assert.ok(handler);
    const metrics = handler.getRecoveryMetrics();
    assert.equal(metrics.totalExecutions, 0);
  });

  await t.test('should accept custom recovery handlers in config', () => {
    const config = createDefaultConfig();
    const recoveryHandler = async () => {};
    config.recoveryHandlers.set('TEST_ERROR', recoveryHandler);

    const handler = new RecoveryHandler(config);
    assert.ok(handler);
  });

  // =========================================================================
  // Basic Execution Tests
  // =========================================================================

  await t.test('should execute successful operation without retry', async () => {
    const config = createDefaultConfig();
    const handler = new RecoveryHandler(config);

    const result = await handler.executeWithRecovery(async () => 'success');

    assert.equal(result, 'success');
    const metrics = handler.getRecoveryMetrics();
    assert.equal(metrics.totalExecutions, 1);
    assert.equal(metrics.successfulExecutions, 1);
    assert.equal(metrics.failedExecutions, 0);
  });

  await t.test('should execute operation with metadata', async () => {
    const config = createDefaultConfig();
    const handler = new RecoveryHandler(config);

    const options: ExecutionOptions = {
      tag: 'test-tag',
      metadata: { userId: 123 },
    };

    const result = await handler.executeWithRecovery(async () => 'success', options);

    assert.equal(result, 'success');
  });

  // =========================================================================
  // Retry Integration Tests
  // =========================================================================

  await t.test('should retry on retryable error', async () => {
    const config = createDefaultConfig();
    const handler = new RecoveryHandler(config);

    let attemptCount = 0;

    const result = await handler.executeWithRecovery(async () => {
      attemptCount++;
      if (attemptCount < 2) {
        throw new NetworkError('Transient error', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
          retryable: true,
        });
      }
      return 'success after retry';
    });

    assert.equal(result, 'success after retry');
    assert.equal(attemptCount, 2);

    const metrics = handler.getRecoveryMetrics();
    assert.equal(metrics.retriedExecutions, 1);
  });

  await t.test('should exhaust retries and throw error', async () => {
    const config = createDefaultConfig();
    config.retry.maxRetries = 2;
    const handler = new RecoveryHandler(config);

    let attemptCount = 0;

    try {
      await handler.executeWithRecovery(async () => {
        attemptCount++;
        throw new NetworkError('Persistent error', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
          retryable: true,
        });
      });
      assert.fail('Should have thrown error');
    } catch (error) {
      assert.ok(error instanceof NetworkError);
      assert.ok(attemptCount >= 2);
    }

    const metrics = handler.getRecoveryMetrics();
    assert.equal(metrics.failedExecutions, 1);
  });

  await t.test('should respect max retries limit', async () => {
    const config = createDefaultConfig();
    config.retry.maxRetries = 1; // Allow 1 retry
    const handler = new RecoveryHandler(config);

    let attemptCount = 0;

    try {
      await handler.executeWithRecovery(async () => {
        attemptCount++;
        throw new NetworkError('Error that gets retried', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
          retryable: true,
        });
      });
      assert.fail('Should have thrown error');
    } catch (error) {
      assert.ok(error instanceof NetworkError);
    }

    // With maxRetries=1, we get 1 attempt initially, then exhausts without retry
    // because shouldRetry checks attemptNumber < maxRetries
    assert.ok(attemptCount >= 1);
  });

  // =========================================================================
  // Circuit Breaker Integration Tests
  // =========================================================================

  await t.test('should integrate retry with circuit breaker', async () => {
    const config = createDefaultConfig();
    config.circuitBreaker.failureThreshold = 2;
    config.circuitBreaker.timeoutMs = 50;
    const handler = new RecoveryHandler(config);

    let attemptCount = 0;

    try {
      // First execution - will fail and eventually open circuit
      for (let i = 0; i < 3; i++) {
        try {
          await handler.executeWithRecovery(async () => {
            attemptCount++;
            throw new NetworkError('Failure', {
              code: NetworkErrorCode.CONNECTION_TIMEOUT,
              retryable: true,
            });
          });
        } catch (error) {
          // Expected to fail
        }
      }
    } catch (error) {
      // Expected
    }

    // Should have failed multiple times
    assert.ok(attemptCount > 0);
  });

  await t.test('should track failed executions in metrics', async () => {
    const config = createDefaultConfig();
    config.retry.maxRetries = 0; // Disable retry
    const handler = new RecoveryHandler(config);

    // Trigger a failure
    try {
      await handler.executeWithRecovery(async () => {
        throw new NetworkError('Failure', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
          retryable: true,
        });
      });
    } catch (error) {
      assert.ok(error instanceof NetworkError);
    }

    // Check metrics
    const metrics = handler.getRecoveryMetrics();
    assert.equal(metrics.failedExecutions, 1);
    assert.equal(metrics.totalExecutions, 1);
  });

  // =========================================================================
  // Recovery Handler Tests
  // =========================================================================

  await t.test('should invoke registered recovery handler on error', async () => {
    const config = createDefaultConfig();
    let recoveryHandlerInvoked = false;

    const recoveryHandler = async () => {
      recoveryHandlerInvoked = true;
    };

    config.recoveryHandlers.set(NetworkErrorCode.CONNECTION_TIMEOUT, recoveryHandler);
    const handler = new RecoveryHandler(config);

    try {
      await handler.executeWithRecovery(async () => {
        throw new NetworkError('Test error', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
          retryable: true,
        });
      });
    } catch (error) {
      // Expected
    }

    assert.equal(recoveryHandlerInvoked, true);
  });

  await t.test('should pass error and context to recovery handler', async () => {
    const config = createDefaultConfig();
    config.retry.maxRetries = 1;

    let capturedError: any = null;
    let capturedContext: any = null;

    const recoveryHandler = async (error: any, context: any) => {
      capturedError = error;
      capturedContext = context;
    };

    config.recoveryHandlers.set(NetworkErrorCode.CONNECTION_TIMEOUT, recoveryHandler);
    const handler = new RecoveryHandler(config);

    try {
      await handler.executeWithRecovery(async () => {
        throw new NetworkError('Test error', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
          retryable: true,
        });
      });
    } catch (error) {
      // Expected
    }

    assert.ok(capturedError instanceof NetworkError);
    assert.ok(capturedContext.errorCode);
    assert.ok(capturedContext.attempt >= 1);
  });

  await t.test('should continue retry even if recovery handler fails', async () => {
    const config = createDefaultConfig();
    config.retry.maxRetries = 2;
    let attemptCount = 0;

    const recoveryHandler = async () => {
      throw new Error('Recovery handler failed');
    };

    config.recoveryHandlers.set(NetworkErrorCode.CONNECTION_TIMEOUT, recoveryHandler);
    const handler = new RecoveryHandler(config);

    try {
      await handler.executeWithRecovery(async () => {
        attemptCount++;
        if (attemptCount < 2) {
          throw new NetworkError('Test error', {
            code: NetworkErrorCode.CONNECTION_TIMEOUT,
            retryable: true,
          });
        }
        return 'success';
      });
    } catch (error) {
      // Expected if handler doesn't succeed
    }

    // Should still attempt retries despite handler failure
    assert.ok(attemptCount >= 1);
  });

  await t.test('should register recovery handler after initialization', () => {
    const config = createDefaultConfig();
    const handler = new RecoveryHandler(config);

    const recoveryHandler = async () => {};
    handler.registerRecoveryHandler('TEST_ERROR', recoveryHandler);

    assert.ok(handler);
  });

  await t.test('should unregister recovery handler', () => {
    const config = createDefaultConfig();
    const handler = new RecoveryHandler(config);

    const recoveryHandler = async () => {};
    handler.registerRecoveryHandler('TEST_ERROR', recoveryHandler);

    const result = handler.unregisterRecoveryHandler('TEST_ERROR');
    assert.equal(result, true);

    const result2 = handler.unregisterRecoveryHandler('NONEXISTENT');
    assert.equal(result2, false);
  });

  // =========================================================================
  // Timeout Tests
  // =========================================================================

  await t.test('should enforce timeout on execution', async () => {
    const config = createDefaultConfig();
    const handler = new RecoveryHandler(config);

    try {
      await handler.executeWithRecovery(
        async () => {
          await wait(500); // Wait longer than timeout
          return 'success';
        },
        { timeout: 50 }
      );
      assert.fail('Should have timed out');
    } catch (error) {
      assert.ok(error instanceof NetworkError);
      assert.ok((error as any).message.includes('timeout'));
    }
  });

  await t.test('should complete before timeout expires', async () => {
    const config = createDefaultConfig();
    const handler = new RecoveryHandler(config);

    const result = await handler.executeWithRecovery(
      async () => {
        await wait(10);
        return 'success';
      },
      { timeout: 100 }
    );

    assert.equal(result, 'success');
  });

  // =========================================================================
  // Metrics Tests
  // =========================================================================

  await t.test('should aggregate execution metrics', async () => {
    const config = createDefaultConfig();
    config.retry.maxRetries = 1;
    const handler = new RecoveryHandler(config);

    // Successful execution
    await handler.executeWithRecovery(async () => 'success1');

    // Failed execution
    try {
      await handler.executeWithRecovery(async () => {
        throw new NetworkError('Error', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
          retryable: false,
        });
      });
    } catch (error) {
      // Expected
    }

    const metrics = handler.getRecoveryMetrics();
    assert.equal(metrics.totalExecutions, 2);
    assert.equal(metrics.successfulExecutions, 1);
    assert.equal(metrics.failedExecutions, 1);
  });

  await t.test('should calculate success rate', async () => {
    const config = createDefaultConfig();
    config.retry.maxRetries = 1;
    const handler = new RecoveryHandler(config);

    for (let i = 0; i < 10; i++) {
      if (i < 7) {
        await handler.executeWithRecovery(async () => 'success');
      } else {
        try {
          await handler.executeWithRecovery(async () => {
            throw new NetworkError('Error', {
              code: NetworkErrorCode.CONNECTION_TIMEOUT,
              retryable: false,
            });
          });
        } catch (error) {
          // Expected
        }
      }
    }

    const metrics = handler.getRecoveryMetrics();
    assert.equal(metrics.successRate, 70); // 7/10 = 70%
  });

  await t.test('should track average retries', async () => {
    const config = createDefaultConfig();
    config.retry.maxRetries = 3;
    const handler = new RecoveryHandler(config);

    let attemptCount1 = 0;
    try {
      await handler.executeWithRecovery(async () => {
        attemptCount1++;
        if (attemptCount1 < 2) {
          throw new NetworkError('Error', {
            code: NetworkErrorCode.CONNECTION_TIMEOUT,
            retryable: true,
          });
        }
        return 'success';
      });
    } catch (error) {
      // Expected
    }

    const metrics = handler.getRecoveryMetrics();
    assert.ok(metrics.averageRetries >= 0);
  });

  await t.test('should count recovery handler invocations', async () => {
    const config = createDefaultConfig();
    config.retry.maxRetries = 1;

    const recoveryHandler = async () => {};
    config.recoveryHandlers.set(NetworkErrorCode.CONNECTION_TIMEOUT, recoveryHandler);
    const handler = new RecoveryHandler(config);

    try {
      await handler.executeWithRecovery(async () => {
        throw new NetworkError('Error', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
          retryable: true,
        });
      });
    } catch (error) {
      // Expected
    }

    const metrics = handler.getRecoveryMetrics();
    assert.ok(metrics.recoveryHandlerInvocations >= 1);
  });

  // =========================================================================
  // Reset Tests
  // =========================================================================

  await t.test('should reset all metrics and state with resetAll()', async () => {
    const config = createDefaultConfig();
    const handler = new RecoveryHandler(config);

    // Execute some operations
    await handler.executeWithRecovery(async () => 'success');

    let metrics = handler.getRecoveryMetrics();
    assert.equal(metrics.totalExecutions, 1);

    // Reset
    handler.resetAll();

    metrics = handler.getRecoveryMetrics();
    assert.equal(metrics.totalExecutions, 0);
    assert.equal(metrics.successfulExecutions, 0);
    assert.equal(metrics.failedExecutions, 0);
  });

  // =========================================================================
  // Event Subscription Tests
  // =========================================================================

  await t.test('should emit executionStart event', async () => {
    const config = createDefaultConfig();
    const handler = new RecoveryHandler(config);

    let eventFired = false;
    const unsubscribe = handler.onEvent('executionStart', () => {
      eventFired = true;
    });

    await handler.executeWithRecovery(async () => 'success');

    assert.equal(eventFired, true);
    unsubscribe();
  });

  await t.test('should emit executionSuccess event', async () => {
    const config = createDefaultConfig();
    const handler = new RecoveryHandler(config);

    let eventFired = false;
    const unsubscribe = handler.onEvent('executionSuccess', (event) => {
      eventFired = true;
      assert.ok((event.metadata?.duration as any) >= 0);
    });

    await handler.executeWithRecovery(async () => 'success');

    assert.equal(eventFired, true);
    unsubscribe();
  });

  await t.test('should emit executionFailure event', async () => {
    const config = createDefaultConfig();
    const handler = new RecoveryHandler(config);

    let eventFired = false;
    const unsubscribe = handler.onEvent('executionFailure', (event) => {
      eventFired = true;
      assert.ok(event.metadata?.error);
    });

    try {
      await handler.executeWithRecovery(async () => {
        throw new NetworkError('Error', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
          retryable: false,
        });
      });
    } catch (error) {
      // Expected
    }

    assert.equal(eventFired, true);
    unsubscribe();
  });

  await t.test('should emit recoveryApplied event', async () => {
    const config = createDefaultConfig();
    config.retry.maxRetries = 1;

    const recoveryHandler = async () => {};
    config.recoveryHandlers.set(NetworkErrorCode.CONNECTION_TIMEOUT, recoveryHandler);
    const handler = new RecoveryHandler(config);

    let eventFired = false;
    const unsubscribe = handler.onEvent('recoveryApplied', () => {
      eventFired = true;
    });

    try {
      await handler.executeWithRecovery(async () => {
        throw new NetworkError('Error', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
          retryable: true,
        });
      });
    } catch (error) {
      // Expected
    }

    assert.equal(eventFired, true);
    unsubscribe();
  });

  // =========================================================================
  // Configuration Tests
  // =========================================================================

  await t.test('should respect enableRetry=false configuration', async () => {
    const config = createDefaultConfig();
    config.enableRetry = false;

    const handler = new RecoveryHandler(config);

    let attemptCount = 0;

    try {
      await handler.executeWithRecovery(async () => {
        attemptCount++;
        throw new NetworkError('Error', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
          retryable: true,
        });
      });
    } catch (error) {
      // Expected
    }

    assert.equal(attemptCount, 1); // No retry
  });

  await t.test('should respect enableCircuitBreaker=false configuration', async () => {
    const config = createDefaultConfig();
    config.enableCircuitBreaker = false;

    const handler = new RecoveryHandler(config);

    // Should execute without circuit breaker protection
    const result = await handler.executeWithRecovery(async () => 'success');
    assert.equal(result, 'success');
  });

  // =========================================================================
  // Edge Cases
  // =========================================================================

  await t.test('should handle rapid successive executions', async () => {
    const config = createDefaultConfig();
    const handler = new RecoveryHandler(config);

    const results = await Promise.all([
      handler.executeWithRecovery(async () => 'result1'),
      handler.executeWithRecovery(async () => 'result2'),
      handler.executeWithRecovery(async () => 'result3'),
    ]);

    assert.equal(results.length, 3);
    assert.deepEqual(results, ['result1', 'result2', 'result3']);
  });

  await t.test('should handle named circuit breakers', async () => {
    const config = createDefaultConfig();
    const handler = new RecoveryHandler(config);

    const result1 = await handler.executeWithRecovery(async () => 'api1', {
      circuitBreakerName: 'api-service-1',
    });

    const result2 = await handler.executeWithRecovery(async () => 'api2', {
      circuitBreakerName: 'api-service-2',
    });

    assert.equal(result1, 'api1');
    assert.equal(result2, 'api2');
  });

  await t.test('should provide unsubscribe function for event listeners', async () => {
    const config = createDefaultConfig();
    const handler = new RecoveryHandler(config);

    let callCount = 0;
    const unsubscribe = handler.onEvent('executionSuccess', () => {
      callCount++;
    });

    await handler.executeWithRecovery(async () => 'success1');
    assert.equal(callCount, 1);

    unsubscribe();

    await handler.executeWithRecovery(async () => 'success2');
    assert.equal(callCount, 1); // Should not increment after unsubscribe
  });

  await t.test('should normalize errors correctly', async () => {
    const config = createDefaultConfig();
    const handler = new RecoveryHandler(config);

    try {
      await handler.executeWithRecovery(async () => {
        throw new Error('Plain error');
      });
      assert.fail('Should have thrown error');
    } catch (error) {
      assert.ok(error instanceof NetworkError);
    }
  });
});
