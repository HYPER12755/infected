/**
 * @fileoverview Retry Strategy Implementation
 * Provides exponential backoff retry mechanism with jitter, event emission,
 * and integration with the error taxonomy system.
 *
 * @module core/recovery/retry-strategy
 */

import { BaseError } from '../error-system/error-taxonomy.js';
import { NetworkError } from '../error-system/error-categories.js';
import { ErrorSeverity, NetworkErrorCode } from '../error-system/error-taxonomy.js';

/**
 * Configuration options for retry strategy
 * @interface RetryConfig
 */
export interface RetryConfig {
  /** Maximum number of attempts (default: 3) */
  maxAttempts?: number;
  /** Initial delay in milliseconds (default: 100) */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs?: number;
  /** Exponential backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Enable jitter to prevent thundering herd (default: true) */
  useJitter?: boolean;
  /** Jitter range as percentage (default: 0.25 for ±25%) */
  jitterFraction?: number;
}

/**
 * Context information during retry attempts
 * Provides visibility into current retry state and history
 * @interface RetryContext
 */
export interface RetryContext {
  /** Maximum number of retry attempts */
  maxAttempts: number;
  /** Current attempt number (1-indexed) */
  currentAttempt: number;
  /** Last error encountered (if any) */
  lastError?: BaseError;
  /** Total accumulated delay in milliseconds */
  totalDelayMs: number;
  /** Calculated delay for next attempt in milliseconds */
  nextDelayMs: number;
}

/**
 * Event payload for retry events
 * @interface RetryEvent
 */
interface RetryEvent {
  /** Current attempt number */
  attempt: number;
  /** Total delay accumulated so far */
  totalDelayMs: number;
  /** Delay before next attempt */
  nextDelayMs: number;
  /** The error that triggered retry */
  error: BaseError;
}

/**
 * Event handler type for retry events
 */
type RetryEventHandler = (event: RetryEvent) => void;

/**
 * Retry Strategy Implementation
 *
 * Implements exponential backoff with optional jitter for reliable
 * execution of async operations. Integrates with error taxonomy to
 * determine when retries should occur.
 *
 * @example
 * ```typescript
 * const strategy = new RetryStrategy({
 *   maxAttempts: 5,
 *   initialDelayMs: 100,
 *   maxDelayMs: 10000,
 *   useJitter: true
 * });
 *
 * strategy.on('retry', (event) => {
 *   console.log(`Retry attempt ${event.attempt}, next delay: ${event.nextDelayMs}ms`);
 * });
 *
 * try {
 *   const result = await strategy.execute(() => fetchData());
 * } catch (error) {
 *   console.error('All retries exhausted:', error);
 * }
 * ```
 */
export class RetryStrategy {
  private config: Required<RetryConfig>;
  private eventHandlers: Map<string, Set<RetryEventHandler>>;

  /**
   * Creates a new RetryStrategy instance
   * @param config - Configuration options for retry behavior
   */
  constructor(config: RetryConfig = {}) {
    this.config = {
      maxAttempts: config.maxAttempts ?? 3,
      initialDelayMs: config.initialDelayMs ?? 100,
      maxDelayMs: config.maxDelayMs ?? 30000,
      backoffMultiplier: config.backoffMultiplier ?? 2,
      useJitter: config.useJitter ?? true,
      jitterFraction: config.jitterFraction ?? 0.25,
    };

    this.eventHandlers = new Map();
    this.validateConfig();
  }

  /**
   * Validates configuration parameters
   * @throws {Error} If configuration is invalid
   * @private
   */
  private validateConfig(): void {
    if (this.config.maxAttempts < 1) {
      throw new Error('maxAttempts must be at least 1');
    }

    if (this.config.initialDelayMs < 0) {
      throw new Error('initialDelayMs must be non-negative');
    }

    if (this.config.maxDelayMs < this.config.initialDelayMs) {
      throw new Error('maxDelayMs must be >= initialDelayMs');
    }

    if (this.config.backoffMultiplier <= 1) {
      throw new Error('backoffMultiplier must be > 1');
    }

    if (this.config.jitterFraction < 0 || this.config.jitterFraction > 1) {
      throw new Error('jitterFraction must be between 0 and 1');
    }
  }

  /**
   * Registers an event handler
   * @param event - Event type ('retry', 'retrySuccess', 'retryFailure')
   * @param handler - Callback function to execute
   * @returns This strategy instance for method chaining
   *
   * @example
   * ```typescript
   * strategy.on('retry', (event) => {
   *   metrics.recordRetry(event.attempt);
   * });
   * ```
   */
  public on(event: 'retry' | 'retrySuccess' | 'retryFailure', handler: (payload: any) => void): this {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }

