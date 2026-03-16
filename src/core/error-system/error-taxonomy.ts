/**
 * Error Taxonomy and Classification System
 * 
 * Provides a comprehensive base error class with standardized properties,
 * methods, and metadata for all error types in the system.
 */

/**
 * Error categories for classification
 * @enum {string}
 */
export enum ErrorCategory {
  NETWORK = 'NETWORK',
  PROCESS = 'PROCESS',
  SSH = 'SSH',
  RESOURCE = 'RESOURCE',
  SECURITY = 'SECURITY',
  TIMEOUT = 'TIMEOUT',
  FILESYSTEM = 'FILESYSTEM',
}

/**
 * Error severity levels
 * @enum {string}
 */
export enum ErrorSeverity {
  CRITICAL = 'CRITICAL',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

/**
 * Standard error codes for each category
 * Network category codes
 */
export enum NetworkErrorCode {
  CONNECTION_TIMEOUT = 'NET_CONN_TIMEOUT',
  DNS_FAILURE = 'NET_DNS_FAILURE',
  CONNECTION_REFUSED = 'NET_CONN_REFUSED',
  UNREACHABLE = 'NET_UNREACHABLE',
  RESET = 'NET_RESET',
  KEEP_ALIVE_TIMEOUT = 'NET_KEEP_ALIVE_TIMEOUT',
  PROTOCOL_ERROR = 'NET_PROTOCOL_ERROR',
}

/**
 * Process category codes
 */
export enum ProcessErrorCode {
  SPAWN_FAILED = 'PROC_SPAWN_FAILED',
  EXIT_CODE = 'PROC_EXIT_CODE',
  SIGNAL_RECEIVED = 'PROC_SIGNAL_RECEIVED',
  TIMEOUT = 'PROC_TIMEOUT',
  NOT_FOUND = 'PROC_NOT_FOUND',
  PERMISSION_DENIED = 'PROC_PERM_DENIED',
  INVALID_ARGS = 'PROC_INVALID_ARGS',
}

/**
 * SSH category codes
 */
export enum SSHErrorCode {
  AUTH_FAILED = 'SSH_AUTH_FAILED',
  CONNECTION_FAILED = 'SSH_CONN_FAILED',
  COMMAND_FAILED = 'SSH_CMD_FAILED',
  TIMEOUT = 'SSH_TIMEOUT',
  HOST_KEY_VERIFICATION = 'SSH_HOST_KEY_VERIFY',
  CHANNEL_OPEN_FAILURE = 'SSH_CHANNEL_OPEN_FAIL',
  DISCONNECTED = 'SSH_DISCONNECTED',
}

/**
 * Resource category codes
 */
export enum ResourceErrorCode {
  MEMORY_EXCEEDED = 'RES_MEMORY_EXCEEDED',
  CPU_LIMIT = 'RES_CPU_LIMIT',
  FILE_HANDLES_EXCEEDED = 'RES_FH_EXCEEDED',
  DISK_FULL = 'RES_DISK_FULL',
  NOT_AVAILABLE = 'RES_NOT_AVAILABLE',
  QUOTA_EXCEEDED = 'RES_QUOTA_EXCEEDED',
}

/**
 * Security category codes
 */
export enum SecurityErrorCode {
  VALIDATION_FAILED = 'SEC_VALIDATION_FAILED',
  POLICY_VIOLATION = 'SEC_POLICY_VIOLATION',
  UNAUTHORIZED = 'SEC_UNAUTHORIZED',
  FORBIDDEN = 'SEC_FORBIDDEN',
  INVALID_SIGNATURE = 'SEC_INVALID_SIG',
  CERTIFICATE_INVALID = 'SEC_CERT_INVALID',
}

/**
 * Timeout category codes
 */
export enum TimeoutErrorCode {
  OPERATION_TIMEOUT = 'TIMEOUT_OPERATION',
  COMMAND_TIMEOUT = 'TIMEOUT_COMMAND',
  HANDSHAKE_TIMEOUT = 'TIMEOUT_HANDSHAKE',
  READ_TIMEOUT = 'TIMEOUT_READ',
  WRITE_TIMEOUT = 'TIMEOUT_WRITE',
}

/**
 * Filesystem category codes
 */
export enum FilesystemErrorCode {
  NOT_FOUND = 'FS_NOT_FOUND',
  PERMISSION_DENIED = 'FS_PERM_DENIED',
  READ_FAILED = 'FS_READ_FAILED',
  WRITE_FAILED = 'FS_WRITE_FAILED',
  IS_DIRECTORY = 'FS_IS_DIR',
  NOT_DIRECTORY = 'FS_NOT_DIR',
  EXISTS = 'FS_EXISTS',
  INVALID_PATH = 'FS_INVALID_PATH',
}

/**
 * Error metadata with comprehensive debugging information
 * @template T - Additional context type
 */
export interface ErrorMetadata<T = Record<string, unknown>> {
  /** ISO timestamp when error occurred */
  timestamp: string;
  /** Error category for classification */
  category: ErrorCategory;
  /** Standardized error code */
  code: string;
  /** Severity level of the error */
  severity: ErrorSeverity;
  /** Whether the operation can be retried */
  retryable: boolean;
  /** Additional contextual data */
  context?: T;
  /** The original error if converted from another type */
  originalError?: Error | null;
  /** Suggested action to resolve the error */
  suggestedAction?: string;
  /** Stack trace of the error */
  stack?: string;
}

/**
 * Base abstract error class for all error types
 * 
 * Extends native Error and provides standardized properties, methods,
 * and metadata for consistent error handling across the system.
 * 
 * @template T - Generic type for custom context data
 * 
 * @example
 * ```typescript
 * class CustomError extends BaseError {
 *   constructor(message: string, options: ErrorOptions<CustomContext>) {
 *     super(message, options);
 *   }
 * }
 * ```
 */
export abstract class BaseError<T = Record<string, unknown>> extends Error {
  /** Error category */
  readonly category: ErrorCategory;
  /** Standardized error code */
  readonly code: string;
  /** Error severity level */
  readonly severity: ErrorSeverity;
  /** Whether operation can be retried */
  readonly retryable: boolean;
  /** Contextual data for debugging */
  readonly context: T;
  /** ISO timestamp when error occurred */
  readonly timestamp: string;
  /** The original error if this was converted */
  readonly originalError: Error | null;
  /** Suggested action to resolve */
  readonly suggestedAction: string | undefined;

