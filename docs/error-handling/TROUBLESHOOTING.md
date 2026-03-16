# Troubleshooting Error Handling & Recovery

Common issues encountered when using error handling and recovery strategies, with solutions and debugging techniques.

## Common Issues and Solutions

### Issue 1: Operations Keep Retrying Forever

**Symptoms:**
- Operation never completes
- Retries continue indefinitely
- High CPU/memory usage from retries

**Root Causes:**

1. **Non-retryable error marked as retryable**
   ```typescript
   // BAD: Auth errors shouldn't be retried
   throw new SecurityError('Invalid API key', {
     code: SecurityErrorCode.UNAUTHORIZED,
     retryable: true,  // ❌ WRONG
   });
   ```

2. **Function throws error on every attempt**
   ```typescript
   // BAD: Function throws every time
   await retry.execute(() => {
     // This will fail the same way every time
     return someOperation();
   });
   ```

3. **Wrong error type for operation**

**Solutions:**

```typescript
// 1. Verify error retryability
const error = new SecurityError('Invalid API key', {
  code: SecurityErrorCode.UNAUTHORIZED,
  retryable: false,  // ✓ Correct for auth
});

if (!error.retryable) {
  console.log('Non-retryable error, failing fast');
  throw error;
}

// 2. Add safeguards
const strategy = new RetryStrategy({
  maxAttempts: 3,
  // ... config
});

let errorCount = 0;
try {
  const result = await strategy.execute(async () => {
    errorCount++;
    if (errorCount > 10) {
      throw new Error('Safety check: too many errors');
    }
    return operation();
  });
} catch (error) {
  console.error('Operation failed after retries');
}

// 3. Monitor and log retries
strategy.on('retry', (event) => {
  logger.warn(`Retry attempt ${event.attempt}`, {
    code: event.error.code,
    nextDelay: event.nextDelayMs,
  });
  
  // Stop if we've retried too much
  if (event.attempt > 5) {
    throw new Error('Max retries exceeded');
  }
});
```

**Prevention:**
- Always mark permanent errors (`UNAUTHORIZED`, `VALIDATION_FAILED`, etc.) as `retryable: false`
- Test retry scenarios: ensure operations eventually succeed or fail cleanly
- Set reasonable `maxAttempts` (typically 3-5)
- Add timeout around entire retry operation

---

### Issue 2: Circuit Breaker Never Opens

**Symptoms:**
- Circuit remains in CLOSED state despite failures
- Service continues getting hammered
- No protection against cascading failures

**Root Causes:**

1. **Failure threshold too high**
   ```typescript
   const breaker = new CircuitBreaker({
     failureThreshold: 100,  // Too high
   });
   ```

2. **Window size misaligned**
   ```typescript
   const breaker = new CircuitBreaker({
     windowSize: 60000,      // 1 minute
     failureThreshold: 5,
     // If failures are spread over time, threshold might not be hit
   });
   ```

3. **Error not reaching circuit breaker**
   ```typescript
   // Error caught before reaching breaker
   try {
     await breaker.execute(() => operation());
   } catch (error) {
     // Error swallowed here, breaker doesn't know about it
     console.error(error);
   }
   ```

**Solutions:**

```typescript
// 1. Lower threshold for sensitive services
const breaker = new CircuitBreaker({
  failureThreshold: 3,        // More sensitive
  successThreshold: 2,
  timeout: 30000,
  windowSize: 60000,
});

// 2. Monitor state changes
breaker.on(CircuitBreakerEventType.STATE_CHANGE, (type, state, details) => {
  logger.warn(`Circuit breaker: ${state}`, details);
  
  if (state === CircuitState.OPEN) {
    alerting.notify('Circuit breaker opened', {
      service: 'external-api',
      lastError: details?.lastError,
    });
  }
});

// 3. Ensure all errors reach breaker
try {
  return await breaker.execute(async () => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new NetworkError(`HTTP ${response.status}`, {
        code: NetworkErrorCode.CONNECTION_REFUSED,
        retryable: response.status >= 500,
        context: { status: response.status },
      });
    }
    return response.json();
  });
} catch (error) {
  if (error instanceof CircuitBreakerOpenError) {
    // Handle open circuit
    return getCachedData();
  }
  throw error;  // Propagate other errors
}

// 4. Check metrics
const metrics = breaker.getMetrics();
if (metrics.failedRequests > 0) {
  console.log('Failures detected:', {
    failed: metrics.failedRequests,
    total: metrics.totalRequests,
    rate: (metrics.failedRequests / metrics.totalRequests).toFixed(2),
  });
}
```

