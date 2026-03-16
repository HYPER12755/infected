/**
 * Error System Index
 *
 * Central export point for all error system components including:
 * - Base error classes
 * - Error categories and codes
 * - Conversion utilities
 * - Type guards and helpers
 * - Error metrics tracking
 * - Health checks and monitoring
 * - Metrics aggregation
 */
// Re-export from error-taxonomy
export { BaseError, ErrorCategory, ErrorSeverity, NetworkErrorCode, ProcessErrorCode, SSHErrorCode, ResourceErrorCode, SecurityErrorCode, TimeoutErrorCode, FilesystemErrorCode, } from './error-taxonomy.js';
// Re-export from error-categories
export { NetworkError, ProcessError, SSHError, ResourceError, SecurityError, TimeoutError, FilesystemError, } from './error-categories.js';
// Re-export from error-metadata
export { ErrorSource, convertNodeError, convertNetworkError, convertProcessError, convertSSHError, convertFileSystemError, convertError, isBaseError, isRetryable, isCritical, } from './error-metadata.js';
// Re-export from error-metrics
export { ErrorMetrics, TimeWindow, } from './error-metrics.js';
// Re-export from error-health-check
export { ErrorHealthCheck, HealthStatus, } from './error-health-check.js';
// Re-export from error-metrics-aggregator
export { ErrorMetricsAggregator, } from './error-metrics-aggregator.js';
