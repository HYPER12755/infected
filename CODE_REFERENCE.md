# Code Reference Guide for Recovery Strategy Implementation

## Error System Implementation Files

### Core Error Taxonomy
```
/src/core/error-system/
├── error-taxonomy.ts       (353 lines)
│   ├── BaseError<T> abstract class
│   ├── ErrorCategory enum (7 values)
│   ├── ErrorSeverity enum (4 values)
│   ├── ErrorMetadata<T> interface
│   └── Error code enums (7 total)
│       ├── NetworkErrorCode
│       ├── ProcessErrorCode
│       ├── SSHErrorCode
│       ├── ResourceErrorCode
│       ├── SecurityErrorCode
│       ├── TimeoutErrorCode
│       └── FilesystemErrorCode
│
├── error-categories.ts     (332 lines)
│   ├── NetworkError class
│   ├── ProcessError class
│   ├── SSHError class
│   ├── ResourceError class
│   ├── SecurityError class
│   ├── TimeoutError class
│   └── FilesystemError class
│
├── error-metadata.ts       (472 lines)
│   ├── ErrorSource enum
│   ├── ErrorContext interface
│   ├── convertNodeError()
│   ├── convertNetworkError()
│   ├── convertProcessError()
│   ├── convertSSHError()
│   ├── convertFileSystemError()
│   ├── convertError() - Smart dispatcher
│   ├── isBaseError() - Type guard
│   ├── isRetryable() - Type guard
│   └── isCritical() - Type guard
│
└── index.ts                (50 lines)
    └── Central export point for all error system components
```

### Error System Key Interfaces
```typescript
// From error-taxonomy.ts

export abstract class BaseError<T = Record<string, unknown>> extends Error {
  readonly category: ErrorCategory;
  readonly code: string;
  readonly severity: ErrorSeverity;
  readonly retryable: boolean;
  readonly context: T;
  readonly timestamp: string;
  readonly originalError: Error | null;
  readonly suggestedAction: string | undefined;
  
  // Methods
  isCritical(): boolean;
  isHigh(): boolean;
  isMedium(): boolean;
  isLow(): boolean;
  isCategory(category: ErrorCategory): boolean;
  canRetry(): boolean;
  getMetadata(): ErrorMetadata<T>;
  matches(criteria: {...}): boolean;
  toJSON(): Record<string, unknown>;
  toString(): string;
  getClassification(): string;
}

export interface ErrorMetadata<T = Record<string, unknown>> {
  timestamp: string;
  category: ErrorCategory;
  code: string;
  severity: ErrorSeverity;
  retryable: boolean;
  context?: T;
  originalError?: Error | null;
  suggestedAction?: string;
  stack?: string;
}
```

---

## Critical Component Error Handling

### ProcessManager
**File**: `/src/core/process-manager.ts` (982 lines)

**Key Error Throwing Points**:
```typescript
// Line 256: Concurrent process limit
throw new ResourceLimitError('concurrent processes', this.maxConcurrentProcesses);

// Lines 265-307: FileManager unavailability
throw new ExecutionError('FileManager is not available...');

// Line 301: Input read failure
throw new ExecutionError(`Failed to read input from output_id...`);

// Line 366: Terminal creation failure
throw new ExecutionError(`Failed to create terminal...`);

// Line 537: Execution info not found
reject(new ExecutionError('Execution info not found', { executionId }));

// Line 586: Process error wrapper
reject(new ExecutionError(`Process error: ${error.message}`, { originalError }));
```

**Key Methods for Integration**:
- `executeCommand()` (line 249) - Main execution entry point
- `getExecutionStrategy()` (line 239) - Get strategy for mode
- `convertStrategyResultToExecutionInfo()` (line 415) - Strategy result conversion

**Current Legacy Errors Used**:
- ExecutionError
- ResourceLimitError
- TimeoutError

---

### SSH Session Manager
**File**: `/src/modules/ssh/ssh-session-manager.ts` (261 lines)

**Key Error Throwing Points**:
```typescript
// Line 73: Session already exists
throw new Error(`Session ${sessionId} already exists...`);

// Line 166: Session not found
throw new Error(`Session ${sessionId} not found`);

// Lines 182-188: Session close error handling
// Currently just logs, but error state set
```

**Key Methods**:
- `createSession()` (line 67) - Create new session
- `closeSession()` (line 163) - Close session
- `getSession()` (line 155) - Get session by ID
- `listSessions()` (line 194) - List all sessions

**Session Interface**:
```typescript
export interface Session {
  id: string;
  connectionId: string;
  created: number;
  lastUsed: number;
  state: SessionState;  // 'active' | 'closed' | 'error'
  ptyProcess: IPty;
  outputBuffer: string;
  historyLog: string;
  isReady: boolean;
  isConnected: boolean;
  lastCommand: string;
  target?: SSHConnectionTarget;
}
```

