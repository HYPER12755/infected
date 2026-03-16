import { RetryStrategy } from './retry-strategy.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { BaseError, ErrorSeverity, NetworkErrorCode } from '../error-system/error-taxonomy.js';
import { NetworkError } from '../error-system/error-categories.js';
/**
 * RecoveryHandler - Main orchestrator for error recovery
 *
 * Coordinates RetryStrategy and CircuitBreaker while managing error-type specific
 * recovery logic. Tracks metrics and success rates for monitoring.
 *
 * @example
 * ```typescript
 * const config: RecoveryHandlerConfig = {
 *   enableRetry: true,
 *   enableCircuitBreaker: true,
 *   retry: {
 *     maxRetries: 3,
 *     initialDelayMs: 100,
 *     maxDelayMs: 5000,
 *     backoffMultiplier: 2,
 *     jitterFactor: 0.1
 *   },
 *   circuitBreaker: {
 *     failureThreshold: 5,
 *     successThreshold: 2,
 *     timeoutMs: 60000,
 *     halfOpenMaxAttempts: 1
 *   },
 *   recoveryHandlers: new Map()
 * };
 *
 * const handler = new RecoveryHandler(config);
 *
 * // Register custom recovery for network errors
 * handler.registerRecoveryHandler('NETWORK_ERROR', async (error, context) => {
 *   console.log(`Network error on attempt ${context.attempt}`);
 *   // Perform cleanup, reset connections, etc.
 * });
 *
 * // Execute with recovery
 * try {
 *   const result = await handler.executeWithRecovery(
 *     () => fetchData(),
 *     { circuitBreakerName: 'api-calls', tag: 'fetch-users' }
 *   );
 * } catch (error) {
 *   console.error('Operation failed after retries:', error);
 * }
 *
 * // Monitor recovery effectiveness
 * const metrics = handler.getRecoveryMetrics();
 * console.log(`Success rate: ${metrics.successRate}%`);
 * ```
 */
