# Error System Overview

## Introduction

The Infected project implements a comprehensive, standardized error handling system designed for distributed systems, complex process management, and network operations. This document provides a complete overview of the error taxonomy, classification system, and integration with recovery strategies.

The error system is built on three core principles:

1. **Consistency**: All errors follow a standardized format with predictable properties
2. **Classification**: Errors are categorized for intelligent routing to recovery strategies
3. **Actionability**: Each error includes metadata to guide resolution

## Error Taxonomy Architecture

### System Overview

The error taxonomy is built on a hierarchical classification system that categorizes errors into distinct types and provides rich metadata for debugging and recovery.

```
BaseError (Abstract)
├── NetworkError
├── ProcessError
├── SSHError
├── ResourceError
├── SecurityError
├── TimeoutError
└── FilesystemError
```

Each error type extends `BaseError` and inherits standardized properties and methods while providing category-specific defaults and behaviors.

## Error Categories

The system defines 7 primary error categories, each handling a specific domain of failures:

### 1. NETWORK Category

Handles all network-level communication failures including connection issues, DNS problems, and protocol errors.

**Error Codes:**
- `NET_CONN_TIMEOUT` - Connection timeout to remote host
- `NET_DNS_FAILURE` - DNS resolution failure
- `NET_CONN_REFUSED` - Connection refused by remote host
- `NET_UNREACHABLE` - Network unreachable
- `NET_RESET` - Connection reset by peer
- `NET_KEEP_ALIVE_TIMEOUT` - Keep-alive timeout
- `NET_PROTOCOL_ERROR` - Protocol violation

**Example:**
```typescript
throw new NetworkError('Connection timeout to database', {
  code: NetworkErrorCode.CONNECTION_TIMEOUT,
  severity: ErrorSeverity.HIGH,
  retryable: true,
  context: {
    host: 'db.example.com',
    port: 5432,
    timeout: 30000,
    attempt: 1,
  },
  suggestedAction: 'Verify database is running and network connectivity is available',
});
```

**Common Causes:**
- Network connectivity issues
- Firewall blocking connections
- Remote service unavailable
- DNS resolution failures
- Connection pool exhaustion

**Retry Strategy:**
- Default: Retryable with exponential backoff
- Suitable for: RetryStrategy with 3-5 attempts
- Circuit breaker: Recommended for repeated failures

### 2. PROCESS Category

Handles process execution failures, including spawn errors, exit codes, signals, and command execution issues.

**Error Codes:**
- `PROC_SPAWN_FAILED` - Failed to spawn process
- `PROC_EXIT_CODE` - Process exited with non-zero code
- `PROC_SIGNAL_RECEIVED` - Process killed by signal
- `PROC_TIMEOUT` - Process execution timeout
- `PROC_NOT_FOUND` - Process executable not found
- `PROC_PERM_DENIED` - Permission denied executing process
- `PROC_INVALID_ARGS` - Invalid process arguments

**Example:**
```typescript
throw new ProcessError('npm test exited with code 1', {
  code: ProcessErrorCode.EXIT_CODE,
  severity: ErrorSeverity.HIGH,
  retryable: false,
  context: {
    command: 'npm test',
    exitCode: 1,
    pid: 12345,
    signal: null,
    stderr: 'Test suite failed',
  },
  suggestedAction: 'Review test output and fix failing tests',
});
```

**Common Causes:**
- Application logic errors
- Test suite failures
- Missing dependencies
- Insufficient permissions
- Invalid command arguments

**Retry Strategy:**
- Default: Non-retryable
- Exception: PROC_TIMEOUT can be retried
- Use: ProcessError should trigger manual review

### 3. SSH Category

Handles SSH protocol failures including authentication, connection, command execution, and key verification.

**Error Codes:**
- `SSH_AUTH_FAILED` - SSH authentication failure
- `SSH_CONN_FAILED` - SSH connection failure
- `SSH_CMD_FAILED` - Remote command execution failure
- `SSH_TIMEOUT` - SSH operation timeout
- `SSH_HOST_KEY_VERIFY` - Host key verification failure
- `SSH_CHANNEL_OPEN_FAIL` - SSH channel open failure
- `SSH_DISCONNECTED` - SSH connection unexpectedly disconnected

