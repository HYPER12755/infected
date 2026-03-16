/**
 * Base interface for all execution strategies.
 * Each strategy defines how processes are spawned, monitored, and cleaned up.
 *
 * @template TConfig Configuration type for this strategy
 * @template TResult Result type returned by this strategy
 */
export class ExecutionStrategy {
    /**
     * Create a new execution strategy with given configuration
     */
    constructor(config) {
        this.config = config;
    }
    /**
     * Get current timeout configuration
     */
    getTimeoutMs() {
        return this.config.timeoutMs;
    }
    /**
     * Set timeout configuration
     */
    setTimeoutMs(timeoutMs) {
        this.config.timeoutMs = timeoutMs;
    }
    /**
     * Get kill grace period configuration
     */
    getKillGracePeriodMs() {
        return this.config.killGracePeriodMs;
    }
    /**
     * Set kill grace period configuration
     */
    setKillGracePeriodMs(gracePeriodMs) {
        this.config.killGracePeriodMs = gracePeriodMs;
    }
}
/**
 * Error thrown when a process execution times out
 */
export class ExecutionTimeoutError extends Error {
    constructor(timeoutMs) {
        super(`Process execution timed out after ${timeoutMs}ms`);
        this.name = 'ExecutionTimeoutError';
    }
}
/**
 * Error thrown when a process cannot be found (already terminated)
 */
export class ProcessNotFoundError extends Error {
    constructor(pid) {
        super(`Process with PID ${pid} not found`);
        this.name = 'ProcessNotFoundError';
    }
}
/**
 * Error thrown when process termination fails
 */
export class ProcessTerminationError extends Error {
    constructor(pid, signal, message) {
        super(`Failed to terminate process ${pid} with signal ${signal}: ${message}`);
        this.name = 'ProcessTerminationError';
    }
}
