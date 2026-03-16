# Error Handling & Recovery Examples

Practical, copy-paste ready code examples demonstrating error handling and recovery strategies in real-world scenarios.

## 1. Basic Retry for File Operations

```typescript
import { RetryStrategy } from '@core/recovery/retry-strategy';
import { FilesystemError, FilesystemErrorCode, ErrorSeverity } from '@core/error-system';
import { promises as fs } from 'fs';

// Configure retry strategy
const fileRetry = new RetryStrategy({
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
  useJitter: true,
});

// Monitor retries
fileRetry.on('retry', (event) => {
  console.log(`Retry attempt ${event.attempt}, waiting ${event.nextDelayMs}ms`);
});

// Read file with retry
async function readFileWithRetry(filePath: string): Promise<string> {
  try {
    return await fileRetry.execute(async () => {
      try {
        return await fs.readFile(filePath, 'utf-8');
      } catch (error: any) {
        // Convert Node.js error to typed error
        if (error.code === 'ENOENT') {
          throw new FilesystemError('File not found', {
            code: FilesystemErrorCode.NOT_FOUND,
            severity: ErrorSeverity.MEDIUM,
            retryable: false,
            context: { path: filePath },
          });
        }
        if (error.code === 'EACCES') {
          throw new FilesystemError('Permission denied', {
            code: FilesystemErrorCode.PERMISSION_DENIED,
            severity: ErrorSeverity.MEDIUM,
            retryable: false,
            context: { path: filePath },
          });
        }
        // I/O errors can be retried
        throw new FilesystemError('Read failed', {
          code: FilesystemErrorCode.READ_FAILED,
          severity: ErrorSeverity.MEDIUM,
          retryable: true,
          context: { path: filePath },
          originalError: error,
        });
      }
    });
  } catch (error) {
    console.error(`Failed to read file after retries: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw error;
  }
}

// Usage
const content = await readFileWithRetry('/data/config.json');
console.log('File content:', content);
```

## 2. Using Circuit Breaker for API Calls

```typescript
import { CircuitBreaker, CircuitState, CircuitBreakerEventType } from '@core/recovery/circuit-breaker';
import { NetworkError, NetworkErrorCode, ErrorSeverity } from '@core/error-system';

// Configure circuit breaker for external API
const apiBreaker = new CircuitBreaker({
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 60000,
  windowSize: 60000,
});

// Monitor state changes
apiBreaker.on(CircuitBreakerEventType.STATE_CHANGE, (type, state, details) => {
  console.log(`API circuit breaker: ${state}`);
  if (state === CircuitState.OPEN) {
    alerting.notify(`External API unavailable`, {
      service: 'payment-service',
      lastError: details?.lastError,
    });
  }
});

// API client with circuit breaker
async function getPaymentStatus(orderId: string): Promise<any> {
  try {
    return await apiBreaker.execute(async () => {
      const response = await fetch(`https://api.payment.com/status/${orderId}`);
      
      if (!response.ok) {
        throw new NetworkError(`Payment API error: ${response.status}`, {
          code: NetworkErrorCode.CONNECTION_REFUSED,
          severity: ErrorSeverity.HIGH,
          retryable: response.status >= 500,
          context: { orderId, status: response.status },
        });
      }
      
      return response.json();
    });
  } catch (error) {
    if (error instanceof CircuitBreakerOpenError) {
      // Fallback to cached data
      console.log('Circuit open, using cached payment status');
      return getCachedPaymentStatus(orderId) || {
        status: 'unknown',
        cached: true,
      };
    }
    throw error;
  }
}

// Usage
const status = await getPaymentStatus('order-123');
console.log('Payment status:', status);
```

## 3. Custom Recovery Handlers for SSH Operations

```typescript
import { RecoveryHandler } from '@core/recovery/recovery-handler';
import { SSHError, SSHErrorCode, ErrorSeverity } from '@core/error-system';
import { NodeSSH } from 'node-ssh';

class SSHConnectionManager {
  private ssh: NodeSSH;
  private handler: RecoveryHandler;
  private reconnectAttempts = 0;