---

### SSH Command Executor
**File**: `/src/modules/ssh/ssh-command-executor.ts` (284 lines)

**Key Error Throwing Points**:
```typescript
// Line 42: Connection check
throw new Error(`Session ${session.id} is not connected`);

// Line 46: Busy check
throw new Error(`Session ${session.id} is busy executing...`);

// Line 107: Command timeout
throw new Error(`Command timeout after ${validTimeout}ms...`);

// Lines 179-184: Command cancellation failure
// Currently just logs error
```

**Key Methods**:
- `executeCommand()` (line 36) - Execute command in session
- `cancelCommand()` (line 159) - Cancel running command

**CommandResult Interface**:
```typescript
export interface CommandResult {
  output: string;
  exitCode: number;
  durationMs: number;
  completedNormally: boolean;
}
```

---

### Resource Limiter
**File**: `/src/core/resource-limiter.ts` (484 lines)

**Key Error Class**:
```typescript
export class LimitExceededError extends Error {
  constructor(
    public limitType: 'memory' | 'cpu' | 'fileHandles' | 'connections',
    public current: number,
    public limit: number,
    public processId?: number
  )
}
```

**Event-Based Error Handling**:
```typescript
// Line 196: Memory limit check emits event
this.emit('limit-exceeded', info);

// Line 222: CPU limit check emits event
this.emit('limit-exceeded', info);

// Line 301: Enforcement action emitted
this.emit('action-taken', action);
```

**Key Methods**:
- `checkMemoryLimit()` (line 183) - Check and enforce memory
- `checkCPULimit()` (line 209) - Check and enforce CPU
- `checkFileHandleLimit()` (line 236) - Check and enforce file handles
- `checkConnectionLimit()` (line 263) - Check and enforce connections

**EnforcementAction Interface**:
```typescript
export interface EnforcementAction {
  timestamp: number;
  limitType: 'memory' | 'cpu' | 'fileHandles' | 'connections';
  action: string;
  target?: number | string;
  reason: string;
  details?: Record<string, unknown>;
}
```

---

## Configuration and Service Injection

### Configuration Schema
**File**: `/src/config/schema.ts` (116 lines)

**Relevant Schemas**:
```typescript
ProcessManagerConfigSchema
  ├── maxConcurrentProcesses: number
  └── outputDir: string

ExecutionStrategyConfigSchema
  ├── defaultTimeoutMs: number
  └── defaultKillGracePeriodMs: number

SSHConnectionPoolConfigSchema
  ├── maxConnections: number
  ├── maxIdleTime: number
  ├── maxConnectionAge: number
  ├── maxReusesPerConnection: number
  ├── staleCheckInterval: number
  └── enableCredentialCaching: boolean

ResourcesConfigSchema
  ├── maxMemoryMB: number
  ├── maxCPUPercent: number
  ├── maxFileHandles: number
  ├── maxConnections: number
  ├── monitoringIntervalMs: number
  ├── thresholdPercent: number
  ├── cpuThresholdPercent: number
  ├── fileHandleThresholdPercent: number
  ├── enableLimiting: boolean
  └── enableMonitoring: boolean
```

---

### Service Container
**File**: `/src/core/service-container.ts` (272 lines)

**Key Methods**:
```typescript
public get<T extends ServiceName>(name: T): ManagerInstances[T]
  // Get registered service by name

public getAllManagers(): ManagerInstances
  // Get all managers as ManagerInstances

public getExecutionStrategyFactory(): ExecutionStrategyFactory
  // Lazy-load execution strategy factory

public getSSHConnectionPool(): SSHConnectionPool
  // Lazy-load SSH connection pool

public getResourceMonitor(): ResourceMonitor
  // Lazy-load resource monitor (with config)

public getResourceLimiter(): ResourceLimiter
  // Lazy-load resource limiter (with config)
```

**Service Registration Pattern**:
```typescript
// Eager registration in constructor
const fileManager = new FileManager();
this.services.set('fileManager', fileManager);

// Lazy-loading pattern for specialized services
public getResourceMonitor(): ResourceMonitor {
  if (this.resourceMonitor === null) {
    this.resourceMonitor = resourceMonitorInstance;
    const monitorConfig = {
      memoryThresholdPercent: this.config.resources?.thresholdPercent ?? 85,
      // ... more config
    };
    this.resourceMonitor.configure(monitorConfig);
  }
  return this.resourceMonitor;
}
```

---

## Recommended Integration Points for Recovery

### 1. ProcessManager Integration
**Location**: `/src/core/process-manager.ts:249`

