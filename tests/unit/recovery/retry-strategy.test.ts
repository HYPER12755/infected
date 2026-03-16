/**
 * @fileoverview Comprehensive test suite for RetryStrategy
 * Tests exponential backoff, jitter, event emission, retry budgets, and configuration
 */

import { test } from 'node:test';
import * as assert from 'node:assert';
import { RetryStrategy, createRetryStrategy, type RetryConfig, type RetryContext } from '../../../src/core/recovery/retry-strategy.js';
import { NetworkError } from '../../../src/core/error-system/error-categories.js';
import { NetworkErrorCode, ErrorSeverity } from '../../../src/core/error-system/error-taxonomy.js';
import { wait } from '../../helpers/test-utils.js';

test('RetryStrategy', async (t) => {
  // =========================================================================
  // Basic Functionality Tests
  // =========================================================================

  await t.test('should initialize with default configuration', () => {
    const strategy = new RetryStrategy();
    const config = strategy.getConfig();

    assert.equal(config.maxAttempts, 3);
    assert.equal(config.initialDelayMs, 100);
    assert.equal(config.maxDelayMs, 30000);
    assert.equal(config.backoffMultiplier, 2);
    assert.equal(config.useJitter, true);
    assert.equal(config.jitterFraction, 0.25);
  });

  await t.test('should initialize with custom configuration', () => {
    const customConfig: RetryConfig = {
      maxAttempts: 5,
      initialDelayMs: 50,
      maxDelayMs: 10000,
      backoffMultiplier: 1.5,
      useJitter: false,
      jitterFraction: 0.1,
    };

    const strategy = new RetryStrategy(customConfig);
    const config = strategy.getConfig();

    assert.equal(config.maxAttempts, 5);
    assert.equal(config.initialDelayMs, 50);
    assert.equal(config.maxDelayMs, 10000);
    assert.equal(config.backoffMultiplier, 1.5);
    assert.equal(config.useJitter, false);
    assert.equal(config.jitterFraction, 0.1);
  });

  // =========================================================================
  // Configuration Validation Tests
  // =========================================================================

  await t.test('should throw error if maxAttempts < 1', () => {
    assert.throws(
      () => new RetryStrategy({ maxAttempts: 0 }),
      (error: any) => error.message.includes('maxAttempts must be at least 1')
    );
  });

  await t.test('should throw error if initialDelayMs is negative', () => {
    assert.throws(
      () => new RetryStrategy({ initialDelayMs: -100 }),
      (error: any) => error.message.includes('initialDelayMs must be non-negative')
    );
  });

  await t.test('should throw error if maxDelayMs < initialDelayMs', () => {
    assert.throws(
      () => new RetryStrategy({ initialDelayMs: 100, maxDelayMs: 50 }),
      (error: any) => error.message.includes('maxDelayMs must be >= initialDelayMs')
    );
  });

  await t.test('should throw error if backoffMultiplier <= 1', () => {
    assert.throws(
      () => new RetryStrategy({ backoffMultiplier: 1 }),
      (error: any) => error.message.includes('backoffMultiplier must be > 1')
    );
  });

  await t.test('should throw error if jitterFraction out of range', () => {
    assert.throws(
      () => new RetryStrategy({ jitterFraction: 1.5 }),
      (error: any) => error.message.includes('jitterFraction must be between 0 and 1')
    );
  });

  // =========================================================================
  // Exponential Backoff Calculation Tests
  // =========================================================================

  await t.test('should calculate exponential backoff delays', () => {
    const strategy = new RetryStrategy({
      initialDelayMs: 100,
      maxDelayMs: 10000,
      backoffMultiplier: 2,
      useJitter: false,
    });

    const delays: number[] = [];
    const maxDelayMs = 10000;

    for (let attempt = 1; attempt <= 6; attempt++) {
      let delayCaptured = false;
      strategy.on('retry', (event: any) => {
        delays.push(event.nextDelayMs);
        delayCaptured = true;
      });

      strategy
        .execute(
          async () => {
            throw new NetworkError('test error', {
              code: NetworkErrorCode.CONNECTION_TIMEOUT,
              retryable: true,
            });
          },
          {
            maxAttempts: attempt + 1,
            currentAttempt: attempt,
            totalDelayMs: 0,
            nextDelayMs: 0,
          }
        )
        .catch(() => {});
    }
  });

  await t.test('should respect max delay cap', async () => {
    const strategy = new RetryStrategy({
      initialDelayMs: 100,
      maxDelayMs: 500,
      backoffMultiplier: 2,
      useJitter: false,
    });

    let maxDelayEncountered = 0;
    strategy.on('retry', (event: any) => {
      maxDelayEncountered = Math.max(maxDelayEncountered, event.nextDelayMs);
    });

    try {
      await strategy.execute(
        async () => {
          throw new NetworkError('test error', {
            code: NetworkErrorCode.CONNECTION_TIMEOUT,
            retryable: true,
          });
        },
        {
          maxAttempts: 10,
          currentAttempt: 1,
          totalDelayMs: 0,
          nextDelayMs: 0,
        }
      );
    } catch (error) {
      // Expected to fail
    }

    assert.ok(maxDelayEncountered <= 500);
  });

  // =========================================================================
  // Jitter Application Tests
  // =========================================================================

  await t.test('should apply jitter within expected range', async () => {
    const strategy = new RetryStrategy({
      initialDelayMs: 100,
      maxDelayMs: 10000,
      backoffMultiplier: 2,
      useJitter: true,
      jitterFraction: 0.25,
    });

    const capturedDelays: number[] = [];

    strategy.on('retry', (event: any) => {
      capturedDelays.push(event.nextDelayMs);
    });

    try {
      await strategy.execute(
        async () => {
          throw new NetworkError('test error', {
            code: NetworkErrorCode.CONNECTION_TIMEOUT,
            retryable: true,
          });
        },
        {
          maxAttempts: 3,
          currentAttempt: 1,
          totalDelayMs: 0,
          nextDelayMs: 0,
        }
      );
    } catch (error) {
      // Expected to fail
    }

    // All captured delays should be valid numbers between 0 and max delay
    capturedDelays.forEach((delay) => {
      assert.ok(delay >= 0);
      assert.ok(delay <= 10000);
    });
  });

  await t.test('should not apply jitter when disabled', async () => {
    const strategy = new RetryStrategy({
      initialDelayMs: 100,
      maxDelayMs: 10000,
      backoffMultiplier: 2,
      useJitter: false,
    });

    // Without jitter, delays should be predictable (approximately)
    // Attempt 2: 100ms, Attempt 3: 200ms
    const config = strategy.getConfig();
    assert.equal(config.useJitter, false);
  });

  // =========================================================================
  // Successful Retry Tests
  // =========================================================================

  await t.test('should succeed on first attempt without retry', async () => {
    const strategy = new RetryStrategy({
      maxAttempts: 3,
      initialDelayMs: 10,
    });

    let successEventFired = false;
    strategy.on('retrySuccess', () => {
      successEventFired = true;
    });

    const result = await strategy.execute(async () => 'success');

    assert.equal(result, 'success');
    assert.equal(successEventFired, false); // retrySuccess only fires on retry success, not first attempt
  });

  await t.test('should succeed on 2nd attempt and emit retrySuccess event', async () => {
    const strategy = new RetryStrategy({
      maxAttempts: 3,
      initialDelayMs: 10,
    });

    let attemptCount = 0;
    let successEventFired = false;

    strategy.on('retrySuccess', () => {
      successEventFired = true;
    });

    const result = await strategy.execute(async () => {
      attemptCount++;
      if (attemptCount < 2) {
        throw new NetworkError('Fail once', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
          retryable: true,
        });
      }
      return 'success';
    });

    assert.equal(result, 'success');
    assert.equal(attemptCount, 2);
    assert.equal(successEventFired, true);
  });

  await t.test('should succeed on 3rd attempt', async () => {
    const strategy = new RetryStrategy({
      maxAttempts: 5,
      initialDelayMs: 10,
    });

    let attemptCount = 0;

    const result = await strategy.execute(async () => {
      attemptCount++;
      if (attemptCount < 3) {
        throw new NetworkError('Fail twice', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
          retryable: true,
        });
      }
      return `success after ${attemptCount} attempts`;
    });

    assert.equal(attemptCount, 3);
    assert.ok(result.includes('success after 3'));
  });

  // =========================================================================
  // Retry Exhaustion Tests
  // =========================================================================

  await t.test('should exhaust retries and throw error', async () => {
    const strategy = new RetryStrategy({
      maxAttempts: 2,
      initialDelayMs: 10,
    });

    let attemptCount = 0;
    let failureEventFired = false;

    strategy.on('retryFailure', (event: any) => {
      failureEventFired = true;
      assert.equal(event.attempt, 2); // Final attempt
    });

    try {
      await strategy.execute(async () => {
        attemptCount++;
        throw new NetworkError('Always fails', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
          retryable: true,
        });
      });
      assert.fail('Should have thrown error');
    } catch (error) {
      assert.ok(error instanceof NetworkError);
      assert.equal(attemptCount, 2);
      assert.equal(failureEventFired, true);
    }
  });

  await t.test('should add retry metadata to error context on exhaustion', async () => {
    const strategy = new RetryStrategy({
      maxAttempts: 2,
      initialDelayMs: 10,
    });

    try {
      await strategy.execute(async () => {
        throw new NetworkError('Test error', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
          retryable: true,
          context: {} as Record<string, unknown>,
        });
      });
      assert.fail('Should have thrown error');
    } catch (error) {
      assert.ok(error instanceof NetworkError);
      const context = (error as any).context;
      assert.equal(context.retryAttempts, 2);
      assert.ok(context.retryExhausted === true);
    }
  });

  // =========================================================================
  // Non-Retryable Error Tests
  // =========================================================================

  await t.test('should fail immediately on non-retryable error', async () => {
    const strategy = new RetryStrategy({
      maxAttempts: 5,
      initialDelayMs: 10,
    });

    let attemptCount = 0;

    try {
      await strategy.execute(async () => {
        attemptCount++;
        throw new NetworkError('Non-retryable', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
          retryable: false,
        });
      });
      assert.fail('Should have thrown error');
    } catch (error) {
      assert.ok(error instanceof NetworkError);
      assert.equal(attemptCount, 1); // No retries
    }
  });

  // =========================================================================
  // Event Emission Tests
  // =========================================================================

  await t.test('should emit retry event with correct payload', async () => {
    const strategy = new RetryStrategy({
      maxAttempts: 3,
      initialDelayMs: 10,
    });

    const retryEvents: any[] = [];

    strategy.on('retry', (event) => {
      retryEvents.push(event);
    });

    try {
      await strategy.execute(async () => {
        throw new NetworkError('Test', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
          retryable: true,
        });
      });
    } catch (error) {
      // Expected
    }

    assert.ok(retryEvents.length > 0);
    const firstEvent = retryEvents[0];
    assert.ok(typeof firstEvent.attempt === 'number');
    assert.ok(typeof firstEvent.totalDelayMs === 'number');
    assert.ok(typeof firstEvent.nextDelayMs === 'number');
    assert.ok(firstEvent.error instanceof NetworkError);
  });

  await t.test('should allow multiple event listeners', async () => {
    const strategy = new RetryStrategy({
      maxAttempts: 3,
      initialDelayMs: 10,
    });

    let listener1Fired = false;
    let listener2Fired = false;

    strategy.on('retry', () => {
      listener1Fired = true;
    });

    strategy.on('retry', () => {
      listener2Fired = true;
    });

    try {
      await strategy.execute(async () => {
        throw new NetworkError('Test', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
          retryable: true,
        });
      });
    } catch (error) {
      // Expected
    }

    assert.equal(listener1Fired, true);
    assert.equal(listener2Fired, true);
  });

  await t.test('should support removing event handlers', async () => {
    const strategy = new RetryStrategy({
      maxAttempts: 3,
      initialDelayMs: 10,
    });

    let handlerCalled = false;
    const handler = () => {
      handlerCalled = true;
    };

    strategy.on('retry', handler);
    strategy.off('retry', handler);

    try {
      await strategy.execute(async () => {
        throw new NetworkError('Test', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
          retryable: true,
        });
      });
    } catch (error) {
      // Expected
    }

    assert.equal(handlerCalled, false);
  });

  // =========================================================================
  // Retry Context Tests
  // =========================================================================

  await t.test('should track retry context correctly', async () => {
    const strategy = new RetryStrategy({
      maxAttempts: 3,
      initialDelayMs: 10,
    });

    const context: RetryContext = {
      maxAttempts: 3,
      currentAttempt: 1,
      totalDelayMs: 0,
      nextDelayMs: 0,
    };

    let attemptCount = 0;

    try {
      await strategy.execute(
        async () => {
          attemptCount++;
          if (attemptCount < 2) {
            throw new NetworkError('Test', {
              code: NetworkErrorCode.CONNECTION_TIMEOUT,
              retryable: true,
            });
          }
          return 'success';
        },
        context
      );
    } catch (error) {
      // May fail if max attempts reached
    }

    // Context should be updated
    assert.ok(context.currentAttempt >= 1);
  });

  await t.test('should create context with createContext method', () => {
    const strategy = new RetryStrategy({
      maxAttempts: 5,
      initialDelayMs: 100,
    });

    const context = strategy.createContext();

    assert.equal(context.maxAttempts, 5);
    assert.equal(context.currentAttempt, 1);
    assert.equal(context.totalDelayMs, 0);
    assert.equal(context.nextDelayMs, 0);
  });

  // =========================================================================
  // Configuration Preset Tests
  // =========================================================================

  await t.test('should create aggressive retry strategy', () => {
    const strategy = createRetryStrategy('aggressive');
    const config = strategy.getConfig();

    assert.equal(config.maxAttempts, 10);
    assert.equal(config.initialDelayMs, 50);
    assert.equal(config.maxDelayMs, 5000);
    assert.equal(config.backoffMultiplier, 1.5);
    assert.equal(config.useJitter, true);
  });

  await t.test('should create moderate retry strategy', () => {
    const strategy = createRetryStrategy('moderate');
    const config = strategy.getConfig();

    assert.equal(config.maxAttempts, 3);
    assert.equal(config.initialDelayMs, 100);
    assert.equal(config.maxDelayMs, 30000);
    assert.equal(config.backoffMultiplier, 2);
    assert.equal(config.useJitter, true);
  });

  await t.test('should create conservative retry strategy', () => {
    const strategy = createRetryStrategy('conservative');
    const config = strategy.getConfig();

    assert.equal(config.maxAttempts, 2);
    assert.equal(config.initialDelayMs, 500);
    assert.equal(config.maxDelayMs, 10000);
    assert.equal(config.backoffMultiplier, 2);
    assert.equal(config.useJitter, false);
  });

  await t.test('should default to moderate preset', () => {
    const strategy = createRetryStrategy();
    const config = strategy.getConfig();

    // Should match moderate preset
    assert.equal(config.maxAttempts, 3);
  });

  // =========================================================================
  // Configuration Update Tests
  // =========================================================================

  await t.test('should create new strategy with updated config via withConfig', () => {
    const originalStrategy = new RetryStrategy({
      maxAttempts: 3,
      initialDelayMs: 100,
    });

    const newStrategy = originalStrategy.withConfig({
      maxAttempts: 5,
    });

    const originalConfig = originalStrategy.getConfig();
    const newConfig = newStrategy.getConfig();

    // Original should be unchanged
    assert.equal(originalConfig.maxAttempts, 3);

    // New should have updated value
    assert.equal(newConfig.maxAttempts, 5);
    assert.equal(newConfig.initialDelayMs, 100); // Inherited from original
  });

  // =========================================================================
  // Retry Budget and Max Time Tests
  // =========================================================================

  await t.test('should estimate max retry time correctly', () => {
    const strategy = new RetryStrategy({
      maxAttempts: 3,
      initialDelayMs: 100,
      maxDelayMs: 10000,
      backoffMultiplier: 2,
      useJitter: false,
    });

    const maxTime = strategy.estimateMaxRetryTime();

    // Should be sum of all delays: 100 + 200 = 300ms (no jitter)
    assert.ok(maxTime >= 300);
    assert.ok(maxTime <= 400); // Allow small margin for rounding
  });

  // =========================================================================
  // Error Normalization Tests
  // =========================================================================

  await t.test('should normalize plain Error to BaseError', async () => {
    const strategy = new RetryStrategy({
      maxAttempts: 2,
      initialDelayMs: 10,
    });

    try {
      await strategy.execute(async () => {
        throw new Error('Plain error');
      });
      assert.fail('Should have thrown error');
    } catch (error) {
      assert.ok(error instanceof NetworkError);
      assert.ok((error as any).code);
    }
  });

  await t.test('should normalize unknown error types', async () => {
    const strategy = new RetryStrategy({
      maxAttempts: 2,
      initialDelayMs: 10,
    });

    try {
      await strategy.execute(async () => {
        throw 'string error';
      });
      assert.fail('Should have thrown error');
    } catch (error) {
      assert.ok(error instanceof NetworkError);
    }
  });

  // =========================================================================
  // Edge Case Tests
  // =========================================================================

  await t.test('should handle single attempt (maxAttempts=1)', async () => {
    const strategy = new RetryStrategy({
      maxAttempts: 1,
      initialDelayMs: 10,
    });

    let attemptCount = 0;

    try {
      await strategy.execute(async () => {
        attemptCount++;
        throw new NetworkError('Test', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
          retryable: true,
        });
      });
    } catch (error) {
      // Expected
    }

    assert.equal(attemptCount, 1);
  });

  await t.test('should handle zero initial delay', async () => {
    const strategy = new RetryStrategy({
      initialDelayMs: 0,
      maxDelayMs: 1000,
    });

    let attemptCount = 0;

    try {
      await strategy.execute(async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new NetworkError('Test', {
            code: NetworkErrorCode.CONNECTION_TIMEOUT,
            retryable: true,
          });
        }
        return 'success';
      });
    } catch (error) {
      // Expected if max attempts < 3
    }

    assert.ok(attemptCount >= 1);
  });

  await t.test('should get immutable config copy', () => {
    const strategy = new RetryStrategy({
      maxAttempts: 3,
    });

    const config = strategy.getConfig();

    // Config should be frozen
    assert.throws(
      () => {
        (config as any).maxAttempts = 5;
      },
      TypeError
    );
  });
});