  /**
   * Initialize base error with metadata
   * @param message - Human-readable error message
   * @param options - Error configuration options
   */
  constructor(
    message: string,
    options: {
      category: ErrorCategory;
      code: string;
      severity: ErrorSeverity;
      retryable: boolean;
      context?: T;
      originalError?: Error | null;
      suggestedAction?: string;
    }
  ) {
    super(message);
    this.name = this.constructor.name;
    this.category = options.category;
    this.code = options.code;
    this.severity = options.severity;
    this.retryable = options.retryable;
    this.context = options.context || ({} as T);
    this.timestamp = new Date().toISOString();
    this.originalError = options.originalError || null;
    this.suggestedAction = options.suggestedAction;

    // Set proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Get comprehensive error metadata
   * @returns Metadata object with all error information
   */
  getMetadata(): ErrorMetadata<T> {
    return {
      timestamp: this.timestamp,
      category: this.category,
      code: this.code,
      severity: this.severity,
      retryable: this.retryable,
      context: this.context,
      originalError: this.originalError,
      suggestedAction: this.suggestedAction,
      stack: this.stack,
    };
  }

  /**
   * Check if error is of critical severity
   * @returns True if severity is CRITICAL
   */
  isCritical(): boolean {
    return this.severity === ErrorSeverity.CRITICAL;
  }

  /**
   * Check if error is of high severity
   * @returns True if severity is HIGH
   */
  isHigh(): boolean {
    return this.severity === ErrorSeverity.HIGH;
  }

  /**
   * Check if error is of medium severity
   * @returns True if severity is MEDIUM
   */
  isMedium(): boolean {
    return this.severity === ErrorSeverity.MEDIUM;
  }

  /**
   * Check if error is of low severity
   * @returns True if severity is LOW
   */
  isLow(): boolean {
    return this.severity === ErrorSeverity.LOW;
  }

  /**
   * Check if error is of a specific category
   * @param category - Category to check
   * @returns True if error matches category
   */
  isCategory(category: ErrorCategory): boolean {
    return this.category === category;
  }

  /**
   * Check if operation can be retried
   * @returns True if retryable
   */
  canRetry(): boolean {
    return this.retryable;
  }

  /**
   * Convert error to JSON-serializable object
   * @returns JSON-compatible object representation
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      category: this.category,
      severity: this.severity,
      retryable: this.retryable,
      timestamp: this.timestamp,
      context: this.context,
      suggestedAction: this.suggestedAction,
      originalError: this.originalError ? {
        name: this.originalError.name,
        message: this.originalError.message,
        stack: this.originalError.stack,
      } : null,
      stack: this.stack,
    };
  }

  /**
   * Convert error to string representation
   * @returns Formatted error string with metadata
   */
  toString(): string {
    const parts: string[] = [
      `[${this.name}]`,
      `(${this.code})`,
      this.message,
    ];

    if (this.suggestedAction) {
      parts.push(`\nSuggested action: ${this.suggestedAction}`);
    }

     if (this.context && typeof this.context === 'object' && Object.keys(this.context as Record<string, unknown>).length > 0) {
       parts.push(`\nContext: ${JSON.stringify(this.context, null, 2)}`);
     }

    return parts.join(' ');
  }

  /**
   * Get error classification as a string
   * @returns Classification string combining category and severity
   */
  getClassification(): string {
    return `${this.category}:${this.severity}`;
  }

  /**
   * Check if error matches multiple criteria
   * @param criteria - Criteria to match against
   * @returns True if error matches all criteria
   */
  matches(criteria: {
    category?: ErrorCategory;
    severity?: ErrorSeverity;
    code?: string;
    retryable?: boolean;
  }): boolean {
    if (criteria.category && this.category !== criteria.category) return false;
    if (criteria.severity && this.severity !== criteria.severity) return false;
    if (criteria.code && this.code !== criteria.code) return false;
    if (criteria.retryable !== undefined && this.retryable !== criteria.retryable) return false;
    return true;
  }
}