**Debugging:**
```typescript
// Log every request/failure
breaker.on(CircuitBreakerEventType.EXECUTION_FAILURE, (type, state, details) => {
  logger.debug('Request failed', {
    state,
    error: details?.error,
    failureCount: details?.failureCount,
  });
});

// Verify threshold is being reached
if (breaker.getMetrics().currentFailureCount >= breaker.config.failureThreshold) {
  logger.error('Circuit should be OPEN but is:', breaker.getState());
}
```

---

### Issue 3: Excessive Retries Causing Cascading Failures

**Symptoms:**
- Downstream service gets overwhelmed by retries
- "Thundering herd" behavior when service recovers
- CPU/memory spikes from retry storms

**Root Causes:**

1. **No jitter in retry delays**
   ```typescript
   // BAD: All clients retry at same time
   const strategy = new RetryStrategy({
     useJitter: false,  // ❌ No jitter
   });
   ```

2. **Exponential backoff too aggressive**
   ```typescript
   const strategy = new RetryStrategy({
     initialDelayMs: 100,
     backoffMultiplier: 3,    // Too aggressive
     maxDelayMs: 300000,      // Too high
   });
   ```

3. **No circuit breaker to stop retries**
   ```typescript
   // BAD: Retrying to already-failing service
   const strategy = new RetryStrategy({ maxAttempts: 10 });
   
   // No circuit breaker to detect service is down
   ```

**Solutions:**

```typescript
// 1. Enable jitter
const strategy = new RetryStrategy({
  useJitter: true,           // ✓ Enable jitter
  jitterFraction: 0.25,      // ±25% variance
  initialDelayMs: 100,
  backoffMultiplier: 2,      // Moderate
  maxDelayMs: 10000,         // Reasonable cap
});

// 2. Combine with circuit breaker
const breaker = new CircuitBreaker({
  failureThreshold: 5,
  timeout: 60000,
});

const handler = new RecoveryHandler({
  enableRetry: true,
  enableCircuitBreaker: true,
  retry: { maxAttempts: 5, initialDelayMs: 100 },
  circuitBreaker: { failureThreshold: 5, timeout: 60000 },
});

// 3. Limit concurrent retries
class BoundedRetryStrategy {
  private activeRetries = 0;
  private readonly maxConcurrent = 10;

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.activeRetries >= this.maxConcurrent) {
      throw new Error('Too many concurrent retries');
    }

    this.activeRetries++;
    try {
      return await this.strategy.execute(fn);
    } finally {
      this.activeRetries--;
    }
  }
}

// 4. Monitor retry patterns
const retryMetrics = {
  totalRetries: 0,
  retriesByError: new Map<string, number>(),
};

strategy.on('retry', (event) => {
  retryMetrics.totalRetries++;
  const count = retryMetrics.retriesByError.get(event.error.code) ?? 0;
  retryMetrics.retriesByError.set(event.error.code, count + 1);

  // Alert if too many retries of same error
  if (count > 100) {
    alerting.warn(`High retry rate for ${event.error.code}`);
  }
});
```

**Prevention:**
- Always enable jitter
- Use moderate backoff multiplier (2-1.5)
- Cap max delay reasonably (10-30 seconds)
- Combine retry with circuit breaker
- Monitor retry metrics continuously

---

### Issue 4: Memory Leaks from Retry/Circuit Breaker

**Symptoms:**
- Memory usage grows over time
- Heap usage increases steadily
- Out of memory after extended operation

**Root Causes:**

1. **Event listeners not cleaned up**
   ```typescript
   // BAD: Listener never removed
   strategy.on('retry', handler);
   // If strategy instance is recreated, listener leaks
   ```

2. **Metrics not cleared**
   ```typescript
   // BAD: Map grows unbounded
   private metrics = new Map();
   
   recordError(error: BaseError) {
     const count = this.metrics.get(error.code) ?? 0;
     this.metrics.set(error.code, count + 1);
     // Never cleared, keeps growing
   }
   ```

3. **Context stored in errors**
   ```typescript
   // BAD: Large context kept in error
   throw new Error('Operation failed', {
     context: {
       largeData: Buffer.alloc(1024 * 1024),  // 1MB per error
       fullRequest: entireHTTPRequest,
       largeResponse: entireHTTPResponse,
     },
   });
   ```

**Solutions:**

