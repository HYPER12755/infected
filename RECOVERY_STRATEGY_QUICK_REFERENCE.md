# Recovery Strategy Implementation Quick Reference

## Overview
This document provides a quick reference for implementing recovery strategies in the Infected MCP Server, using the newly established error taxonomy system.

---

## Key Facts Summary

### Error Taxonomy
- **Location**: `/src/core/error-system/`
- **7 Categories**: NETWORK, PROCESS, SSH, RESOURCE, SECURITY, TIMEOUT, FILESYSTEM
- **4 Severity Levels**: CRITICAL, HIGH, MEDIUM, LOW
- **Key Property**: `retryable` boolean indicates if error can be retried

### Current Error Handling Gaps
- ProcessManager uses legacy error classes (ExecutionError, ResourceLimitError)
- SSH modules throw plain `Error` objects without categorization
- ResourceLimiter uses event-based pattern, not exception-based
- No structured recovery logic exists anywhere
- No integration with BaseError taxonomy

### Service Architecture
- **ServiceContainer** at `/src/core/service-container.ts`
- Implements lazy-loading for specialized services
- Provides singleton access to managers
- Already loads: ProcessManager, ResourceMonitor, ResourceLimiter, ExecutionStrategyFactory

---

## Recovery Strategy Interface (Proposed)

```typescript
// /src/core/recovery-strategies/recovery-strategy.ts

export interface RecoveryStrategy {
  // Unique identifier for this strategy
  readonly id: string;
  
  // Whether this strategy can handle the given error
  canHandle(error: BaseError): boolean;
  
  // Execute recovery for the error
  execute(context: RecoveryContext): Promise<RecoveryResult>;
}

export interface RecoveryContext {
  error: BaseError;
  originalOperation: () => Promise<any>;
  services: ServiceContainer;
  config: InfectedConfig;
}

export interface RecoveryResult {
  success: boolean;
  outcome: 'retry-success' | 'fallback-success' | 'exhausted' | 'skipped';
  finalError?: BaseError;
  recoveryMetrics: {
    attemptCount: number;
    totalDurationMs: number;
    lastAttemptTime: Date;
  };
}
```

---

## Error to Recovery Decision Tree

```
Error Received
    ↓
Is BaseError? No → Convert using error-system/convertError()
    ↓ Yes
Is retryable = false? Yes → Log and throw
    ↓ No
Check error.category:

NETWORK:
  - CONNECTION_TIMEOUT → RetryStrategy (exponential backoff)
  - CONNECTION_REFUSED → RetryStrategy + wait
  - RESET → RetryStrategy
  - DNS_FAILURE → Fail fast (not retryable)
  
PROCESS:
  - TIMEOUT → RetryStrategy (longer timeout)
  - SPAWN_FAILED → RetryStrategy (limited attempts)
  - EXIT_CODE → Check code, may fail fast
  - SIGNAL_RECEIVED → Log, may retry
  
SSH:
  - TIMEOUT → RetryStrategy (with reconnect)
  - CONNECTION_FAILED → RetryStrategy (new connection)
  - AUTH_FAILED → Fail fast (not retryable)
  - DISCONNECTED → RetryStrategy (reconnect)
  
RESOURCE:
  - MEMORY_EXCEEDED → FallbackStrategy (kill processes)
  - CPU_LIMIT → Alert + fail
  - FILE_HANDLES_EXCEEDED → FallbackStrategy (close handles)
  
TIMEOUT:
  - OPERATION_TIMEOUT → RetryStrategy (increase timeout)
  - COMMAND_TIMEOUT → RetryStrategy (longer duration)
  
SECURITY/FILESYSTEM:
  - All errors → Fail fast (not retryable)
```

---

## Integration Checklist

### Step 1: Error Taxonomy Adoption
- [ ] Replace legacy ExecutionError with ProcessError in ProcessManager
- [ ] Replace ResourceLimitError with ResourceError
- [ ] Convert SSH errors to SSHError
- [ ] Update error throwing to use new taxonomy
- [ ] Add error context objects to all errors

### Step 2: Config Schema Extension
```typescript
// In /src/config/schema.ts, add:

export const RecoveryStrategyConfigSchema = z.object({
  enabled: z.boolean().default(true).describe("Enable automatic recovery strategies."),
  defaultStrategy: z.enum(['retry', 'fallback', 'circuit-breaker']).default('retry'),
  
  retry: z.object({
    enabled: z.boolean().default(true),
    maxAttempts: z.number().int().min(1).max(20).default(3),
    initialBackoffMs: z.number().int().min(100).default(1000),
    maxBackoffMs: z.number().int().min(1000).default(30000),
    backoffMultiplier: z.number().default(2),
    jitterPercent: z.number().min(0).max(100).default(10),
  }).default({}),
  
  fallback: z.object({
    enabled: z.boolean().default(true),
    timeout: z.number().int().min(1000).default(5000),
    fallbackHosts: z.array(z.string()).default([]),
  }).default({}),
  
  circuitBreaker: z.object({
    enabled: z.boolean().default(false),
    failureThreshold: z.number().int().min(1).default(5),
    successThreshold: z.number().int().min(1).default(2),
    resetTimeoutMs: z.number().int().min(1000).default(60000),
  }).default({}),
}).optional();

// Then add to InfectedConfigSchema:
export const InfectedConfigSchema = z.object({
  // ... existing fields
  recovery: RecoveryStrategyConfigSchema,
});
```

