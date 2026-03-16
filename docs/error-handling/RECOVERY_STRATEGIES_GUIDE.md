# Recovery Strategies Guide

## Introduction

Recovery strategies are the mechanisms that detect errors and automatically take corrective action. This guide covers the three primary recovery strategies: RetryStrategy, CircuitBreaker, and RecoveryHandler orchestrator.

These strategies work together to build resilient systems that can gracefully degrade and recover from transient failures while protecting against cascading failures.

## Architecture Overview

Recovery strategies follow a clear layering model:

```
Application Code
        ↓
RecoveryHandler (Orchestrator)
        ├── RetryStrategy (Transient Failures)
        └── CircuitBreaker (Cascading Failures)
        ↓
External Service / Operation
```

## RetryStrategy: Exponential Backoff with Jitter

### Purpose

RetryStrategy automatically retries failed operations with exponential backoff, preventing overwhelming failed services and increasing success probability for transient failures.

### Configuration

```typescript
interface RetryConfig {
  /** Maximum number of attempts (default: 3) */
  maxAttempts?: number;
  
  /** Initial delay in milliseconds (default: 100) */
  initialDelayMs?: number;
  
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs?: number;
  
  /** Exponential backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  
  /** Enable jitter to prevent thundering herd (default: true) */
  useJitter?: boolean;
  
  /** Jitter range as percentage (default: 0.25 for ±25%) */
  jitterFraction?: number;
}
```

### Delay Calculation

RetryStrategy calculates delays using exponential backoff with optional jitter:

```
Base Delay = initialDelayMs × (backoffMultiplier ^ (attempt - 2))
Capped Delay = min(Base Delay, maxDelayMs)
Jittered Delay = Capped Delay × (1 ± jitterFraction)
```

#### Example Calculation

With defaults (initial: 100ms, multiplier: 2, max: 30000ms, jitter: ±25%):

| Attempt | Base (ms) | Capped (ms) | Jitter Range (ms) | Example (ms) |
|---------|-----------|-------------|-------------------|--------------|
| 1       | 0         | 0           | N/A               | 0            |
| 2       | 100       | 100         | 75-125            | 98           |
| 3       | 200       | 200         | 150-250           | 215          |
| 4       | 400       | 400         | 300-500           | 387          |
| 5       | 800       | 800         | 600-1000          | 892          |
| 6       | 1600      | 1600        | 1200-2000         | 1567         |
| 7       | 3200      | 3200        | 2400-4000         | 3124         |
| 8       | 6400      | 6400        | 4800-8000         | 6789         |

**Total backoff time:** ~13.5 seconds (varies with jitter)

### Presets

The system provides pre-configured presets for common scenarios:

#### Aggressive Retry (Fast Failures)
```typescript
const retry = new RetryStrategy({
  maxAttempts: 3,
  initialDelayMs: 50,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
  useJitter: true,
});
// Use for: Cache lookups, local operations
// Total time: ~5 seconds
```

#### Standard Retry (Balanced)
```typescript
const retry = new RetryStrategy({
  maxAttempts: 5,
  initialDelayMs: 100,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  useJitter: true,
});
// Use for: API calls, database operations
// Total time: ~10 seconds
```

#### Conservative Retry (Long Waits)
```typescript
const retry = new RetryStrategy({
  maxAttempts: 7,
  initialDelayMs: 500,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  useJitter: true,
});
// Use for: Long-running operations, batch jobs
// Total time: ~60 seconds
```

#### Timeout-Focused Retry
```typescript
const retry = new RetryStrategy({
  maxAttempts: 10,
  initialDelayMs: 1000,
  maxDelayMs: 60000,
  backoffMultiplier: 1.5,
  useJitter: true,
});
// Use for: Operations with high variance
// Total time: ~5 minutes
```

### Event Emission

RetryStrategy emits events for monitoring and custom handling:

```typescript
strategy.on('retry', (event) => {
  console.log(`Retry attempt ${event.attempt}, waiting ${event.nextDelayMs}ms`);
});

strategy.on('retrySuccess', (event) => {
  console.log(`Succeeded on attempt ${event.attempt}`);
});

strategy.on('retryFailure', (error) => {
  console.error(`All retries exhausted: ${error.message}`);
});
```

### Usage Example

