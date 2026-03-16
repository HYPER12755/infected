# Infected MCP Server Codebase Analysis

## 1. ERROR TAXONOMY STRUCTURE

### Location
`/src/core/error-system/`

### Files
1. **error-taxonomy.ts** - Base error classes and enums
2. **error-categories.ts** - Concrete error subclasses
3. **error-metadata.ts** - Conversion utilities and type guards
4. **index.ts** - Central export point

### Error Categories (7 types)
```
NETWORK, PROCESS, SSH, RESOURCE, SECURITY, TIMEOUT, FILESYSTEM
```

### Error Severity Levels (4 tiers)
```
CRITICAL > HIGH > MEDIUM > LOW
```

### BaseError Class Features
- **Properties**: category, code, severity, retryable, context, timestamp, originalError, suggestedAction
- **Methods**: 
  - `isCritical()`, `isHigh()`, `isMedium()`, `isLow()`
  - `isCategory()`
  - `canRetry()`
  - `matches(criteria)` - Multi-criteria matching
  - `getMetadata()` - Full metadata export
  - `toJSON()` - Serialization
  - `toString()` - String representation
  - `getClassification()` - Category:Severity format

### Error Code Systems (per category)
- **NetworkErrorCode**: CONNECTION_TIMEOUT, DNS_FAILURE, CONNECTION_REFUSED, UNREACHABLE, RESET, KEEP_ALIVE_TIMEOUT, PROTOCOL_ERROR
- **ProcessErrorCode**: SPAWN_FAILED, EXIT_CODE, SIGNAL_RECEIVED, TIMEOUT, NOT_FOUND, PERMISSION_DENIED, INVALID_ARGS
- **SSHErrorCode**: AUTH_FAILED, CONNECTION_FAILED, COMMAND_FAILED, TIMEOUT, HOST_KEY_VERIFICATION, CHANNEL_OPEN_FAILURE, DISCONNECTED
- **ResourceErrorCode**: MEMORY_EXCEEDED, CPU_LIMIT, FILE_HANDLES_EXCEEDED, DISK_FULL, NOT_AVAILABLE, QUOTA_EXCEEDED
- **SecurityErrorCode**: VALIDATION_FAILED, POLICY_VIOLATION, UNAUTHORIZED, FORBIDDEN, INVALID_SIGNATURE, CERTIFICATE_INVALID
- **TimeoutErrorCode**: OPERATION_TIMEOUT, COMMAND_TIMEOUT, HANDSHAKE_TIMEOUT, READ_TIMEOUT, WRITE_TIMEOUT
- **FilesystemErrorCode**: NOT_FOUND, PERMISSION_DENIED, READ_FAILED, WRITE_FAILED, IS_DIRECTORY, NOT_DIRECTORY, EXISTS, INVALID_PATH

### Concrete Error Classes
```typescript
NetworkError, ProcessError, SSHError, ResourceError, SecurityError, TimeoutError, FilesystemError
```
All extend BaseError with category-specific defaults.

### Conversion Functions
- `convertNodeError()` - Maps Node.js errors to BaseError types
- `convertNetworkError()` - Detailed network error mapping
- `convertProcessError()` - Exit codes and signals to ProcessError
- `convertSSHError()` - SSH-specific error detection
- `convertFileSystemError()` - FS error code mapping
- `convertError()` - Smart dispatcher with source hints

### Type Guards
- `isBaseError()` - Check if error is BaseError
- `isRetryable()` - Check if retryable
- `isCritical()` - Check if critical severity

### ErrorMetadata Interface
```typescript
{
  timestamp: string;          // ISO timestamp
  category: ErrorCategory;
  code: string;
  severity: ErrorSeverity;
  retryable: boolean;
  context?: T;                // Custom context data
  originalError?: Error;      // Wrapped error
  suggestedAction?: string;
  stack?: string;
}
```

---

## 2. CURRENT ERROR HANDLING PATTERNS

### ProcessManager Error Handling
**File**: `/src/core/process-manager.ts` (lines 249-409)

#### Errors Thrown
1. **ResourceLimitError** - When concurrent processes exceed maxConcurrentProcesses
   - Line 256: `throw new ResourceLimitError('concurrent processes', this.maxConcurrentProcesses)`
   
2. **ExecutionError** - For FileManager unavailability
   - Line 265: FileManager not available for input_output_id processing
   - Line 301: Failed to read input from output_id
   - Line 537: Execution info not found
   - Line 586: Process error wrapper

