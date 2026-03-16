# Best Practices for Error Handling

## Overview

This guide provides proven best practices for implementing robust error handling and recovery strategies in production systems. Following these patterns will result in more reliable, maintainable, and observable systems.

## 1. Error Classification and Use Cases

### When to Use Each Recovery Strategy

#### Use RetryStrategy When:

✓ **Transient failures are expected**
- Network timeouts due to latency
- Temporary service unavailability
- Rate limiting (with appropriate backoff)
- Overloaded services (temporary)

```typescript
// Good example: API call with retry
const apiClient = new RetryStrategy({
  maxAttempts: 5,
  initialDelayMs: 100,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  useJitter: true,
});

const data = await apiClient.execute(() => 
  fetch('https://api.example.com/data').then(r => r.json())
);
```

✗ **Don't retry when:**
- Error is permanent (auth failure, validation error)
- Operation is not idempotent (financial transaction)
- Error indicates resource exhaustion
- System is already overloaded

```typescript
// Bad: Retrying auth failure
const token = await retryStrategy.execute(async () => {
  // This will fail with wrong credentials forever
  return authenticate('user', wrongPassword);
});
```

#### Use CircuitBreaker When:

✓ **Protecting against cascading failures**
- Calling external APIs
- Database connections
- Third-party service dependencies
- Fallback to degraded mode available

```typescript
// Good example: External API with circuit breaker
const breaker = new CircuitBreaker({
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 60000,
});

try {
  return await breaker.execute(() => callExternalAPI());
} catch (error) {
  if (error instanceof CircuitBreakerOpenError) {
    return getCachedData(); // Graceful degradation
  }
  throw error;
}
```

✗ **Don't use circuit breaker for:**
- Local operations
- Operations that don't fail externally
- Where failure is normal behavior
- Operations without degradation path

#### Use RecoveryHandler When:

✓ **Building production-grade systems**
- Combining retry + circuit breaker
- Custom recovery actions needed
- Monitoring and metrics collection
- Multi-strategy error handling

```typescript
// Good: Integrated recovery
const handler = new RecoveryHandler({
  enableRetry: true,
  enableCircuitBreaker: true,
  retry: { maxRetries: 5, initialDelayMs: 100, maxDelayMs: 10000 },
  circuitBreaker: { failureThreshold: 5, timeout: 60000 },
  recoveryHandlers: new Map([
    [NetworkErrorCode.CONNECTION_TIMEOUT, logNetworkTimeout],
    [SSHErrorCode.DISCONNECTED, reconnectSSH],
  ]),
});
```

## 2. Configuration Recommendations

### Conservative Configuration (For Critical Services)

```typescript
const criticalServiceConfig = {
  enableRetry: true,
  enableCircuitBreaker: true,
  retry: {
    maxRetries: 3,
    initialDelayMs: 200,
    maxDelayMs: 5000,
    backoffMultiplier: 2,
    useJitter: true,
  },
  circuitBreaker: {
    failureThreshold: 3,      // Fail fast
    successThreshold: 2,
    timeout: 30000,           // Quick recovery check
    windowSize: 30000,
  },
};
// Total backoff: ~7 seconds
// Use for: Payment processing, authentication
```

### Balanced Configuration (For Most Services)

```typescript
const defaultConfig = {
  enableRetry: true,
  enableCircuitBreaker: true,
  retry: {
    maxRetries: 5,
    initialDelayMs: 100,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
    useJitter: true,
  },
  circuitBreaker: {
    failureThreshold: 5,      // Moderate sensitivity
    successThreshold: 2,
    timeout: 60000,           // Standard recovery time
    windowSize: 60000,
  },
};
// Total backoff: ~10 seconds
// Use for: APIs, databases, general services
```

### Aggressive Configuration (For Resilient Services)

