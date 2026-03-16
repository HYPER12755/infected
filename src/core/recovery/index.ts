/**
 * @fileoverview Recovery Strategies Module
 *
 * Comprehensive error recovery toolkit combining multiple strategies:
 * - Retry Strategy: Exponential backoff with jitter for transient failures
 * - Circuit Breaker: State machine pattern to prevent cascading failures
 * - Recovery Handler: Orchestrator coordinating retries, circuit breaking, and custom recovery logic
 * - Backoff Calculator: Multiple backoff algorithms (exponential, linear, Fibonacci, polynomial)
 *
 * This module provides production-ready resilience patterns for distributed systems,
 * with built-in metrics, event emission, and customizable recovery handlers.
 *
 * @module core/recovery
 */

// ============================================================================
// RetryStrategy Exports
// ============================================================================

export {
   RetryStrategy,
   type RetryConfig,
   type RetryContext,
   createRetryStrategy,
 } from './retry-strategy.js';

// ============================================================================
// CircuitBreaker Exports
// ============================================================================

export {
   CircuitBreaker,
   CircuitBreakerOpenError,
   CircuitState,
   type CircuitBreakerConfig,
   type CircuitBreakerMetrics,
   type CircuitBreakerEventHandler,
   CircuitBreakerEventType,
 } from './circuit-breaker.js';

// ============================================================================
// RecoveryHandler Exports
// ============================================================================

export {
   RecoveryHandler,
   type RecoveryHandlerConfig,
   type RecoveryContext,
   type RecoveryFunction,
   type RecoveryMetrics,
   type ExecutionOptions,
 } from './recovery-handler.js';

// ============================================================================
// BackoffCalculator Exports
// ============================================================================

export {
   BackoffCalculator,
   type BackoffParams,
   BACKOFF_PRESET_AGGRESSIVE,
   BACKOFF_PRESET_MODERATE,
   BACKOFF_PRESET_CONSERVATIVE,
   BACKOFF_PRESET_CONSTANT,
 } from './backoff-calculator.js';