**Example:**
```typescript
throw new SSHError('Authentication failed for server', {
  code: SSHErrorCode.AUTH_FAILED,
  severity: ErrorSeverity.HIGH,
  retryable: false,
  context: {
    host: 'server.example.com',
    port: 22,
    user: 'deploy',
    authMethod: 'publicKey',
    keyPath: '/home/user/.ssh/id_rsa',
  },
  suggestedAction: 'Verify SSH key permissions (600) and add to authorized_keys',
});
```

**Common Causes:**
- Invalid SSH keys or credentials
- Host key mismatch or not trusted
- SSH server not responding
- Network routing issues
- Firewall blocking SSH port 22

**Retry Strategy:**
- Default: Non-retryable
- Exception: SSH_TIMEOUT, SSH_DISCONNECTED can be retried
- Use: Requires manual credential verification

### 4. RESOURCE Category

Handles resource exhaustion and quota violations including memory, CPU, file handles, and disk space.

**Error Codes:**
- `RES_MEMORY_EXCEEDED` - Memory limit exceeded
- `RES_CPU_LIMIT` - CPU limit exceeded
- `RES_FH_EXCEEDED` - File handle limit exceeded
- `RES_DISK_FULL` - Disk space full
- `RES_NOT_AVAILABLE` - Resource not available
- `RES_QUOTA_EXCEEDED` - Quota limit exceeded

**Example:**
```typescript
throw new ResourceError('Memory limit exceeded for operation', {
  code: ResourceErrorCode.MEMORY_EXCEEDED,
  severity: ErrorSeverity.CRITICAL,
  retryable: true,
  context: {
    available: 512,
    required: 1024,
    unit: 'MB',
    process: 'data-processing',
  },
  suggestedAction: 'Reduce batch size, increase available memory, or upgrade system resources',
});
```

**Common Causes:**
- Large dataset processing
- Memory leak in application
- Insufficient system resources
- Too many concurrent connections
- Large file operations

**Retry Strategy:**
- Default: Retryable (after cleanup)
- Use: Combine with timeout and garbage collection
- Circuit breaker: Recommended for repeated resource exhaustion

### 5. SECURITY Category

Handles security violations, validation failures, authorization issues, and cryptographic errors.

**Error Codes:**
- `SEC_VALIDATION_FAILED` - Validation failure
- `SEC_POLICY_VIOLATION` - Security policy violation
- `SEC_UNAUTHORIZED` - Unauthorized access
- `SEC_FORBIDDEN` - Access forbidden
- `SEC_INVALID_SIG` - Invalid cryptographic signature
- `SEC_CERT_INVALID` - Invalid certificate

**Example:**
```typescript
throw new SecurityError('API key validation failed', {
  code: SecurityErrorCode.VALIDATION_FAILED,
  severity: ErrorSeverity.HIGH,
  retryable: false,
  context: {
    field: 'apiKey',
    reason: 'Invalid format or expired',
    timestamp: new Date().toISOString(),
  },
  suggestedAction: 'Verify API key format, expiration, and permissions',
});
```

**Common Causes:**
- Invalid credentials or API keys
- Expired tokens or certificates
- Insufficient permissions
- Policy violations
- Signature verification failure

**Retry Strategy:**
- Default: Non-retryable
- Rationale: Repeating same credentials won't help
- Use: Require manual intervention to fix credentials

### 6. TIMEOUT Category

Handles operation, command, handshake, and I/O timeouts.

**Error Codes:**
- `TIMEOUT_OPERATION` - Generic operation timeout
- `TIMEOUT_COMMAND` - Command execution timeout
- `TIMEOUT_HANDSHAKE` - Protocol handshake timeout
- `TIMEOUT_READ` - Read operation timeout
- `TIMEOUT_WRITE` - Write operation timeout

**Example:**
```typescript
throw new TimeoutError('Operation timeout after 30 seconds', {
  code: TimeoutErrorCode.OPERATION_TIMEOUT,
  severity: ErrorSeverity.MEDIUM,
  retryable: true,
  context: {
    operation: 'fetchUserData',
    timeout: 30000,
    elapsed: 30123,
  },
  suggestedAction: 'Increase timeout threshold or optimize operation performance',
});
```

**Common Causes:**
- Remote service is slow or unresponsive
- Network latency
- Resource contention
- Large data transfers
- Blocking I/O operations

