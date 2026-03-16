/**
 * Error Metadata and Conversion Utilities
 * 
 * Provides interfaces and conversion functions for transforming native errors
 * and other error types into standardized BaseError instances.
 */

import {
   BaseError,
   ErrorCategory,
   ErrorSeverity,
   NetworkErrorCode,
   ProcessErrorCode,
   SSHErrorCode,
   FilesystemErrorCode,
   ErrorMetadata,
 } from './error-taxonomy.js';

 import {
   NetworkError,
   ProcessError,
   SSHError,
   FilesystemError,
 } from './error-categories.js';

/**
 * Error source enumeration for tracking error origin
 * @enum {string}
 */
export enum ErrorSource {
  NODE = 'NODE',
  PROCESS = 'PROCESS',
  SSH = 'SSH',
  RESOURCE = 'RESOURCE',
  FILESYSTEM = 'FILESYSTEM',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Error context interface for structured contextual information
 */
export interface ErrorContext {
  /** Source of the error */
  source?: ErrorSource;
  /** Additional metadata fields */
  [key: string]: unknown;
}

/**
 * Convert native JavaScript Error or Node.js error to appropriate BaseError
 * 
 * Attempts to classify the error and convert it to the appropriate error subclass.
 * Falls back to NetworkError if type cannot be determined.
 * 
 * @param error - The error to convert
 * @param source - Optional source specification for better classification
 * @returns BaseError instance with proper classification
 * 
 * @example
 * ```typescript
 * try {
 *   // some operation
 * } catch (err) {
 *   const baseError = convertNodeError(err as Error);
 *   console.log(baseError.category);
 * }
 * ```
 */
export function convertNodeError(
  error: Error,
  source?: ErrorSource
): BaseError {
  const message = error.message || 'Unknown error';
  const nodeError = error as NodeJS.ErrnoException;

  // Check for filesystem errors
  if (nodeError.code === 'ENOENT') {
    return new FilesystemError(message, {
      code: FilesystemErrorCode.NOT_FOUND,
      severity: ErrorSeverity.MEDIUM,
      retryable: false,
      context: {
        errorCode: nodeError.code,
        path: nodeError.path,
        errno: nodeError.errno,
      } as Record<string, unknown>,
      originalError: error,
      suggestedAction: 'Verify the file or directory path exists',
    });
  }

  if (nodeError.code === 'EACCES' || nodeError.code === 'EPERM') {
    return new FilesystemError(message, {
      code: FilesystemErrorCode.PERMISSION_DENIED,
      severity: ErrorSeverity.MEDIUM,
      retryable: false,
      context: {
        errorCode: nodeError.code,
        path: nodeError.path,
        errno: nodeError.errno,
      } as Record<string, unknown>,
      originalError: error,
      suggestedAction: 'Check file permissions and user privileges',
    });
  }

  if (nodeError.code === 'EISDIR') {
    return new FilesystemError(message, {
      code: FilesystemErrorCode.IS_DIRECTORY,
      severity: ErrorSeverity.LOW,
      retryable: false,
      context: {
        errorCode: nodeError.code,
        path: nodeError.path,
      } as Record<string, unknown>,
      originalError: error,
    });
  }

  if (nodeError.code === 'ENOTDIR') {
    return new FilesystemError(message, {
      code: FilesystemErrorCode.NOT_DIRECTORY,
      severity: ErrorSeverity.LOW,
      retryable: false,
      context: {
        errorCode: nodeError.code,
        path: nodeError.path,
      } as Record<string, unknown>,
      originalError: error,
    });
  }

  if (nodeError.code === 'EEXIST') {
    return new FilesystemError(message, {
      code: FilesystemErrorCode.EXISTS,
      severity: ErrorSeverity.LOW,
      retryable: false,
      context: {
        errorCode: nodeError.code,
        path: nodeError.path,
      } as Record<string, unknown>,
      originalError: error,
    });
  }

  // Check for network errors
  if (
    nodeError.code === 'ECONNREFUSED' ||
    nodeError.code === 'ECONNRESET' ||
    nodeError.code === 'ETIMEDOUT' ||
    nodeError.code === 'ENOTFOUND' ||
    nodeError.code === 'EHOSTUNREACH' ||
    nodeError.code === 'ENETUNREACH'
  ) {
    return convertNetworkError(error);
  }

  // Default: return as NetworkError
  return new NetworkError(message, {
    code: NetworkErrorCode.PROTOCOL_ERROR,
    severity: ErrorSeverity.HIGH,
    retryable: false,
    context: {
      originalCode: nodeError.code || 'UNKNOWN',
      errno: nodeError.errno,
      source: source || ErrorSource.UNKNOWN,
    } as Record<string, unknown>,
    originalError: error,
  });
}

/**
 * Convert Node.js network errors to NetworkError
 * 
 * @param error - The network error to convert
 * @returns NetworkError instance
 * 
 * @example
 * ```typescript
 * const netError = convertNetworkError(connectionRefusedError);
 * ```
 */
export function convertNetworkError(error: Error): NetworkError {
  const nodeError = error as NodeJS.ErrnoException;
  const message = error.message || 'Network error occurred';

  let code: NetworkErrorCode = NetworkErrorCode.PROTOCOL_ERROR;
  let retryable = false;

  switch (nodeError.code) {
    case 'ECONNREFUSED':
      code = NetworkErrorCode.CONNECTION_REFUSED;
      retryable = true;
      break;
    case 'ECONNRESET':
      code = NetworkErrorCode.RESET;
      retryable = true;
      break;
    case 'ETIMEDOUT':
      code = NetworkErrorCode.CONNECTION_TIMEOUT;
      retryable = true;
      break;
    case 'ENOTFOUND':
      code = NetworkErrorCode.DNS_FAILURE;
      retryable = false;
      break;
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      code = NetworkErrorCode.UNREACHABLE;
      retryable = true;
      break;
  }

  return new NetworkError(message, {
    code,
    severity: ErrorSeverity.HIGH,
    retryable,
    context: {
      errorCode: nodeError.code || 'UNKNOWN',
      errno: nodeError.errno,
    } as Record<string, unknown>,
    originalError: error,
  });
}

/**
 * Convert process exit code and optional signal to ProcessError
 * 
 * Interprets exit codes and signals to create appropriate error objects.
 * 
 * @param code - Exit code (negative for signal) or signal name
 * @param signal - Optional signal name received by process
 * @param command - Optional command that was executed
 * @returns ProcessError instance
 * 
 * @example
 * ```typescript
 * const procError = convertProcessError(1, undefined, 'npm test');
 * const signalError = convertProcessError(0, 'SIGTERM', 'node server.js');
 * ```
 */
export function convertProcessError(
  code: number | string,
  signal?: string,
  command?: string
): ProcessError {
  const exitCode = typeof code === 'number' ? code : parseInt(code, 10);
  const severity = exitCode === 0 ? ErrorSeverity.MEDIUM : ErrorSeverity.HIGH;
  const retryable = [1, 11, 12, 13].includes(exitCode); // Common retryable codes

  let message: string;
  if (signal) {
    message = `Process killed by signal ${signal}`;
  } else if (exitCode === 0) {
    message = 'Process exited cleanly but with signal indication';
  } else {
    message = `Process exited with code ${exitCode}`;
  }

  return new ProcessError(message, {
    code: signal ? ProcessErrorCode.SIGNAL_RECEIVED : ProcessErrorCode.EXIT_CODE,
    severity,
    retryable,
    context: {
      exitCode,
      signal: signal || undefined,
      command: command || undefined,
    } as Record<string, unknown>,
  });
}

/**
 * Convert SSH error to SSHError
 * 
 * Analyzes error messages and properties to classify SSH-specific errors.
 * 
 * @param error - The SSH error to convert
 * @param context - Optional additional context
 * @returns SSHError instance
 * 
 * @example
 * ```typescript
 * const sshErr = convertSSHError(authError, {
 *   host: 'server.example.com',
 *   user: 'admin',
 * });
 * ```
 */
export function convertSSHError(
  error: Error,
  context?: Record<string, unknown>
): SSHError {
  const message = error.message || 'SSH error occurred';

  // Determine SSH error code from message content
  let code = SSHErrorCode.COMMAND_FAILED;
  let retryable = false;

  const msg = message.toLowerCase();

  if (msg.includes('auth') || msg.includes('permission') || msg.includes('denied')) {
    code = SSHErrorCode.AUTH_FAILED;
    retryable = false;
  } else if (msg.includes('connect') || msg.includes('econnrefused')) {
    code = SSHErrorCode.CONNECTION_FAILED;
    retryable = true;
  } else if (msg.includes('timeout') || msg.includes('etimedout')) {
    code = SSHErrorCode.TIMEOUT;
    retryable = true;
  } else if (msg.includes('host key') || msg.includes('verification')) {
    code = SSHErrorCode.HOST_KEY_VERIFICATION;
    retryable = false;
  } else if (msg.includes('channel') || msg.includes('session')) {
    code = SSHErrorCode.CHANNEL_OPEN_FAILURE;
    retryable = true;
  } else if (msg.includes('disconnect')) {
    code = SSHErrorCode.DISCONNECTED;
    retryable = true;
  }

  return new SSHError(message, {
    code,
    severity: ErrorSeverity.HIGH,
    retryable,
    context: context || {},
    originalError: error,
  });
}

/**
 * Convert filesystem error to FilesystemError
 * 
 * Maps Node.js filesystem error codes to FilesystemError instances.
 * 
 * @param error - The filesystem error to convert
 * @returns FilesystemError instance
 * 
 * @example
 * ```typescript
 * try {
 *   fs.readFileSync('./missing.json');
 * } catch (err) {
 *   const fsErr = convertFileSystemError(err as Error);
 * }
 * ```
 */
export function convertFileSystemError(error: Error): FilesystemError {
  const nodeError = error as NodeJS.ErrnoException;
  const message = error.message || 'Filesystem error occurred';

  let code = FilesystemErrorCode.READ_FAILED;
  let severity = ErrorSeverity.MEDIUM;

  switch (nodeError.code) {
    case 'ENOENT':
      code = FilesystemErrorCode.NOT_FOUND;
      break;
    case 'EACCES':
    case 'EPERM':
      code = FilesystemErrorCode.PERMISSION_DENIED;
      break;
    case 'EISDIR':
      code = FilesystemErrorCode.IS_DIRECTORY;
      severity = ErrorSeverity.LOW;
      break;
    case 'ENOTDIR':
      code = FilesystemErrorCode.NOT_DIRECTORY;
      severity = ErrorSeverity.LOW;
      break;
    case 'EEXIST':
      code = FilesystemErrorCode.EXISTS;
      severity = ErrorSeverity.LOW;
      break;
    case 'EIO':
      code = FilesystemErrorCode.READ_FAILED;
      severity = ErrorSeverity.HIGH;
      break;
    default:
      code = FilesystemErrorCode.READ_FAILED;
  }

  return new FilesystemError(message, {
    code,
    severity,
    retryable: false,
    context: {
      errorCode: nodeError.code || 'UNKNOWN',
      path: nodeError.path,
      errno: nodeError.errno,
    } as Record<string, unknown>,
    originalError: error,
  });
}

/**
 * Smart error converter that detects error type and converts appropriately
 * 
 * Attempts to identify the source and type of an error, then converts
 * it to the appropriate BaseError subclass.
 * 
 * @param error - Error to convert
 * @param source - Optional hint about error source
 * @returns Appropriate BaseError subclass instance
 * 
 * @example
 * ```typescript
 * const converted = convertError(unknownError, ErrorSource.PROCESS);
 * if (converted instanceof ProcessError) {
 *   // Handle process error
 * }
 * ```
 */
export function convertError(
  error: unknown,
  source?: ErrorSource
): BaseError {
  // Already a BaseError
  if (error instanceof BaseError) {
    return error;
  }

  // Convert Error instances
  if (error instanceof Error) {
    if (source === ErrorSource.SSH) {
      return convertSSHError(error);
    }
    if (source === ErrorSource.FILESYSTEM) {
      return convertFileSystemError(error);
    }
    // Default to general Node error conversion
    return convertNodeError(error, source);
  }

  // Fallback for unknown types
  return new NetworkError('Unknown error occurred', {
    code: NetworkErrorCode.PROTOCOL_ERROR,
    severity: ErrorSeverity.HIGH,
    retryable: false,
    context: {
      originalType: typeof error,
      value: String(error),
      source: source || ErrorSource.UNKNOWN,
    } as Record<string, unknown>,
  });
}

/**
 * Type guard to check if error is a BaseError
 * @param error - Error to check
 * @returns True if error is a BaseError instance
 */
export function isBaseError(error: unknown): error is BaseError {
  return error instanceof BaseError;
}

/**
 * Type guard to check if error is retryable
 * @param error - Error to check
 * @returns True if error can be retried
 */
export function isRetryable(error: unknown): error is BaseError {
  return isBaseError(error) && error.retryable;
}

/**
 * Type guard for critical errors
 * @param error - Error to check
 * @returns True if error is critical severity
 */
export function isCritical(error: unknown): error is BaseError {
  return isBaseError(error) && error.severity === ErrorSeverity.CRITICAL;
}