  constructor() {
    this.ssh = new NodeSSH();
    
    this.handler = new RecoveryHandler({
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
        [SSHErrorCode.DISCONNECTED, this.handleDisconnect.bind(this)],
        [SSHErrorCode.AUTH_FAILED, this.handleAuthFailure.bind(this)],
        [SSHErrorCode.TIMEOUT, this.handleTimeout.bind(this)],
      ]),
    });
  }

  async executeCommand(
    host: string,
    command: string,
    credentials: { user: string; privateKey: string }
  ): Promise<string> {
    return this.handler.execute(
      async () => {
        // Ensure connection
        if (!this.ssh.isConnected()) {
          await this.connect(host, credentials);
        }

        // Execute command
        const result = await this.ssh.execCommand(command, {
          onChannel: (channel) => {
            channel.on('close', () => {
              this.reconnectAttempts = 0;
            });
          },
        });

        if (result.code !== 0) {
          throw new SSHError(`Command failed: ${result.stderr}`, {
            code: SSHErrorCode.COMMAND_FAILED,
            severity: ErrorSeverity.HIGH,
            retryable: false,
            context: {
              command,
              exitCode: result.code,
              stderr: result.stderr,
            },
          });
        }

        return result.stdout;
      },
      {
        circuitBreakerName: `ssh-${host}`,
        timeout: 30000,
        tag: `ssh-exec-${command}`,
      }
    );
  }

  private async connect(
    host: string,
    credentials: { user: string; privateKey: string }
  ): Promise<void> {
    try {
      await this.ssh.connect({
        host,
        username: credentials.user,
        privateKey: credentials.privateKey,
        readyTimeout: 10000,
      });
    } catch (error: any) {
      if (error.code === 'EAUTH') {
        throw new SSHError('SSH authentication failed', {
          code: SSHErrorCode.AUTH_FAILED,
          severity: ErrorSeverity.HIGH,
          retryable: false,
          context: { host },
          originalError: error,
        });
      }
      throw new SSHError('SSH connection failed', {
        code: SSHErrorCode.CONNECTION_FAILED,
        severity: ErrorSeverity.HIGH,
        retryable: true,
        context: { host },
        originalError: error,
      });
    }
  }

  private async handleDisconnect(error: BaseError, context: RecoveryContext): Promise<void> {
    console.log(`SSH disconnected, attempt ${context.attempt}`);
    this.reconnectAttempts++;

    if (this.reconnectAttempts > 3) {
      logger.error('SSH reconnection failed after 3 attempts');
      return;
    }

    this.ssh.dispose();
  }

  private async handleAuthFailure(error: BaseError, context: RecoveryContext): Promise<void> {
    logger.error('SSH authentication failed', {
      error: error.getMetadata(),
      attempt: context.attempt,
    });
    
    alerting.notify('SSH authentication failure', {
      severity: 'high',
      error: error.message,
    });
  }

  private async handleTimeout(error: BaseError, context: RecoveryContext): Promise<void> {
    logger.warn('SSH operation timeout', {
      attempt: context.attempt,
      willRetry: context.willRetry,
    });
  }
}

// Usage
const sshManager = new SSHConnectionManager();
const output = await sshManager.executeCommand(
  'server.example.com',
  'ls -la /data',
  {
    user: 'deploy',
    privateKey: fs.readFileSync('/home/user/.ssh/id_rsa', 'utf-8'),
  }
);
console.log('Remote output:', output);
```

## 4. Database Connection with Retry and Circuit Breaker

```typescript
import { RecoveryHandler } from '@core/recovery/recovery-handler';
import { NetworkError, NetworkErrorCode, TimeoutErrorCode, TimeoutError } from '@core/error-system';
import { Pool } from 'pg';

class ResilientDatabasePool {
  private pool: Pool;
  private handler: RecoveryHandler;