### Step 3: Recovery Manager Implementation
```typescript
// /src/core/recovery-strategies/recovery-manager.ts

export class RecoveryStrategyManager {
  private strategies: Map<string, RecoveryStrategy> = new Map();
  
  constructor(
    private config: InfectedConfig,
    private serviceContainer: ServiceContainer
  ) {}
  
  async attemptRecovery(error: BaseError): Promise<RecoveryResult> {
    // 1. Check if error is retryable
    if (!error.canRetry()) {
      return { success: false, outcome: 'skipped' };
    }
    
    // 2. Select appropriate strategy based on error and config
    const strategy = this.selectStrategy(error);
    
    // 3. Execute recovery
    return strategy.execute({
      error,
      originalOperation: null,
      services: this.serviceContainer,
      config: this.config
    });
  }
  
  private selectStrategy(error: BaseError): RecoveryStrategy {
    // Selection logic based on error type and config
  }
}
```

### Step 4: ServiceContainer Integration
```typescript
// In /src/core/service-container.ts, add:

private recoveryManager: RecoveryStrategyManager | null = null;

public getRecoveryStrategyManager(): RecoveryStrategyManager {
  if (this.recoveryManager === null) {
    this.recoveryManager = new RecoveryStrategyManager(this.config, this);
    this.recoveryManager.registerStrategies([
      new RetryStrategy(this.config.recovery?.retry),
      new FallbackStrategy(this.config.recovery?.fallback),
      new CircuitBreakerStrategy(this.config.recovery?.circuitBreaker),
    ]);
    logger.debug('RecoveryStrategyManager initialized');
  }
  return this.recoveryManager;
}
```

### Step 5: Error Interception
```typescript
// In critical methods like ProcessManager.executeCommand():

try {
  // ... existing code
} catch (error) {
  const baseError = error instanceof BaseError 
    ? error 
    : convertError(error, ErrorSource.PROCESS);
  
  // Attempt recovery
  const recoveryMgr = this.serviceContainer.getRecoveryStrategyManager();
  const recoveryResult = await recoveryMgr.attemptRecovery(baseError);
  
  if (recoveryResult.success) {
    return recoveryResult.result;
  }
  
  // Recovery failed, throw original error
  throw baseError;
}
```

---

## Service Dependencies for Recovery Strategies

| Strategy | Dependencies |
|----------|------------|
| Retry | ProcessManager, ExecutionStrategyFactory |
| Fallback | ProcessManager, SSHConnectionPool, ResourceMonitor |
| CircuitBreaker | MetricsCollector, Logger |
| ResourceRecovery | ResourceMonitor, ResourceLimiter, ProcessManager |

---

## Testing Scenarios

### RetryStrategy Tests
- Exhaust max retries → fail with original error
- Succeed on 2nd attempt → return success
- Backoff timing → verify exponential growth
- Jitter → verify randomness within bounds

### FallbackStrategy Tests
- Fallback host unavailable → use next fallback
- All fallbacks exhausted → fail
- Fallback succeeds → return success with fallback metadata

### CircuitBreakerStrategy Tests
- Failure threshold reached → circuit opens
- Circuit open → request rejected immediately
- Reset timeout elapsed → attempt half-open
- Success in half-open → circuit closes

---

## Logging and Observability

All recovery attempts should emit structured logs:

```typescript
logger.info('Recovery strategy initiated', {
  component: 'RecoveryManager',
  errorCode: error.code,
  category: error.category,
  strategyId: strategy.id,
  context: error.context,
});

logger.info('Recovery attempt', {
  component: 'RecoveryManager',
  strategyId: strategy.id,
  attemptNumber: n,
  backoffMs: backoff,
});

logger.info('Recovery outcome', {
  component: 'RecoveryManager',
  strategyId: strategy.id,
  outcome: result.outcome,
  totalDurationMs: result.recoveryMetrics.totalDurationMs,
  attemptCount: result.recoveryMetrics.attemptCount,
});
```

---

## Files to Create/Modify

### New Files to Create
```
/src/core/recovery-strategies/
  ├── index.ts
  ├── recovery-strategy.ts (interfaces)
  ├── recovery-manager.ts
  ├── retry-strategy.ts
  ├── fallback-strategy.ts
  ├── circuit-breaker-strategy.ts
  └── resource-recovery-strategy.ts
```

### Files to Modify
```
/src/config/schema.ts                    (add recovery config)
/src/core/service-container.ts          (add recovery manager)
/src/core/process-manager.ts            (integrate recovery)
/src/modules/ssh/ssh-session-manager.ts (use BaseError)
/src/modules/ssh/ssh-command-executor.ts (use BaseError)
/src/core/resource-limiter.ts           (use ResourceError)
```

---

## Quick Facts for Developers

1. **All errors thrown must extend BaseError** from error taxonomy
2. **Recovery is opt-in** via configuration `recovery.enabled`
3. **Services accessed via ServiceContainer** - never create singletons directly
4. **Configuration is immutable** - loaded at startup
5. **Error context is crucial** - pass complete context for recovery decisions
6. **Logging must be structured** - use component, error code, metadata fields
7. **Recovery has a cost** - monitor retry/fallback overhead
8. **Circuit breakers prevent cascading failures** - use for external services
9. **Recovery state is transient** - don't persist recovery metadata
10. **Metrics matter** - track recovery success rates by error type