```typescript
async executeCommand(options: ExecutionOptions): Promise<ExecutionInfo> {
  try {
    // Check concurrent process limit
    if (runningProcesses >= this.maxConcurrentProcesses) {
      throw new ProcessError('Too many concurrent processes', {
        code: ProcessErrorCode.SPAWN_FAILED,
        severity: ErrorSeverity.HIGH,
        retryable: true,  // Can retry after cleanup
        context: { 
          current: runningProcesses, 
          limit: this.maxConcurrentProcesses 
        }
      });
    }
    
    // ... existing code
    
  } catch (error) {
    const baseError = error instanceof BaseError 
      ? error 
      : convertError(error, ErrorSource.PROCESS);
    
    // RECOVERY POINT HERE
    if (baseError.canRetry()) {
      const recoveryMgr = this.serviceContainer?.getRecoveryStrategyManager();
      if (recoveryMgr) {
        const result = await recoveryMgr.attemptRecovery(baseError);
        if (result.success) {
          return result.result;
        }
      }
    }
    
    throw baseError;
  }
}
```

### 2. SSH Module Integration
**Location**: `/src/modules/ssh/ssh-command-executor.ts:36`

```typescript
async executeCommand(
  session: Session,
  command: string,
  timeout: number = DEFAULT_TIMEOUT_MS
): Promise<CommandResult> {
  if (!session.isConnected) {
    throw new SSHError(`Session ${session.id} is not connected`, {
      code: SSHErrorCode.DISCONNECTED,
      severity: ErrorSeverity.HIGH,
      retryable: true,  // Can reconnect
      context: {
        sessionId: session.id,
        target: session.target
      }
    });
  }
  
  // ... existing code
}
```

### 3. Resource Limiter Integration
**Location**: `/src/core/resource-limiter.ts:183`

```typescript
checkMemoryLimit(currentUsageMB: number, totalAvailableMB: number): void {
  if (!this.memoryLimitMB || currentUsageMB <= this.memoryLimitMB) {
    return;
  }
  
  // Emit event instead of throwing (currently)
  // Future: Create ResourceError
  const error = new ResourceError('Memory limit exceeded', {
    code: ResourceErrorCode.MEMORY_EXCEEDED,
    severity: ErrorSeverity.CRITICAL,
    retryable: true,  // Can retry after cleanup
    context: {
      current: currentUsageMB,
      limit: this.memoryLimitMB,
      available: totalAvailableMB
    }
  });
  
  this.emit('limit-exceeded', error.getMetadata());
  
  // Could also trigger recovery here
}
```

---

## Error Flow Diagram

```
User Request
    ↓
ProcessManager.executeCommand()
    ↓
[Try to execute operation]
    ├─ Success → Return ExecutionInfo
    └─ Error → Catch block
        ↓
        [Is BaseError?]
        ├─ No → convertError() → BaseError
        └─ Yes → Use as is
        ↓
        [Is retryable?]
        ├─ No → Throw error immediately
        └─ Yes
            ↓
            [Get RecoveryStrategyManager from ServiceContainer]
            ↓
            [Select strategy based on error type/config]
            ├─ RetryStrategy
            ├─ FallbackStrategy
            ├─ CircuitBreakerStrategy
            └─ Custom strategy
            ↓
            [Execute recovery]
            ├─ Success → Return result
            └─ Failure → Throw original error
```

---

## Testing Integration Points

### Unit Tests Needed
1. **Error Conversion**: Verify convertError() maps all error types correctly
2. **ProcessManager**: Test error throwing for resource limits
3. **SSH Modules**: Test error throwing with context
4. **ResourceLimiter**: Test event emission for limits
5. **ServiceContainer**: Test lazy-loading of recovery manager

### Integration Tests Needed
1. **Retry Strategy**: Simulate timeout → success on retry
2. **Fallback Strategy**: Simulate primary failure → fallback success
3. **Circuit Breaker**: Simulate threshold → open circuit
4. **Error Context**: Verify context propagation through recovery

---

## Quick Lookup Table

| Component | File | Key Method | Error Class | Status |
|-----------|------|-----------|------------|--------|
| ProcessManager | process-manager.ts | executeCommand() | ExecutionError (legacy) | Needs migration |
| ResourceLimiter | resource-limiter.ts | checkMemoryLimit() | LimitExceededError (custom) | Needs migration |
| SSHSessionManager | ssh-session-manager.ts | createSession() | Error (plain) | Needs migration |
| SSHCommandExecutor | ssh-command-executor.ts | executeCommand() | Error (plain) | Needs migration |
| ErrorSystem | error-system/* | Various | BaseError subclasses | Ready for use |
| ServiceContainer | service-container.ts | getResourceMonitor() | N/A | Ready for use |
| Config | config/schema.ts | Various | N/A | Needs extension |