export class RecoveryHandler {
    /**
     * Creates a new RecoveryHandler instance
     *
     * @param config - Configuration object for recovery handling
     */
    constructor(config) {
        this.defaultCircuitBreakerName = '__default__';
        this.config = config;
        this.circuitBreakers = new Map();
        this.recoveryHandlers = new Map(config.recoveryHandlers);
        this.eventListeners = new Map();
        this.metrics = {
            totalExecutions: 0,
            successfulExecutions: 0,
            failedExecutions: 0,
            retriedExecutions: 0,
            circuitBreakerRejections: 0,
            recoveryHandlerInvocations: 0,
            totalRetries: 0
        };
        // Initialize retry strategy if enabled
        if (config.enableRetry) {
            this.retryStrategy = new RetryStrategy(config.retry);
        }
        else {
            this.retryStrategy = null;
        }
        // Initialize default circuit breaker if enabled
        if (config.enableCircuitBreaker) {
            this.getOrCreateCircuitBreaker(this.defaultCircuitBreakerName);
        }
    }
    /**
     * Executes a function with full recovery support (retry + circuit breaker)
     *
     * Coordinates retry strategy and circuit breaker, invokes recovery handlers,
     * tracks metrics, and emits events throughout execution lifecycle.
     *
     * @template T - Return type of the execution function
     * @param fn - The async function to execute
     * @param options - Optional execution options
     * @returns Promise resolving to the function result
     * @throws BaseError - If execution fails after all retries and recovery attempts
     *
     * @example
     * ```typescript
     * const result = await handler.executeWithRecovery(
     *   async () => {
     *     const response = await fetch('/api/users');
     *     return response.json();
     *   },
     *   { circuitBreakerName: 'api', timeout: 5000, tag: 'getUserList' }
     * );
     * ```
     */
    async executeWithRecovery(fn, options = {}) {
        const startTime = Date.now();
        const tag = options.tag || 'unknown';
        const circuitBreakerName = options.circuitBreakerName || this.defaultCircuitBreakerName;
        this.metrics.totalExecutions++;
        this.emitEvent({
            type: 'executionStart',
            timestamp: startTime,
            tag,
            metadata: options.metadata
        });
        let lastError = null;
        let attemptNumber = 0;
        let executedRetries = 0;
        // Execution loop with retry and circuit breaker support
        while (true) {
            attemptNumber++;
            try {
                // Execute with circuit breaker and optional timeout
                if (this.config.enableCircuitBreaker) {
                    const circuitBreaker = this.getOrCreateCircuitBreaker(circuitBreakerName);
                    const result = options.timeout
                        ? await circuitBreaker.execute(() => this.executeWithTimeout(fn, options.timeout))
                        : await circuitBreaker.execute(fn);
                    // Record success
                    this.metrics.successfulExecutions++;
                    this.emitEvent({
                        type: 'executionSuccess',
                        timestamp: Date.now(),
                        tag,
                        metadata: { attempts: attemptNumber, duration: Date.now() - startTime }
                    });
                    return result;
                }
                else {
                    // Execute with optional timeout only
                    const result = options.timeout
                        ? await this.executeWithTimeout(fn, options.timeout)
                        : await fn();
                    // Record success
                    this.metrics.successfulExecutions++;
                    this.emitEvent({
                        type: 'executionSuccess',
                        timestamp: Date.now(),
                        tag,
                        metadata: { attempts: attemptNumber, duration: Date.now() - startTime }
                    });
                    return result;
                }
            }
            catch (error) {
                lastError = this.normalizeError(error);
                const willRetry = this.shouldRetry(attemptNumber);
                // Build recovery context
                const context = {
                    errorCode: lastError.code,
                    severity: lastError.severity,
                    timestamp: Date.now(),
                    attempt: attemptNumber,
                    willRetry,
                    executionPath: options.tag || 'unknown'
                };
                // Invoke recovery handler if registered for this error type
                await this.invokeRecoveryHandler(lastError, context);
                // If no retry, emit failure and throw
                if (!willRetry) {
                    this.metrics.failedExecutions++;
                    this.emitEvent({
                        type: 'executionFailure',
                        timestamp: Date.now(),
                        tag,
                        metadata: {
                            error: lastError.code,
                            attempts: attemptNumber,
                            duration: Date.now() - startTime
                        }
                    });
                    throw lastError;
                }
                // Prepare for retry
                executedRetries++;
                this.metrics.retriedExecutions++;
                this.metrics.totalRetries++;
                // Get delay before next retry using exponential backoff
                const delayMs = this.calculateBackoffDelay(attemptNumber);
                await this.sleep(delayMs);
            }
        }
    }
    /**
     * Registers a recovery handler for a specific error code
     *
     * Recovery handlers are called after an error is caught but before retry.
     * They can perform cleanup, logging, state reset, etc.
     *
     * @param errorCode - The error code to handle
     * @param handler - The recovery function to invoke
     *
     * @example
     * ```typescript
     * handler.registerRecoveryHandler('DATABASE_CONNECTION_ERROR', async (error, context) => {
     *   console.error(`Database error on attempt ${context.attempt}`);
     *   // Reset connection pool
     *   await database.resetConnectionPool();
     * });
     * ```
     */
    registerRecoveryHandler(errorCode, handler) {
        this.recoveryHandlers.set(errorCode, handler);
    }
    /**
     * Unregisters a recovery handler for a specific error code
     *
     * @param errorCode - The error code to unregister
     * @returns true if handler was found and removed, false otherwise
     */
    unregisterRecoveryHandler(errorCode) {
        return this.recoveryHandlers.delete(errorCode);
    }
    /**
     * Gets current recovery metrics
     *
     * Metrics include execution counts, retry statistics, circuit breaker rejections,
     * and calculated values like success rate and average retries.
     *
     * @returns Current RecoveryMetrics snapshot
     *
     * @example
     * ```typescript
     * const metrics = handler.getRecoveryMetrics();
     * console.log(`Success rate: ${metrics.successRate}%`);
     * console.log(`Average retries: ${metrics.averageRetries}`);
     * ```
     */
    getRecoveryMetrics() {
        const successful = this.metrics.successfulExecutions;
        const failed = this.metrics.failedExecutions;
        const total = successful + failed;
        const successRate = total === 0 ? 0 : Math.round((successful / total) * 100);
        const averageRetries = this.metrics.retriedExecutions === 0
            ? 0
            : Math.round((this.metrics.totalRetries / this.metrics.retriedExecutions) * 100) / 100;
        return {
            totalExecutions: this.metrics.totalExecutions,
            successfulExecutions: this.metrics.successfulExecutions,
            failedExecutions: this.metrics.failedExecutions,
            retriedExecutions: this.metrics.retriedExecutions,
            circuitBreakerRejections: this.metrics.circuitBreakerRejections,
            recoveryHandlerInvocations: this.metrics.recoveryHandlerInvocations,
            averageRetries,
            successRate
        };
    }
    /**
     * Resets all metrics and state
     *
     * Clears execution metrics and circuit breaker state. Useful for testing
     * or when starting a new monitoring period.
     *
     * @example
     * ```typescript
     * handler.resetAll();
     * // Metrics are now at zero
     * ```
     */
    resetAll() {
        this.metrics = {
            totalExecutions: 0,
            successfulExecutions: 0,
            failedExecutions: 0,
            retriedExecutions: 0,
            circuitBreakerRejections: 0,
            recoveryHandlerInvocations: 0,
            totalRetries: 0
        };
        this.circuitBreakers.forEach((cb) => cb.reset());
    }
    /**
     * Subscribes to recovery events
     *
     * @param eventType - Type of event to listen for
     * @param listener - Callback function
     * @returns Unsubscribe function
     */
    onEvent(eventType, listener) {
        const key = `${eventType}-${Math.random()}`;
        this.eventListeners.set(key, (event) => {
            if (event.type === eventType) {
                listener(event);
            }
        });
        return () => {
            this.eventListeners.delete(key);
        };
    }
    /**
     * Gets or creates a circuit breaker with the given name
     *
     * @param name - Unique name for the circuit breaker
     * @returns The circuit breaker instance
     */
    getOrCreateCircuitBreaker(name) {
        if (!this.circuitBreakers.has(name)) {
            this.circuitBreakers.set(name, new CircuitBreaker(this.config.circuitBreaker));
        }
        return this.circuitBreakers.get(name);
    }
    /**
     * Determines if execution should be retried
     *
     * @param attemptNumber - Current attempt number
     * @returns true if should retry, false otherwise
     */
    shouldRetry(attemptNumber) {
        if (!this.config.enableRetry || !this.retryStrategy) {
            return false;
        }
        // Check if we haven't exceeded max attempts yet
        return attemptNumber < this.config.retry.maxRetries;
    }
    /**
     * Invokes registered recovery handler for error code if it exists
     * Failures in recovery handlers don't prevent retry
     *
     * @param error - The error that occurred
     * @param context - Recovery context
     */
    async invokeRecoveryHandler(error, context) {
        const handler = this.recoveryHandlers.get(error.code);
        if (!handler) {
            return;
        }
        this.metrics.recoveryHandlerInvocations++;
        try {
            await handler(error, context);
            this.emitEvent({
                type: 'recoveryApplied',
                timestamp: Date.now(),
                metadata: { errorCode: error.code, attempt: context.attempt }
            });
        }
        catch (handlerError) {
            // Recovery handler errors don't prevent retry
            console.warn(`Recovery handler for ${error.code} failed:`, handlerError instanceof Error ? handlerError.message : String(handlerError));
        }
    }
    /**
     * Normalizes caught errors to BaseError
     *
     * @param error - Unknown error object
     * @returns Normalized BaseError instance
     */
    normalizeError(error) {
        if (error instanceof BaseError) {
            return error;
        }
        if (error instanceof Error) {
            return new NetworkError(error.message, {
                code: NetworkErrorCode.PROTOCOL_ERROR,
                severity: ErrorSeverity.HIGH,
                retryable: true,
                context: {},
                originalError: error,
            });
        }
        return new NetworkError(typeof error === 'string' ? error : 'Unknown error occurred', {
            code: NetworkErrorCode.PROTOCOL_ERROR,
            severity: ErrorSeverity.HIGH,
            retryable: true,
            context: {},
        });
    }
    /**
     * Executes a function with timeout
     *
     * @template T - Return type of the function
     * @param fn - The async function to execute
     * @param timeoutMs - Timeout in milliseconds
     * @returns Promise that resolves to function result or rejects on timeout
     */
    executeWithTimeout(fn, timeoutMs) {
        return Promise.race([
            fn(),
            new Promise((_, reject) => setTimeout(() => {
                reject(new NetworkError(`Execution exceeded ${timeoutMs}ms timeout`, {
                    code: NetworkErrorCode.CONNECTION_TIMEOUT,
                    severity: ErrorSeverity.HIGH,
                    retryable: true,
                    context: { timeoutMs },
                }));
            }, timeoutMs))
        ]);
    }
    /**
     * Calculates exponential backoff delay for retry attempt
     * @param attemptNumber - The current attempt number
     * @returns Delay in milliseconds
     */
    calculateBackoffDelay(attemptNumber) {
        if (attemptNumber === 1) {
            return 0;
        }
        const exponentialDelay = this.config.retry.initialDelayMs *
            Math.pow(this.config.retry.backoffMultiplier, attemptNumber - 2);
        const cappedDelay = Math.min(exponentialDelay, this.config.retry.maxDelayMs);
        // Apply jitter
        const jitterAmount = cappedDelay * this.config.retry.jitterFactor;
        const minDelay = cappedDelay - jitterAmount;
        const maxDelay = cappedDelay + jitterAmount;
        return minDelay + Math.random() * (maxDelay - minDelay);
    }
    /**
     * Sleeps for specified milliseconds
     *
     * @param ms - Milliseconds to sleep
     */
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    /**
     * Emits recovery events to registered listeners
     *
     * @param event - The event to emit
     */
    emitEvent(event) {
        this.eventListeners.forEach((listener) => {
            try {
                listener(event);
            }
            catch (error) {
                // Event listener errors don't affect execution
                console.warn('Error in event listener:', error instanceof Error ? error.message : String(error));
            }
        });
    }
}