```typescript
const aggressiveConfig = {
  enableRetry: true,
  enableCircuitBreaker: true,
  retry: {
    maxRetries: 10,
    initialDelayMs: 50,
    maxDelayMs: 30000,
    backoffMultiplier: 1.5,
    useJitter: true,
  },
  circuitBreaker: {
    failureThreshold: 10,     // Tolerant
    successThreshold: 5,
    timeout: 300000,          // Longer recovery
    windowSize: 120000,
  },
};
// Total backoff: ~60 seconds
// Use for: Batch jobs, long-running operations, unreliable services
```

### Service-Specific Configurations

#### REST API Client
```typescript
{
  retry: {
    maxRetries: 5,
    initialDelayMs: 100,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
  },
  circuitBreaker: {
    failureThreshold: 5,
    timeout: 60000,
  },
}
```

#### Database Connection
```typescript
{
  retry: {
    maxRetries: 3,
    initialDelayMs: 50,
    maxDelayMs: 5000,
    backoffMultiplier: 2,
  },
  circuitBreaker: {
    failureThreshold: 3,
    timeout: 10000,
  },
}
```

#### SSH Operations
```typescript
{
  retry: {
    maxRetries: 3,
    initialDelayMs: 500,
    maxDelayMs: 5000,
    backoffMultiplier: 1.5,
  },
  circuitBreaker: {
    failureThreshold: 3,
    timeout: 30000,
  },
}
```

#### File I/O
```typescript
{
  retry: {
    maxRetries: 2,
    initialDelayMs: 50,
    maxDelayMs: 1000,
    backoffMultiplier: 2,
  },
  circuitBreaker: null,  // Usually disabled for local ops
}
```

## 3. Monitoring and Health Checks

### Collecting Metrics

```typescript
class ErrorMetricsCollector {
  private metrics = {
    totalErrors: 0,
    errorsByCode: new Map<string, number>(),
    errorsByCategory: new Map<string, number>(),
    retriesByCode: new Map<string, number>(),
    circuitBreakerStateChanges: 0,
  };

  recordError(error: BaseError) {
    this.metrics.totalErrors++;
    
    const codeCount = this.metrics.errorsByCode.get(error.code) ?? 0;
    this.metrics.errorsByCode.set(error.code, codeCount + 1);
    
    const catCount = this.metrics.errorsByCategory.get(error.category) ?? 0;
    this.metrics.errorsByCategory.set(error.category, catCount + 1);
  }

  recordRetry(code: string) {
    const count = this.metrics.retriesByCode.get(code) ?? 0;
    this.metrics.retriesByCode.set(code, count + 1);
  }

  getMetrics() {
    return {
      ...this.metrics,
      errorsByCode: Object.fromEntries(this.metrics.errorsByCode),
      errorsByCategory: Object.fromEntries(this.metrics.errorsByCategory),
      retriesByCode: Object.fromEntries(this.metrics.retriesByCode),
    };
  }
}
```

### Health Check Pattern

```typescript
class SystemHealthCheck {
  async checkOverallHealth(): Promise<HealthStatus> {
    const checks = await Promise.all([
      this.checkNetworkHealth(),
      this.checkDatabaseHealth(),
      this.checkExternalServices(),
      this.checkResourceHealth(),
    ]);

    const errors = checks.filter(c => c.status === 'unhealthy');
    
    return {
      status: errors.length === 0 ? 'healthy' : 'unhealthy',
      checks,
      timestamp: new Date(),
    };
  }

  private async checkNetworkHealth(): Promise<HealthCheck> {
    try {
      const start = Date.now();
      await fetch('https://api.example.com/health');
      const latency = Date.now() - start;
      
      return {
        component: 'network',
        status: latency < 5000 ? 'healthy' : 'degraded',
        latency,
      };
    } catch (error) {
      return {
        component: 'network',
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown',
      };
    }
  }

  private async checkDatabaseHealth(): Promise<HealthCheck> {
    try {
      const result = await db.query('SELECT 1');
      return {
        component: 'database',
        status: result ? 'healthy' : 'unhealthy',
      };
    } catch (error) {
      return {
        component: 'database',
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown',
      };
    }
  }

  // ... other checks
}
```

### Monitoring Thresholds