```typescript
// 1. Clean up listeners
const handler = (event: any) => {
  // Handle retry
};

strategy.on('retry', handler);

// Clean up when done
strategy.off('retry', handler);

// Or use named handlers that can be removed
class ManagedRetryStrategy {
  private handlers = new Map<string, Function>();

  on(event: string, name: string, handler: Function) {
    this.handlers.set(`${event}:${name}`, handler);
    // Register with strategy
  }

  cleanup() {
    // Remove all handlers
    this.handlers.clear();
  }
}

// 2. Clear metrics periodically
class BoundedMetrics {
  private readonly MAX_ENTRIES = 1000;
  private metrics = new Map<string, number>();

  recordError(code: string) {
    const count = this.metrics.get(code) ?? 0;
    this.metrics.set(code, count + 1);

    // Clear oldest entries if too many
    if (this.metrics.size > this.MAX_ENTRIES) {
      const oldest = Array.from(this.metrics.entries())
        .sort((a, b) => a[1] - b[1])
        .slice(0, 100);

      oldest.forEach(([key]) => this.metrics.delete(key));
    }
  }
}

// 3. Minimize context in errors
// BAD
throw new Error('Request failed', {
  context: {
    fullRequest: request,        // Large
    fullResponse: response,      // Large
    allHeaders: headers,         // Potentially large
  },
});

// GOOD
throw new NetworkError('Request failed', {
  code: NetworkErrorCode.CONNECTION_TIMEOUT,
  context: {
    statusCode: response.status,           // Small
    url: request.url,                      // String
    responseTime: Date.now() - startTime,  // Number
  },
  originalError: originalError,
});

// 4. Monitor memory usage
function monitorMemory(strategy: RetryStrategy) {
  if (global.gc) {
    setInterval(() => {
      global.gc();
      const usage = process.memoryUsage();
      
      if (usage.heapUsed / usage.heapTotal > 0.9) {
        logger.error('High memory usage', {
          heapUsedMB: Math.round(usage.heapUsed / 1024 / 1024),
          heapTotalMB: Math.round(usage.heapTotal / 1024 / 1024),
        });
      }
    }, 60000);
  }
}
```

---

### Issue 5: Circuit Breaker Stuck in OPEN

**Symptoms:**
- Circuit breaker opened and never recovers
- Service never re-enters CLOSED state
- Traffic never returns to service

**Root Causes:**

1. **Timeout never expires**
   ```typescript
   // BAD: Timeout too long
   const breaker = new CircuitBreaker({
     timeout: 86400000,  // 24 hours!
   });
   ```

2. **Service still failing during HALF_OPEN**
   ```typescript
   // Circuit opens
   // After timeout, goes to HALF_OPEN
   // But service still returning errors
   // So it opens again
   // Loop continues
   ```

3. **Manual reset not called**

**Solutions:**

```typescript
// 1. Use reasonable timeout
const breaker = new CircuitBreaker({
  timeout: 60000,           // 1 minute for testing
  successThreshold: 2,      // Need 2 successes to close
});

// 2. Monitor HALF_OPEN state
let halfOpenAttempts = 0;

breaker.on(CircuitBreakerEventType.STATE_CHANGE, (type, state) => {
  if (state === CircuitState.HALF_OPEN) {
    halfOpenAttempts = 0;
    logger.info('Circuit breaker testing recovery');
  } else if (state === CircuitState.OPEN) {
    logger.warn('Circuit breaker reopened');
  } else if (state === CircuitState.CLOSED) {
    logger.info('Circuit breaker closed, service recovered');
  }
});

// 3. Manual recovery check
async function checkServiceRecovery(breaker: CircuitBreaker) {
  const state = breaker.getState();
  
  if (state === CircuitState.OPEN) {
    logger.info('Checking if service recovered...');
    
    try {
      const result = await breaker.execute(() => healthCheck());
      logger.info('Service recovered, circuit should close');
    } catch (error) {
      logger.warn('Service still failing');
      // Circuit will try again after timeout
    }
  }
}

// 4. Force reset if needed
async function forceReset(breaker: CircuitBreaker) {
  logger.warn('Force resetting circuit breaker');
  
  // Check if service is actually healthy
  try {
    await healthCheck();
    // If healthy, create new breaker
    breaker = new CircuitBreaker(breaker.config);
    logger.info('Circuit breaker reset');
  } catch (error) {
    logger.error('Service not healthy, cannot reset');
  }
}

// 5. Alert on stuck open
setInterval(() => {
  const state = breaker.getState();
  const metrics = breaker.getMetrics();

  if (state === CircuitState.OPEN) {
    const timeSinceLastFailure = Date.now() - metrics.lastFailureTime;
    const timeout = breaker.config.timeout;

    if (timeSinceLastFailure > timeout) {
      logger.warn('Circuit stuck OPEN after timeout', {
        timeSinceOpen: timeSinceLastFailure,
        expectedTimeout: timeout,
      });
    }
  }
}, 30000);
```

