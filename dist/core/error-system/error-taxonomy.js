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
export var ErrorCategory;
(function (ErrorCategory) {
    ErrorCategory["NETWORK"] = "NETWORK";
    ErrorCategory["PROCESS"] = "PROCESS";
    ErrorCategory["SSH"] = "SSH";
    ErrorCategory["RESOURCE"] = "RESOURCE";
    ErrorCategory["SECURITY"] = "SECURITY";
    ErrorCategory["TIMEOUT"] = "TIMEOUT";
    ErrorCategory["FILESYSTEM"] = "FILESYSTEM";
})(ErrorCategory || (ErrorCategory = {}));
/**
 * Error severity levels
 * @enum {string}
 */
export var ErrorSeverity;
(function (ErrorSeverity) {
    ErrorSeverity["CRITICAL"] = "CRITICAL";
    ErrorSeverity["HIGH"] = "HIGH";
    ErrorSeverity["MEDIUM"] = "MEDIUM";
    ErrorSeverity["LOW"] = "LOW";
})(ErrorSeverity || (ErrorSeverity = {}));
/**
 * Standard error codes for each category
 * Network category codes
 */
export var NetworkErrorCode;
(function (NetworkErrorCode) {
    NetworkErrorCode["CONNECTION_TIMEOUT"] = "NET_CONN_TIMEOUT";
    NetworkErrorCode["DNS_FAILURE"] = "NET_DNS_FAILURE";
    NetworkErrorCode["CONNECTION_REFUSED"] = "NET_CONN_REFUSED";
    NetworkErrorCode["UNREACHABLE"] = "NET_UNREACHABLE";
    NetworkErrorCode["RESET"] = "NET_RESET";
    NetworkErrorCode["KEEP_ALIVE_TIMEOUT"] = "NET_KEEP_ALIVE_TIMEOUT";
    NetworkErrorCode["PROTOCOL_ERROR"] = "NET_PROTOCOL_ERROR";
})(NetworkErrorCode || (NetworkErrorCode = {}));
/**
 * Process category codes
 */
export var ProcessErrorCode;
(function (ProcessErrorCode) {
    ProcessErrorCode["SPAWN_FAILED"] = "PROC_SPAWN_FAILED";
    ProcessErrorCode["EXIT_CODE"] = "PROC_EXIT_CODE";
    ProcessErrorCode["SIGNAL_RECEIVED"] = "PROC_SIGNAL_RECEIVED";
    ProcessErrorCode["TIMEOUT"] = "PROC_TIMEOUT";
    ProcessErrorCode["NOT_FOUND"] = "PROC_NOT_FOUND";
    ProcessErrorCode["PERMISSION_DENIED"] = "PROC_PERM_DENIED";
    ProcessErrorCode["INVALID_ARGS"] = "PROC_INVALID_ARGS";
})(ProcessErrorCode || (ProcessErrorCode = {}));
/**
 * SSH category codes
 */
export var SSHErrorCode;
(function (SSHErrorCode) {
    SSHErrorCode["AUTH_FAILED"] = "SSH_AUTH_FAILED";
    SSHErrorCode["CONNECTION_FAILED"] = "SSH_CONN_FAILED";
    SSHErrorCode["COMMAND_FAILED"] = "SSH_CMD_FAILED";
    SSHErrorCode["TIMEOUT"] = "SSH_TIMEOUT";
    SSHErrorCode["HOST_KEY_VERIFICATION"] = "SSH_HOST_KEY_VERIFY";
    SSHErrorCode["CHANNEL_OPEN_FAILURE"] = "SSH_CHANNEL_OPEN_FAIL";
    SSHErrorCode["DISCONNECTED"] = "SSH_DISCONNECTED";
})(SSHErrorCode || (SSHErrorCode = {}));
/**
 * Resource category codes
 */
export var ResourceErrorCode;
(function (ResourceErrorCode) {
    ResourceErrorCode["MEMORY_EXCEEDED"] = "RES_MEMORY_EXCEEDED";
    ResourceErrorCode["CPU_LIMIT"] = "RES_CPU_LIMIT";
    ResourceErrorCode["FILE_HANDLES_EXCEEDED"] = "RES_FH_EXCEEDED";
    ResourceErrorCode["DISK_FULL"] = "RES_DISK_FULL";
    ResourceErrorCode["NOT_AVAILABLE"] = "RES_NOT_AVAILABLE";
    ResourceErrorCode["QUOTA_EXCEEDED"] = "RES_QUOTA_EXCEEDED";
})(ResourceErrorCode || (ResourceErrorCode = {}));
/**
 * Security category codes
 */