```typescript
// Define when to alert
const ALERT_THRESHOLDS = {
  errorRate: 0.01,           // 1% error rate
  retryRate: 0.05,           // 5% of requests need retry
  circuitBreakerOpen: true,  // Any open circuit
  p99Latency: 5000,          // 5 second latency
  memoryUsage: 0.9,          // 90% memory used
  cpuUsage: 0.9,             // 90% CPU used
  failureCount: 10,          // 10 failures in window
};

// Monitor and alert
setInterval(async () => {
  const metrics = metricsCollector.getMetrics();
  const health = await healthCheck.checkOverallHealth();

  if (metrics.circuitBreakerStateChanges > 5) {
    alerting.warn('High circuit breaker activity');
  }

  if (health.status === 'unhealthy') {
    alerting.critical('System health check failed');
  }
}, 60000);
```

## 4. Error Logging and Debugging

### Structured Logging

```typescript
class ErrorLogger {
  private logger: Logger;

  logError(error: BaseError, context?: Record<string, unknown>) {
    const metadata = error.getMetadata();
    
    this.logger.error('Error occurred', {
      code: metadata.code,
      category: metadata.category,
      severity: metadata.severity,
      message: error.message,
      stack: metadata.stack,
      context: { ...metadata.context, ...context },
      timestamp: metadata.timestamp,
    });
  }

  logRetry(code: string, attempt: number, nextDelay: number) {
    this.logger.warn('Retrying operation', {
      code,
      attempt,
      nextDelayMs: nextDelay,
    });
  }

  logCircuitBreakerStateChange(serviceName: string, oldState: string, newState: string) {
    this.logger.warn('Circuit breaker state change', {
      service: serviceName,
      from: oldState,
      to: newState,
    });
  }
}
```

### Debugging Recovery Behavior

```typescript
// Enable verbose logging for debugging
const debugHandler = new RecoveryHandler(config);

debugHandler.on('retry', (event) => {
  console.log(`[RETRY] Attempt ${event.attempt}, delay: ${event.nextDelayMs}ms`);
});

debugHandler.on('circuitBreakerStateChange', (service, newState) => {
  console.log(`[CIRCUIT] ${service} -> ${newState}`);
});

// Use tags for request tracking
const result = await handler.execute(
  () => operation(),
  {
    tag: 'user-data-fetch',
    metadata: { userId: '123', requestId: 'req-456' },
  }
);
```

## 5. Performance Tuning

### Timeout Alignment

```typescript
// Important: Align timeouts with retry strategy
const strategy = new RetryStrategy({
  maxAttempts: 5,
  initialDelayMs: 100,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
});
// Total backoff: ~31 seconds

// Operation timeout should be longer to account for retries
const operationTimeout = 60000; // 1 minute total

// Individual operation timeout
const singleAttemptTimeout = 10000; // 10 seconds per attempt
```

### Load Distribution

```typescript
// Use jitter to prevent thundering herd
const strategyWithJitter = new RetryStrategy({
  useJitter: true,
  jitterFraction: 0.25,  // ±25% variance
});

// Without jitter, all clients retry simultaneously
const strategyNoJitter = new RetryStrategy({
  useJitter: false,  // BAD: causes thundering herd
});
```

### Connection Pooling

```typescript
// Configure pool size appropriately
class DatabasePool {
  private pool = new Pool({
    max: 20,              // Max connections
    idleTimeoutMillis: 30000,  // Close idle after 30s
    connectionTimeoutMillis: 2000,  // Fail fast if pool exhausted
  });

  async execute<T>(query: string, params?: unknown[]): Promise<T> {
    const start = Date.now();
    try {
      const connection = await this.pool.connect();
      const result = await connection.query(query, params);
      connection.release();
      
      const elapsed = Date.now() - start;
      metrics.recordQueryTime(elapsed);
      
      return result.rows;
    } catch (error) {
      metrics.recordPoolError(error);
      throw error;
    }
  }
}
```

## 6. Security Considerations

### Credential Handling