```typescript
const retry = new RetryStrategy({
  maxAttempts: 5,
  initialDelayMs: 100,
  maxDelayMs: 10000,
});

// Monitor retries
retry.on('retry', (event) => {
  metrics.recordRetry(event.attempt);
});

try {
  const data = await retry.execute(async () => {
    const response = await fetch('https://api.example.com/data');
    if (!response.ok) {
      throw new NetworkError('API error', {
        code: NetworkErrorCode.CONNECTION_TIMEOUT,
        retryable: true,
      });
    }
    return response.json();
  });
  
  console.log('Success:', data);
} catch (error) {
  console.error('Failed after retries:', error);
}
```

### Retry Filtering

Control which errors trigger retries:

```typescript
class SmartRetryStrategy extends RetryStrategy {
  async execute<T>(
    fn: () => Promise<T>,
    shouldRetry: (error: BaseError) => boolean = (e) => e.retryable
  ): Promise<T> {
    // Only retry if shouldRetry returns true
    let lastError: BaseError | null = null;
    
    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (!(error instanceof BaseError) || !shouldRetry(error)) {
          throw error;
        }
        lastError = error;
        
        if (attempt < this.config.maxAttempts) {
          const delay = this.calculateDelay(attempt);
          await this.sleep(delay);
        }
      }
    }
    
    throw lastError;
  }
}
```

## CircuitBreaker: Cascading Failure Prevention

### Purpose

CircuitBreaker prevents cascading failures by monitoring request success rates and temporarily stopping requests when failures exceed thresholds, allowing downstream services to recover.

### States

```
CLOSED (Normal) → OPEN (Failing) → HALF_OPEN (Testing) → CLOSED/OPEN
```

#### CLOSED State (Normal Operation)
- Requests pass through normally
- Success/failure recorded
- Transitions to OPEN if failures exceed threshold
- Typical duration: Minutes to hours

#### OPEN State (Failure Detected)
- Requests rejected immediately without calling service
- Allows service to recover
- Transitions to HALF_OPEN after timeout
- Duration: Configurable (default 60 seconds)

#### HALF_OPEN State (Testing Recovery)
- Limited requests allowed through
- Tests if service recovered
- Transitions to CLOSED if threshold met, OPEN if failures occur
- Duration: Until threshold or failure

### Configuration

```typescript
interface CircuitBreakerConfig {
  /** Number of failures before opening circuit (default: 5) */
  failureThreshold?: number;
  
  /** Number of successes in HALF_OPEN to close circuit (default: 2) */
  successThreshold?: number;
  
  /** Duration in OPEN state before HALF_OPEN (default: 60000ms) */
  timeout?: number;
  
  /** Time window for failure tracking (default: 60000ms) */
  windowSize?: number;
  
  /** Track failures by error type (default: true) */
  monitorErrorType?: boolean;
}
```

### Failure Detection Strategy

CircuitBreaker uses a rolling window to track failures:

```typescript
// With windowSize: 60000ms, failureThreshold: 5
// Tracks failures in last 60 seconds
// Opens when 5 failures detected

const breaker = new CircuitBreaker({
  failureThreshold: 5,      // Open after 5 failures
  successThreshold: 2,      // Close after 2 successes in HALF_OPEN
  timeout: 60000,           // Wait 60s before HALF_OPEN
  windowSize: 60000,        // Track last 60s of failures
  monitorErrorType: true,   // Track by error code
});
```

### State Machine Diagram

```
                        Successes ≥ successThreshold
                        or timeout expires
                                  ↓
    ┌──────────────────────────────────────────────┐
    │                                              │
    ▼                                              │
┌─────────────────────────────────────────────────────────┐
│                      CLOSED                             │
│            (Normal Operation, requests pass)            │
└────────────────────────┬────────────────────────────────┘
                         │
            Failures ≥ failureThreshold
                         │
                         ▼
    ┌──────────────────────────────────────────────┐
    │                                              │
    │            Timeout expires                  │
    │            (default 60s)                    │
    │                  │                          │
    │                  ▼                          │
    │    ┌────────────────────────────────┐       │
    │    │       HALF_OPEN                │       │
    │    │ (Limited requests, testing)    │       │
    │    │   ↑             ↓              │       │
    │    │ Success      Failure          │       │
    │    │   │             │              │       │
    │    │ Close         Reopen         │       │
    │    └────────────────────────────────┘       │
    │                  │                          │
    └──────────────────┘                          │
         OPEN (Rejecting requests)                │
         (default 60s)────────────────────────────┘
```

### Metrics and Monitoring

CircuitBreaker tracks detailed metrics:

```typescript
interface CircuitBreakerMetrics {
  totalRequests: number;              // All requests processed
  successfulRequests: number;          // Successful executions
  failedRequests: number;              // Failed executions
  rejectedRequests: number;            // Rejected while OPEN
  currentFailureCount: number;         // In current window
  lastFailureTime: number;             // Timestamp of last failure
  lastErrorCode: string;               // Code of last error
  stateChanges: number;                // Total state transitions
  halfOpenAttempts: number;            // Attempts in HALF_OPEN
}
```

