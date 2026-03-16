/**
 * Error System Index
 * 
 * Central export point for all error system components including:
 * - Base error classes
 * - Error categories and codes
 * - Conversion utilities
 * - Type guards and helpers
 */

// Re-export from error-taxonomy
export {
   BaseError,
   ErrorCategory,
   ErrorSeverity,
   NetworkErrorCode,
   ProcessErrorCode,
   SSHErrorCode,
   ResourceErrorCode,
   SecurityErrorCode,
   TimeoutErrorCode,
   FilesystemErrorCode,
   ErrorMetadata,
 } from './error-taxonomy.js';

 // Re-export from error-categories
 export {
   NetworkError,
   ProcessError,
   SSHError,
   ResourceError,
   SecurityError,
   TimeoutError,
   FilesystemError,
 } from './error-categories.js';

 // Re-export from error-metadata
 export {
   ErrorSource,
   ErrorContext,
   convertNodeError,
   convertNetworkError,
   convertProcessError,
   convertSSHError,
   convertFileSystemError,
   convertError,
   isBaseError,
   isRetryable,
   isCritical,
 } from './error-metadata.js';