**Retry Strategy:**
- Default: Retryable
- Use: RetryStrategy with exponential backoff
- Consideration: Increase timeout on subsequent retries

### 7. FILESYSTEM Category

Handles file system operations including permission, access, and path errors.

**Error Codes:**
- `FS_NOT_FOUND` - File or directory not found
- `FS_PERM_DENIED` - Permission denied
- `FS_READ_FAILED` - Read operation failed
- `FS_WRITE_FAILED` - Write operation failed
- `FS_IS_DIR` - Expected file, got directory
- `FS_NOT_DIR` - Expected directory, got file
- `FS_EXISTS` - File already exists
- `FS_INVALID_PATH` - Invalid file path

**Example:**
```typescript
throw new FilesystemError('File not found in working directory', {
  code: FilesystemErrorCode.NOT_FOUND,
  severity: ErrorSeverity.MEDIUM,
  retryable: false,
  context: {
    path: '/data/config.json',
    operation: 'read',
    workingDir: '/app',
  },
  suggestedAction: 'Verify file exists and path is correct relative to working directory',
});
```

**Common Causes:**
- File path errors
- Insufficient permissions
- File system issues
- Race conditions in concurrent access
- Disk I/O errors

**Retry Strategy:**
- Default: Non-retryable
- Exception: Some transient I/O errors can be retried
- Use: Validate paths and permissions before operations

## Error Metadata Structure

Every error includes comprehensive metadata for debugging and routing to recovery strategies:

```typescript
interface ErrorMetadata<T = Record<string, unknown>> {
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
```

### Severity Levels

Errors are classified into 4 severity levels:

1. **CRITICAL** - System-wide failure, immediate action required
   - Example: Memory exhausted, core service failure
   - Response: Alert administrators, trigger incident response

2. **HIGH** - Major functionality impaired, operation failed
   - Example: Database connection lost, authentication failed
   - Response: Retry, escalate if persists

3. **MEDIUM** - Operation failed but can be recovered
   - Example: Single request timeout, temporary resource unavailable
   - Response: Retry with backoff

4. **LOW** - Minor issue, operation may complete on retry
   - Example: Connection timeout on initial attempt
   - Response: Transparent retry

## Conversion from Native Node.js Errors

The system provides utilities to convert native JavaScript and Node.js errors into typed errors:

### Converting Common Node.js Errors

```typescript
// Network errors from 'net' module
const netError = new Error('connect ECONNREFUSED 127.0.0.1:3000');
const converted = NetworkError.from(netError, {
  host: '127.0.0.1',
  port: 3000,
});

// File system errors
const fsError = new Error('ENOENT: no such file or directory');
const fsConverted = FilesystemError.from(fsError, {
  path: '/app/config.json',
  operation: 'read',
});

// Timeout errors
const timeoutError = new Error('Operation timeout');
const timeoutConverted = TimeoutError.from(timeoutError, {
  timeout: 30000,
  elapsed: 30500,
});
```

### Conversion Strategy

When converting errors:

1. **Parse error message and code** - Extract information from error name and message
2. **Determine category** - Map to appropriate error category
3. **Set retryable flag** - Based on error type and category
4. **Extract context** - Preserve relevant details from original error
5. **Create typed error** - Instantiate appropriate error class

```typescript
function convertNodeError(error: Error, context?: Record<string, unknown>) {
  // Network errors
  if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
    return new NetworkError(error.message, {
      code: NetworkErrorCode.CONNECTION_REFUSED,
      severity: ErrorSeverity.HIGH,
      retryable: true,
      originalError: error,
      context,
    });
  }
  
  // Filesystem errors
  if (error.code === 'ENOENT') {
    return new FilesystemError(error.message, {
      code: FilesystemErrorCode.NOT_FOUND,
      severity: ErrorSeverity.MEDIUM,
      retryable: false,
      originalError: error,
      context,
    });
  }
  
  // Generic fallback
  return error;
}
```

## Type Guards and Utilities

### Type Guard Functions

Use type guards to safely check error types:

```typescript
function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError;
}

function isRetryable(error: unknown): error is BaseError {
  return error instanceof BaseError && error.canRetry();
}

function isCritical(error: unknown): error is BaseError {
  return error instanceof BaseError && error.isCritical();
}

// Usage
try {
  await fetchData();
} catch (error) {
  if (isNetworkError(error) && error.retryable) {
    // Retry with strategy
  } else if (isCritical(error)) {
    // Alert and shutdown
  }
}
```