export var SecurityErrorCode;
(function (SecurityErrorCode) {
    SecurityErrorCode["VALIDATION_FAILED"] = "SEC_VALIDATION_FAILED";
    SecurityErrorCode["POLICY_VIOLATION"] = "SEC_POLICY_VIOLATION";
    SecurityErrorCode["UNAUTHORIZED"] = "SEC_UNAUTHORIZED";
    SecurityErrorCode["FORBIDDEN"] = "SEC_FORBIDDEN";
    SecurityErrorCode["INVALID_SIGNATURE"] = "SEC_INVALID_SIG";
    SecurityErrorCode["CERTIFICATE_INVALID"] = "SEC_CERT_INVALID";
})(SecurityErrorCode || (SecurityErrorCode = {}));
/**
 * Timeout category codes
 */
export var TimeoutErrorCode;
(function (TimeoutErrorCode) {
    TimeoutErrorCode["OPERATION_TIMEOUT"] = "TIMEOUT_OPERATION";
    TimeoutErrorCode["COMMAND_TIMEOUT"] = "TIMEOUT_COMMAND";
    TimeoutErrorCode["HANDSHAKE_TIMEOUT"] = "TIMEOUT_HANDSHAKE";
    TimeoutErrorCode["READ_TIMEOUT"] = "TIMEOUT_READ";
    TimeoutErrorCode["WRITE_TIMEOUT"] = "TIMEOUT_WRITE";
})(TimeoutErrorCode || (TimeoutErrorCode = {}));
/**
 * Filesystem category codes
 */
export var FilesystemErrorCode;
(function (FilesystemErrorCode) {
    FilesystemErrorCode["NOT_FOUND"] = "FS_NOT_FOUND";
    FilesystemErrorCode["PERMISSION_DENIED"] = "FS_PERM_DENIED";
    FilesystemErrorCode["READ_FAILED"] = "FS_READ_FAILED";
    FilesystemErrorCode["WRITE_FAILED"] = "FS_WRITE_FAILED";
    FilesystemErrorCode["IS_DIRECTORY"] = "FS_IS_DIR";
    FilesystemErrorCode["NOT_DIRECTORY"] = "FS_NOT_DIR";
    FilesystemErrorCode["EXISTS"] = "FS_EXISTS";
    FilesystemErrorCode["INVALID_PATH"] = "FS_INVALID_PATH";
})(FilesystemErrorCode || (FilesystemErrorCode = {}));
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
export class BaseError extends Error {
    /**
     * Initialize base error with metadata
     * @param message - Human-readable error message
     * @param options - Error configuration options
     */
    constructor(message, options) {
        super(message);
        this.name = this.constructor.name;
        this.category = options.category;
        this.code = options.code;
        this.severity = options.severity;
        this.retryable = options.retryable;
        this.context = options.context || {};
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
    getMetadata() {
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
    isCritical() {
        return this.severity === ErrorSeverity.CRITICAL;
    }
    /**
     * Check if error is of high severity
     * @returns True if severity is HIGH
     */
    isHigh() {
        return this.severity === ErrorSeverity.HIGH;
    }
    /**
     * Check if error is of medium severity
     * @returns True if severity is MEDIUM
     */
    isMedium() {
        return this.severity === ErrorSeverity.MEDIUM;
    }
    /**
     * Check if error is of low severity
     * @returns True if severity is LOW
     */
    isLow() {
        return this.severity === ErrorSeverity.LOW;
    }
    /**
     * Check if error is of a specific category
     * @param category - Category to check
     * @returns True if error matches category
     */
    isCategory(category) {
        return this.category === category;
    }
    /**
     * Check if operation can be retried
     * @returns True if retryable
     */
    canRetry() {
        return this.retryable;
    }
    /**
     * Convert error to JSON-serializable object
     * @returns JSON-compatible object representation
     */
    toJSON() {
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
    toString() {
        const parts = [
            `[${this.name}]`,
            `(${this.code})`,
            this.message,
        ];
        if (this.suggestedAction) {
            parts.push(`\nSuggested action: ${this.suggestedAction}`);
        }
        if (this.context && typeof this.context === 'object' && Object.keys(this.context).length > 0) {
            parts.push(`\nContext: ${JSON.stringify(this.context, null, 2)}`);
        }
        return parts.join(' ');
    }
    /**
     * Get error classification as a string
     * @returns Classification string combining category and severity
     */
    getClassification() {
        return `${this.category}:${this.severity}`;
    }
    /**
     * Check if error matches multiple criteria
     * @param criteria - Criteria to match against
     * @returns True if error matches all criteria
     */
    matches(criteria) {
        if (criteria.category && this.category !== criteria.category)
            return false;
        if (criteria.severity && this.severity !== criteria.severity)
            return false;
        if (criteria.code && this.code !== criteria.code)
            return false;
        if (criteria.retryable !== undefined && this.retryable !== criteria.retryable)
            return false;
        return true;
    }
}
