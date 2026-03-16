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
import { BaseError } from '../error-system/error-taxonomy.js';
/**
 * Circuit breaker states
 * @enum {string}
 */
export var CircuitState;
(function (CircuitState) {
    /** Normal operation, requests pass through */
    CircuitState["CLOSED"] = "CLOSED";
    /** Failures detected, requests rejected immediately */
    CircuitState["OPEN"] = "OPEN";
    /** Testing if service recovered, selective requests allowed */
    CircuitState["HALF_OPEN"] = "HALF_OPEN";
})(CircuitState || (CircuitState = {}));
/**
 * Circuit breaker event types
 * @enum {string}
 */
export var CircuitBreakerEventType;
(function (CircuitBreakerEventType) {
    CircuitBreakerEventType["STATE_CHANGE"] = "stateChange";
    CircuitBreakerEventType["REQUEST_REJECTED"] = "requestRejected";
    CircuitBreakerEventType["EXECUTION_SUCCESS"] = "executionSuccess";
    CircuitBreakerEventType["EXECUTION_FAILURE"] = "executionFailure";
})(CircuitBreakerEventType || (CircuitBreakerEventType = {}));
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
    /**
     * Create a new CircuitBreaker instance
     * @param config - Configuration options
     */
    constructor(config = {}) {
        this.state = CircuitState.CLOSED;
        this.failureRecords = [];
        this.lastOpenTime = 0;
        this.consecutiveSuccesses = 0;
        this.metrics = {
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
        this.eventHandlers = new Set();
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
    on(handler) {
        this.eventHandlers.add(handler);
    }
    /**
     * Unregister an event handler
     * @param handler - Event handler function to remove
     */
    off(handler) {
        this.eventHandlers.delete(handler);
    }
    /**
     * Emit an event to all registered handlers
     * @param eventType - Type of event
     * @param details - Additional event details
     */
    emitEvent(eventType, details) {
        for (const handler of Array.from(this.eventHandlers)) {
            handler(eventType, this.state, details);
        }
    }
    /**
     * Clean up old failures outside the time window
     */
    cleanupOldFailures() {
        const now = Date.now();
        const cutoffTime = now - this.windowSize;
        this.failureRecords = this.failureRecords.filter((record) => record.timestamp > cutoffTime);
        this.metrics.currentFailureCount = this.failureRecords.length;
    }
    /**
     * Record a failure in the failure window
     * @param error - The error that occurred
     */
    recordFailure(error) {
        const errorCode = error instanceof BaseError ? error.code : 'UNKNOWN';
        const errorType = error.constructor.name;
        const record = {
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
    shouldOpen() {
        this.cleanupOldFailures();
        return this.failureRecords.length >= this.failureThreshold;
    }
    /**
     * Transition to OPEN state
     */
    transitionToOpen() {
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
    shouldAttemptHalfOpen() {
        const now = Date.now();
        return now - this.lastOpenTime >= this.timeout;
    }
    /**
     * Transition to HALF_OPEN state
     */
    transitionToHalfOpen() {
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
    transitionToClosed() {
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
    recordSuccess() {
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
    async execute(fn) {
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
            throw new CircuitBreakerOpenError('Circuit breaker is open, request rejected', this.getRemainingTimeout());
        }
        try {
            const result = await fn();
            this.recordSuccess();
            return result;
        }
        catch (error) {
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
    getState() {
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
    getRemainingTimeout() {
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
    getMetrics() {
        return { ...this.metrics };
    }
    /**
     * Manually reset the circuit breaker to CLOSED state
     */
    reset() {
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
    forceOpen() {
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
    getSuccessRate() {
        if (this.metrics.totalRequests === 0) {
            return 0;
        }
        return (this.metrics.successfulRequests / this.metrics.totalRequests) * 100;
    }
    /**
     * Get failure rate percentage
     * @returns Failure rate as percentage (0-100), or 0 if no requests
     */
    getFailureRate() {
        if (this.metrics.totalRequests === 0) {
            return 0;
        }
        return (this.metrics.failedRequests / this.metrics.totalRequests) * 100;
    }
    /**
     * Get rejection rate percentage
     * @returns Rejection rate as percentage (0-100), or 0 if no requests
     */
    getRejectionRate() {
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
    /**
     * Create a new CircuitBreakerOpenError
     * @param message - Error message
     * @param timeUntilRetry - Milliseconds until circuit will attempt recovery
     */
    constructor(message, timeUntilRetry) {
        super(message);
        this.name = 'CircuitBreakerOpenError';
        this.timeUntilRetry = timeUntilRetry;
        Object.setPrototypeOf(this, CircuitBreakerOpenError.prototype);
    }
}
