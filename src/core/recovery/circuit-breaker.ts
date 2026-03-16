/**
 * Circuit Breaker Pattern Implementation
 * 
 * Implements the circuit breaker pattern to prevent cascading failures
 * in distributed systems. Uses a state machine with three states:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Failures detected, requests rejected immediately
 * - HALF_OPEN: Testing recovery, selective requests allowed
 * 
 * State Machine Diagram:
 * ```
 *     ┌─────────────────────────────┐
 *     │        CLOSED               │
 *     │   (Normal Operation)        │
 *     └──────────────┬──────────────┘
 *                    │ Failures exceed threshold
 *                    ▼
 *     ┌─────────────────────────────┐
 *     │         OPEN                │
 *     │  (Rejecting Requests)       │
 *     └──────────────┬──────────────┘
 *                    │ Timeout expires
 *                    ▼
 *     ┌─────────────────────────────┐
 *     │      HALF_OPEN              │
 *     │  (Testing Recovery)         │
 *     └──────────────┬──────────────┘
 *          │        │ Success threshold
 *          │        │  reached
 *          │        ▼
 *          │   Go to CLOSED
 *          │
 *          │ Failure detected
 *          ▼
 *     Go back to OPEN
 * ```
 */

import { BaseError, type ErrorMetadata, ErrorSeverity, NetworkErrorCode } from '../error-system/error-taxonomy.js';
import { NetworkError } from '../error-system/error-categories.js';

/**
 * Circuit breaker states
 * @enum {string}
 */
export enum CircuitState {
  /** Normal operation, requests pass through */
  CLOSED = 'CLOSED',
  /** Failures detected, requests rejected immediately */
  OPEN = 'OPEN',
  /** Testing if service recovered, selective requests allowed */
  HALF_OPEN = 'HALF_OPEN',
}

/**
 * Circuit breaker configuration interface
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit (default: 5) */
  failureThreshold?: number;
  /** Number of successes in HALF_OPEN state to close circuit (default: 2) */
  successThreshold?: number;
  /** Duration in OPEN state before transitioning to HALF_OPEN (default: 60000ms) */
  timeout?: number;
  /** Time window for failure tracking in milliseconds (default: 60000ms) */
  windowSize?: number;
  /** Track failures by error type (default: true) */
  monitorErrorType?: boolean;
}

/**
 * Metrics for circuit breaker monitoring
 */
export interface CircuitBreakerMetrics {
  /** Total number of requests processed */
  totalRequests: number;
  /** Number of successful requests */
  successfulRequests: number;
  /** Number of failed requests */
  failedRequests: number;
  /** Number of requests rejected due to open circuit */
  rejectedRequests: number;
  /** Current failure count within window */
  currentFailureCount: number;
  /** Timestamp of last failure */
  lastFailureTime: number;
  /** Error code of last failure */
  lastErrorCode: string;
  /** Number of state changes */
  stateChanges: number;
  /** Number of attempts made in HALF_OPEN state */
  halfOpenAttempts: number;
}

/**
 * Event handler type for circuit breaker events
 */
export type CircuitBreakerEventHandler = (
  eventType: CircuitBreakerEventType,
  state: CircuitState,
  details?: Record<string, unknown>
) => void;

/**
 * Circuit breaker event types
 * @enum {string}
 */
export enum CircuitBreakerEventType {
  STATE_CHANGE = 'stateChange',
  REQUEST_REJECTED = 'requestRejected',
  EXECUTION_SUCCESS = 'executionSuccess',
  EXECUTION_FAILURE = 'executionFailure',
}

/**
 * Failure record for rolling window tracking
 */
interface FailureRecord {
  timestamp: number;
  errorCode: string;
  errorType?: string;
}