```typescript
// Bad: Logging credentials
logger.error('Auth failed', {
  username: 'admin',
  password: 'secret123',  // NEVER log passwords!
  error: error.message,
});

// Good: Log safe information only
logger.error('Auth failed', {
  username: 'admin',
  method: 'publicKey',
  error: error.message,
});
```

### Sensitive Data in Errors

```typescript
// Bad: Exposing sensitive data
throw new Error(`API key ${apiKey} is invalid`);

// Good: Masking sensitive data
const maskedKey = `${apiKey.substring(0, 4)}...${apiKey.substring(-4)}`;
throw new SecurityError(`Invalid API key (${maskedKey})`, {
  code: SecurityErrorCode.VALIDATION_FAILED,
  retryable: false,
  context: { apiKeyLength: apiKey.length },  // Safe metadata
});
```

### Error Information Disclosure

```typescript
// Bad: Returning full error to client
app.get('/api/data', async (req, res) => {
  try {
    const data = await fetchData();
    res.json(data);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,  // Reveals internals
    });
  }
});

// Good: Safe error responses
app.get('/api/data', async (req, res) => {
  try {
    const data = await fetchData();
    res.json(data);
  } catch (error) {
    const errorId = uuid();
    logger.error('Request failed', {
      errorId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    
    res.status(500).json({
      error: 'Internal server error',
      errorId,  // Client can report this for support
    });
  }
});
```

## 7. Common Pitfalls and Solutions

### Pitfall 1: Retry Without Idempotency

```typescript
// BAD: Non-idempotent operation retried
async function transferMoney(from: string, to: string, amount: number) {
  return retryStrategy.execute(async () => {
    return await bank.transfer(from, to, amount);
    // If retried, money transferred twice!
  });
}

// GOOD: Idempotent with idempotency key
async function transferMoney(from: string, to: string, amount: number, idempotencyKey: string) {
  return retryStrategy.execute(async () => {
    return await bank.transfer(from, to, amount, idempotencyKey);
    // Safe to retry - idempotency key prevents duplicates
  });
}
```

### Pitfall 2: Unbounded Retry Delay

```typescript
// BAD: Exponential backoff without cap
const badStrategy = new RetryStrategy({
  initialDelayMs: 100,
  backoffMultiplier: 3,
  // No maxDelayMs - delay grows infinitely
});

// GOOD: Capped exponential backoff
const goodStrategy = new RetryStrategy({
  initialDelayMs: 100,
  backoffMultiplier: 2,
  maxDelayMs: 30000,  // Cap at 30 seconds
});
```

### Pitfall 3: No Jitter

```typescript
// BAD: All clients retry simultaneously
const badStrategy = new RetryStrategy({
  useJitter: false,  // Causes thundering herd
});

// GOOD: Jitter prevents synchronization
const goodStrategy = new RetryStrategy({
  useJitter: true,
  jitterFraction: 0.25,
});
```

### Pitfall 4: Catching All Errors

```typescript
// BAD: Catching and hiding errors
async function getData() {
  try {
    return await fetchData();
  } catch (error) {
    console.error('Error:', error);
    return null;  // Silent failure
  }
}

// GOOD: Handle specific errors, propagate others
async function getData() {
  try {
    return await fetchData();
  } catch (error) {
    if (error instanceof NetworkError && error.retryable) {
      return retryStrategy.execute(() => fetchData());
    }
    throw error;  // Propagate unexpected errors
  }
}
```

### Pitfall 5: Ignoring Circuit Breaker Open

```typescript
// BAD: Ignoring circuit breaker status
async function callService() {
  return breaker.execute(() => externalService.call());
  // May throw CircuitBreakerOpenError without fallback
}

// GOOD: Handle circuit breaker with fallback
async function callService() {
  try {
    return await breaker.execute(() => externalService.call());
  } catch (error) {
    if (error instanceof CircuitBreakerOpenError) {
      return getCachedResponse() || getDefaultResponse();
    }
    throw error;
  }
}
```

## 8. Testing Error Scenarios

### Unit Testing Retry Logic