### Usage Example

```typescript
const breaker = new CircuitBreaker({
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 60000,
  windowSize: 60000,
});

// Monitor state changes
breaker.on(CircuitBreakerEventType.STATE_CHANGE, (type, state, details) => {
  console.log(`Circuit breaker transitioned to ${state}`);
  if (state === CircuitState.OPEN) {
    alerting.notifyOps(`Service unavailable: ${details?.serviceName}`);
  }
});

try {
  const result = await breaker.execute(async () => {
    return await callExternalService();
  });
} catch (error) {
  if (error instanceof CircuitBreakerOpenError) {
    console.log('Circuit is OPEN - service unavailable');
    // Fallback to cached data or degraded mode
  }
}
```

### Presets for Different Scenarios

#### Web API Protection
```typescript
new CircuitBreaker({
  failureThreshold: 5,      // 5 failures triggers open
  successThreshold: 3,      // 3 successes to close
  timeout: 30000,           // 30s wait before testing
  windowSize: 60000,        // 1 minute window
});
```

#### Database Connection Pool
```typescript
new CircuitBreaker({
  failureThreshold: 3,      // More sensitive
  successThreshold: 2,
  timeout: 10000,           // Faster recovery
  windowSize: 30000,        // Smaller window
});
```

#### Batch Job Protection
```typescript
new CircuitBreaker({
  failureThreshold: 10,     // More tolerant
  successThreshold: 5,      // More tests needed
  timeout: 300000,          // 5 minute wait
  windowSize: 600000,       // 10 minute window
});
```

## RecoveryHandler: Orchestration and Coordination

### Purpose

RecoveryHandler orchestrates RetryStrategy and CircuitBreaker, providing integrated error handling with custom recovery functions for specific error codes.

### Architecture

```typescript
interface RecoveryHandlerConfig {
  enableRetry: boolean;
  enableCircuitBreaker: boolean;
  retry: RetryConfig;
  circuitBreaker: CircuitBreakerConfig;
  recoveryHandlers: Map<string, RecoveryFunction>;
}
```

### Recovery Handler Pattern

Recovery handlers are custom functions called when specific errors occur:

```typescript
type RecoveryFunction = (
  error: BaseError,
  context: RecoveryContext
) => Promise<void>;

interface RecoveryContext {
  errorCode: string;
  severity: ErrorSeverity;
  timestamp: number;
  attempt: number;
  willRetry: boolean;
  executionPath: string;
}
```

### Execution Flow

```
1. Operation executed
         ↓
2. Error caught
         ↓
3. Check if error is retryable
         ├─ No → Fail
         └─ Yes ↓
4. Call recovery handler (if exists)
         ↓
5. Check circuit breaker
         ├─ OPEN → Reject
         ├─ HALF_OPEN → Allow with tracking
         └─ CLOSED → Continue
         ↓
6. Retry with backoff
         ├─ Success → Return result
         └─ Failure → Repeat from step 3
```

### Configuration Example

```typescript
const handler = new RecoveryHandler({
  enableRetry: true,
  enableCircuitBreaker: true,
  retry: {
    maxRetries: 5,
    initialDelayMs: 100,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
    jitterFactor: 0.25,
  },
  circuitBreaker: {
    failureThreshold: 5,
    successThreshold: 2,
    timeoutMs: 60000,
    halfOpenMaxAttempts: 3,
  },
  recoveryHandlers: new Map([
    [NetworkErrorCode.CONNECTION_TIMEOUT, async (error, context) => {
      logger.warn('Network timeout, retrying...', {
        attempt: context.attempt,
        nextRetry: context.willRetry,
      });
    }],
    [SSHErrorCode.AUTH_FAILED, async (error, context) => {
      logger.error('SSH auth failed', { error: error.getMetadata() });
      alerting.notifySecurityTeam(error);
    }],
    [ResourceErrorCode.MEMORY_EXCEEDED, async (error, context) => {
      logger.error('Memory exceeded', { error: error.getMetadata() });
      await gc();
      clearCaches();
    }],
  ]),
});
```

### Execution Options

```typescript
interface ExecutionOptions {
  circuitBreakerName?: string;    // Group for circuit breaker
  timeout?: number;                // Operation timeout
  metadata?: Record<string, unknown>; // Custom context
  tag?: string;                    // Debug tag
}
```

### Usage Pattern