  constructor(poolConfig: any) {
    this.pool = new Pool(poolConfig);

    this.handler = new RecoveryHandler({
      enableRetry: true,
      enableCircuitBreaker: true,
      retry: {
        maxRetries: 3,
        initialDelayMs: 50,
        maxDelayMs: 5000,
        backoffMultiplier: 2,
        jitterFactor: 0.1,
      },
      circuitBreaker: {
        failureThreshold: 3,
        successThreshold: 2,
        timeoutMs: 10000,
        halfOpenMaxAttempts: 2,
      },
      recoveryHandlers: new Map([
        [NetworkErrorCode.CONNECTION_TIMEOUT, async (error, ctx) => {
          logger.warn(`DB timeout attempt ${ctx.attempt}`);
          if (ctx.attempt === 1) {
            // On first timeout, drain and recreate connections
            await this.resetConnectionPool();
          }
        }],
        [NetworkErrorCode.CONNECTION_REFUSED, async (error, ctx) => {
          logger.error('Database refused connection', {
            error: error.getMetadata(),
          });
          // Check if database is running
          await this.checkDatabaseHealth();
        }],
      ]),
    });
  }

  async query<T>(
    sql: string,
    params?: unknown[],
    options?: { timeout?: number; tag?: string }
  ): Promise<T[]> {
    return this.handler.execute(
      async () => {
        const client = await this.pool.connect();
        try {
          const query = new Promise<T[]>((resolve, reject) => {
            const timeoutHandle = setTimeout(() => {
              reject(new TimeoutError('Query timeout', {
                code: TimeoutErrorCode.OPERATION_TIMEOUT,
                retryable: true,
                context: { sql, timeout: options?.timeout },
              }));
            }, options?.timeout ?? 10000);

            client
              .query(sql, params)
              .then((result) => {
                clearTimeout(timeoutHandle);
                resolve(result.rows as T[]);
              })
              .catch((error: any) => {
                clearTimeout(timeoutHandle);
                
                if (error.code === 'ECONNREFUSED') {
                  reject(new NetworkError('Database connection refused', {
                    code: NetworkErrorCode.CONNECTION_REFUSED,
                    retryable: true,
                    context: { sql },
                    originalError: error,
                  }));
                } else if (error.code === 'ETIMEDOUT') {
                  reject(new NetworkError('Database connection timeout', {
                    code: NetworkErrorCode.CONNECTION_TIMEOUT,
                    retryable: true,
                    context: { sql },
                    originalError: error,
                  }));
                } else {
                  reject(error);
                }
              });
          });

          return await query;
        } finally {
          client.release();
        }
      },
      {
        circuitBreakerName: 'database',
        timeout: (options?.timeout ?? 10000) + 5000,
        tag: options?.tag,
      }
    );
  }

  private async resetConnectionPool(): Promise<void> {
    logger.info('Resetting database connection pool');
    await this.pool.drain();
    this.pool = new Pool(this.pool.options);
  }

  private async checkDatabaseHealth(): Promise<void> {
    try {
      await this.query('SELECT 1', []);
      logger.info('Database health check passed');
    } catch (error) {
      logger.error('Database health check failed', { error });
    }
  }
}

