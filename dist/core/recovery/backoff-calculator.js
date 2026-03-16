/**
 * BackoffCalculator - Exponential, Linear, and other retry backoff strategies
 *
 * Provides multiple backoff algorithms with optional jitter for distributed
 * retry scenarios. All methods are pure functions with no side effects.
 *
 * @module BackoffCalculator
 */
/**
 * Backoff calculation strategies with mathematical formulas and jitter support.
 *
 * Performance note: All operations are O(1) with negligible overhead.
 * Safe for millions of invocations per second.
 */
export class BackoffCalculator {
    /**
     * Exponential backoff strategy
     *
     * Formula: min(baseDelay * (multiplier ^ attempt), maxDelay)
     *
     * @example
     * // Doubles each attempt: 100ms, 200ms, 400ms, 800ms...
     * BackoffCalculator.exponential(0, 100, 2, 30000); // 100ms
     * BackoffCalculator.exponential(1, 100, 2, 30000); // 200ms
     * BackoffCalculator.exponential(5, 100, 2, 30000); // 3200ms
     * BackoffCalculator.exponential(10, 100, 2, 30000); // 30000ms (capped)
     *
     * Ideal for: General-purpose retries, network requests, API calls
     * Time to max: ~log(maxDelay/baseDelay) attempts
     *
     * @param attempt - Attempt number (0-indexed)
     * @param baseDelay - Initial delay in milliseconds
     * @param multiplier - Growth factor (typically 2)
     * @param maxDelay - Maximum delay in milliseconds
     * @returns Calculated delay in milliseconds
     */
    static exponential(attempt, baseDelay, multiplier, maxDelay) {
        const delay = baseDelay * Math.pow(multiplier, Math.max(0, attempt));
        return BackoffCalculator.clampDelay(delay, baseDelay, maxDelay);
    }
    /**
     * Linear backoff strategy
     *
     * Formula: min(baseDelay + (increment * attempt), maxDelay)
     *
     * @example
     * // Increases by 100ms each attempt: 100ms, 200ms, 300ms, 400ms...
     * BackoffCalculator.linear(0, 100, 100, 5000); // 100ms
     * BackoffCalculator.linear(1, 100, 100, 5000); // 200ms
     * BackoffCalculator.linear(10, 100, 100, 5000); // 1100ms
     * BackoffCalculator.linear(50, 100, 100, 5000); // 5000ms (capped)
     *
     * Ideal for: Load-based backoffs, rate limiting, steady retry patterns
     * Time to max: (maxDelay - baseDelay) / increment attempts
     *
     * @param attempt - Attempt number (0-indexed)
     * @param baseDelay - Initial delay in milliseconds
     * @param increment - Delay increase per attempt in milliseconds
     * @param maxDelay - Maximum delay in milliseconds
     * @returns Calculated delay in milliseconds
     */
    static linear(attempt, baseDelay, increment, maxDelay) {
        const delay = baseDelay + increment * Math.max(0, attempt);
        return BackoffCalculator.clampDelay(delay, baseDelay, maxDelay);
    }
    /**
     * Fibonacci backoff strategy
     *
     * Sequence: 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89...
     * Formula: min(baseDelay * fib(attempt), maxDelay)
     *
     * @example
     * // Fibonacci sequence: 100ms, 100ms, 200ms, 300ms, 500ms...
     * BackoffCalculator.fibonacci(0, 100, 30000); // 100ms
     * BackoffCalculator.fibonacci(1, 100, 30000); // 100ms
     * BackoffCalculator.fibonacci(2, 100, 30000); // 200ms
     * BackoffCalculator.fibonacci(5, 100, 30000); // 500ms
     * BackoffCalculator.fibonacci(10, 100, 30000); // 55000ms (capped)
     *
     * Ideal for: Cloud systems, natural backoff progression, AWS-recommended
     * Time to max: ~log_phi(maxDelay/baseDelay) attempts (slower than exponential)
     *
     * @param attempt - Attempt number (0-indexed)
     * @param baseDelay - Initial delay in milliseconds
     * @param maxDelay - Maximum delay in milliseconds
     * @returns Calculated delay in milliseconds
     */
    static fibonacci(attempt, baseDelay, maxDelay) {
        const fibs = [1, 1];
        const maxAttempt = Math.max(0, attempt);
        for (let i = 2; i <= maxAttempt; i++) {
            fibs[i] = fibs[i - 1] + fibs[i - 2];
            // Early exit if we exceed max possible value
            if (fibs[i] > maxDelay / baseDelay) {
                fibs[i] = Math.ceil(maxDelay / baseDelay);
                break;
            }
        }
        const multiplier = fibs[Math.min(maxAttempt, fibs.length - 1)];
        const delay = baseDelay * multiplier;
        return BackoffCalculator.clampDelay(delay, baseDelay, maxDelay);
    }
    /**
     * Polynomial backoff strategy
     *
     * Formula: min(baseDelay * (attempt ^ degree), maxDelay)
     *
     * @example
     * // Quadratic (degree=2): 100ms, 100ms, 400ms, 900ms, 1600ms...
     * BackoffCalculator.polynomial(0, 100, 2, 30000); // 100ms
     * BackoffCalculator.polynomial(1, 100, 2, 30000); // 100ms
     * BackoffCalculator.polynomial(2, 100, 2, 30000); // 400ms
     * BackoffCalculator.polynomial(3, 100, 2, 30000); // 900ms
     * BackoffCalculator.polynomial(10, 100, 2, 30000); // 10000ms
     *
     * // Cubic (degree=3): 100ms, 100ms, 800ms, 2700ms...
     * BackoffCalculator.polynomial(3, 100, 3, 30000); // 2700ms
     *
     * Ideal for: Custom growth patterns, fine-tuned retry behavior
     * Time to max: (maxDelay/baseDelay)^(1/degree) attempts
     *
     * @param attempt - Attempt number (0-indexed)
     * @param baseDelay - Initial delay in milliseconds
     * @param degree - Polynomial degree (2 for quadratic, 3 for cubic, etc.)
     * @param maxDelay - Maximum delay in milliseconds
     * @returns Calculated delay in milliseconds
     */
    static polynomial(attempt, baseDelay, degree, maxDelay) {
        const actualAttempt = Math.max(0, attempt);
        const delay = baseDelay * Math.pow(actualAttempt, degree);
        return BackoffCalculator.clampDelay(delay, baseDelay, maxDelay);
    }
    /**
     * Decorrelated jitter backoff strategy
     *
     * Combines exponential backoff with decorrelated jitter for distributed systems.
     * Formula: min(maxDelay, random(baseDelay, previousDelay * 3))
     *
     * Recommended by AWS and reduces thundering herd issues better than
     * simple exponential backoff with jitter.
     *
     * @example
     * // First attempt: random(100, 300)
     * BackoffCalculator.decorrelatedJitter(100, 100, 30000); // ~150ms
     * // Second attempt: random(100, 450)
     * BackoffCalculator.decorrelatedJitter(150, 100, 30000); // ~300ms
     * // Capped at maxDelay
     * BackoffCalculator.decorrelatedJitter(20000, 100, 30000); // ~30000ms
     *
     * Ideal for: Distributed systems, preventing synchronization, AWS recommended
     *
     * @param previousDelay - Previous delay value in milliseconds
     * @param baseDelay - Minimum delay in milliseconds
     * @param maxDelay - Maximum delay in milliseconds
     * @returns Calculated delay in milliseconds with decorrelated jitter
     */
    static decorrelatedJitter(previousDelay, baseDelay, maxDelay) {
        const maxRandomDelay = previousDelay * 3;
        const delay = baseDelay + Math.random() * (maxRandomDelay - baseDelay);
        return BackoffCalculator.clampDelay(delay, baseDelay, maxDelay);
    }
    /**
     * Add uniform jitter to a delay
     *
     * Applies ±jitterFraction to the delay value to desynchronize retries.
     * For example, with jitterFraction=0.1 and delay=1000ms:
     * Returns value between 900ms and 1100ms
     *
     * @param delay - Base delay in milliseconds
     * @param jitterFraction - Jitter as decimal (0.1 = ±10%)
     * @returns Delay with jitter applied
     */
    static addJitter(delay, jitterFraction = 0.1) {
        const jitterAmount = delay * jitterFraction;
        const minDelay = delay - jitterAmount;
        const maxDelay = delay + jitterAmount;
        return minDelay + Math.random() * (maxDelay - minDelay);
    }
    /**
     * Add full jitter (random delay between baseDelay and maxDelay)
     *
     * Provides maximum desynchronization by selecting uniformly random
     * delay between base and max. Better than addJitter for high contention.
     *
     * @param baseDelay - Minimum delay in milliseconds
     * @param maxDelay - Maximum delay in milliseconds
     * @returns Random delay between baseDelay and maxDelay
     */
    static addFullJitter(baseDelay, maxDelay) {
        return baseDelay + Math.random() * (maxDelay - baseDelay);
    }
    /**
     * Add equal jitter (AWS recommended formula)
     *
     * Formula: min(delay, baseDelay) + random(0, min_result / 2)
     * More balanced than full jitter, keeps minimum guaranteed delay.
     *
     * @example
     * // With delay=100, baseDelay=50
     * // Result: 50 + random(0, 25) => range [50, 75]
     *
     * @param delay - Calculated delay in milliseconds
     * @param baseDelay - Minimum delay in milliseconds
     * @returns Delay with equal jitter applied
     */
    static addEqualJitter(delay, baseDelay) {
        const minDelay = Math.min(delay, baseDelay);
        return minDelay + Math.random() * (minDelay / 2);
    }
    /**
     * Add decorrelated jitter for use with exponential backoff
     *
     * Formula: random(baseDelay, previousDelay * 3)
     * Recommended for distributed retry scenarios.
     *
     * @param previousDelay - Previous retry delay in milliseconds
     * @param baseDelay - Minimum delay in milliseconds
     * @param maxDelay - Maximum delay in milliseconds
     * @returns Delay with decorrelated jitter
     */
    static addDecorrelatedJitter(previousDelay, baseDelay, maxDelay) {
        const maxRandomDelay = previousDelay * 3;
        const delay = baseDelay + Math.random() * (maxRandomDelay - baseDelay);
        return BackoffCalculator.clampDelay(delay, baseDelay, maxDelay);
    }
    /**
     * Validate backoff parameters for correctness
     *
     * Checks:
     * - baseDelay > 0
     * - maxDelay >= baseDelay
     * - multiplier/increment/degree are positive if provided
     *
     * @param params - BackoffParams to validate
     * @returns true if valid, false otherwise
     */
    static validateBackoffParams(params) {
        const { baseDelay = 0, maxDelay = 0, multiplier, increment, degree, jitterFraction, } = params;
        if (baseDelay <= 0 || maxDelay <= 0) {
            return false;
        }
        if (maxDelay < baseDelay) {
            return false;
        }
        if (multiplier !== undefined && multiplier <= 0) {
            return false;
        }
        if (increment !== undefined && increment < 0) {
            return false;
        }
        if (degree !== undefined && degree <= 0) {
            return false;
        }
        if (jitterFraction !== undefined && (jitterFraction < 0 || jitterFraction > 1)) {
            return false;
        }
        return true;
    }
    /**
     * Clamp delay to valid range
     *
     * Ensures delay is within [minDelay, maxDelay] bounds.
     * Handles edge cases and prevents negative or infinity values.
     *
     * @param delay - Delay to clamp
     * @param minDelay - Minimum allowed delay
     * @param maxDelay - Maximum allowed delay
     * @returns Clamped delay value
     */
    static clampDelay(delay, minDelay, maxDelay) {
        // Handle invalid inputs
        if (!Number.isFinite(delay) || delay < 0) {
            return minDelay;
        }
        // Enforce bounds
        return Math.max(minDelay, Math.min(maxDelay, delay));
    }
    /**
     * Estimate the maximum total backoff time across all retry attempts
     *
     * Useful for determining SLA impact of retry strategy.
     * Assumes no jitter for worst-case estimation.
     *
     * @example
     * // Exponential: 100 * (2^10 - 1) ≈ 102,300ms
     * BackoffCalculator.estimateMaxBackoff(10, {
     *   baseDelay: 100,
     *   multiplier: 2,
     *   maxDelay: 30000,
     * });
     *
     * @param attempts - Number of retry attempts
     * @param params - Backoff parameters (uses baseDelay and maxDelay at minimum)
     * @returns Total accumulated delay in milliseconds
     */
    static estimateMaxBackoff(attempts, params) {
        const { baseDelay = 100, maxDelay = 30000 } = params;
        if (attempts <= 0 || baseDelay <= 0) {
            return 0;
        }
        let totalDelay = 0;
        for (let i = 0; i < attempts; i++) {
            // Use the maximum possible delay per attempt
            totalDelay += maxDelay;
        }
        return totalDelay;
    }
}
/**
 * Preset backoff configurations for common scenarios
 */