/**
 * Circuit Breaker Implementation
 * 
 * Prevents cascading failures by monitoring request success/failure rates
 * and temporarily blocking requests when failures exceed thresholds.
 * 
 * @example
 * ```typescript
 * const breaker = new CircuitBreaker({
 *   failureThreshold: 5,
 *   timeout: 60000,
 *   windowSize: 60000,
 * });
 * 
 * breaker.on(CircuitBreakerEventType.STATE_CHANGE, (type, state, details) => {
 *   console.log(`Circuit breaker transitioned to ${state}`);
 * });
 * 
 * try {
 *   const result = await breaker.execute(() => callExternalService());
 * } catch (error) {
 *   if (error instanceof CircuitBreakerOpenError) {
 *     console.log('Circuit is open, service unavailable');
 *   }
 * }
 * ```
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureThreshold: number;
  private successThreshold: number;
  private timeout: number;
  private windowSize: number;
  private monitorErrorType: boolean;

  private failureRecords: FailureRecord[] = [];
  private lastOpenTime: number = 0;
  private consecutiveSuccesses: number = 0;

  private metrics: CircuitBreakerMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    rejectedRequests: 0,
    currentFailureCount: 0,
    lastFailureTime: 0,
    lastErrorCode: '',
    stateChanges: 0,
    halfOpenAttempts: 0,
  };

  private eventHandlers: Set<CircuitBreakerEventHandler> = new Set();

  /**
   * Create a new CircuitBreaker instance
   * @param config - Configuration options
   */
  constructor(config: CircuitBreakerConfig = {}) {
    this.failureThreshold = config.failureThreshold ?? 5;
    this.successThreshold = config.successThreshold ?? 2;
    this.timeout = config.timeout ?? 60000;
    this.windowSize = config.windowSize ?? 60000;
    this.monitorErrorType = config.monitorErrorType ?? true;
  }

  /**
   * Register an event handler
   * @param handler - Event handler function
   */
  on(handler: CircuitBreakerEventHandler): void {
    this.eventHandlers.add(handler);
  }

  /**
   * Unregister an event handler
   * @param handler - Event handler function to remove
   */
  off(handler: CircuitBreakerEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  /**
   * Emit an event to all registered handlers
   * @param eventType - Type of event
   * @param details - Additional event details
   */
  private emitEvent(
    eventType: CircuitBreakerEventType,
    details?: Record<string, unknown>
  ): void {
    for (const handler of Array.from(this.eventHandlers)) {
      handler(eventType, this.state, details);
    }
  }

  /**
   * Clean up old failures outside the time window
   */
  private cleanupOldFailures(): void {
    const now = Date.now();
    const cutoffTime = now - this.windowSize;
    this.failureRecords = this.failureRecords.filter(
      (record) => record.timestamp > cutoffTime
    );
    this.metrics.currentFailureCount = this.failureRecords.length;
  }

  /**
   * Record a failure in the failure window
   * @param error - The error that occurred
   */
  private recordFailure(error: BaseError | Error): void {
    const errorCode = error instanceof BaseError ? error.code : 'UNKNOWN';
    const errorType = error.constructor.name;

    const record: FailureRecord = {
      timestamp: Date.now(),
      errorCode,
      errorType: this.monitorErrorType ? errorType : undefined,
    };

    this.failureRecords.push(record);
    this.metrics.lastFailureTime = record.timestamp;
    this.metrics.lastErrorCode = errorCode;
    this.metrics.failedRequests++;
    this.cleanupOldFailures();

    this.emitEvent(CircuitBreakerEventType.EXECUTION_FAILURE, {
      errorCode,
      errorType: this.monitorErrorType ? errorType : undefined,
      failureCount: this.failureRecords.length,
      threshold: this.failureThreshold,
    });
  }

  /**
   * Check if failure threshold has been exceeded
   * @returns True if threshold exceeded
   */
  private shouldOpen(): boolean {
    this.cleanupOldFailures();
    return this.failureRecords.length >= this.failureThreshold;
  }

  /**
   * Transition to OPEN state
   */
  private transitionToOpen(): void {
    if (this.state !== CircuitState.OPEN) {
      this.state = CircuitState.OPEN;
      this.lastOpenTime = Date.now();
      this.consecutiveSuccesses = 0;
      this.metrics.stateChanges++;
      this.emitEvent(CircuitBreakerEventType.STATE_CHANGE, {
        previousState: CircuitState.CLOSED,
        newState: CircuitState.OPEN,
        reason: 'Failure threshold exceeded',
      });
    }
  }

  /**
   * Check if circuit should transition to HALF_OPEN
   * @returns True if timeout has expired
   */
  private shouldAttemptHalfOpen(): boolean {
    const now = Date.now();
    return now - this.lastOpenTime >= this.timeout;
  }

  /**
   * Transition to HALF_OPEN state
   */
  private transitionToHalfOpen(): void {
    if (this.state === CircuitState.OPEN) {
      this.state = CircuitState.HALF_OPEN;
      this.consecutiveSuccesses = 0;
      this.metrics.stateChanges++;
      this.emitEvent(CircuitBreakerEventType.STATE_CHANGE, {
        previousState: CircuitState.OPEN,
        newState: CircuitState.HALF_OPEN,
        reason: 'Timeout expired, attempting recovery',
      });
    }
  }

  /**
   * Transition to CLOSED state
   */
  private transitionToClosed(): void {
    if (this.state !== CircuitState.CLOSED) {
      this.state = CircuitState.CLOSED;
      this.consecutiveSuccesses = 0;
      this.failureRecords = [];
      this.metrics.currentFailureCount = 0;
      this.metrics.stateChanges++;
      this.emitEvent(CircuitBreakerEventType.STATE_CHANGE, {
        previousState: this.state,
        newState: CircuitState.CLOSED,
        reason: 'Recovery successful',
      });
    }
  }

  /**
   * Record a successful execution
   */
  private recordSuccess(): void {
    this.metrics.totalRequests++;
    this.metrics.successfulRequests++;
    this.consecutiveSuccesses++;

    this.emitEvent(CircuitBreakerEventType.EXECUTION_SUCCESS, {
      successCount: this.consecutiveSuccesses,
      threshold: this.successThreshold,
    });

    if (this.state === CircuitState.HALF_OPEN) {
      this.metrics.halfOpenAttempts++;
      if (this.consecutiveSuccesses >= this.successThreshold) {
        this.transitionToClosed();
      }
    }
  }

  /**
   * Execute a function with circuit breaker protection
   * 
   * @template T - Return type of the function
   * @param fn - Async function to execute
   * @returns Promise with the function result
   * @throws CircuitBreakerOpenError if circuit is open and rejecting requests
   * @throws Original error if function throws
   * 
   * @example
   * ```typescript
   * const result = await breaker.execute(() => fetchData());
   * ```
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if we should attempt recovery from OPEN state
    if (this.state === CircuitState.OPEN && this.shouldAttemptHalfOpen()) {
      this.transitionToHalfOpen();
    }

    // Reject request if circuit is OPEN
    if (this.state === CircuitState.OPEN) {
      this.metrics.totalRequests++;
      this.metrics.rejectedRequests++;
      this.emitEvent(CircuitBreakerEventType.REQUEST_REJECTED, {
        reason: 'Circuit is open',
        timeUntilRetry: this.getRemainingTimeout(),
      });
      throw new CircuitBreakerOpenError(
        'Circuit breaker is open, request rejected',
        this.getRemainingTimeout()
      );
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.metrics.totalRequests++;

      // Only count BaseError instances as failures for threshold tracking
      if (error instanceof BaseError) {
        this.recordFailure(error);

        // Check if we should open the circuit
        if (this.shouldOpen()) {
          this.transitionToOpen();
        }

        // If in HALF_OPEN and failure occurs, go back to OPEN
        if (this.state === CircuitState.HALF_OPEN) {
          this.consecutiveSuccesses = 0;
          this.transitionToOpen();
        }
      }

      throw error;
    }
  }

  /**
   * Get the current state of the circuit breaker
   * @returns Current circuit state
   */
  getState(): CircuitState {
    // Auto-transition to HALF_OPEN if timeout expired
    if (this.state === CircuitState.OPEN && this.shouldAttemptHalfOpen()) {
      this.transitionToHalfOpen();
    }
    return this.state;
  }

  /**
   * Get remaining time until circuit attempts recovery
   * @returns Milliseconds until recovery attempt, or 0 if not in OPEN state
   */
  getRemainingTimeout(): number {
    if (this.state !== CircuitState.OPEN) {
      return 0;
    }

    const now = Date.now();
    const elapsed = now - this.lastOpenTime;
    const remaining = Math.max(0, this.timeout - elapsed);
    return remaining;
  }

  /**
   * Get current metrics
   * @returns Metrics object with all tracking information
   */
  getMetrics(): CircuitBreakerMetrics {
    return { ...this.metrics };
  }

  /**
   * Manually reset the circuit breaker to CLOSED state
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureRecords = [];
    this.consecutiveSuccesses = 0;
    this.metrics.currentFailureCount = 0;
    this.metrics.totalRequests = 0;
    this.metrics.successfulRequests = 0;
    this.metrics.failedRequests = 0;
    this.metrics.rejectedRequests = 0;
    this.metrics.lastFailureTime = 0;
    this.metrics.lastErrorCode = '';
    this.metrics.stateChanges++;
    this.metrics.halfOpenAttempts = 0;

    this.emitEvent(CircuitBreakerEventType.STATE_CHANGE, {
      newState: CircuitState.CLOSED,
      reason: 'Manual reset',
    });
  }

  /**
   * Manually force circuit to OPEN state
   */
  forceOpen(): void {
    if (this.state !== CircuitState.OPEN) {
      this.state = CircuitState.OPEN;
      this.lastOpenTime = Date.now();
      this.consecutiveSuccesses = 0;
      this.metrics.stateChanges++;
      this.emitEvent(CircuitBreakerEventType.STATE_CHANGE, {
        newState: CircuitState.OPEN,
        reason: 'Manually forced open',
      });
    }
  }

  /**
   * Get success rate percentage
   * @returns Success rate as percentage (0-100), or 0 if no requests
   */
  getSuccessRate(): number {
    if (this.metrics.totalRequests === 0) {
      return 0;
    }
    return (this.metrics.successfulRequests / this.metrics.totalRequests) * 100;
  }

  /**
   * Get failure rate percentage
   * @returns Failure rate as percentage (0-100), or 0 if no requests
   */
  getFailureRate(): number {
    if (this.metrics.totalRequests === 0) {
      return 0;
    }
    return (this.metrics.failedRequests / this.metrics.totalRequests) * 100;
  }

  /**
   * Get rejection rate percentage
   * @returns Rejection rate as percentage (0-100), or 0 if no requests
   */
  getRejectionRate(): number {
    if (this.metrics.totalRequests === 0) {
      return 0;
    }
    return (this.metrics.rejectedRequests / this.metrics.totalRequests) * 100;
  }
}

/**
 * Error thrown when circuit breaker rejects a request
 */
export class CircuitBreakerOpenError extends Error {
  readonly name = 'CircuitBreakerOpenError';
  readonly timeUntilRetry: number;

  /**
   * Create a new CircuitBreakerOpenError
   * @param message - Error message
   * @param timeUntilRetry - Milliseconds until circuit will attempt recovery
   */
  constructor(message: string, timeUntilRetry: number) {
    super(message);
    this.timeUntilRetry = timeUntilRetry;
    Object.setPrototypeOf(this, CircuitBreakerOpenError.prototype);
  }
}