// Usage
const db = new ResilientDatabasePool({
  user: 'app',
  password: 'secret',
  host: 'localhost',
  port: 5432,
  database: 'myapp',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Query with automatic recovery
const users = await db.query<{ id: string; name: string }>(
  'SELECT id, name FROM users WHERE active = $1',
  [true],
  { timeout: 10000, tag: 'fetch-active-users' }
);
console.log('Found users:', users);
```

## 5. REST API Client with Full Recovery

```typescript
import { RecoveryHandler } from '@core/recovery/recovery-handler';
import { NetworkError, NetworkErrorCode, TimeoutErrorCode, TimeoutError } from '@core/error-system';

class ResilientAPIClient {
  private handler: RecoveryHandler;
  private requestMetrics: Map<string, { count: number; errors: number }> = new Map();

  constructor(baseURL: string, options?: any) {
    this.handler = new RecoveryHandler({
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
        [NetworkErrorCode.CONNECTION_TIMEOUT, this.handleConnectionTimeout.bind(this)],
        [NetworkErrorCode.CONNECTION_REFUSED, this.handleConnectionRefused.bind(this)],
        [TimeoutErrorCode.OPERATION_TIMEOUT, this.handleOperationTimeout.bind(this)],
      ]),
    });
  }

  async get<T>(path: string, options?: any): Promise<T> {
    return this.request<T>('GET', path, undefined, options);
  }

  async post<T>(path: string, body: unknown, options?: any): Promise<T> {
    return this.request<T>('POST', path, body, options);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: any
  ): Promise<T> {
    const endpoint = `${method} ${path}`;
    this.recordMetric(endpoint);

    return this.handler.execute(
      async () => {
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          options?.timeout ?? 30000
        );

        try {
          const response = await fetch(path, {
            method,
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/json',
              ...options?.headers,
            },
          });

          if (!response.ok) {
            const error = new NetworkError(`API error: ${response.status}`, {
              code: response.status >= 500
                ? NetworkErrorCode.CONNECTION_REFUSED
                : NetworkErrorCode.PROTOCOL_ERROR,
              severity: response.status >= 500 ? 'HIGH' : 'MEDIUM',
              retryable: response.status >= 500,
              context: {
                path,
                status: response.status,
                statusText: response.statusText,
              },
            });

            this.recordError(endpoint);
            throw error;
          }

          return (await response.json()) as T;
        } catch (error: any) {
          if (error.name === 'AbortError') {
            throw new TimeoutError('API request timeout', {
              code: TimeoutErrorCode.OPERATION_TIMEOUT,
              retryable: true,
              context: { path, timeout: options?.timeout ?? 30000 },
            });
          }

          if (error instanceof NetworkError) {
            throw error;
          }

          throw new NetworkError(`API request failed: ${error.message}`, {
            code: NetworkErrorCode.PROTOCOL_ERROR,
            retryable: false,
            originalError: error,
            context: { path },
          });
        } finally {
          clearTimeout(timeout);
        }
      },
      {
        circuitBreakerName: 'api-client',
        timeout: (options?.timeout ?? 30000) + 5000,
        tag: endpoint,
      }
    );
  }

  private async handleConnectionTimeout(error: BaseError, context: RecoveryContext): Promise<void> {
    logger.warn('API connection timeout', {
      attempt: context.attempt,
      willRetry: context.willRetry,
    });
  }

  private async handleConnectionRefused(error: BaseError, context: RecoveryContext): Promise<void> {
    logger.error('API connection refused', {
      error: error.getMetadata(),
      attempt: context.attempt,
    });

    if (context.attempt === 1) {
      // Check service health
      await this.checkServiceHealth();
    }
  }

  private async handleOperationTimeout(error: BaseError, context: RecoveryContext): Promise<void> {
    logger.warn('API operation timeout', {
      attempt: context.attempt,
      willRetry: context.willRetry,
    });
  }

  private async checkServiceHealth(): Promise<void> {
    // Implementation to check if service is healthy
  }

  private recordMetric(endpoint: string): void {
    const current = this.requestMetrics.get(endpoint) ?? { count: 0, errors: 0 };
    current.count++;
    this.requestMetrics.set(endpoint, current);
  }

  private recordError(endpoint: string): void {
    const current = this.requestMetrics.get(endpoint) ?? { count: 0, errors: 0 };
    current.errors++;
    this.requestMetrics.set(endpoint, current);
  }

  getMetrics() {
    return Object.fromEntries(this.requestMetrics);
  }
}

// Usage
const api = new ResilientAPIClient('https://api.example.com');

const user = await api.get<{ id: string; name: string }>('/api/users/123');
console.log('User:', user);

const created = await api.post<{ id: string }>(
  '/api/users',
  { name: 'John Doe', email: 'john@example.com' },
  { timeout: 15000 }
);
console.log('Created user:', created);

// Monitor metrics
setInterval(() => {
  const metrics = api.getMetrics();
  console.log('API Metrics:', metrics);
}, 60000);
```

## 6. Monitoring Error Health

```typescript
import { BaseError, ErrorCategory, ErrorSeverity } from '@core/error-system';

class ErrorHealthMonitor {
  private window: {
    timestamp: number;
    category: ErrorCategory;
    severity: ErrorSeverity;
    code: string;
  }[] = [];

  private readonly WINDOW_SIZE = 60000; // 1 minute
  private readonly ALERT_THRESHOLDS = {
    criticalErrors: 1,      // Alert if any critical error
    errorRate: 0.05,        // Alert if 5% of operations fail
    categoryThreshold: 10,  // Alert if 10 errors of same category
  };