### Error Matching

Match errors against multiple criteria:

```typescript
const error = new NetworkError('Connection timeout', {
  code: NetworkErrorCode.CONNECTION_TIMEOUT,
  severity: ErrorSeverity.HIGH,
  retryable: true,
});

// Exact match
if (error.code === NetworkErrorCode.CONNECTION_TIMEOUT) {
  // Handle timeout specifically
}

// Pattern matching
if (error.matches({
  category: ErrorCategory.NETWORK,
  severity: ErrorSeverity.HIGH,
  retryable: true,
})) {
  // Handle high-severity retryable network errors
}

// Classification
const [category, severity] = error.getClassification().split(':');
```

### Metadata Access

Retrieve comprehensive metadata for logging and analysis:

```typescript
const error = new NetworkError('Connection failed', {
  code: NetworkErrorCode.CONNECTION_TIMEOUT,
  retryable: true,
  context: { host: 'example.com', timeout: 5000 },
});

// Get all metadata
const metadata = error.getMetadata();
console.log(metadata);
// {
//   timestamp: '2024-03-16T12:00:00Z',
//   category: 'NETWORK',
//   code: 'NET_CONN_TIMEOUT',
//   severity: 'HIGH',
//   retryable: true,
//   context: { host: 'example.com', timeout: 5000 },
//   originalError: null,
//   suggestedAction: 'Check network connectivity...',
//   stack: '...',
// }

// Convert to JSON
const json = error.toJSON();

// Convert to string
const str = error.toString();
```

## Error Classification Patterns

### Pattern 1: Transient vs. Permanent Errors

```typescript
interface ErrorPattern {
  retryable: boolean;
  recoveryStrategy: 'retry' | 'circuitBreaker' | 'manual' | 'none';
  maxRetries: number;
  backoffMultiplier: number;
}

// Transient network error - retry with backoff
const transientPattern: ErrorPattern = {
  retryable: true,
  recoveryStrategy: 'retry',
  maxRetries: 5,
  backoffMultiplier: 2,
};

// Permanent auth error - no retry
const permanentPattern: ErrorPattern = {
  retryable: false,
  recoveryStrategy: 'manual',
  maxRetries: 0,
  backoffMultiplier: 1,
};
```

### Pattern 2: Cascading vs. Isolated

```typescript
// Cascading: affects multiple operations
const cascading = new NetworkError('Database unreachable', {
  code: NetworkErrorCode.CONNECTION_TIMEOUT,
  severity: ErrorSeverity.CRITICAL,
  retryable: true,
  context: { service: 'primary-db' },
});

// Isolated: affects single operation
const isolated = new ProcessError('Single test failed', {
  code: ProcessErrorCode.EXIT_CODE,
  severity: ErrorSeverity.MEDIUM,
  retryable: false,
  context: { testName: 'users.test.ts' },
});
```

### Pattern 3: User-Facing vs. System Errors

```typescript
// System error - requires infrastructure fix
const systemError = new ResourceError('Disk full', {
  code: ResourceErrorCode.DISK_FULL,
  severity: ErrorSeverity.CRITICAL,
  retryable: false,
  suggestedAction: 'Increase disk capacity or clean up old data',
});

// User error - requires input correction
const userError = new SecurityError('Invalid API key', {
  code: SecurityErrorCode.VALIDATION_FAILED,
  severity: ErrorSeverity.HIGH,
  retryable: false,
  suggestedAction: 'Verify and update API key in configuration',
});
```

## Error Codes Reference

### Summary Table

