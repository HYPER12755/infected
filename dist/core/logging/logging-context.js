import logger from '../logger.js';
import { CorrelationContext } from './correlation-context.js';
/**
 * LoggingContext class
 *
 * A wrapper around the existing Winston logger that automatically injects
 * correlation ID metadata into all log calls. This enables distributed
 * tracing across the entire system while maintaining backward compatibility
 * with existing logger usage.
 *
 * Each log method automatically merges correlation context metadata with
 * user-provided metadata, ensuring every log entry can be traced.
 *
 * Usage:
 *   const logContext = new LoggingContext();
 *   logContext.info('Operation started', { operation: 'process' });
 *   // Automatically includes correlationId, userId, sessionId, etc.
 */
export class LoggingContext {
    /**
     * Creates a new LoggingContext instance
     * Can operate with or without an explicit correlation context
     */
    constructor() { }
    /**
     * Merges correlation context metadata with user-provided metadata
     *
     * @param userMeta - User-provided metadata
     * @returns Merged metadata object
     */
    mergeMetadata(userMeta) {
        const correlationMeta = CorrelationContext.toMetadata();
        if (!userMeta) {
            return correlationMeta;
        }
        // Merge metadata, with user metadata taking precedence for overlapping keys
        // except for correlation-specific fields which are always included
        return {
            ...correlationMeta,
            ...userMeta,
            // Ensure correlation fields are always present
            correlationId: correlationMeta.correlationId,
        };
    }
    /**
     * Logs an error message
     *
     * @param message - Log message
     * @param meta - Optional metadata to include
     */
    error(message, meta) {
        const merged = this.mergeMetadata(meta);
        logger.error(message, merged);
    }
    /**
     * Logs a warning message
     *
     * @param message - Log message
     * @param meta - Optional metadata to include
     */
    warn(message, meta) {
        const merged = this.mergeMetadata(meta);
        logger.warn(message, merged);
    }
    /**
     * Logs an info message
     *
     * @param message - Log message
     * @param meta - Optional metadata to include
     */
    info(message, meta) {
        const merged = this.mergeMetadata(meta);
        logger.info(message, merged);
    }
    /**
     * Logs a debug message
     *
     * @param message - Log message
     * @param meta - Optional metadata to include
     */
    debug(message, meta) {
        const merged = this.mergeMetadata(meta);
        logger.debug(message, merged);
    }
    /**
     * Logs an HTTP-level message
     *
     * @param message - Log message
     * @param meta - Optional metadata to include
     */
    http(message, meta) {
        const merged = this.mergeMetadata(meta);
        logger.http(message, merged);
    }
    /**
     * Logs a fatal error message
     *
     * @param message - Log message
     * @param meta - Optional metadata to include
     */
    fatal(message, meta) {
        const merged = this.mergeMetadata(meta);
        logger.fatal(message, merged);
    }
    /**
     * Gets the current correlation context
     *
     * @returns Current correlation context or undefined
     */
    getContext() {
        return CorrelationContext.get();
    }
    /**
     * Gets the current correlation ID
     *
     * @returns Current correlation ID or undefined
     */
    getCorrelationId() {
        return CorrelationContext.getId();
    }
    /**
     * Executes a callback within a correlation context, with automatic logging
     *
     * Useful for wrapping async operations that should be traced together
     *
     * @param context - The correlation context to use
     * @param callback - Callback to execute
     * @param operation - Optional operation name for logging
     * @returns The return value of the callback
     */
    withContext(context, callback, operation) {
        if (operation) {
            this.info(`Starting operation: ${operation}`, {
                operationName: operation,
            });
        }
        try {
            return CorrelationContext.run(context, callback);
        }
        catch (error) {
            this.error(`Operation failed: ${operation || 'unknown'}`, {
                operationName: operation,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
    /**
     * Executes an async callback within a correlation context, with automatic logging
     *
     * Useful for wrapping async operations that should be traced together
     *
     * @param context - The correlation context to use
     * @param callback - Async callback to execute
     * @param operation - Optional operation name for logging
     * @returns Promise that resolves to the return value of the callback
     */
    async withContextAsync(context, callback, operation) {
        if (operation) {
            this.info(`Starting operation: ${operation}`, {
                operationName: operation,
            });
        }
        try {
            const result = await CorrelationContext.runAsync(context, callback);
            if (operation) {
                this.info(`Completed operation: ${operation}`, {
                    operationName: operation,
                });
            }
            return result;
        }
        catch (error) {
            this.error(`Operation failed: ${operation || 'unknown'}`, {
                operationName: operation,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
            });
            throw error;
        }
    }
    /**
     * Creates a child context and executes a callback within it
     *
     * Useful for nested operations that should maintain parent trace relationship
     *
     * @param callback - Callback to execute
     * @param operation - Optional operation name for logging
     * @param userId - Optional user identifier for child context
     * @param sessionId - Optional session identifier for child context
     * @returns The return value of the callback
     * @throws Error if no parent context exists
     */
    withChildContext(callback, operation, userId, sessionId) {
        try {
            const childContext = CorrelationContext.createChild(userId, sessionId);
            return this.withContext(childContext, callback, operation);
        }
        catch (error) {
            this.error(`Failed to create child context: ${operation || 'unknown'}`, {
                operationName: operation,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
    /**
     * Creates a child context and executes an async callback within it
     *
     * Useful for nested operations that should maintain parent trace relationship
     *
     * @param callback - Async callback to execute
     * @param operation - Optional operation name for logging
     * @param userId - Optional user identifier for child context
     * @param sessionId - Optional session identifier for child context
     * @returns Promise that resolves to the return value of the callback
     * @throws Error if no parent context exists
     */
    async withChildContextAsync(callback, operation, userId, sessionId) {
        try {
            const childContext = CorrelationContext.createChild(userId, sessionId);
            return await this.withContextAsync(childContext, callback, operation);
        }
        catch (error) {
            this.error(`Failed to create child context: ${operation || 'unknown'}`, {
                operationName: operation,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
            });
            throw error;
        }
    }
}
/**
 * Global singleton instance for convenient access
 */
export const loggingContext = new LoggingContext();
export default LoggingContext;