  recordError(error: BaseError): void {
    const now = Date.now();

    // Add to window
    this.window.push({
      timestamp: now,
      category: error.category,
      severity: error.severity,
      code: error.code,
    });

    // Clean old entries
    this.window = this.window.filter(
      (entry) => now - entry.timestamp < this.WINDOW_SIZE
    );

    // Check thresholds
    this.checkThresholds(error);
  }

  private checkThresholds(error: BaseError): void {
    // Check for critical errors
    if (error.severity === ErrorSeverity.CRITICAL) {
      alerting.critical(`Critical error: ${error.code}`, {
        error: error.getMetadata(),
      });
      return;
    }

    // Check error rate
    const errorRate = this.getErrorRate();
    if (errorRate > this.ALERT_THRESHOLDS.errorRate) {
      alerting.warn(`High error rate: ${(errorRate * 100).toFixed(1)}%`, {
        threshold: `${(this.ALERT_THRESHOLDS.errorRate * 100).toFixed(1)}%`,
      });
    }

    // Check category distribution
    const categoryCount = this.getCategoryCount(error.category);
    if (categoryCount > this.ALERT_THRESHOLDS.categoryThreshold) {
      alerting.warn(
        `High error rate for ${error.category}: ${categoryCount} errors`,
        { threshold: this.ALERT_THRESHOLDS.categoryThreshold }
      );
    }
  }

  private getErrorRate(): number {
    if (this.window.length === 0) return 0;
    // This would integrate with request count metric
    return this.window.length / 100; // Placeholder
  }

  private getCategoryCount(category: ErrorCategory): number {
    return this.window.filter((e) => e.category === category).length;
  }

  getHealthStatus(): {
    status: 'healthy' | 'degraded' | 'unhealthy';
    criticalErrors: number;
    errorRate: number;
    errorsByCategory: Record<string, number>;
  } {
    const errorsByCategory = Object.values(ErrorCategory).reduce(
      (acc, cat) => {
        acc[cat] = this.getCategoryCount(cat);
        return acc;
      },
      {} as Record<string, number>
    );

    const criticalCount = this.window.filter(
      (e) => e.severity === ErrorSeverity.CRITICAL
    ).length;

    const errorRate = this.getErrorRate();

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (criticalCount > 0 || errorRate > 0.1) {
      status = 'unhealthy';
    } else if (errorRate > 0.05) {
      status = 'degraded';
    }

    return {
      status,
      criticalErrors: criticalCount,
      errorRate,
      errorsByCategory,
    };
  }
}

// Usage
const monitor = new ErrorHealthMonitor();

// In error handler
try {
  await operation();
} catch (error) {
  if (error instanceof BaseError) {
    monitor.recordError(error);
  }
  throw error;
}

// Periodically check health
setInterval(() => {
  const health = monitor.getHealthStatus();
  console.log('System health:', health);

  if (health.status === 'unhealthy') {
    logger.error('System unhealthy', health);
  }
}, 30000);
```

## 7. Integrating with Logging System

```typescript
import { BaseError } from '@core/error-system';
import { Logger } from '@shared/logging';

class ErrorLoggerIntegration {
  constructor(private logger: Logger) {}

  logError(error: unknown, context?: Record<string, unknown>): void {
    if (error instanceof BaseError) {
      const metadata = error.getMetadata();

      this.logger.error('Error occurred', {
        // Standard error fields
        errorCode: metadata.code,
        errorCategory: metadata.category,
        errorSeverity: metadata.severity,
        errorMessage: error.message,
        errorStack: metadata.stack,

        // Timestamp
        timestamp: metadata.timestamp,

        // Context
        ...metadata.context,
        ...context,

        // Retry information
        retryable: metadata.retryable,

        // Original error
        originalError: metadata.originalError ? {
          name: metadata.originalError.name,
          message: metadata.originalError.message,
        } : null,

        // Suggestion
        suggestedAction: metadata.suggestedAction,
      });
    } else if (error instanceof Error) {
      this.logger.error('Unexpected error', {
        errorName: error.name,
        errorMessage: error.message,
        errorStack: error.stack,
        ...context,
      });
    } else {
      this.logger.error('Unknown error', {
        error: String(error),
        ...context,
      });
    }
  }