```typescript
describe('RetryStrategy', () => {
  it('should retry on transient failure', async () => {
    const strategy = new RetryStrategy({ maxAttempts: 3 });
    let attempts = 0;

    const result = await strategy.execute(async () => {
      attempts++;
      if (attempts < 3) {
        throw new NetworkError('Temporary failure', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
          retryable: true,
        });
      }
      return 'success';
    });

    expect(attempts).toBe(3);
    expect(result).toBe('success');
  });

  it('should fail on non-retryable error', async () => {
    const strategy = new RetryStrategy({ maxAttempts: 3 });

    await expect(
      strategy.execute(async () => {
        throw new SecurityError('Auth failed', {
          code: SecurityErrorCode.UNAUTHORIZED,
          retryable: false,
        });
      })
    ).rejects.toThrow(SecurityError);
  });
});
```

### Integration Testing with Circuit Breaker

```typescript
describe('CircuitBreaker', () => {
  it('should open circuit on repeated failures', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      timeout: 100,
    });

    // Cause 3 failures
    for (let i = 0; i < 3; i++) {
      await expect(
        breaker.execute(() => Promise.reject(new Error('Failed')))
      ).rejects.toThrow();
    }

    // Circuit should now be OPEN
    expect(breaker.getState()).toBe('OPEN');

    // Request should be rejected
    await expect(
      breaker.execute(() => Promise.resolve('success'))
    ).rejects.toThrow(CircuitBreakerOpenError);
  });

  it('should attempt recovery in HALF_OPEN state', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      timeout: 50,  // Quick recovery test
    });

    // Trigger failure
    await expect(
      breaker.execute(() => Promise.reject(new Error('Failed')))
    ).rejects.toThrow();

    // Wait for HALF_OPEN
    await new Promise(resolve => setTimeout(resolve, 100));

    // Should attempt request
    const result = await breaker.execute(() => Promise.resolve('success'));
    expect(result).toBe('success');
  });
});
```

### Chaos Testing

```typescript
// Simulate failures for resilience testing
class ChaosMonkey {
  inject(operation: () => Promise<unknown>, failureRate: number) {
    return async () => {
      if (Math.random() < failureRate) {
        throw new NetworkError('Chaos monkey injected failure', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
          retryable: true,
        });
      }
      return operation();
    };
  }
}

// Use in testing
const monkey = new ChaosMonkey();
const chaosOperation = monkey.inject(
  () => fetchData(),
  0.1  // 10% failure rate
);

for (let i = 0; i < 100; i++) {
  try {
    await handler.execute(chaosOperation);
  } catch (error) {
    console.error('Failed after retries:', error);
  }
}
```

## 9. Production Checklist

Before deploying error handling:

- [ ] All external service calls use CircuitBreaker
- [ ] All retryable operations use RetryStrategy
- [ ] Timeouts configured and tested
- [ ] Jitter enabled for distributed retries
- [ ] Idempotency ensured for critical operations
- [ ] Logging structured and queryable
- [ ] Metrics collected and monitored
- [ ] Health checks implemented
- [ ] Error response safe (no secrets/stack)
- [ ] Fallback strategies implemented
- [ ] Chaos testing passed
- [ ] Documentation updated
- [ ] Team trained on patterns
- [ ] Alerting configured
- [ ] Dashboard created for monitoring

## Summary

Key principles:
1. **Choose the right strategy** for the scenario
2. **Configure appropriately** for your system
3. **Monitor continuously** with metrics
4. **Log structured data** for debugging
5. **Test thoroughly** including failures
6. **Document decisions** for team
7. **Review and adjust** based on production data

---

**Related Documentation:**
- [Error System Overview](ERROR_SYSTEM_OVERVIEW.md)
- [Recovery Strategies Guide](RECOVERY_STRATEGIES_GUIDE.md)
- [Error Codes Reference](ERROR_CODES_REFERENCE.md)
- [Examples](EXAMPLES.md)
- [Troubleshooting](TROUBLESHOOTING.md)
