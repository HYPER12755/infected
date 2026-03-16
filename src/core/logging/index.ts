/**
 * Core logging context system
 *
 * This module provides a comprehensive correlation ID and logging context system
 * for distributed tracing across the application. It integrates with the existing
 * Winston logger and provides request-scoped context management using AsyncLocalStorage.
 *
 * Key components:
 * - CorrelationContext: Manages request-scoped correlation IDs with AsyncLocalStorage
 * - LoggingContext: Wraps the logger to auto-inject correlation metadata
 * - Middleware: Express integration for automatic context management
 *
 * Usage:
 *   import { CorrelationContext, LoggingContext, createContextMiddleware } from './logging';
 *
 *   // In Express app setup:
 *   app.use(createContextMiddleware());
 *
 *   // In route handlers or services:
 *   const logContext = new LoggingContext();
 *   logContext.info('Operation started', { operation: 'process' });
 */

// Core correlation context
export {
  CorrelationContext,
  type ICorrelationContext,
} from './correlation-context.js';

// Logging context wrapper
export {
  LoggingContext,
  loggingContext,
  type ILoggingMetadata,
} from './logging-context.js';

// Middleware and utilities
export {
  createContextMiddleware,
  withCorrelationContext,
  withCorrelationContextSync,
  extractCorrelationIdFromError,
  attachContextToError,
  withRequestContext,
  propagateCorrelationContext,
  type ExpressMiddleware,
} from './logging-context-middleware.js';

// Re-export for convenience
export { default as logger } from '../logger.js';