3. **ExecutionError** - For terminal creation failures
   - Line 366: Failed to create terminal

#### Error Context
- Uses custom error classes from `../utils/shell-errors.js` (legacy)
- Error info stored in execution info (status: 'failed')
- Timestamps and exit codes tracked
- Output saved to FileManager with error context

#### Current Pattern
```typescript
try {
  // operation
} catch (error) {
  // Log error
  logger.error('message', { error: error.message });
  // Update execution state
  executionInfo.status = 'failed';
  // Throw wrapped error
  throw new ExecutionError(message, { originalError: String(error) });
}
```

#### Limitations
- No structured error categories for recovery decisions
- No automatic retry logic integration
- No error severity-based handling
- No suggested actions for operators
- Legacy error types not part of new taxonomy

---

### SSH Module Error Handling

#### SSHSessionManager (ssh-session-manager.ts)
**Error Handling Pattern**:
- Throws generic `Error` for session already exists (line 73)
- Throws generic `Error` for session not found (line 166)
- Session state transitions on error (state: 'error')
- Error events emitted: `session:closed`
- Log-based error tracking

**Current Errors**:
```typescript
throw new Error(`Session ${sessionId} already exists...`);
throw new Error(`Session ${sessionId} not found`);
```

#### SSHCommandExecutor (ssh-command-executor.ts)
**Error Handling Pattern**:
- Throws generic `Error` for connection checks (lines 42, 46)
- Throws generic `Error` for command timeout (line 107)
- Throws generic `Error` for command cancellation failures (line 184)
- Log-based error tracking
- No retry logic

**Current Errors**:
```typescript
throw new Error(`Session ${session.id} is not connected`);
throw new Error(`Session ${session.id} is busy...`);
throw new Error(`Command timeout after ${validTimeout}ms`);
```

**Limitations**:
- No SSHError class usage
- No error categorization
- No distinction between retryable and terminal errors
- Manual error string parsing for severity detection
- No error context propagation

---

### ResourceLimiter Error Handling
**File**: `/src/core/resource-limiter.ts`

#### Custom Error Class
```typescript
class LimitExceededError extends Error {
  constructor(
    public limitType: 'memory' | 'cpu' | 'fileHandles' | 'connections',
    public current: number,
    public limit: number,
    public processId?: number
  )
}
```

#### Error Handling Pattern
- Event-based error notification: `limit-exceeded`, `action-taken`
- No thrown errors (emits instead)
- Enforcement actions recorded in history
- Graceful degradation for enforcement

#### Enforcement Actions
```typescript
interface EnforcementAction {
  timestamp: number;
  limitType: 'memory' | 'cpu' | 'fileHandles' | 'connections';
  action: string;
  target?: number | string;
  reason: string;
  details?: Record<string, unknown>;
}
```

#### Current Actions
- Memory: Process termination (oldest first)
- CPU: Warning issued
- File Handles: New spawn blocked
- Connections: Connection rejected

**Limitations**:
- LimitExceededError not part of error taxonomy
- No integration with BaseError system
- Event-based, not exception-based error handling
- No recovery strategy interface

---

## 3. CONFIGURATION STRUCTURE

### File
`/src/config/schema.ts`

### Key Sections Relevant to Recovery Strategies

#### ProcessManager Config
```typescript
ProcessManagerConfigSchema = {
  maxConcurrentProcesses: number,  // default: 50
  outputDir: string                 // default: '/tmp/mcp-shell-outputs'
}
```

#### ExecutionStrategy Config
```typescript
ExecutionStrategyConfigSchema = {
  defaultTimeoutMs: number,         // default: 300000
  defaultKillGracePeriodMs: number  // default: 5000
}
```

#### SSHConnectionPool Config
```typescript
SSHConnectionPoolConfigSchema = {
  maxConnections: number,
  maxIdleTime: number,
  maxConnectionAge: number,
  maxReusesPerConnection: number,
  staleCheckInterval: number,
  enableCredentialCaching: boolean
}
```

#### Resources Config
```typescript
ResourcesConfigSchema = {
  maxMemoryMB: number,              // default: 4096
  maxCPUPercent: number,            // default: 80
  maxFileHandles: number,           // default: 2048
  maxConnections: number,           // default: 50
  monitoringIntervalMs: number,     // default: 5000
  thresholdPercent: number,         // default: 85
  cpuThresholdPercent: number,      // default: 80
  fileHandleThresholdPercent: number, // default: 90
  enableLimiting: boolean,          // default: true
  enableMonitoring: boolean         // default: true
}
```