```typescript
// Execute with automatic recovery
const result = await handler.execute(
  async () => {
    return await fetchDataFromAPI();
  },
  {
    circuitBreakerName: 'api-service',
    timeout: 30000,
    tag: 'fetch-user-data',
  }
);
```

## Configuration Examples for Different Scenarios

### 1. REST API Client

```typescript
const apiHandler = new RecoveryHandler({
  enableRetry: true,
  enableCircuitBreaker: true,
  retry: {
    maxRetries: 5,
    initialDelayMs: 100,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
    jitterFactor: 0.25,
  },
  circuitBreaker: {
    failureThreshold: 5,
    successThreshold: 2,
    timeoutMs: 60000,
    halfOpenMaxAttempts: 3,
  },
  recoveryHandlers: new Map([
    [NetworkErrorCode.CONNECTION_TIMEOUT, logAndAlert],
    [NetworkErrorCode.CONNECTION_REFUSED, checkServiceHealth],
    [TimeoutErrorCode.OPERATION_TIMEOUT, increaseTimeout],
  ]),
});
```

### 2. Database Operations

```typescript
const dbHandler = new RecoveryHandler({
  enableRetry: true,
  enableCircuitBreaker: true,
  retry: {
    maxRetries: 3,
    initialDelayMs: 50,
    maxDelayMs: 5000,
    backoffMultiplier: 2,
    jitterFactor: 0.25,
  },
  circuitBreaker: {
    failureThreshold: 3,
    successThreshold: 2,
    timeoutMs: 10000,
    halfOpenMaxAttempts: 2,
  },
  recoveryHandlers: new Map([
    [NetworkErrorCode.CONNECTION_TIMEOUT, resetConnection],
    [ProcessErrorCode.TIMEOUT, killSlowQuery],
  ]),
});
```

### 3. SSH Remote Operations

```typescript
const sshHandler = new RecoveryHandler({
  enableRetry: true,
  enableCircuitBreaker: true,
  retry: {
    maxRetries: 3,
    initialDelayMs: 500,
    maxDelayMs: 5000,
    backoffMultiplier: 1.5,
    jitterFactor: 0.2,
  },
  circuitBreaker: {
    failureThreshold: 3,
    successThreshold: 1,
    timeoutMs: 30000,
    halfOpenMaxAttempts: 1,
  },
  recoveryHandlers: new Map([
    [SSHErrorCode.DISCONNECTED, reconnectSSH],
    [SSHErrorCode.AUTH_FAILED, requestNewCredentials],
    [TimeoutErrorCode.OPERATION_TIMEOUT, increaseTimeout],
  ]),
});
```

### 4. File Operations

```typescript
const fileHandler = new RecoveryHandler({
  enableRetry: true,
  enableCircuitBreaker: false,      // No circuit breaker for local ops
  retry: {
    maxRetries: 2,
    initialDelayMs: 50,
    maxDelayMs: 1000,
    backoffMultiplier: 2,
    jitterFactor: 0.1,
  },
  circuitBreaker: {
    failureThreshold: 10,
    successThreshold: 5,
    timeoutMs: 60000,
    halfOpenMaxAttempts: 3,
  },
  recoveryHandlers: new Map([
    [FilesystemErrorCode.NOT_FOUND, validatePath],
    [FilesystemErrorCode.PERM_DENIED, checkPermissions],
  ]),
});
```

## Performance Considerations

### Timeout Management

```typescript
// Align operation timeout with retry strategy
const strategy = new RetryStrategy({
  maxAttempts: 5,
  initialDelayMs: 100,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
});
// Total backoff: ~31 seconds

// Operation timeout should be longer
const options = {
  timeout: 60000,  // 1 minute total
};
```

### Memory Impact

```typescript
// Monitor memory during retries
const memoryTracker = new MemoryTracker();

strategy.on('retry', (event) => {
  const usage = process.memoryUsage();
  if (usage.heapUsed > MAX_HEAP) {
    // Abort retry and fail fast
    throw new ResourceError('Memory limit exceeded', {
      code: ResourceErrorCode.MEMORY_EXCEEDED,
      retryable: false,
    });
  }
});
```

### Concurrent Operations

```typescript
// Limit concurrent retries to avoid overwhelming system
class BoundedRetryStrategy {
  constructor(
    private strategy: RetryStrategy,
    private maxConcurrent: number = 10
  ) {}
  
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.semaphore.acquire();
    try {
      return await this.strategy.execute(fn);
    } finally {
      this.semaphore.release();
    }
  }
}
```

## Common Patterns and Anti-Patterns