**Prevention:**
- Use reasonable timeout values (30-120 seconds)
- Test HALF_OPEN behavior
- Monitor circuit state transitions
- Have health check that works when service recovers
- Implement manual recovery procedures

---

## Performance Issues

### Issue: Slow Retry Delays

**Problem:** Operations taking too long to complete due to long delays

**Solutions:**
```typescript
// 1. Reduce initial delay
const strategy = new RetryStrategy({
  initialDelayMs: 50,    // Shorter initial delay
  maxDelayMs: 5000,
  backoffMultiplier: 2,
});

// 2. Use shorter max delay for quick operations
const strategy = new RetryStrategy({
  maxDelayMs: 1000,      // 1 second max
});

// 3. Lower multiplier for less aggressive backoff
const strategy = new RetryStrategy({
  backoffMultiplier: 1.5,  // Less aggressive than 2
});
```

---

### Issue: High Latency Variation

**Problem:** Some requests fast, others slow due to retries

**Solution:**
```typescript
// Implement timeout for entire operation
const totalTimeout = 30000;  // 30 seconds max
const controller = new AbortController();

const timeoutHandle = setTimeout(() => {
  controller.abort();
}, totalTimeout);

try {
  const result = await handler.execute(
    () => operation({ signal: controller.signal }),
    { timeout: totalTimeout }
  );
} finally {
  clearTimeout(timeoutHandle);
}
```

---

## Debugging Recovery Behavior

### Enable Verbose Logging

```typescript
class VerboseRecoveryHandler extends RecoveryHandler {
  executeWithLogging<T>(
    fn: () => Promise<T>,
    tag?: string
  ): Promise<T> {
    console.log(`[${tag}] Starting execution`);

    return this.execute(fn, { tag }).then(
      (result) => {
        console.log(`[${tag}] Success`);
        return result;
      },
      (error) => {
        console.log(`[${tag}] Failed:`, error.message);
        throw error;
      }
    );
  }
}
```

### Trace Execution Path

```typescript
function traceOperation(operation: () => Promise<any>, name: string) {
  console.time(name);
  console.log(`→ ${name} starting`);

  return operation().then(
    (result) => {
      console.log(`✓ ${name} succeeded`);
      console.timeEnd(name);
      return result;
    },
    (error) => {
      console.log(`✗ ${name} failed:`, error.message);
      console.timeEnd(name);
      throw error;
    }
  );
}

// Usage
await traceOperation(
  () => handler.execute(() => fetchData()),
  'fetch-user-data'
);
```

---

## Metrics Interpretation

### High Error Rates

```
Error Rate = Failed Operations / Total Operations
- < 0.1% (0.001): Normal
- 0.1% - 1% (0.01): Monitor
- 1% - 5% (0.05): Investigate
- > 5%: Alert
```

### Circuit Breaker Metrics

```
Rejected Requests = Requests rejected while OPEN
High value indicates:
- Service having extended outage
- Threshold too low (opening too easily)
- Service not recovering

State Changes = Transitions between states
High value indicates:
- Service flapping (oscillating OPEN/CLOSED)
- Threshold too close to failure rate
```

---

## Testing and Validation

### Verify Retry Works

```typescript
it('should retry failed operations', async () => {
  let attempts = 0;

  const result = await strategy.execute(async () => {
    attempts++;
    if (attempts < 2) {
      throw new NetworkError('Temp failure', {
        code: NetworkErrorCode.CONNECTION_TIMEOUT,
        retryable: true,
      });
    }
    return 'success';
  });

  expect(result).to.equal('success');
  expect(attempts).to.equal(2);
});
```

### Verify Circuit Breaker Protection

```typescript
it('should reject requests when circuit open', async () => {
  const breaker = new CircuitBreaker({ failureThreshold: 1 });

  // Trigger failure
  await expect(
    breaker.execute(() => Promise.reject(new Error('Failed')))
  ).rejects.toThrow();

  // Circuit should now be OPEN
  expect(breaker.getState()).to.equal('OPEN');

  // Next request should be rejected
  await expect(
    breaker.execute(() => Promise.resolve('success'))
  ).rejects.toThrow(CircuitBreakerOpenError);
});
```

---

**Related Documentation:**
- [Error System Overview](ERROR_SYSTEM_OVERVIEW.md)
- [Recovery Strategies Guide](RECOVERY_STRATEGIES_GUIDE.md)
- [Error Codes Reference](ERROR_CODES_REFERENCE.md)
- [Best Practices](BEST_PRACTICES.md)
- [Examples](EXAMPLES.md)
