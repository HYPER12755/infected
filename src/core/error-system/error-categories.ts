/**
 * Error Category Implementations
 * 
 * Concrete error classes for specific error categories, each extending BaseError
 * with category-specific properties and methods.
 */

import {
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
 } from './error-taxonomy.js';

/**
 * Network-related errors
 * 
 * Handles connection timeouts, DNS failures, connection refused, and other
 * network-level issues.
 * 
 * @example
 * ```typescript
 * throw new NetworkError('Connection timeout to host', {
 *   code: NetworkErrorCode.CONNECTION_TIMEOUT,
 *   severity: ErrorSeverity.HIGH,
 *   retryable: true,
 *   context: {
 *     host: 'example.com',
 *     port: 22,
 *     timeout: 30000,
 *   },
 * });
 * ```
 */
export class NetworkError<T extends Record<string, unknown> = Record<string, unknown>>
  extends BaseError<T> {
  constructor(
    message: string,
    options: {
      code: NetworkErrorCode;
      severity?: ErrorSeverity;
      retryable?: boolean;
      context?: T;
      originalError?: Error | null;
      suggestedAction?: string;
    }
  ) {
    super(message, {
      category: ErrorCategory.NETWORK,
      code: options.code,
      severity: options.severity ?? ErrorSeverity.HIGH,
      retryable: options.retryable ?? true,
      context: options.context,
      originalError: options.originalError,
      suggestedAction: options.suggestedAction ?? 'Check network connectivity and try again',
    });
  }
}

/**
 * Process-related errors
 * 
 * Handles process spawn failures, exit codes, signals, and other
 * process execution issues.
 * 
 * @example
 * ```typescript
 * throw new ProcessError('Process exited with code 1', {
 *   code: ProcessErrorCode.EXIT_CODE,
 *   severity: ErrorSeverity.HIGH,
 *   retryable: false,
 *   context: {
 *     exitCode: 1,
 *     command: 'npm test',
 *     pid: 12345,
 *   },
 * });
 * ```
 */
export class ProcessError<T extends Record<string, unknown> = Record<string, unknown>>
  extends BaseError<T> {
  constructor(
    message: string,
    options: {
      code: ProcessErrorCode;
      severity?: ErrorSeverity;
      retryable?: boolean;
      context?: T;
      originalError?: Error | null;
      suggestedAction?: string;
    }
  ) {
    super(message, {
      category: ErrorCategory.PROCESS,
      code: options.code,
      severity: options.severity ?? ErrorSeverity.HIGH,
      retryable: options.retryable ?? false,
      context: options.context,
      originalError: options.originalError,
      suggestedAction: options.suggestedAction ?? 'Review process output and logs for details',
    });
  }
}

/**
 * SSH-related errors
 * 
 * Handles SSH authentication failures, connection errors, command execution
 * failures, and other SSH protocol issues.
 * 
 * @example
 * ```typescript
 * throw new SSHError('SSH authentication failed', {
 *   code: SSHErrorCode.AUTH_FAILED,
 *   severity: ErrorSeverity.HIGH,
 *   retryable: false,
 *   context: {
 *     host: 'server.example.com',
 *     user: 'admin',
 *     authMethod: 'password',
 *   },
 * });
 * ```
 */
export class SSHError<T extends Record<string, unknown> = Record<string, unknown>>
  extends BaseError<T> {
  constructor(
    message: string,
    options: {
      code: SSHErrorCode;
      severity?: ErrorSeverity;
      retryable?: boolean;
      context?: T;
      originalError?: Error | null;
      suggestedAction?: string;
    }
  ) {
    super(message, {
      category: ErrorCategory.SSH,
      code: options.code,
      severity: options.severity ?? ErrorSeverity.HIGH,
      retryable: options.retryable ?? false,
      context: options.context,
      originalError: options.originalError,
      suggestedAction: options.suggestedAction ?? 'Verify SSH credentials and connection settings',
    });
  }
}

/**
 * Resource-related errors
 * 
 * Handles resource exhaustion including memory limits, CPU limits,
 * file handle limits, disk space, and quota violations.
 * 
 * @example
 * ```typescript
 * throw new ResourceError('Memory limit exceeded', {
 *   code: ResourceErrorCode.MEMORY_EXCEEDED,
 *   severity: ErrorSeverity.CRITICAL,
 *   retryable: true,
 *   context: {
 *     available: 512,
 *     required: 1024,
 *     unit: 'MB',
 *   },
 * });
 * ```
 */