  logRetry(code: string, attempt: number, nextDelay: number, context?: Record<string, unknown>): void {
    this.logger.warn('Operation retry', {
      errorCode: code,
      attempt,
      nextDelayMs: nextDelay,
      ...context,
    });
  }

  logCircuitBreakerStateChange(
    serviceName: string,
    oldState: string,
    newState: string,
    context?: Record<string, unknown>
  ): void {
    this.logger.warn('Circuit breaker state change', {
      service: serviceName,
      fromState: oldState,
      toState: newState,
      ...context,
    });
  }

  logRecoveryAttempt(code: string, attempt: number, success: boolean): void {
    this.logger[success ? 'info' : 'warn']('Recovery attempt', {
      errorCode: code,
      attempt,
      success,
    });
  }
}

// Usage
const errorLogger = new ErrorLoggerIntegration(logger);

try {
  await operation();
} catch (error) {
  errorLogger.logError(error, { userId: '123', operation: 'fetchData' });
}

// In retry handler
handler.on('retry', (event) => {
  errorLogger.logRetry(event.error.code, event.attempt, event.nextDelayMs);
});
```

## 8. Testing Error Scenarios

```typescript
import { expect } from 'chai';
import { RetryStrategy } from '@core/recovery/retry-strategy';
import { NetworkError, NetworkErrorCode } from '@core/error-system';

describe('Error Handling Integration', () => {
  it('should retry network timeout', async () => {
    const strategy = new RetryStrategy({
      maxAttempts: 3,
      initialDelayMs: 10,
    });

    let attempts = 0;

    const result = await strategy.execute(async () => {
      attempts++;
      if (attempts < 3) {
        throw new NetworkError('Timeout', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
          retryable: true,
        });
      }
      return 'success';
    });

    expect(attempts).to.equal(3);
    expect(result).to.equal('success');
  });

  it('should fail on non-retryable error', async () => {
    const strategy = new RetryStrategy({ maxAttempts: 3 });

    let attempts = 0;

    try {
      await strategy.execute(async () => {
        attempts++;
        throw new NetworkError('Auth failed', {
          code: NetworkErrorCode.CONNECTION_REFUSED,
          retryable: false,
        });
      });

      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).to.be.instanceOf(NetworkError);
      expect(attempts).to.equal(1);
    }
  });

  it('should respect max attempts', async () => {
    const strategy = new RetryStrategy({ maxAttempts: 2 });

    let attempts = 0;

    try {
      await strategy.execute(async () => {
        attempts++;
        throw new NetworkError('Always fails', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
          retryable: true,
        });
      });

      expect.fail('Should have thrown');
    } catch (error) {
      expect(attempts).to.equal(2);
    }
  });

  it('should apply exponential backoff', async () => {
    const strategy = new RetryStrategy({
      maxAttempts: 3,
      initialDelayMs: 100,
      maxDelayMs: 1000,
      backoffMultiplier: 2,
      useJitter: false,
    });

    const delays: number[] = [];

    strategy.on('retry', (event) => {
      delays.push(event.nextDelayMs);
    });

    try {
      await strategy.execute(async () => {
        throw new NetworkError('Always fails', {
          code: NetworkErrorCode.CONNECTION_TIMEOUT,
          retryable: true,
        });
      });
    } catch {
      // Expected to fail
    }

    // Delays should be approximately: 100, 200 (not retrying 3rd)
    expect(delays.length).to.equal(2);
    expect(delays[0]).to.be.greaterThan(50);
    expect(delays[0]).to.be.lessThan(150);
  });
});
```

---

**Related Documentation:**
- [Error System Overview](ERROR_SYSTEM_OVERVIEW.md)
- [Recovery Strategies Guide](RECOVERY_STRATEGIES_GUIDE.md)
- [Error Codes Reference](ERROR_CODES_REFERENCE.md)
- [Best Practices](BEST_PRACTICES.md)
- [Troubleshooting](TROUBLESHOOTING.md)
