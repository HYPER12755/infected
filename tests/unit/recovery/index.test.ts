/**
 * @fileoverview Test suite for recovery module exports
 * Verifies that all exports are available and properly exported
 */

import { test } from 'node:test';
import * as assert from 'node:assert';
import {
  RetryStrategy,
  createRetryStrategy,
  CircuitBreaker,
  CircuitBreakerOpenError,
  CircuitState,
  CircuitBreakerEventType,
  RecoveryHandler,
  BackoffCalculator,
  BACKOFF_PRESET_AGGRESSIVE,
  BACKOFF_PRESET_MODERATE,
  BACKOFF_PRESET_CONSERVATIVE,
  BACKOFF_PRESET_CONSTANT,
} from '../../../src/core/recovery/index.js';

test('Recovery Module Exports', async (t) => {
  // =========================================================================
  // RetryStrategy Exports
  // =========================================================================

  await t.test('should export RetryStrategy class', () => {
    assert.ok(typeof RetryStrategy === 'function');
    const strategy = new RetryStrategy();
    assert.ok(strategy instanceof RetryStrategy);
  });

  await t.test('should export createRetryStrategy factory function', () => {
    assert.ok(typeof createRetryStrategy === 'function');
    const strategy = createRetryStrategy('moderate');
    assert.ok(strategy instanceof RetryStrategy);
  });

  // =========================================================================
  // CircuitBreaker Exports
  // =========================================================================

  await t.test('should export CircuitBreaker class', () => {
    assert.ok(typeof CircuitBreaker === 'function');
    const breaker = new CircuitBreaker();
    assert.ok(breaker instanceof CircuitBreaker);
  });

  await t.test('should export CircuitBreakerOpenError class', () => {
    assert.ok(typeof CircuitBreakerOpenError === 'function');
    const error = new CircuitBreakerOpenError('Test error', 1000);
    assert.ok(error instanceof CircuitBreakerOpenError);
  });

  await t.test('should export CircuitState enum', () => {
    assert.ok(CircuitState);
    assert.ok(CircuitState.CLOSED);
    assert.ok(CircuitState.OPEN);
    assert.ok(CircuitState.HALF_OPEN);
  });

  await t.test('should export CircuitBreakerEventType enum', () => {
    assert.ok(CircuitBreakerEventType);
    assert.ok(CircuitBreakerEventType.STATE_CHANGE);
    assert.ok(CircuitBreakerEventType.REQUEST_REJECTED);
    assert.ok(CircuitBreakerEventType.EXECUTION_SUCCESS);
    assert.ok(CircuitBreakerEventType.EXECUTION_FAILURE);
  });

  // =========================================================================
  // RecoveryHandler Exports
  // =========================================================================

  await t.test('should export RecoveryHandler class', () => {
    assert.ok(typeof RecoveryHandler === 'function');
    const handler = new RecoveryHandler({
      enableRetry: false,
      enableCircuitBreaker: false,
      retry: {
        maxRetries: 3,
        initialDelayMs: 100,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
        jitterFactor: 0.1,
      },
      circuitBreaker: {
        failureThreshold: 5,
        successThreshold: 2,
        timeoutMs: 60000,
        halfOpenMaxAttempts: 1,
      },
      recoveryHandlers: new Map(),
    });
    assert.ok(handler instanceof RecoveryHandler);
  });

  // =========================================================================
  // BackoffCalculator Exports
  // =========================================================================

  await t.test('should export BackoffCalculator class', () => {
    assert.ok(typeof BackoffCalculator === 'function');
    assert.ok(typeof BackoffCalculator.exponential === 'function');
  });

  await t.test('should export backoff preset constants', () => {
    assert.ok(BACKOFF_PRESET_AGGRESSIVE);
    assert.ok(BACKOFF_PRESET_MODERATE);
    assert.ok(BACKOFF_PRESET_CONSERVATIVE);
    assert.ok(BACKOFF_PRESET_CONSTANT);
  });

  await t.test('BACKOFF_PRESET_AGGRESSIVE should have correct properties', () => {
    assert.ok(typeof BACKOFF_PRESET_AGGRESSIVE.baseDelay === 'number');
    assert.ok(typeof BACKOFF_PRESET_AGGRESSIVE.maxDelay === 'number');
  });

  await t.test('BACKOFF_PRESET_MODERATE should have correct properties', () => {
    assert.ok(typeof BACKOFF_PRESET_MODERATE.baseDelay === 'number');
    assert.ok(typeof BACKOFF_PRESET_MODERATE.maxDelay === 'number');
  });

  await t.test('BACKOFF_PRESET_CONSERVATIVE should have correct properties', () => {
    assert.ok(typeof BACKOFF_PRESET_CONSERVATIVE.baseDelay === 'number');
    assert.ok(typeof BACKOFF_PRESET_CONSERVATIVE.maxDelay === 'number');
  });

  await t.test('BACKOFF_PRESET_CONSTANT should have correct properties', () => {
    assert.ok(typeof BACKOFF_PRESET_CONSTANT.baseDelay === 'number');
    assert.ok(typeof BACKOFF_PRESET_CONSTANT.maxDelay === 'number');
  });

  // =========================================================================
  // Module Integrity Tests
  // =========================================================================

  await t.test('should not have circular dependencies', () => {
    // If circular dependencies exist, imports would fail
    assert.ok(RetryStrategy);
    assert.ok(CircuitBreaker);
    assert.ok(RecoveryHandler);
    assert.ok(BackoffCalculator);
  });

  await t.test('should allow instantiation of all exported classes', () => {
    const retryStrategy = new RetryStrategy();
    const circuitBreaker = new CircuitBreaker();
    const recoveryHandler = new RecoveryHandler({
      enableRetry: false,
      enableCircuitBreaker: false,
      retry: {
        maxRetries: 3,
        initialDelayMs: 100,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
        jitterFactor: 0.1,
      },
      circuitBreaker: {
        failureThreshold: 5,
        successThreshold: 2,
        timeoutMs: 60000,
        halfOpenMaxAttempts: 1,
      },
      recoveryHandlers: new Map(),
    });

    assert.ok(retryStrategy);
    assert.ok(circuitBreaker);
    assert.ok(recoveryHandler);
  });

  await t.test('exported classes should have expected methods', () => {
    const retryStrategy = new RetryStrategy();
    assert.ok(typeof retryStrategy.execute === 'function');
    assert.ok(typeof retryStrategy.on === 'function');
    assert.ok(typeof retryStrategy.off === 'function');
    assert.ok(typeof retryStrategy.getConfig === 'function');

    const circuitBreaker = new CircuitBreaker();
    assert.ok(typeof circuitBreaker.execute === 'function');
    assert.ok(typeof circuitBreaker.getState === 'function');
    assert.ok(typeof circuitBreaker.getMetrics === 'function');
    assert.ok(typeof circuitBreaker.reset === 'function');

    const recoveryHandler = new RecoveryHandler({
      enableRetry: false,
      enableCircuitBreaker: false,
      retry: {
        maxRetries: 3,
        initialDelayMs: 100,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
        jitterFactor: 0.1,
      },
      circuitBreaker: {
        failureThreshold: 5,
        successThreshold: 2,
        timeoutMs: 60000,
        halfOpenMaxAttempts: 1,
      },
      recoveryHandlers: new Map(),
    });
    assert.ok(typeof recoveryHandler.executeWithRecovery === 'function');
    assert.ok(typeof recoveryHandler.registerRecoveryHandler === 'function');
    assert.ok(typeof recoveryHandler.getRecoveryMetrics === 'function');
  });

  await t.test('BackoffCalculator should export all static methods', () => {
    assert.ok(typeof BackoffCalculator.exponential === 'function');
    assert.ok(typeof BackoffCalculator.linear === 'function');
    assert.ok(typeof BackoffCalculator.fibonacci === 'function');
    assert.ok(typeof BackoffCalculator.polynomial === 'function');
    assert.ok(typeof BackoffCalculator.decorrelatedJitter === 'function');
    assert.ok(typeof BackoffCalculator.addJitter === 'function');
    assert.ok(typeof BackoffCalculator.addFullJitter === 'function');
    assert.ok(typeof BackoffCalculator.addEqualJitter === 'function');
    assert.ok(typeof BackoffCalculator.addDecorrelatedJitter === 'function');
    assert.ok(typeof BackoffCalculator.validateBackoffParams === 'function');
    assert.ok(typeof BackoffCalculator.clampDelay === 'function');
    assert.ok(typeof BackoffCalculator.estimateMaxBackoff === 'function');
  });
});