| Code | Category | Retryable | Severity | Common Cause |
|------|----------|-----------|----------|--------------|
| NET_CONN_TIMEOUT | NETWORK | Yes | HIGH | Connection timeout |
| NET_DNS_FAILURE | NETWORK | Yes | HIGH | DNS resolution failed |
| NET_CONN_REFUSED | NETWORK | Yes | HIGH | Remote rejected connection |
| NET_UNREACHABLE | NETWORK | Yes | HIGH | Network unavailable |
| NET_RESET | NETWORK | Yes | HIGH | Peer reset connection |
| PROC_SPAWN_FAILED | PROCESS | No | HIGH | Cannot spawn process |
| PROC_EXIT_CODE | PROCESS | No | HIGH | Process exited with error |
| PROC_TIMEOUT | PROCESS | Yes | HIGH | Process took too long |
| SSH_AUTH_FAILED | SSH | No | HIGH | Authentication failed |
| SSH_CONN_FAILED | SSH | Yes | HIGH | Connection failed |
| SSH_CMD_FAILED | SSH | No | HIGH | Remote command failed |
| RES_MEMORY_EXCEEDED | RESOURCE | Yes | CRITICAL | Out of memory |
| RES_DISK_FULL | RESOURCE | No | CRITICAL | Disk is full |
| RES_CPU_LIMIT | RESOURCE | No | CRITICAL | CPU limit reached |
| SEC_VALIDATION_FAILED | SECURITY | No | HIGH | Invalid input |
| SEC_UNAUTHORIZED | SECURITY | No | HIGH | Authentication required |
| TIMEOUT_OPERATION | TIMEOUT | Yes | MEDIUM | Operation timed out |
| TIMEOUT_COMMAND | TIMEOUT | Yes | MEDIUM | Command timed out |
| FS_NOT_FOUND | FILESYSTEM | No | MEDIUM | File not found |
| FS_PERM_DENIED | FILESYSTEM | No | MEDIUM | Permission denied |

## Integration with Recovery Strategies

Errors are designed to work seamlessly with recovery strategies:

### Automatic Recovery Selection

```typescript
function selectRecoveryStrategy(error: BaseError): RecoveryStrategy {
  // Non-retryable errors - fail fast
  if (!error.retryable) {
    return RecoveryStrategy.FAIL_FAST;
  }
  
  // Critical errors - use circuit breaker
  if (error.isCritical()) {
    return RecoveryStrategy.CIRCUIT_BREAKER;
  }
  
  // Network errors - use retry with backoff
  if (error.category === ErrorCategory.NETWORK) {
    return RecoveryStrategy.RETRY_BACKOFF;
  }
  
  // Timeout errors - use longer retry period
  if (error.category === ErrorCategory.TIMEOUT) {
    return RecoveryStrategy.RETRY_LONG;
  }
  
  // Default - retry with jitter
  return RecoveryStrategy.RETRY_JITTER;
}
```

### Recovery Handler Integration

```typescript
const recoveryHandlers = {
  [NetworkErrorCode.CONNECTION_TIMEOUT]: async (error, context) => {
    // Log the error
    logger.warn('Network timeout', { error: error.getMetadata(), attempt: context.attempt });
    
    // Check if circuit breaker should be involved
    if (context.attempt > 2) {
      circuitBreaker.recordFailure();
    }
  },
  
  [SSHErrorCode.AUTH_FAILED]: async (error, context) => {
    // Alert on auth failures
    logger.error('SSH auth failure', { error: error.getMetadata() });
    alerting.notifySecurityTeam();
  },
  
  [ResourceErrorCode.MEMORY_EXCEEDED]: async (error, context) => {
    // Trigger cleanup
    logger.error('Memory exceeded', { error: error.getMetadata() });
    await gc();
    clearCaches();
  },
};
```

## Best Practices

1. **Always use typed errors**: Never throw generic `Error` objects
2. **Include context**: Provide relevant debugging information
3. **Set correct severity**: Use appropriate severity levels
4. **Use suggestions**: Include actionable recovery hints
5. **Preserve original errors**: Keep reference to original error for debugging
6. **Classify correctly**: Use proper error categories for routing
7. **Test error paths**: Ensure error handling is tested

## Summary

The error system provides:

- **7 error categories** covering all major failure domains
- **46+ standardized error codes** for precise error identification
- **Rich metadata** for debugging and recovery routing
- **Type safety** with TypeScript and type guards
- **Integration** with recovery strategies
- **Logging support** for monitoring and analysis
- **Actionable guidance** for error resolution

This comprehensive system enables sophisticated error handling, intelligent recovery, and effective monitoring across the entire platform.

---

**Related Documentation:**
- [Recovery Strategies Guide](RECOVERY_STRATEGIES_GUIDE.md)
- [Error Codes Reference](ERROR_CODES_REFERENCE.md)
- [Best Practices](BEST_PRACTICES.md)
- [Examples](EXAMPLES.md)
- [Troubleshooting](TROUBLESHOOTING.md)
