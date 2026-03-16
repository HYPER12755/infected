import { randomUUID } from 'crypto';
import { CorrelationContext } from './correlation-context.js';
import { loggingContext } from './logging-context.js';
/**
 * HTTP header names for correlation ID propagation
 */
const CORRELATION_ID_HEADER = 'x-correlation-id';
const CORRELATION_ID_RESPONSE_HEADER = 'x-correlation-id-response';
const USER_ID_HEADER = 'x-user-id';
const SESSION_ID_HEADER = 'x-session-id';
/**
 * Creates an Express middleware that automatically manages correlation contexts
 *
 * For each incoming HTTP request:
 * - Extracts or generates a correlation ID
 * - Creates a correlation context for the request duration
 * - Adds correlation ID to response headers
 * - Cleans up context when response completes
 *
 * Usage:
 *   app.use(createContextMiddleware());
 *
 * @returns Express middleware function
 */
export function createContextMiddleware() {
    return (req, res, next) => {
        // Extract correlation ID from request headers or generate new one
        const correlationId = req.headers[CORRELATION_ID_HEADER] ||
            randomUUID();
        // Extract optional user and session IDs from headers
        const userId = req.headers[USER_ID_HEADER];
        const sessionId = req.headers[SESSION_ID_HEADER];
        // Create correlation context for this request
        const context = CorrelationContext.generate(undefined, userId, sessionId);
        // Override the correlationId if it was provided (to maintain external ID)
        const contextWithProvidedId = {
            ...context,
            correlationId,
        };
        // Add correlation ID to response headers
        res.setHeader(CORRELATION_ID_RESPONSE_HEADER, correlationId);
        // Add correlation ID to response locals for easy access in route handlers
        res.locals.correlationId = correlationId;
        res.locals.context = contextWithProvidedId;
        // Log request start
        loggingContext.info(`${req.method} ${req.path}`, {
            requestId: correlationId,
            method: req.method,
            path: req.path,
            ip: req.ip,
            userAgent: req.get('user-agent'),
            userId,
        });
        // Track response completion time
        const startTime = Date.now();
        // Override res.json to capture response
        const originalJson = res.json.bind(res);
        res.json = function (data) {
            const duration = Date.now() - startTime;
            loggingContext.info(`${req.method} ${req.path} completed`, {
                requestId: correlationId,
                method: req.method,
                path: req.path,
                statusCode: res.statusCode,
                duration,
            });
            return originalJson(data);
        };
        // Execute the request within correlation context
        CorrelationContext.run(contextWithProvidedId, () => {
            next();
        });
    };
}
/**
 * Wraps an async operation to execute within a correlation context
 *
 * Creates a new correlation context for arbitrary async operations
 * (not necessarily HTTP requests)
 *
 * Usage:
 *   await withCorrelationContext(async () => {
 *     // Operation code here is executed within a correlation context
 *   });
 *
 * @param callback - Async callback to execute
 * @param correlationId - Optional correlation ID to use (generates if not provided)
 * @param userId - Optional user identifier
 * @param sessionId - Optional session identifier
 * @returns Promise that resolves to the callback result
 */
export async function withCorrelationContext(callback, correlationId, userId, sessionId) {
    const context = CorrelationContext.generate(undefined, userId, sessionId);
    // Override correlationId if provided
    if (correlationId) {
        context.correlationId = correlationId;
    }
    return CorrelationContext.runAsync(context, callback);
}
/**
 * Wraps a sync operation to execute within a correlation context
 *
 * @param callback - Callback to execute
 * @param correlationId - Optional correlation ID to use (generates if not provided)
 * @param userId - Optional user identifier
 * @param sessionId - Optional session identifier
 * @returns The callback result
 */
export function withCorrelationContextSync(callback, correlationId, userId, sessionId) {
    const context = CorrelationContext.generate(undefined, userId, sessionId);
    // Override correlationId if provided
    if (correlationId) {
        context.correlationId = correlationId;
    }
    return CorrelationContext.run(context, callback);
}
/**
 * Extracts correlation ID from an Error object
 *
 * Useful for error handling and reporting - ensures errors include
 * correlation context for tracing
 *
 * @param error - Error object to extract from
 * @returns Correlation ID if found, undefined otherwise
 */
export function extractCorrelationIdFromError(error) {
    if (!error || typeof error !== 'object') {
        return undefined;
    }
    const err = error;
    // Check multiple common property names for correlation ID
    return (err.correlationId ||
        err.requestId ||
        err.traceId ||
        err.context?.correlationId ||
        undefined);
}
/**
 * Attaches correlation context to an Error object
 *
 * Modifies the error to include current correlation context for
 * enhanced error tracing
 *
 * @param error - Error object to attach context to
 * @param context - Optional correlation context (uses current if not provided)
 * @returns The error object with attached context
 */
export function attachContextToError(error, context) {
    const ctx = context || CorrelationContext.get();
    if (ctx) {
        error.correlationId = ctx.correlationId;
        error.context = ctx;
    }
    return error;
}
/**
 * Creates a request handler wrapper that automatically manages correlation context
 *
 * Useful for wrapping individual route handlers to ensure correlation
 * context is maintained throughout the handler execution
 *
 * @param handler - Express route handler to wrap
 * @returns Wrapped handler that maintains correlation context
 */
export function withRequestContext(handler) {
    return async (req, res, next) => {
        const correlationId = req.headers[CORRELATION_ID_HEADER] ||
            res.locals.correlationId ||
            randomUUID();
        const userId = req.headers[USER_ID_HEADER];
        const sessionId = req.headers[SESSION_ID_HEADER];
        const context = CorrelationContext.generate(undefined, userId, sessionId);
        context.correlationId = correlationId;
        try {
            await CorrelationContext.runAsync(context, async () => {
                await Promise.resolve(handler(req, res, next));
            });
        }
        catch (error) {
            attachContextToError(error, context);
            next(error);
        }
    };
}
/**
 * Utility to propagate correlation context to downstream service calls
 *
 * Adds correlation headers to outgoing HTTP request options
 *
 * Usage:
 *   const headers = propagateCorrelationContext({});
 *   const response = await fetch(url, { headers });
 *
 * @param headers - Existing headers object to augment
 * @param context - Optional correlation context (uses current if not provided)
 * @returns Headers object with correlation ID included
 */
export function propagateCorrelationContext(headers = {}, context) {
    const ctx = context || CorrelationContext.get();
    if (!ctx) {
        return headers;
    }
    return {
        ...headers,
        [CORRELATION_ID_HEADER]: ctx.correlationId,
        ...(ctx.userId && { [USER_ID_HEADER]: ctx.userId }),
        ...(ctx.sessionId && { [SESSION_ID_HEADER]: ctx.sessionId }),
    };
}
export default {
    createContextMiddleware,
    withCorrelationContext,
    withCorrelationContextSync,
    extractCorrelationIdFromError,
    attachContextToError,
    withRequestContext,
    propagateCorrelationContext,
};
