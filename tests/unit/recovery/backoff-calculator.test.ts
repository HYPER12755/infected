/**
 * @fileoverview Comprehensive test suite for BackoffCalculator
 * Tests all backoff strategies, jitter functions, presets, and edge cases
 */

import { test } from 'node:test';
import * as assert from 'node:assert';
import {
  BackoffCalculator,
  type BackoffParams,
  BACKOFF_PRESET_AGGRESSIVE,
  BACKOFF_PRESET_MODERATE,
  BACKOFF_PRESET_CONSERVATIVE,
  BACKOFF_PRESET_CONSTANT,
} from '../../../src/core/recovery/backoff-calculator.js';

test('BackoffCalculator', async (t) => {
  // =========================================================================
  // Exponential Backoff Strategy Tests
  // =========================================================================

  await t.test('exponential: should calculate correct delay at attempt 0', () => {
    const delay = BackoffCalculator.exponential(0, 100, 2, 30000);
    assert.equal(delay, 100);
  });

  await t.test('exponential: should calculate correct delay at attempt 1', () => {
    const delay = BackoffCalculator.exponential(1, 100, 2, 30000);
    assert.equal(delay, 200);
  });

  await t.test('exponential: should calculate correct delay at attempt 2', () => {
    const delay = BackoffCalculator.exponential(2, 100, 2, 30000);
    assert.equal(delay, 400);
  });

  await t.test('exponential: should calculate correct delay at attempt 5', () => {
    const delay = BackoffCalculator.exponential(5, 100, 2, 30000);
    assert.equal(delay, 3200);
  });

  await t.test('exponential: should cap at maxDelay', () => {
    const delay = BackoffCalculator.exponential(10, 100, 2, 1000);
    assert.equal(delay, 1000);
  });

  await t.test('exponential: should handle different multipliers', () => {
    const delay1 = BackoffCalculator.exponential(3, 100, 1.5, 30000);
    const delay2 = BackoffCalculator.exponential(3, 100, 2, 30000);

    assert.ok(delay1 < delay2);
  });

  // =========================================================================
  // Linear Backoff Strategy Tests
  // =========================================================================

  await t.test('linear: should calculate correct delay at attempt 0', () => {
    const delay = BackoffCalculator.linear(0, 100, 100, 5000);
    assert.equal(delay, 100);
  });

  await t.test('linear: should calculate correct delay at attempt 1', () => {
    const delay = BackoffCalculator.linear(1, 100, 100, 5000);
    assert.equal(delay, 200);
  });

  await t.test('linear: should calculate correct delay at attempt 5', () => {
    const delay = BackoffCalculator.linear(5, 100, 100, 5000);
    assert.equal(delay, 600);
  });

  await t.test('linear: should cap at maxDelay', () => {
    const delay = BackoffCalculator.linear(100, 100, 100, 5000);
    assert.equal(delay, 5000);
  });

  await t.test('linear: should handle different increments', () => {
    const delay1 = BackoffCalculator.linear(3, 100, 50, 5000);
    const delay2 = BackoffCalculator.linear(3, 100, 100, 5000);

    assert.ok(delay1 < delay2);
  });

  // =========================================================================
  // Fibonacci Backoff Strategy Tests
  // =========================================================================

  await t.test('fibonacci: should return correct sequence values', () => {
    // Fibonacci sequence: 1, 1, 2, 3, 5, 8, 13, 21...
    const delay0 = BackoffCalculator.fibonacci(0, 100, 30000);
    const delay1 = BackoffCalculator.fibonacci(1, 100, 30000);
    const delay2 = BackoffCalculator.fibonacci(2, 100, 30000);
    const delay3 = BackoffCalculator.fibonacci(3, 100, 30000);
    const delay4 = BackoffCalculator.fibonacci(4, 100, 30000);

    assert.equal(delay0, 100); // 1 * 100
    assert.equal(delay1, 100); // 1 * 100
    assert.equal(delay2, 200); // 2 * 100
    assert.equal(delay3, 300); // 3 * 100
    assert.equal(delay4, 500); // 5 * 100
  });

  await t.test('fibonacci: should cap at maxDelay', () => {
    const delay = BackoffCalculator.fibonacci(20, 100, 1000);
    assert.equal(delay, 1000);
  });

  await t.test('fibonacci: should handle different base delays', () => {
    const delay1 = BackoffCalculator.fibonacci(3, 50, 30000);
    const delay2 = BackoffCalculator.fibonacci(3, 100, 30000);

    assert.equal(delay1, 150); // 3 * 50
    assert.equal(delay2, 300); // 3 * 100
  });

  // =========================================================================
  // Polynomial Backoff Strategy Tests
  // =========================================================================

  await t.test('polynomial: quadratic should calculate correct delays', () => {
    const delay0 = BackoffCalculator.polynomial(0, 100, 2, 30000);
    const delay1 = BackoffCalculator.polynomial(1, 100, 2, 30000);
    const delay2 = BackoffCalculator.polynomial(2, 100, 2, 30000);
    const delay3 = BackoffCalculator.polynomial(3, 100, 2, 30000);

    assert.equal(delay0, 100); // 0^2 * 100 = 100 (clamped to base)
    assert.equal(delay1, 100); // 1^2 * 100 = 100
    assert.equal(delay2, 400); // 2^2 * 100 = 400
    assert.equal(delay3, 900); // 3^2 * 100 = 900
  });

  await t.test('polynomial: cubic should calculate correct delays', () => {
    const delay1 = BackoffCalculator.polynomial(1, 100, 3, 30000);
    const delay2 = BackoffCalculator.polynomial(2, 100, 3, 30000);
    const delay3 = BackoffCalculator.polynomial(3, 100, 3, 30000);

    assert.equal(delay1, 100); // 1^3 * 100 = 100
    assert.equal(delay2, 800); // 2^3 * 100 = 800
    assert.equal(delay3, 2700); // 3^3 * 100 = 2700
  });

  await t.test('polynomial: should cap at maxDelay', () => {
    const delay = BackoffCalculator.polynomial(10, 100, 2, 5000);
    assert.equal(delay, 5000);
  });

  // =========================================================================
  // Decorrelated Jitter Tests
  // =========================================================================

  await t.test('decorrelatedJitter: should return value in valid range', () => {
    for (let i = 0; i < 100; i++) {
      const delay = BackoffCalculator.decorrelatedJitter(100, 50, 5000);
      assert.ok(delay >= 50);
      assert.ok(delay <= 5000);
    }
  });

  await t.test('decorrelatedJitter: should cap at maxDelay', () => {
    const delay = BackoffCalculator.decorrelatedJitter(10000, 100, 5000);
    assert.ok(delay <= 5000);
    assert.ok(delay >= 100);
  });

  await t.test('decorrelatedJitter: should produce varied results', () => {
    const delays = new Set<number>();

    for (let i = 0; i < 100; i++) {
      delays.add(BackoffCalculator.decorrelatedJitter(100, 50, 5000));
    }

    // Should have multiple different values (high probability with jitter)
    assert.ok(delays.size > 50);
  });

  // =========================================================================
  // Jitter Functions Tests
  // =========================================================================

  await t.test('addJitter: should apply uniform jitter', () => {
    for (let i = 0; i < 50; i++) {
      const delay = BackoffCalculator.addJitter(1000, 0.1);
      assert.ok(delay >= 900); // 1000 - 100
      assert.ok(delay <= 1100); // 1000 + 100
    }
  });

  await t.test('addJitter: should respect jitterFraction parameter', () => {
    const delays1: number[] = [];
    const delays2: number[] = [];

    for (let i = 0; i < 30; i++) {
      delays1.push(BackoffCalculator.addJitter(1000, 0.05));
      delays2.push(BackoffCalculator.addJitter(1000, 0.25));
    }

    const avg1 = delays1.reduce((a, b) => a + b) / delays1.length;
    const avg2 = delays2.reduce((a, b) => a + b) / delays2.length;

    // With larger jitter, variance should be larger
    const variance1 = delays1.reduce((sum, d) => sum + Math.pow(d - avg1, 2), 0) / delays1.length;
    const variance2 = delays2.reduce((sum, d) => sum + Math.pow(d - avg2, 2), 0) / delays2.length;

    assert.ok(variance2 > variance1);
  });

  await t.test('addFullJitter: should return value between baseDelay and maxDelay', () => {
    for (let i = 0; i < 50; i++) {
      const delay = BackoffCalculator.addFullJitter(100, 1000);
      assert.ok(delay >= 100);
      assert.ok(delay <= 1000);
    }
  });

  await t.test('addEqualJitter: should apply AWS recommended formula', () => {
    for (let i = 0; i < 50; i++) {
      const delay = BackoffCalculator.addEqualJitter(1000, 500);
      assert.ok(delay >= 500); // min(1000, 500) = 500
      assert.ok(delay <= 750); // 500 + 500/2 = 750
    }
  });

  await t.test('addDecorrelatedJitter: should apply decorrelated jitter', () => {
    for (let i = 0; i < 50; i++) {
      const delay = BackoffCalculator.addDecorrelatedJitter(100, 50, 5000);
      assert.ok(delay >= 50);
      assert.ok(delay <= 5000);
    }
  });

  // =========================================================================
  // Validation Tests
  // =========================================================================

  await t.test('validateBackoffParams: should accept valid parameters', () => {
    const valid = BackoffCalculator.validateBackoffParams({
      baseDelay: 100,
      maxDelay: 10000,
      multiplier: 2,
      jitterFraction: 0.1,
    });

    assert.equal(valid, true);
  });

  await t.test('validateBackoffParams: should reject zero baseDelay', () => {
    const valid = BackoffCalculator.validateBackoffParams({
      baseDelay: 0,
      maxDelay: 10000,
    });

    assert.equal(valid, false);
  });

  await t.test('validateBackoffParams: should reject negative baseDelay', () => {
    const valid = BackoffCalculator.validateBackoffParams({
      baseDelay: -100,
      maxDelay: 10000,
    });

    assert.equal(valid, false);
  });

  await t.test('validateBackoffParams: should reject zero maxDelay', () => {
    const valid = BackoffCalculator.validateBackoffParams({
      baseDelay: 100,
      maxDelay: 0,
    });

    assert.equal(valid, false);
  });

  await t.test('validateBackoffParams: should reject maxDelay < baseDelay', () => {
    const valid = BackoffCalculator.validateBackoffParams({
      baseDelay: 1000,
      maxDelay: 100,
    });

    assert.equal(valid, false);
  });

  await t.test('validateBackoffParams: should reject negative multiplier', () => {
    const valid = BackoffCalculator.validateBackoffParams({
      baseDelay: 100,
      maxDelay: 10000,
      multiplier: -2,
    });

    assert.equal(valid, false);
  });

  await t.test('validateBackoffParams: should reject negative increment', () => {
    const valid = BackoffCalculator.validateBackoffParams({
      baseDelay: 100,
      maxDelay: 10000,
      increment: -50,
    });

    assert.equal(valid, false);
  });

  await t.test('validateBackoffParams: should reject negative degree', () => {
    const valid = BackoffCalculator.validateBackoffParams({
      baseDelay: 100,
      maxDelay: 10000,
      degree: -2,
    });

    assert.equal(valid, false);
  });

  await t.test('validateBackoffParams: should reject invalid jitterFraction', () => {
    const valid1 = BackoffCalculator.validateBackoffParams({
      baseDelay: 100,
      maxDelay: 10000,
      jitterFraction: -0.1,
    });

    const valid2 = BackoffCalculator.validateBackoffParams({
      baseDelay: 100,
      maxDelay: 10000,
      jitterFraction: 1.5,
    });

    assert.equal(valid1, false);
    assert.equal(valid2, false);
  });

  // =========================================================================
  // Clamping Tests
  // =========================================================================

  await t.test('clampDelay: should clamp below minDelay', () => {
    const clamped = BackoffCalculator.clampDelay(50, 100, 1000);
    assert.equal(clamped, 100);
  });

  await t.test('clampDelay: should clamp above maxDelay', () => {
    const clamped = BackoffCalculator.clampDelay(2000, 100, 1000);
    assert.equal(clamped, 1000);
  });

  await t.test('clampDelay: should return value within range', () => {
    const clamped = BackoffCalculator.clampDelay(500, 100, 1000);
    assert.equal(clamped, 500);
  });

  await t.test('clampDelay: should handle negative values', () => {
    const clamped = BackoffCalculator.clampDelay(-100, 100, 1000);
    assert.equal(clamped, 100);
  });

  await t.test('clampDelay: should handle NaN', () => {
    const clamped = BackoffCalculator.clampDelay(NaN, 100, 1000);
    assert.equal(clamped, 100);
  });

  await t.test('clampDelay: should handle Infinity', () => {
    const clamped = BackoffCalculator.clampDelay(Infinity, 100, 1000);
    assert.equal(clamped, 100); // Non-finite returns minDelay for safety
  });

  // =========================================================================
  // Preset Configuration Tests
  // =========================================================================

  await t.test('BACKOFF_PRESET_AGGRESSIVE: should have correct values', () => {
    assert.equal(BACKOFF_PRESET_AGGRESSIVE.baseDelay, 50);
    assert.equal(BACKOFF_PRESET_AGGRESSIVE.multiplier, 2);
    assert.equal(BACKOFF_PRESET_AGGRESSIVE.maxDelay, 5000);
    assert.equal(BACKOFF_PRESET_AGGRESSIVE.useJitter, true);
    assert.equal(BACKOFF_PRESET_AGGRESSIVE.jitterFraction, 0.1);
  });

  await t.test('BACKOFF_PRESET_MODERATE: should have correct values', () => {
    assert.equal(BACKOFF_PRESET_MODERATE.baseDelay, 100);
    assert.equal(BACKOFF_PRESET_MODERATE.multiplier, 2);
    assert.equal(BACKOFF_PRESET_MODERATE.maxDelay, 30000);
    assert.equal(BACKOFF_PRESET_MODERATE.useJitter, true);
    assert.equal(BACKOFF_PRESET_MODERATE.jitterFraction, 0.1);
  });

  await t.test('BACKOFF_PRESET_CONSERVATIVE: should have correct values', () => {
    assert.equal(BACKOFF_PRESET_CONSERVATIVE.baseDelay, 500);
    assert.equal(BACKOFF_PRESET_CONSERVATIVE.increment, 500);
    assert.equal(BACKOFF_PRESET_CONSERVATIVE.maxDelay, 60000);
    assert.equal(BACKOFF_PRESET_CONSERVATIVE.useJitter, true);
    assert.equal(BACKOFF_PRESET_CONSERVATIVE.jitterFraction, 0.1);
  });

  await t.test('BACKOFF_PRESET_CONSTANT: should have correct values', () => {
    assert.equal(BACKOFF_PRESET_CONSTANT.baseDelay, 10);
    assert.equal(BACKOFF_PRESET_CONSTANT.maxDelay, 10);
    assert.equal(BACKOFF_PRESET_CONSTANT.useJitter, false);
  });

  // =========================================================================
  // EstimateMaxBackoff Tests
  // =========================================================================

  await t.test('estimateMaxBackoff: should estimate total backoff time', () => {
    const estimate = BackoffCalculator.estimateMaxBackoff(5, {
      baseDelay: 100,
      maxDelay: 1000,
    });

    // Should be roughly 5 * 1000 = 5000
    assert.equal(estimate, 5000);
  });

  await t.test('estimateMaxBackoff: should return 0 for zero attempts', () => {
    const estimate = BackoffCalculator.estimateMaxBackoff(0, {
      baseDelay: 100,
      maxDelay: 1000,
    });

    assert.equal(estimate, 0);
  });

  await t.test('estimateMaxBackoff: should handle negative attempts', () => {
    const estimate = BackoffCalculator.estimateMaxBackoff(-5, {
      baseDelay: 100,
      maxDelay: 1000,
    });

    assert.equal(estimate, 0);
  });

  // =========================================================================
  // Edge Case Tests
  // =========================================================================

  await t.test('should handle attempt 0 correctly for all strategies', () => {
    const exp = BackoffCalculator.exponential(0, 100, 2, 30000);
    const lin = BackoffCalculator.linear(0, 100, 100, 5000);
    const fib = BackoffCalculator.fibonacci(0, 100, 30000);
    const poly = BackoffCalculator.polynomial(0, 100, 2, 30000);

    // Attempt 0 should return base delay (or clamped to base)
    assert.ok(exp >= 100);
    assert.equal(lin, 100);
    assert.equal(fib, 100);
    assert.ok(poly >= 100);
  });

  await t.test('should handle very large attempt numbers', () => {
    const delay = BackoffCalculator.exponential(1000, 100, 2, 30000);
    assert.equal(delay, 30000); // Should be capped
  });

  await t.test('should handle very small delays', () => {
    const delay = BackoffCalculator.exponential(0, 1, 2, 10);
    assert.equal(delay, 1);
  });

  await t.test('should handle delays at boundary', () => {
    const delay = BackoffCalculator.exponential(1, 1000, 2, 2000);
    assert.equal(delay, 2000); // 2000 > 2000 cap
  });
});