    this.eventHandlers.get(event)!.add(handler as RetryEventHandler);
    return this;
  }

  /**
   * Removes an event handler
   * @param event - Event type
   * @param handler - Handler to remove
   * @returns This strategy instance for method chaining
   */
  public off(event: 'retry' | 'retrySuccess' | 'retryFailure', handler: (payload: any) => void): this {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler as RetryEventHandler);
    }

    return this;
  }

  /**
   * Emits an event to all registered handlers
   * @param event - Event type
   * @param payload - Event payload
   * @private
   */
  private emit(event: string, payload: any): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(payload);
        } catch (error) {
          console.error(`Error in ${event} handler:`, error);
        }
      });
    }
  }

  /**
   * Calculates delay for the given attempt number
   * Applies exponential backoff with optional jitter
   * @param attemptNumber - The attempt number (1-indexed)
   * @returns Calculated delay in milliseconds
   * @private
   */
  private calculateDelay(attemptNumber: number): number {
    if (attemptNumber === 1) {
      return 0;
    }

    // Exponential backoff: initialDelay * (multiplier ^ (attempt - 2))
    const exponentialDelay =
      this.config.initialDelayMs * Math.pow(this.config.backoffMultiplier, attemptNumber - 2);

    // Cap at maximum delay
    const cappedDelay = Math.min(exponentialDelay, this.config.maxDelayMs);

    // Apply jitter if enabled
    if (this.config.useJitter) {
      return this.applyJitter(cappedDelay);
    }

    return cappedDelay;
  }

  /**
   * Applies jitter to delay to prevent thundering herd
   * Adds random variance of ±jitterFraction
   * @param delay - Base delay in milliseconds
   * @returns Jittered delay in milliseconds
   * @private
   */
  private applyJitter(delay: number): number {
    const jitterAmount = delay * this.config.jitterFraction;
    const minDelay = delay - jitterAmount;
    const maxDelay = delay + jitterAmount;

    // Generate random delay within jitter range
    return minDelay + Math.random() * (maxDelay - minDelay);
  }

  /**
   * Creates a delay promise that can be cancelled
   * @param ms - Delay duration in milliseconds
   * @returns Promise that resolves after delay
   * @private
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  /**
   * Executes an async function with retry logic
   * Automatically retries on retryable errors with exponential backoff
   *
   * @template T - The return type of the function
   * @param fn - Async function to execute
   * @param context - Optional retry context (will be created if not provided)
   * @returns Promise resolving to the function result
   * @throws {BaseError} If all retries are exhausted or function fails with non-retryable error
   *
   * @example
   * ```typescript
   * const result = await strategy.execute(async () => {
   *   const response = await fetch('https://api.example.com/data');
   *   if (!response.ok) throw new Error('API error');
   *   return response.json();
   * });
   * ```
   *
   * @example
   * ```typescript
   * // With context
   * const context: RetryContext = {
   *   maxAttempts: 5,
   *   currentAttempt: 1,
   *   totalDelayMs: 0,
   *   nextDelayMs: 100
   * };
   *
   * const result = await strategy.execute(fetchData, context);
   * ```
   */
  public async execute<T>(fn: () => Promise<T>, context?: RetryContext): Promise<T> {
    const retryContext: RetryContext = context || {
      maxAttempts: this.config.maxAttempts,
      currentAttempt: 1,
      totalDelayMs: 0,
      nextDelayMs: 0,
    };

    // Ensure required fields exist
    retryContext.maxAttempts = retryContext.maxAttempts || this.config.maxAttempts;

    let lastError: BaseError | undefined;

    while (retryContext.currentAttempt <= retryContext.maxAttempts) {
      try {
        const result = await fn();

        // Success - emit success event
        if (retryContext.currentAttempt > 1) {
          this.emit('retrySuccess', {
            attempt: retryContext.currentAttempt,
            totalDelayMs: retryContext.totalDelayMs,
          });
        }

        return result;
      } catch (error: unknown) {
        // Convert error to BaseError if needed
        const baseError = this.normalizeError(error);
        lastError = baseError;

        // Check if error is retryable
         if (!baseError.canRetry()) {
           // Non-retryable error - fail immediately
           throw baseError;
         }

        // Check if we've exhausted retries
        if (retryContext.currentAttempt >= retryContext.maxAttempts) {
          // All retries exhausted
          this.emit('retryFailure', {
            attempt: retryContext.currentAttempt,
            totalDelayMs: retryContext.totalDelayMs,
            error: baseError,
          });

           // Add retry metadata to error context if it has a context property
           if (typeof baseError.context === 'object' && baseError.context !== null) {
             (baseError.context as Record<string, unknown>).retryAttempts = retryContext.currentAttempt;
             (baseError.context as Record<string, unknown>).totalRetryDelayMs = retryContext.totalDelayMs;
             (baseError.context as Record<string, unknown>).retryExhausted = true;
           }

          throw baseError;
        }

        // Calculate delay for next attempt
        const nextDelay = this.calculateDelay(retryContext.currentAttempt + 1);
        retryContext.nextDelayMs = Math.round(nextDelay);
        retryContext.totalDelayMs += retryContext.nextDelayMs;

        // Emit retry event
        this.emit('retry', {
          attempt: retryContext.currentAttempt,
          totalDelayMs: retryContext.totalDelayMs,
          nextDelayMs: retryContext.nextDelayMs,
          error: baseError,
        } as RetryEvent);

        // Wait before retry
        await this.sleep(retryContext.nextDelayMs);

        // Increment attempt counter
        retryContext.currentAttempt++;
      }
    }

    // This should not be reachable, but included for type safety
    if (lastError) {
      throw lastError;
    }

    throw new Error('Retry loop exited unexpectedly');
  }

  /**
   * Normalizes error to BaseError instance
   * @param error - Error to normalize
   * @returns BaseError instance
   * @private
   */
  private normalizeError(error: unknown): BaseError {
     if (error instanceof BaseError) {
       return error;
     }

     if (error instanceof Error) {
       return new NetworkError(error.message, {
         code: NetworkErrorCode.PROTOCOL_ERROR,
         severity: ErrorSeverity.HIGH,
         retryable: true,
         context: {
           cause: error,
         } as Record<string, unknown>,
         originalError: error,
       });
     }

     return new NetworkError(String(error), {
       code: NetworkErrorCode.PROTOCOL_ERROR,
       severity: ErrorSeverity.HIGH,
       retryable: true,
       context: {} as Record<string, unknown>,
     });
   }

  /**
   * Gets current configuration
   * @returns Copy of current retry configuration
   */
  public getConfig(): Readonly<RetryConfig> {
    return Object.freeze({ ...this.config });
  }

  /**
   * Creates a new strategy with updated configuration
   * @param updates - Partial configuration updates
   * @returns New RetryStrategy instance with merged config
   *
   * @example
   * ```typescript
   * const aggressiveStrategy = strategy.withConfig({
   *   maxAttempts: 10,
   *   initialDelayMs: 50
   * });
   * ```
   */
  public withConfig(updates: RetryConfig): RetryStrategy {
    return new RetryStrategy({
      ...this.config,
      ...updates,
    });
  }

  /**
   * Creates a context for tracking retry state
   * Useful for passing between functions or storing retry history
   * @returns New RetryContext instance
   */
  public createContext(): RetryContext {
    return {
      maxAttempts: this.config.maxAttempts,
      currentAttempt: 1,
      totalDelayMs: 0,
      nextDelayMs: 0,
    };
  }

  /**
   * Calculates estimated maximum retry time
   * Useful for setting timeout values
   * @returns Maximum possible time in milliseconds for all retries
   *
   * @example
   * ```typescript
   * const maxTime = strategy.estimateMaxRetryTime();
   * const timeout = maxTime + 5000; // Add buffer for execution time
   * ```
   */
  public estimateMaxRetryTime(): number {
    let totalTime = 0;

    for (let attempt = 2; attempt <= this.config.maxAttempts; attempt++) {
      const delayWithoutJitter =
        this.config.initialDelayMs *
        Math.pow(this.config.backoffMultiplier, attempt - 2);
      const cappedDelay = Math.min(delayWithoutJitter, this.config.maxDelayMs);

      // Add maximum jitter
      const delayWithJitter = this.config.useJitter
        ? cappedDelay * (1 + this.config.jitterFraction)
        : cappedDelay;

      totalTime += delayWithJitter;
    }

    return Math.round(totalTime);
  }
}

/**
 * Factory function to create a retry strategy with common presets
 * @param preset - Preset name ('aggressive', 'moderate', 'conservative')
 * @returns Configured RetryStrategy instance
 *
 * @example
 * ```typescript
 * const strategy = createRetryStrategy('aggressive');
 * const result = await strategy.execute(() => fetchWithRetries());
 * ```
 */
export function createRetryStrategy(
  preset: 'aggressive' | 'moderate' | 'conservative' = 'moderate'
): RetryStrategy {
  const presets: Record<string, RetryConfig> = {
    aggressive: {
      maxAttempts: 10,
      initialDelayMs: 50,
      maxDelayMs: 5000,
      backoffMultiplier: 1.5,
      useJitter: true,
    },
    moderate: {
      maxAttempts: 3,
      initialDelayMs: 100,
      maxDelayMs: 30000,
      backoffMultiplier: 2,
      useJitter: true,
    },
    conservative: {
      maxAttempts: 2,
      initialDelayMs: 500,
      maxDelayMs: 10000,
      backoffMultiplier: 2,
      useJitter: false,
    },
  };

  return new RetryStrategy(presets[preset]);
}