export class ResourceError<T extends Record<string, unknown> = Record<string, unknown>>
  extends BaseError<T> {
  constructor(
    message: string,
    options: {
      code: ResourceErrorCode;
      severity?: ErrorSeverity;
      retryable?: boolean;
      context?: T;
      originalError?: Error | null;
      suggestedAction?: string;
    }
  ) {
    super(message, {
      category: ErrorCategory.RESOURCE,
      code: options.code,
      severity: options.severity ?? ErrorSeverity.CRITICAL,
      retryable: options.retryable ?? true,
      context: options.context,
      originalError: options.originalError,
      suggestedAction: options.suggestedAction ?? 'Free up system resources or increase limits',
    });
  }
}

/**
 * Security-related errors
 * 
 * Handles validation failures, policy violations, unauthorized access,
 * permission issues, and cryptographic failures.
 * 
 * @example
 * ```typescript
 * throw new SecurityError('Validation failed', {
 *   code: SecurityErrorCode.VALIDATION_FAILED,
 *   severity: ErrorSeverity.HIGH,
 *   retryable: false,
 *   context: {
 *     field: 'apiKey',
 *     reason: 'Invalid format',
 *   },
 * });
 * ```
 */
export class SecurityError<T extends Record<string, unknown> = Record<string, unknown>>
  extends BaseError<T> {
  constructor(
    message: string,
    options: {
      code: SecurityErrorCode;
      severity?: ErrorSeverity;
      retryable?: boolean;
      context?: T;
      originalError?: Error | null;
      suggestedAction?: string;
    }
  ) {
    super(message, {
      category: ErrorCategory.SECURITY,
      code: options.code,
      severity: options.severity ?? ErrorSeverity.HIGH,
      retryable: options.retryable ?? false,
      context: options.context,
      originalError: options.originalError,
      suggestedAction: options.suggestedAction ?? 'Review security policies and verify credentials',
    });
  }
}

/**
 * Timeout-related errors
 * 
 * Handles operation timeouts, command timeouts, handshake timeouts,
 * and read/write timeouts.
 * 
 * @example
 * ```typescript
 * throw new TimeoutError('Operation timed out', {
 *   code: TimeoutErrorCode.OPERATION_TIMEOUT,
 *   severity: ErrorSeverity.HIGH,
 *   retryable: true,
 *   context: {
 *     operation: 'fileTransfer',
 *     timeout: 60000,
 *     elapsed: 60500,
 *   },
 * });
 * ```
 */
export class TimeoutError<T extends Record<string, unknown> = Record<string, unknown>>
  extends BaseError<T> {
  constructor(
    message: string,
    options: {
      code: TimeoutErrorCode;
      severity?: ErrorSeverity;
      retryable?: boolean;
      context?: T;
      originalError?: Error | null;
      suggestedAction?: string;
    }
  ) {
    super(message, {
      category: ErrorCategory.TIMEOUT,
      code: options.code,
      severity: options.severity ?? ErrorSeverity.MEDIUM,
      retryable: options.retryable ?? true,
      context: options.context,
      originalError: options.originalError,
      suggestedAction: options.suggestedAction ?? 'Increase timeout duration or investigate slow operation',
    });
  }
}

/**
 * Filesystem-related errors
 * 
 * Handles file not found, permission denied, read/write failures,
 * and other filesystem operations errors.
 * 
 * @example
 * ```typescript
 * throw new FilesystemError('File not found', {
 *   code: FilesystemErrorCode.NOT_FOUND,
 *   severity: ErrorSeverity.MEDIUM,
 *   retryable: false,
 *   context: {
 *     path: '/home/user/config.json',
 *     operation: 'read',
 *   },
 * });
 * ```
 */
export class FilesystemError<T extends Record<string, unknown> = Record<string, unknown>>
  extends BaseError<T> {
  constructor(
    message: string,
    options: {
      code: FilesystemErrorCode;
      severity?: ErrorSeverity;
      retryable?: boolean;
      context?: T;
      originalError?: Error | null;
      suggestedAction?: string;
    }
  ) {
    super(message, {
      category: ErrorCategory.FILESYSTEM,
      code: options.code,
      severity: options.severity ?? ErrorSeverity.MEDIUM,
      retryable: options.retryable ?? false,
      context: options.context,
      originalError: options.originalError,
      suggestedAction: options.suggestedAction ?? 'Verify file path and permissions',
    });
  }
}