/**
 * Aggressive backoff: Fast recovery for critical failures
 *
 * Exponential growth from 50ms to 5s, suitable for:
 * - Critical service dependencies
 * - Internal service-to-service calls
 * - Operations that must recover quickly
 *
 * Attempt delays: 50ms, 100ms, 200ms, 400ms, 800ms, 1600ms, 3200ms, 5000ms+
 */
export const BACKOFF_PRESET_AGGRESSIVE = {
    baseDelay: 50,
    multiplier: 2,
    maxDelay: 5000,
    useJitter: true,
    jitterFraction: 0.1,
};
/**
 * Moderate backoff: Balanced approach for typical retries
 *
 * Exponential growth from 100ms to 30s, suitable for:
 * - HTTP API calls
 * - Database queries
 * - Network-dependent operations
 *
 * Attempt delays: 100ms, 200ms, 400ms, 800ms, 1600ms, 3200ms, 6400ms, 12800ms, 30000ms+
 */
export const BACKOFF_PRESET_MODERATE = {
    baseDelay: 100,
    multiplier: 2,
    maxDelay: 30000,
    useJitter: true,
    jitterFraction: 0.1,
};
/**
 * Conservative backoff: Slow backoff for rate-limited endpoints
 *
 * Linear growth from 500ms to 60s, suitable for:
 * - Third-party API rate limiting
 * - Public API calls with strict quotas
 * - Slow endpoints (SLO >1s response time)
 *
 * Attempt delays: 500ms, 1000ms, 1500ms, 2000ms, 2500ms, ..., 60000ms+
 */
export const BACKOFF_PRESET_CONSERVATIVE = {
    baseDelay: 500,
    increment: 500,
    maxDelay: 60000,
    useJitter: true,
    jitterFraction: 0.1,
};
/**
 * Constant backoff: No backoff, immediate retries
 *
 * Fixed delay of 10ms, suitable for:
 * - Lock contention (spinning)
 * - High-frequency retries with no I/O
 * - Testing/development
 *
 * Note: Can cause thundering herd. Only use when you understand the implications.
 */
export const BACKOFF_PRESET_CONSTANT = {
    baseDelay: 10,
    maxDelay: 10,
    useJitter: false,
};