**Gap**: No recovery strategy configuration section yet. Should add:
```typescript
RecoveryStrategyConfigSchema = {
  enableRecovery: boolean,
  defaultStrategy: 'retry' | 'fallback' | 'circuit-breaker' | 'custom',
  retryConfig: { ... },
  fallbackConfig: { ... },
  circuitBreakerConfig: { ... }
}
```

---

## 4. SERVICE CONTAINER ARCHITECTURE

### File
`/src/core/service-container.ts`

### Registered Services
```typescript
Core Managers:
- fileManager: FileManager
- processManager: ProcessManager
- terminalManager: TerminalManager
- commandHistoryManager: CommandHistoryManager
- securityManager: SecurityManager
- toolCacheManager: ToolCacheManager
- permissionManager: PermissionManager
- monitoringManager: MonitoringManager
- mcpShellConfigManager: McpShellConfigManager
- moduleManager: ModuleManager
- toolLoader: ToolLoader
- pluginLoader: PluginLoader

Phase 1 Integration (Lazy-loaded):
- executionStrategyFactory: ExecutionStrategyFactory
- sshConnectionPool: SSHConnectionPool
- resourceMonitor: ResourceMonitor
- resourceLimiter: ResourceLimiter
```

### Dependency Injection Pattern
1. **Constructor-based injection** for core managers
2. **Getter methods** for lazy-loaded singletons
3. **Registry pattern** using Map<ServiceName, ServiceInstance>

### Service Lifecycle
```typescript
public get<T extends ServiceName>(name: T): ManagerInstances[T] {
  const service = this.services.get(name);
  if (!service) {
    throw new Error(`Service '${name}' not found.`);
  }
  return service as ManagerInstances[T];
}
```

### Lazy-Loading Pattern
```typescript
public getResourceMonitor(): ResourceMonitor {
  if (this.resourceMonitor === null) {
    this.resourceMonitor = resourceMonitorInstance;
    const monitorConfig = { /* from config */ };
    this.resourceMonitor.configure(monitorConfig);
  }
  return this.resourceMonitor;
}
```

### Key Dependencies for Recovery Strategies
1. **ServiceContainer** - Access to all managers
2. **ResourceMonitor** - Get current resource state
3. **ResourceLimiter** - Check and enforce limits
4. **ExecutionStrategyFactory** - Get execution strategies
5. **ProcessManager** - Manage execution lifecycle
6. **Logger** - Log recovery actions

---

## 5. RECOMMENDED INTEGRATION POINTS FOR RECOVERY STRATEGIES

### 1. **Error Interception Points**
- **ProcessManager.executeCommand()** - Line 249
  - After ResourceLimitError for concurrent process limit exceeded
  - After ExecutionError for FileManager unavailability
  - After terminal creation failures
  
- **SSHSessionManager.createSession()** - Line 67
  - Before throwing "Session already exists" error
  
- **SSHCommandExecutor.executeCommand()** - Line 36
  - Before throwing "not connected" or "busy" errors
  - Before throwing "command timeout" errors

- **ResourceLimiter enforcement methods** - Lines 288-366
  - Currently event-based, could trigger recovery strategies

### 2. **Error Wrapping for Context**
All errors thrown should be wrapped in taxonomy-based classes:
```typescript
// Current (legacy):
throw new ExecutionError('message', { context })

// Should become:
throw new ProcessError('message', {
  code: ProcessErrorCode.SPAWN_FAILED,
  severity: ErrorSeverity.HIGH,
  retryable: true,
  context: { /* additional context */ }
})
```

### 3. **Service Container Integration**
Recovery strategies should be registered as services:
```typescript
class ServiceContainer {
  private recoveryStrategyManager: RecoveryStrategyManager | null = null;
  
  public getRecoveryStrategyManager(): RecoveryStrategyManager {
    if (this.recoveryStrategyManager === null) {
      const config = this.config.recovery;
      this.recoveryStrategyManager = new RecoveryStrategyManager(config);
      this.recoveryStrategyManager.registerStrategies([
        new RetryStrategy(...),
        new FallbackStrategy(...),
        new CircuitBreakerStrategy(...)
      ]);
    }
    return this.recoveryStrategyManager;
  }
}
```