### Pattern: Exponential Backoff with Jitter
✓ **GOOD**: Prevents thundering herd and spreads load

```typescript
const strategy = new RetryStrategy({
  initialDelayMs: 100,
  backoffMultiplier: 2,
  useJitter: true,
  jitterFraction: 0.25,
});
```

### Anti-Pattern: Linear Retry Without Jitter
✗ **BAD**: All clients retry simultaneously, causing thundering herd

```typescript
// Don't do this
const badStrategy = new RetryStrategy({
  initialDelayMs: 100,
  backoffMultiplier: 1,  // Linear, not exponential
  useJitter: false,       // No jitter
});
```

### Pattern: Circuit Breaker for External Services
✓ **GOOD**: Protects dependent systems

```typescript
const breaker = new CircuitBreaker({
  failureThreshold: 5,
  timeout: 60000,
});

try {
  return await breaker.execute(() => callExternalAPI());
} catch (error) {
  if (error instanceof CircuitBreakerOpenError) {
    return cachedResponse || defaultValue;
  }
  throw error;
}
```

### Anti-Pattern: No Circuit Breaker for External Services
✗ **BAD**: Can cause cascading failures

```typescript
// Don't do this - can overwhelm external service
while (failures < maxFailures) {
  try {
    return await callUnreliableService();
  } catch {
    failures++;
  }
}
```

### Pattern: Selective Retry Based on Error Type
✓ **GOOD**: Only retries appropriate errors

```typescript
const shouldRetry = (error: BaseError) => {
  return (
    error.retryable &&
    !error.isCritical() &&
    error.category !== ErrorCategory.SECURITY
  );
};

// Use shouldRetry in retry logic
```

### Anti-Pattern: Retry All Errors
✗ **BAD**: Wastes time retrying permanent failures

```typescript
// Don't do this - will retry auth failures forever
for (let i = 0; i < maxRetries; i++) {
  try {
    return await authenticate();
  } catch {
    // Retries auth failure - never succeeds!
  }
}
```

## Real-World Use Cases

### Use Case 1: API Rate Limiting Recovery

```typescript
const handler = new RecoveryHandler({
  enableRetry: true,
  enableCircuitBreaker: true,
  retry: {
    maxRetries: 10,
    initialDelayMs: 1000,        // Start with 1s
    maxDelayMs: 60000,           // Cap at 1 minute
    backoffMultiplier: 1.5,
    jitterFactor: 0.25,
  },
  recoveryHandlers: new Map([
    [NetworkErrorCode.CONNECTION_REFUSED, async (error, context) => {
      if (context.attempt <= 3) {
        logger.info('Rate limited, backing off...');
      }
    }],
  ]),
});
```

### Use Case 2: Database Connection Pool Recovery

```typescript
const handler = new RecoveryHandler({
  enableRetry: true,
  enableCircuitBreaker: true,
  retry: {
    maxRetries: 3,
    initialDelayMs: 50,
    maxDelayMs: 5000,
    backoffMultiplier: 2,
    jitterFactor: 0.1,
  },
  recoveryHandlers: new Map([
    [NetworkErrorCode.CONNECTION_TIMEOUT, async (error, context) => {
      // Drain and rebuild connection pool
      await connectionPool.drain();
      await connectionPool.init();
    }],
  ]),
});
```

### Use Case 3: Graceful Degradation with Fallbacks

```typescript
async function getDataWithFallback() {
  try {
    return await handler.execute(
      () => fetchFromPrimaryService(),
      { circuitBreakerName: 'primary' }
    );
  } catch (error) {
    if (error instanceof CircuitBreakerOpenError) {
      logger.warn('Primary service unavailable, using cache');
      return getCachedData();
    }
    throw error;
  }
}
```

## Best Practices Summary

1. **Use RetryStrategy** for transient failures
2. **Use CircuitBreaker** for external services
3. **Combine both** via RecoveryHandler for production systems
4. **Always enable jitter** to prevent thundering herd
5. **Configure timeouts** carefully relative to retry delays
6. **Monitor metrics** to tune configuration
7. **Implement custom handlers** for domain-specific recovery
8. **Test failure scenarios** thoroughly
9. **Document recovery behavior** for operations teams
10. **Review and adjust** configuration based on production data

---

**Related Documentation:**
- [Error System Overview](ERROR_SYSTEM_OVERVIEW.md)
- [Error Codes Reference](ERROR_CODES_REFERENCE.md)
- [Best Practices](BEST_PRACTICES.md)
- [Examples](EXAMPLES.md)
- [Troubleshooting](TROUBLESHOOTING.md)