### 4. **Configuration Extension Points**
Add recovery strategy config to schema:
```typescript
export const RecoveryStrategyConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultStrategy: z.enum(['retry', 'fallback', 'circuit-breaker']).default('retry'),
  retry: z.object({
    maxAttempts: z.number().default(3),
    backoffMs: z.number().default(1000),
    maxBackoffMs: z.number().default(30000),
    backoffMultiplier: z.number().default(2),
  }),
  fallback: z.object({
    enabled: z.boolean().default(true),
    timeout: z.number().default(5000),
  }),
  circuitBreaker: z.object({
    failureThreshold: z.number().default(5),
    resetTimeoutMs: z.number().default(60000),
  }),
}).optional();

export const InfectedConfigSchema = z.object({
  // ... existing config
  recovery: RecoveryStrategyConfigSchema,
});
```

---

## 6. RECOVERY STRATEGY DEPENDENCIES AND INTERACTIONS

### Required Service Dependencies
1. **ProcessManager** - To execute retries, manage process lifecycle
2. **ResourceMonitor** - To check current resource state before recovery
3. **ResourceLimiter** - To understand current limits and constraints
4. **ExecutionStrategyFactory** - To create alternative execution strategies
5. **SSHConnectionPool** - For SSH connection recovery strategies
6. **Logger** - For audit trail of recovery actions
7. **ServiceContainer** - To access other managers dynamically

### Error Type Handling Matrix
```
ERROR TYPE              | RETRYABLE | RECOVERY STRATEGY
-----------             |---------  |-------------------
ProcessError (timeout)  | YES       | Retry with longer timeout
ProcessError (spawn)    | YES       | Retry with backoff
SSHError (timeout)      | YES       | Reconnect + retry
SSHError (auth)         | NO        | Alert operator
NetworkError (timeout)  | YES       | Retry with fallback host
NetworkError (refused)  | YES       | Wait + retry
ResourceError (memory)  | YES       | Kill background processes
ResourceError (cpu)     | NO        | Alert operator
SecurityError           | NO        | Alert operator
```

### State Management Requirements
```typescript
interface RecoveryState {
  errorId: string;
  originalError: BaseError;
  strategyAttempt: number;
  maxAttempts: number;
  backoffMs: number;
  lastAttemptTime: number;
  recoveryActions: string[];
  finalOutcome: 'success' | 'failure' | 'fallback';
}
```

### Interaction Points
1. **Error Emission** → Recovery Strategy Selection
   - Examine error.category, code, severity, retryable
   - Look up strategy config
   - Initialize recovery state

2. **Recovery Execution** → Resource Validation
   - Check ResourceMonitor current state
   - Verify limits not violated before attempt
   - Emit resource events on enforcement

3. **Retry/Fallback** → Process Management
   - Terminate failed process cleanly
   - Execute alternative strategy
   - Track attempt metrics

4. **Circuit Breaker** → Aggregated Error Tracking
   - Track failures per service/operation
   - Open circuit on threshold
   - Emit circuit-open events

5. **Completion** → Audit Logging
   - Log recovery success/failure
   - Update execution info
   - Notify subscribers of outcome

---

## 7. IMPLEMENTATION ROADMAP

### Phase 1: Error Taxonomy Adoption
- [ ] Integrate error taxonomy into ProcessManager (replace shell-errors.js)
- [ ] Convert SSH module errors to SSHError class
- [ ] Convert ResourceLimiter errors to ResourceError class
- [ ] Update all error-throwing code to use BaseError subclasses

### Phase 2: Recovery Strategy Framework
- [ ] Design RecoveryStrategy interface
- [ ] Create retry, fallback, circuit-breaker implementations
- [ ] Implement RecoveryStrategyManager
- [ ] Register recovery strategies with ServiceContainer

### Phase 3: Configuration Integration
- [ ] Extend config schema with recovery config
- [ ] Load recovery strategies from config
- [ ] Implement config-driven strategy selection

### Phase 4: Service Integration
- [ ] Hook recovery strategies into error-prone methods
- [ ] Implement error interception points
- [ ] Add audit logging for recovery actions
- [ ] Implement metrics collection

### Phase 5: Testing & Observability
- [ ] Test retry exhaustion scenarios
- [ ] Test fallback strategy activation
- [ ] Test circuit breaker transitions
- [ ] Add observability metrics
