# Phase 2.3 Error Integration - Detailed Analysis & Implementation Guide

**Document Date:** March 16, 2026  
**Status:** Analysis Complete  
**Scope:** ProcessManager, SSH Module, ResourceLimiter, ResourceMonitor Integration

---

## EXECUTIVE SUMMARY

Phase 2.3 focuses on **integrating recovery strategies (Retry, CircuitBreaker, RecoveryHandler) into four core components**. These components currently have basic error handling but lack resilience patterns.

### Key Integration Points:
1. **ProcessManager** - Command execution with timeout/resource limits
2. **SSH Module** - Network-based operations (most error-prone)
3. **ResourceLimiter** - Event-based enforcement actions
4. **ResourceMonitor** - Threshold detection and alerting

### Total Estimated LOC Changes: **~800-1000 lines**
- ProcessManager: ~250-300 LOC
- SSH Module: ~300-350 LOC (4 files)
- ResourceLimiter: ~100-150 LOC
- ResourceMonitor: ~50-100 LOC

---

## 1. PROCESSMANAGER ANALYSIS

### Current File Location
`/root/sandbox/infected/src/core/process-manager.ts` (982 lines)

### Current Error Handling Approach

#### 1.1 Current Error Types (Lines 24-28)
```typescript
import {
  ExecutionError,
  TimeoutError,
  ResourceLimitError,
  ResourceNotFoundError,
} from '../utils/shell-errors.js';
```

**Issues:**
- ❌ Basic error classes without categorization
- ❌ No error codes or severity levels
- ❌ Timeouts are handled with setTimeout, not managed
- ❌ Resource limits throw immediately, no retry logic

#### 1.2 Concurrent Process Limits (Lines 250-257)
```typescript
const runningProcesses = Array.from(this.executions.values()).filter(
  (exec) => exec.status === 'running'
).length;

if (runningProcesses >= this.maxConcurrentProcesses) {
  throw new ResourceLimitError('concurrent processes', this.maxConcurrentProcesses);
}
```

**Issue:** Hard fail - no retry, no backoff, no circuit breaker

#### 1.3 Timeout Handling (Lines 590-604)
```typescript
const timeout = setTimeout(() => {
  logger.warn(`Process timeout for ${executionId}`);
  child.kill('SIGTERM');
  
  setTimeout(() => {
    if (!child.killed) {
      child.kill('SIGKILL');
    }
  }, DEFAULT_PROCESS_TIMEOUT);
}, options.timeoutSeconds * 1000);

child.on('close', () => {
  clearTimeout(timeout);
});
```

**Issues:**
- ❌ No timeout recovery (returns partial output)
- ❌ Hardcoded SIGTERM → SIGKILL escalation (5s grace period)
- ❌ No signal-specific error handling
- ❌ Timeout errors not retryable

#### 1.4 ExecutionStrategy Pattern (Lines 385-398)
```typescript
const strategy = this.getExecutionStrategy(options.executionMode);
const strategyResult = await strategy.execute(
  options.command,
  executionId
);

return await this.convertStrategyResultToExecutionInfo(
  executionId,
  executionInfo,
  strategyResult,
  options
);
```

**Observation:** Strategy pattern already in place but:
- ✅ Good abstraction for different execution modes
- ❌ No error recovery per strategy
- ❌ No circuit breaker per execution mode
- ❌ No metrics collection

### 1.5 FileManager Integration (Lines 263-310)
```typescript
if (options.inputOutputId) {
  if (!this.fileManager) {
    throw new ExecutionError('FileManager is not available...');
  }
  // File read with no retry
  try {
    const result = await this.fileManager.readFile(...);
    resolvedInputData = result.content;
  } catch (error) {
    throw new ExecutionError(...);
  }
}
```

**Issue:** File I/O can fail transiently, should have retry logic

---

### WHERE RECOVERY STRATEGIES SHOULD BE INTEGRATED

#### Integration Point 1: Concurrent Process Limit Check (Line 250-257)
**Strategy:** Retry with exponential backoff
**Pattern:** 
```typescript
// BEFORE:
if (runningProcesses >= this.maxConcurrentProcesses) {
  throw new ResourceLimitError(...)
}

// AFTER (with retry):
const limiterCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,      // Fail after 5 consecutive limit hits
  timeout: 60000,            // Try recovery after 60s
  successThreshold: 2
});

const canExecute = await limiterCircuitBreaker.execute(async () => {
  const runningProcesses = ...;
  if (runningProcesses >= this.maxConcurrentProcesses) {
    throw new ResourceLimitError(...);
  }
  return true;
});
```

**Lines to Modify:** 250-257 (+15 lines)
**New Imports:** CircuitBreaker

#### Integration Point 2: Process Execution with Retry (Line 386-398)
**Strategy:** Retry for certain error types + circuit breaker per mode
**Pattern:**
```typescript
// BEFORE:
const strategy = this.getExecutionStrategy(options.executionMode);
const strategyResult = await strategy.execute(
  options.command,
  executionId
);

// AFTER (with recovery handler):
const recoveryHandler = new RecoveryHandler({
  enableRetry: true,
  enableCircuitBreaker: true,
  retry: {
    maxRetries: options.executionMode === 'foreground' ? 1 : 3,
    initialDelayMs: 100,
    maxDelayMs: 5000,
    backoffMultiplier: 2,
    jitterFactor: 0.1
  },
  circuitBreaker: {
    failureThreshold: 10,    // Per mode
    successThreshold: 3,
    timeoutMs: 30000,
    halfOpenMaxAttempts: 1
  },
  recoveryHandlers: new Map([
    ['TIMEOUT', async (error, context) => {
      logger.warn(`Command timeout on attempt ${context.attempt}`);
      // Cleanup partial output
    }],
    ['SIGNAL_RECEIVED', async (error, context) => {
      logger.warn(`Signal received, retrying...`);
    }]
  ])
});

const strategyResult = await recoveryHandler.executeWithRecovery(
  () => strategy.execute(options.command, executionId),
  { circuitBreakerName: `exec-${options.executionMode}`, tag: executionId }
);
```

**Lines to Modify:** 386-398 (+40 lines)
**New Imports:** RecoveryHandler

#### Integration Point 3: FileManager I/O with Retry (Line 291-309)
**Strategy:** Retry with moderate backoff (I/O can be transient)
**Pattern:**
```typescript
// BEFORE:
try {
  const result = await this.fileManager.readFile(...);
  resolvedInputData = result.content;
} catch (error) {
  throw new ExecutionError(...);
}

// AFTER:
const fileIORetry = new RetryStrategy({
  maxAttempts: 3,
  initialDelayMs: 50,
  maxDelayMs: 1000,
  useJitter: true
});

try {
  resolvedInputData = await fileIORetry.execute(() => 
    this.fileManager!.readFile(...)
  );
} catch (error) {
  throw new ExecutionError(...);
}
```

**Lines to Modify:** 291-309 (+10 lines)
**New Imports:** RetryStrategy

#### Integration Point 4: Terminal Creation with Recovery (Line 336-370)
**Strategy:** Retry for transient failures
**Pattern:**
```typescript
// BEFORE:
try {
  const terminalInfo = await this.terminalManager.createTerminal(terminalOptions);
  executionInfo.terminal_id = terminalInfo.terminal_id;
  this.terminalManager.sendInput(terminalInfo.terminal_id, options.command, true);
  // ...
} catch (error) {
  throw new ExecutionError(...);
}

// AFTER:
const terminalRecovery = new RetryStrategy({
  maxAttempts: 2,           // Terminal creation is critical, fewer retries
  initialDelayMs: 200,
  maxDelayMs: 2000,
  useJitter: true
});

try {
  const terminalInfo = await terminalRecovery.execute(() =>
    this.terminalManager.createTerminal(terminalOptions)
  );
  // ...
} catch (error) {
  throw new ExecutionError(...);
}
```

**Lines to Modify:** 336-370 (+15 lines)
**New Imports:** RetryStrategy

#### Integration Point 5: Streaming Pipeline with Recovery (Line 458-606)
**Strategy:** Circuit breaker to prevent cascade failures from streaming
**Pattern:**
```typescript
// NEW: Add property to class
private streamingCircuitBreaker = new CircuitBreaker({
  failureThreshold: 3,
  timeout: 30000,
  windowSize: 60000
});

// BEFORE: Direct stream execution
return new Promise((resolve, reject) => {
  const child = spawn('sh', ['-c', options.command], { ... });
  // ... handle streams
});

// AFTER:
try {
  return await this.streamingCircuitBreaker.execute(() =>
    new Promise((resolve, reject) => {
      const child = spawn('sh', ['-c', options.command], { ... });
      // ... handle streams
    })
  );
} catch (error) {
  if (error instanceof CircuitBreakerOpenError) {
    throw new ExecutionError(`Streaming circuit open: ${error.message}`, {
      retryable: true,
      circuitBreakerTimeout: error.timeUntilRetry
    });
  }
  throw error;
}
```

**Lines to Modify:** 458-606, add ~50 lines
**New Imports:** CircuitBreaker, CircuitBreakerOpenError

### 1.6 Key Methods That Need Retry Logic

| Method | Current Behavior | Recommended Strategy | Lines |
|--------|------------------|----------------------|-------|
| `executeCommand` | Throws on limit | Retry with backoff | 249-409 |
| `executeCommandWithInputStream` | Direct execution | Circuit breaker | 458-606 |
| File read (inputOutputId) | Single attempt | Retry (3x) | 291-309 |
| Terminal creation | Single attempt | Retry (2x) | 336-370 |
| Strategy execution | Direct execution | Recovery handler | 386-398 |

### 1.7 Implementation Order for ProcessManager

1. **Step 1:** Add RecoveryHandler and CircuitBreaker imports
2. **Step 2:** Initialize circuitBreaker for concurrent limits in constructor
3. **Step 3:** Wrap concurrent limit check with circuit breaker (Lines 250-257)
4. **Step 4:** Wrap file I/O with retry strategy (Lines 291-309)
5. **Step 5:** Wrap terminal creation with retry (Lines 336-370)
6. **Step 6:** Wrap strategy execution with recovery handler (Lines 386-398)
7. **Step 7:** Add circuit breaker to streaming pipeline (Lines 458-606)
8. **Step 8:** Add error recovery handlers map to constructor
9. **Step 9:** Add metrics tracking for recovery actions

**Estimated LOC: 250-300 lines**

---

## 2. SSH MODULE ANALYSIS

### Current File Structure
```
src/modules/ssh/
├── ssh-command-executor.ts        (284 lines) - Command execution
├── ssh-session-manager.ts         (261 lines) - Session lifecycle
├── ssh-connection-pool-wrapper.ts (159 lines) - Pool adapter
├── ssh-file-transfer-handler.ts   (430 lines) - File operations
├── ssh-prompt-detector.ts         (~100 lines) - Prompt detection
└── index.ts                       (~50 lines) - Exports
```

### 2.1 SSH Command Executor Analysis

**File:** `/root/sandbox/infected/src/modules/ssh/ssh-command-executor.ts`

#### Current Error Handling (Lines 36-154)
```typescript
async executeCommand(
  session: Session,
  command: string,
  timeout: number = DEFAULT_TIMEOUT_MS
): Promise<CommandResult> {
  if (!session.isConnected) {
    throw new Error(`Session ${session.id} is not connected`);
  }

  if (!session.isReady) {
    throw new Error(`Session ${session.id} is busy executing: ${session.lastCommand}`);
  }

  // ... polling loop with timeout
  while (Date.now() - startTime < validTimeout) {
    if (session.outputBuffer.includes(endMarker)) {
      // Check stability
      if (session.outputBuffer === prevBuffer || stableCount > 3) {
        foundEnd = true;
        break;
      }
    }
    await this.sleep(50);
  }

  if (!foundEnd) {
    throw new Error(`Command timeout after ${validTimeout}ms...`);
  }
  
  // ... extract output and exit code
  return { output, exitCode, durationMs, completedNormally: true };
}
```

**Issues:**
- ❌ No error categorization (network vs. session vs. timeout)
- ❌ No circuit breaker for flaky sessions
- ❌ Session state errors not recoverable
- ❌ Timeout is hard (no partial retry)
- ❌ Error types are generic Error, not BaseError

#### Where Recovery Should Integrate

**Integration Point 1: Session Connection Check (Line 41-47)**
```typescript
// BEFORE:
if (!session.isConnected) {
  throw new Error(`Session ${session.id} is not connected`);
}

// AFTER: Check if we should retry connection
const sessionHealthCircuitBreaker = this.getSessionCircuitBreaker(session.id);
try {
  await sessionHealthCircuitBreaker.execute(async () => {
    if (!session.isConnected) {
      throw new SSHError(
        `Session ${session.id} is not connected`,
        { code: SSHErrorCode.DISCONNECTED, retryable: true }
      );
    }
  });
} catch (error) {
  if (error instanceof CircuitBreakerOpenError) {
    // Session is repeatedly failing, mark for reconnection
    this.emit('session:circuit-open', { sessionId: session.id });
    throw new SSHError(...);
  }
  throw error;
}
```

**Lines to Modify:** 41-47 (+20 lines)

**Integration Point 2: Command Execution with Retry (Line 62-102)**
```typescript
// BEFORE: Fixed timeout, no retry
const startTime = Date.now();
let foundEnd = false;
// ... polling with fixed timeout

if (!foundEnd) {
  throw new Error(`Command timeout after ${validTimeout}ms...`);
}

// AFTER: Retry on transient failures
const commandRetry = new RetryStrategy({
  maxAttempts: 2,                    // Retry once for transient failures
  initialDelayMs: 100,
  maxDelayMs: 1000,
  useJitter: true
});

let lastError: Error | undefined;
try {
  return await commandRetry.execute(async () => {
    const startTime = Date.now();
    let foundEnd = false;
    
    // ... polling with timeout
    if (!foundEnd) {
      lastError = new TimeoutError(
        `Command timeout after ${validTimeout}ms`,
        { retryable: true }
      );
      throw lastError;
    }
    
    // ... extract and return
  });
} catch (error) {
  if (error instanceof TimeoutError && error.retryable) {
    // Log timeout but allow retry
  }
  throw error;
}
```

**Lines to Modify:** 62-102 (+35 lines)

**Integration Point 3: Output Parsing with Error Recovery (Line 119-143)**
```typescript
// BEFORE:
const filtered = this.filterCommandOutput(segment, command, ...);
const cleaned = this.cleanOutput(filtered);
const exitMatch = buffer.match(new RegExp(...));
const exitCode = exitMatch ? parseInt(exitMatch[1], 10) : 0;

// AFTER: Categorize exit codes as errors
const filtered = this.filterCommandOutput(segment, command, ...);
const cleaned = this.cleanOutput(filtered);
const exitMatch = buffer.match(new RegExp(...));
const exitCode = exitMatch ? parseInt(exitMatch[1], 10) : 0;

// Categorize exit code as error if needed
if (exitCode !== 0) {
  const errorCategory = this.categorizeExitCode(exitCode);
  if (errorCategory.retryable) {
    throw new SSHError(
      `Command failed with exit code ${exitCode}`,
      { 
        code: errorCategory.code,
        retryable: true,
        context: { exitCode, output: cleaned }
      }
    );
  }
}

return {
  output: cleaned,
  exitCode,
  durationMs,
  completedNormally: true
};
```

**Lines to Modify:** 119-143 (+25 lines)

### 2.2 SSH Session Manager Analysis

**File:** `/root/sandbox/infected/src/modules/ssh/ssh-session-manager.ts`

#### Current Error Handling (Lines 67-189)
```typescript
async createSession(
  sessionId: string,
  target: SSHConnectionTarget,
  options?: { timeout?: number }
): Promise<Session> {
  if (this.sessions.has(sessionId)) {
    throw new Error(`Session ${sessionId} already exists...`);
  }

  const ptyProcess = ptySpawn(shellPath, args, { ... });

  // Set up listeners
  ptyProcess.onExit((e: { exitCode: number; signal?: number }) => {
    session.isConnected = false;
    session.state = 'closed';
    logger.warn(`SSH Session ${sessionId} exited with code=${e.exitCode}`);
    this.emit('session:closed', { sessionId, exitCode: e.exitCode });
  });

  return session;
}

async closeSession(sessionId: string): Promise<void> {
  const session = this.sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  try {
    session.ptyProcess.kill();
    session.isConnected = false;
  } catch (error) {
    logger.error('Error closing SSH session', { ... });
    throw error;
  }
}
```

**Issues:**
- ❌ No retry on session creation failure (network issue)
- ❌ No categorization of exit codes (permission vs. not found vs. timeout)
- ❌ No recovery handler for unexpected disconnections
- ❌ Error types generic Error

#### Where Recovery Should Integrate

**Integration Point 1: Session Creation with Retry (Line 67-149)**
```typescript
// BEFORE: Single attempt
const ptyProcess = ptySpawn(shellPath, args, { ... });

// AFTER: Retry with exponential backoff
const sessionCreationRetry = new RetryStrategy({
  maxAttempts: 3,                    // Network can be flaky
  initialDelayMs: 100,
  maxDelayMs: 2000,
  useJitter: true
});

const ptyProcess = await sessionCreationRetry.execute(async () => {
  return ptySpawn(shellPath, args, { ... });
});
```

**Lines to Modify:** 79 (+10 lines)

**Integration Point 2: Session Exit Handling with Recovery (Line 120-131)**
```typescript
// BEFORE:
ptyProcess.onExit((e: { exitCode: number; signal?: number }) => {
  session.isConnected = false;
  session.state = 'closed';
  logger.warn(`SSH Session ${sessionId} exited...`);
  this.emit('session:closed', { sessionId, exitCode: e.exitCode });
});

// AFTER: Categorize exit code and attempt recovery
ptyProcess.onExit((e: { exitCode: number; signal?: number }) => {
  session.isConnected = false;
  session.state = 'closed';
  
  const exitCategory = this.categorizeSessionExit(e);
  logger.warn(`SSH Session ${sessionId} exited`, {
    exitCode: e.exitCode,
    signal: e.signal,
    recoverable: exitCategory.recoverable
  });
  
  this.emit('session:closed', {
    sessionId,
    exitCode: e.exitCode,
    signal: e.signal,
    recoverable: exitCategory.recoverable,
    suggestedAction: exitCategory.suggestedAction
  });
});
```

**Lines to Modify:** 120-131 (+15 lines)

**Integration Point 3: Session Close with Recovery (Line 163-189)**
```typescript
// BEFORE:
try {
  session.ptyProcess.kill();
  session.isConnected = false;
  session.state = 'closed';
  this.sessions.delete(sessionId);
} catch (error) {
  logger.error('Error closing SSH session', { ... });
  throw error;
}

// AFTER: Graceful close with timeout
try {
  const closeRetry = new RetryStrategy({
    maxAttempts: 2,
    initialDelayMs: 100,
    maxDelayMs: 500
  });
  
  await closeRetry.execute(async () => {
    // Try graceful exit first
    session.ptyProcess.write('exit\n');
    await this.sleep(100);
    
    if (session.isConnected) {
      session.ptyProcess.kill('SIGTERM');
      await this.sleep(500);
    }
    
    if (!session.isConnected) {
      session.ptyProcess.kill('SIGKILL');
    }
  });
  
  session.state = 'closed';
  this.sessions.delete(sessionId);
} catch (error) {
  logger.error('Error closing SSH session', { ... });
  // Force cleanup anyway
  session.state = 'closed';
  this.sessions.delete(sessionId);
}
```

**Lines to Modify:** 163-189 (+30 lines)

### 2.3 SSH Connection Pool Wrapper Analysis

**File:** `/root/sandbox/infected/src/modules/ssh/ssh-connection-pool-wrapper.ts`

#### Current Error Handling (Lines 55-96, 101-117)
```typescript
async getSSHConnection(options: GetSSHConnectionOptions): Promise<SSHConnection> {
  try {
    const pooledConn = await this.pool.getConnection({
      host: options.host,
      port: options.port,
      username: options.username,
      password: options.password,
      privateKey: options.identityFile,
      timeout: options.timeout,
    });

    const sshConn: SSHConnection = { ... };
    this.connectionMap.set(pooledConn.connectionId, sshConn);
    return sshConn;
  } catch (error) {
    logger.error('Failed to get SSH connection from pool', { ... });
    throw error;
  }
}

releaseSSHConnection(connectionId: string): void {
  try {
    this.pool.releaseConnection(connectionId);
    this.connectionMap.delete(connectionId);
  } catch (error) {
    logger.error('Error releasing SSH connection', { ... });
  }
}
```

**Issues:**
- ❌ No retry on connection acquisition
- ❌ Pool exhaustion not handled (no circuit breaker)
- ❌ Connection errors categorized generically
- ❌ No recovery handler for transient network failures

#### Where Recovery Should Integrate

**Integration Point 1: Connection Acquisition with Retry (Line 55-96)**
```typescript
// BEFORE:
const pooledConn = await this.pool.getConnection({
  host: options.host,
  // ...
});

// AFTER:
const connRetry = new RetryStrategy({
  maxAttempts: options.timeoutMs ? 3 : 2,  // Longer timeout = more attempts
  initialDelayMs: 100,
  maxDelayMs: 3000,
  useJitter: true
});

const pooledConn = await connRetry.execute(() =>
  this.pool.getConnection({
    host: options.host,
    // ...
  })
);
```

**Lines to Modify:** 55-96 (+15 lines)

**Integration Point 2: Pool Exhaustion Handling with Circuit Breaker (New)**
```typescript
// NEW: Add circuit breaker for per-host connection attempts
private hostCircuitBreakers = new Map<string, CircuitBreaker>();

async getSSHConnection(options: GetSSHConnectionOptions): Promise<SSHConnection> {
  const hostKey = `${options.host}:${options.port}`;
  const breaker = this.getOrCreateCircuitBreaker(hostKey);
  
  try {
    const connRetry = new RetryStrategy({ ... });
    
    const pooledConn = await breaker.execute(() =>
      connRetry.execute(() =>
        this.pool.getConnection({ ... })
      )
    );
    
    // ... rest
  } catch (error) {
    if (error instanceof CircuitBreakerOpenError) {
      logger.warn(`Host ${hostKey} circuit open, not accepting new connections`);
    }
    throw error;
  }
}

private getOrCreateCircuitBreaker(hostKey: string): CircuitBreaker {
  if (!this.hostCircuitBreakers.has(hostKey)) {
    this.hostCircuitBreakers.set(hostKey, new CircuitBreaker({
      failureThreshold: 3,      // Fail after 3 connection errors
      timeout: 30000,           // Try recovery after 30s
      successThreshold: 1
    }));
  }
  return this.hostCircuitBreakers.get(hostKey)!;
}
```

**Lines to Modify:** 55-96, add new property and method (+40 lines)

**Integration Point 3: Shutdown with Graceful Closing (Line 143-158)**
```typescript
// BEFORE:
async shutdown(): Promise<void> {
  try {
    this.connectionMap.clear();
    await this.pool.shutdown();
  } catch (error) {
    logger.error('Error shutting down...', { ... });
    throw error;
  }
}

// AFTER: Give connections time to clean up
async shutdown(): Promise<void> {
  try {
    // Give brief delay for in-flight requests
    await this.sleep(100);
    
    // Close all tracked connections gracefully
    for (const connId of Array.from(this.connectionMap.keys())) {
      try {
        this.releaseSSHConnection(connId);
      } catch (error) {
        logger.warn(`Failed to release connection ${connId}`, { ... });
      }
    }
    
    this.connectionMap.clear();
    this.hostCircuitBreakers.forEach(cb => cb.reset());
    
    await this.pool.shutdown();
  } catch (error) {
    logger.error('Error shutting down...', { ... });
    throw error;
  }
}

private sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

**Lines to Modify:** 143-158 (+25 lines)

### 2.4 SSH File Transfer Handler Analysis

**File:** `/root/sandbox/infected/src/modules/ssh/ssh-file-transfer-handler.ts`

#### Current Error Handling (Lines 49-100, 249-327)
```typescript
async uploadFile(
  session: Session,
  localPath: string,
  remotePath: string,
  timeout: number = FILE_TRANSFER_TIMEOUT
): Promise<TransferResult> {
  if (!session.target) {
    throw new Error('No SSH target configured for this session');
  }

  if (!session.isReady) {
    throw new Error(`Session ${session.id} is busy executing...`);
  }

  try {
    const stats = await fsPromises.stat(localPath);

    if (!stats.isFile()) {
      throw new Error('Upload source must be a regular file.');
    }

    if (stats.size > MAX_FILE_SIZE) {
      throw new Error(`File size...exceeds the 10MB limit.`);
    }

    // ... SCP upload with no retry
    const result = await this.commandExecutor.executeCommand(
      session,
      `scp ${options} ${escapedLocal} '${target.user}@${target.host}:${escapedRemote}'`,
      timeout
    );
  } catch (error) {
    logger.error('File upload failed', { ... });
    throw error;
  }
}
```

**Issues:**
- ❌ File size validation prevents large file handling
- ❌ SCP command not retried on transient failure
- ❌ No circuit breaker for file transfer operations
- ❌ Partial upload not resumed
- ❌ Permission errors not distinguished from network errors

#### Where Recovery Should Integrate

**Integration Point 1: File Upload with Retry (Line 49-195)**
```typescript
// BEFORE:
const result = await this.commandExecutor.executeCommand(
  session,
  `scp ... `,
  timeout
);

// AFTER:
const fileTransferRetry = new RetryStrategy({
  maxAttempts: 2,                    // Large files shouldn't retry too much
  initialDelayMs: 500,               // Longer delay for file operations
  maxDelayMs: 5000,
  useJitter: true
});

const result = await fileTransferRetry.execute(async () => {
  return this.commandExecutor.executeCommand(
    session,
    `scp ... `,
    timeout
  );
});
```

**Lines to Modify:** 49-195 (+15 lines)

**Integration Point 2: Download with Retry and Circuit Breaker (Line 200-327)**
```typescript
// BEFORE: Direct command execution
const result = await this.commandExecutor.executeCommand(
  session,
  `scp '${target.user}@${target.host}:${escapedRemote}' ${escapedLocal}`,
  timeout
);

// AFTER:
const downloadCircuitBreaker = new CircuitBreaker({
  failureThreshold: 3,
  timeout: 60000,
  windowSize: 120000
});

const downloadRetry = new RetryStrategy({
  maxAttempts: 2,
  initialDelayMs: 500,
  maxDelayMs: 5000,
  useJitter: true
});

const result = await downloadCircuitBreaker.execute(() =>
  downloadRetry.execute(() =>
    this.commandExecutor.executeCommand(
      session,
      `scp '${target.user}@${target.host}:${escapedRemote}' ${escapedLocal}`,
      timeout
    )
  )
);
```

**Lines to Modify:** 200-327 (+20 lines)

**Integration Point 3: Error Categorization (Add new method)**
```typescript
// NEW: Categorize file transfer errors
private categorizeFileTransferError(error: Error): {
  retryable: boolean;
  category: 'permission' | 'network' | 'size' | 'timeout' | 'unknown';
} {
  const msg = error.message.toLowerCase();
  
  if (msg.includes('permission') || msg.includes('denied')) {
    return { retryable: false, category: 'permission' };
  }
  if (msg.includes('no such file') || msg.includes('not found')) {
    return { retryable: false, category: 'permission' };  // Actually permission
  }
  if (msg.includes('timeout')) {
    return { retryable: true, category: 'timeout' };
  }
  if (msg.includes('connection') || msg.includes('reset')) {
    return { retryable: true, category: 'network' };
  }
  if (msg.includes('too large') || msg.includes('quota')) {
    return { retryable: false, category: 'size' };
  }
  
  return { retryable: true, category: 'unknown' };
}
```

**New Lines:** +20

### 2.5 SSH Module Integration Summary

| File | Integration Points | Strategy | LOC |
|------|-------------------|----------|-----|
| ssh-command-executor.ts | Session health, command retry, exit code categorization | CircuitBreaker + Retry | 80 |
| ssh-session-manager.ts | Session creation, exit handling, graceful close | Retry + Error categorization | 55 |
| ssh-connection-pool-wrapper.ts | Connection acquisition, host circuit breaker, shutdown | Retry + CircuitBreaker | 80 |
| ssh-file-transfer-handler.ts | Upload retry, download circuit breaker, error categorization | Retry + CircuitBreaker | 55 |
| **Total** | | | **270** |

**Estimated SSH Module LOC: 300-350 lines**

---

## 3. RESOURCE LIMITER ANALYSIS

### Current File Location
`/root/sandbox/infected/src/core/resource-limiter.ts` (484 lines)

### Current Error Handling Approach

#### 3.1 Current Error Classes (Lines 8-21)
```typescript
export class LimitExceededError extends Error {
  constructor(
    public limitType: 'memory' | 'cpu' | 'fileHandles' | 'connections',
    public current: number,
    public limit: number,
    public processId?: number
  ) {
    // ...
  }
}
```

**Issue:** Throws errors but doesn't use BaseError/error taxonomy

#### 3.2 Enforcement Methods (Lines 183-283)
```typescript
checkMemoryLimit(currentUsageMB: number, totalAvailableMB: number): void {
  if (!this.memoryLimitMB || currentUsageMB <= this.memoryLimitMB) {
    return;
  }

  const info = {
    limitType: 'memory' as const,
    current: currentUsageMB,
    limit: this.memoryLimitMB,
    totalAvailable: totalAvailableMB,
    timestamp: Date.now(),
  };

  this.emit('limit-exceeded', info);
  logger.warn(`Memory limit exceeded...`);

  if (this.enableEnforcement) {
    this._enforceMemoryLimit(currentUsageMB);
  }
}
```

**Issue:** Events emitted but no recovery handlers invoked

#### 3.3 Enforcement Actions (Lines 288-366)
```typescript
private _enforceMemoryLimit(currentUsageMB: number): void {
  const sorted = Array.from(this.monitoredProcesses.entries())
    .sort(([, timeA], [, timeB]) => timeA - timeB);

  if (sorted.length === 0) {
    logger.warn('Memory limit exceeded but no processes to terminate', ...);
    return;
  }

  const [oldestPid] = sorted[0];
  const action = this._terminateProcess(oldestPid, `Memory limit exceeded...`);
  this.emit('action-taken', action);
}

private _enforceCPULimit(currentUsagePercent: number, processId?: number): void {
  const action: EnforcementAction = {
    timestamp: Date.now(),
    limitType: 'cpu',
    action: 'warning-issued',
    target: processId,
    reason: `CPU usage...`,
    details: { currentUsage: currentUsagePercent, limit: this.cpuLimitPercent },
  };

  this._recordAction(action);
  this.emit('action-taken', action);
  // Only warning for CPU
}

private _terminateProcess(pid: number, reason: string): EnforcementAction {
  // ...
  try {
    process.kill(pid, 'SIGTERM');
    
    const forceKillTimeout = setTimeout(() => {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) { /* */ }
    }, this.gracefulShutdownTimeoutMs);
  } catch (error) { /* */ }
  
  this.unregisterProcess(pid);
  return action;
}
```

**Issues:**
- ❌ Memory enforcement kills oldest process (no mercy killing in order of criticality)
- ❌ CPU enforcement only warns (no throttling)
- ❌ No circuit breaker to prevent cascade enforcement actions
- ❌ No recovery handlers called
- ❌ Hard enforcement (kill) vs. soft (pause/throttle)

### WHERE RECOVERY STRATEGIES SHOULD BE INTEGRATED

#### Integration Point 1: Limit Checks with Recovery Handlers (Lines 183-283)
**Strategy:** Recovery handlers for each limit type
**Pattern:**
```typescript
// BEFORE:
checkMemoryLimit(currentUsageMB: number, totalAvailableMB: number): void {
  if (!this.memoryLimitMB || currentUsageMB <= this.memoryLimitMB) {
    return;
  }

  const info = { limitType: 'memory' as const, ... };
  this.emit('limit-exceeded', info);

  if (this.enableEnforcement) {
    this._enforceMemoryLimit(currentUsageMB);
  }
}

// AFTER: Recovery handlers
checkMemoryLimit(currentUsageMB: number, totalAvailableMB: number): void {
  if (!this.memoryLimitMB || currentUsageMB <= this.memoryLimitMB) {
    return;
  }

  const info = { limitType: 'memory' as const, ... };
  this.emit('limit-exceeded', info);

  if (this.enableEnforcement) {
    // Invoke recovery handler before enforcement
    this.invokeRecoveryHandler('MEMORY_LIMIT_EXCEEDED', {
      current: currentUsageMB,
      limit: this.memoryLimitMB,
      totalAvailable: totalAvailableMB,
    }).then(() => {
      // Check again after recovery attempt
      const updatedUsage = this.getCurrentMemoryUsage();
      if (updatedUsage > this.memoryLimitMB) {
        this._enforceMemoryLimit(updatedUsage);
      }
    }).catch(error => {
      logger.error('Recovery handler failed, proceeding with enforcement', error);
      this._enforceMemoryLimit(currentUsageMB);
    });
  }
}
```

**Lines to Modify:** 183-283 (+30 lines)
**New Methods:** invokeRecoveryHandler (10 lines)

#### Integration Point 2: Enforcement Circuit Breaker (Line 288-302)
**Strategy:** Circuit breaker to prevent excessive enforcement
**Pattern:**
```typescript
// NEW: Add property
private enforcementCircuitBreaker = new CircuitBreaker({
  failureThreshold: 3,      // After 3 enforcement actions, open circuit
  timeout: 30000,           // Try again after 30s
  successThreshold: 2
});

// BEFORE:
private _enforceMemoryLimit(currentUsageMB: number): void {
  const sorted = Array.from(this.monitoredProcesses.entries())
    .sort(([, timeA], [, timeB]) => timeA - timeB);

  if (sorted.length === 0) {
    return;
  }

  const [oldestPid] = sorted[0];
  const action = this._terminateProcess(oldestPid, `Memory limit exceeded...`);
  this.emit('action-taken', action);
}

// AFTER:
private async _enforceMemoryLimit(currentUsageMB: number): Promise<void> {
  try {
    await this.enforcementCircuitBreaker.execute(async () => {
      const sorted = Array.from(this.monitoredProcesses.entries())
        .sort(([, timeA], [, timeB]) => timeA - timeB);

      if (sorted.length === 0) {
        logger.warn('Memory limit exceeded but no processes to terminate');
        return;
      }

      const [oldestPid] = sorted[0];
      const action = this._terminateProcess(oldestPid, `Memory limit exceeded...`);
      this.emit('action-taken', action);
    });
  } catch (error) {
    if (error instanceof CircuitBreakerOpenError) {
      logger.error('Enforcement circuit open - too many enforcement actions', error);
      this.emit('enforcement-circuit-open', { reason: 'excessive-enforcement' });
    } else {
      throw error;
    }
  }
}
```

**Lines to Modify:** 288-302 (+25 lines)

#### Integration Point 3: Process Termination Recovery (Line 371-418)
**Strategy:** Categorize termination and attempt graceful cleanup
**Pattern:**
```typescript
// BEFORE:
private _terminateProcess(pid: number, reason: string): EnforcementAction {
  const action: EnforcementAction = { ... };
  logger.info(`Terminating process ${pid}: ${reason}`, ...);

  try {
    process.kill(pid, 'SIGTERM');

    const forceKillTimeout = setTimeout(() => {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) { }
    }, this.gracefulShutdownTimeoutMs);

    const checkExitInterval = setInterval(() => {
      try {
        process.kill(pid, 0);
      } catch (error) {
        clearInterval(checkExitInterval);
        clearTimeout(forceKillTimeout);
      }
    }, 100);
  } catch (error) {
    logger.debug(`Could not terminate process ${pid}...`);
  }

  this._recordAction(action);
  this.unregisterProcess(pid);
  return action;
}

// AFTER: Recovery handlers for graceful shutdown
private async _terminateProcess(pid: number, reason: string): Promise<EnforcementAction> {
  const action: EnforcementAction = { ... };
  logger.info(`Terminating process ${pid}: ${reason}`, ...);

  try {
    // Invoke recovery handler for graceful shutdown
    await this.invokeRecoveryHandler('PROCESS_TERMINATION', { pid, reason });
    
    // Give process time to clean up
    await this.sleep(100);
  } catch (error) {
    logger.warn(`Recovery handler for process ${pid} failed, forcing termination`, error);
  }

  try {
    process.kill(pid, 'SIGTERM');

    const forceKillTimeout = setTimeout(() => {
      try {
        process.kill(pid, 'SIGKILL');
        logger.info(`Force killed process ${pid}`, ...);
      } catch (error) {
        logger.debug(`Could not force kill process ${pid}...`);
      }
    }, this.gracefulShutdownTimeoutMs);

    const checkExitInterval = setInterval(() => {
      try {
        process.kill(pid, 0);
      } catch (error) {
        clearInterval(checkExitInterval);
        clearTimeout(forceKillTimeout);
      }
    }, 100);
  } catch (error) {
    logger.debug(`Could not terminate process ${pid}...`);
  }

  this._recordAction(action);
  this.unregisterProcess(pid);
  return action;
}
```

**Lines to Modify:** 371-418 (+20 lines)

#### Integration Point 4: Limit Configuration Validation (Lines 92-162)
**Strategy:** Add timeout enforcement when limits are set
**Pattern:**
```typescript
// BEFORE:
setMemoryLimit(limitMB: number): void {
  if (limitMB <= 0) {
    throw new Error('Memory limit must be greater than 0');
  }
  this.memoryLimitMB = limitMB;
  logger.info(`Memory limit set to ${limitMB}MB`, ...);
}

// AFTER:
setMemoryLimit(limitMB: number, options?: { timeoutMs?: number }): void {
  if (limitMB <= 0) {
    throw new Error('Memory limit must be greater than 0');
  }
  
  this.memoryLimitMB = limitMB;
  
  // Optional: Set timeout for enforcement grace period
  if (options?.timeoutMs) {
    this.memoryEnforcementGracePeriodMs = options.timeoutMs;
  }
  
  logger.info(`Memory limit set to ${limitMB}MB`, ...);
  this.emit('limit-configured', { limitType: 'memory', value: limitMB });
}
```

**Lines to Modify:** 92-162 (+10 lines)

### 3.4 Implementation Order for ResourceLimiter

1. **Step 1:** Add RecoveryHandler, CircuitBreaker imports
2. **Step 2:** Add recovery handler registry to constructor
3. **Step 3:** Register default recovery handlers for MEMORY and CPU limits
4. **Step 4:** Modify limit checks to invoke recovery handlers (Lines 183-283)
5. **Step 5:** Add enforcement circuit breaker (new property)
6. **Step 6:** Wrap enforcement actions with circuit breaker
7. **Step 7:** Add recovery handler invocation to process termination
8. **Step 8:** Add timeout enforcement configuration

**Estimated LOC: 100-150 lines**

---

## 4. RESOURCE MONITOR ANALYSIS

### Current File Location
`/root/sandbox/infected/src/core/resource-monitor.ts` (446 lines)

### Current Error Handling Approach

#### 4.1 Current Monitoring Implementation (Lines 127-151)
```typescript
startMonitoring(intervalMs?: number): void {
  if (this.isMonitoring) {
    logger.warn('ResourceMonitor is already running', ...);
    return;
  }

  const interval = intervalMs || this.monitoringIntervalMs;
  this.isMonitoring = true;

  this.previousSystemCpuUsage = process.cpuUsage();
  this.previousSystemCpuUpdateTime = Date.now();

  logger.info(`ResourceMonitor started with ${interval}ms interval`, ...);

  this.monitoringInterval = setInterval(() => {
    try {
      this._updateMetrics();
    } catch (error) {
      logger.error(`Error during resource monitoring: ${error...}`, {
        component: 'ResourceMonitor',
      });
    }
  }, interval);
}
```

**Issue:** Errors in monitoring loop are logged but not recoverable

#### 4.2 Metrics Update with Threshold Checking (Lines 356-421)
```typescript
private async _updateMetrics(): Promise<void> {
  const systemMetrics = this._calculateSystemMetrics();

  if (systemMetrics.memoryPercent > this.memoryThresholdPercent) {
    this.emit('memory-threshold', {
      current: systemMetrics.memoryPercent,
      threshold: this.memoryThresholdPercent,
      metrics: systemMetrics,
    });
    logger.warn(`Memory threshold exceeded...`, ...);
  }

  for (const [pid, tracking] of this.processMetrics) {
    try {
      tracking.fileHandles = await this.getFileDescriptorCount(pid);
      tracking.childProcessCount = this.getChildProcessCount(pid);
      tracking.timestamp = Date.now();

      const processMetrics = this._calculateProcessMetrics(tracking);

      if (processMetrics.cpuUsagePercent > this.cpuThresholdPercent) {
        this.emit('cpu-threshold', {
          pid,
          current: processMetrics.cpuUsagePercent,
          threshold: this.cpuThresholdPercent,
          metrics: processMetrics,
        });
      }

      if (fileHandlePercent > this.fileHandleThresholdPercent) {
        this.emit('file-handles-threshold', { ... });
      }
    } catch (error) {
      logger.debug(`Error updating metrics for process ${pid}...`, ...);
    }
  }
}
```

**Issues:**
- ❌ Events emitted but no recovery handlers
- ❌ Process exceptions caught silently
- ❌ No circuit breaker for problematic processes
- ❌ No categorization of threshold severity

### WHERE RECOVERY STRATEGIES SHOULD BE INTEGRATED

#### Integration Point 1: Monitoring Loop with Circuit Breaker (Line 143-151)
**Strategy:** Circuit breaker to prevent cascading monitoring errors
**Pattern:**
```typescript
// NEW: Add property
private monitoringCircuitBreaker = new CircuitBreaker({
  failureThreshold: 3,      // Fail after 3 monitoring errors
  timeout: 30000,           // Try recovery after 30s
  successThreshold: 2
});

// BEFORE:
this.monitoringInterval = setInterval(() => {
  try {
    this._updateMetrics();
  } catch (error) {
    logger.error(`Error during resource monitoring...`, ...);
  }
}, interval);

// AFTER:
this.monitoringInterval = setInterval(() => {
  this.monitoringCircuitBreaker.execute(async () => {
    try {
      await this._updateMetrics();
    } catch (error) {
      logger.error(`Error during resource monitoring...`, ...);
      throw error;  // Let circuit breaker track failures
    }
  }).catch(error => {
    if (error instanceof CircuitBreakerOpenError) {
      logger.error('Monitoring circuit open - excessive errors', error);
      this.emit('monitoring-circuit-open', { reason: 'excessive-errors' });
      // Could pause monitoring here and alert operations
    }
  });
}, interval);
```

**Lines to Modify:** 143-151 (+30 lines)

#### Integration Point 2: Threshold Events with Recovery Handlers (Line 361-370)
**Strategy:** Invoke recovery handlers when thresholds exceeded
**Pattern:**
```typescript
// BEFORE:
if (systemMetrics.memoryPercent > this.memoryThresholdPercent) {
  this.emit('memory-threshold', { ... });
  logger.warn(`Memory threshold exceeded...`, ...);
}

// AFTER:
if (systemMetrics.memoryPercent > this.memoryThresholdPercent) {
  this.emit('memory-threshold', { ... });
  logger.warn(`Memory threshold exceeded...`, ...);
  
  // Invoke recovery handler if registered
  try {
    await this.invokeRecoveryHandler('MEMORY_THRESHOLD_EXCEEDED', {
      current: systemMetrics.memoryPercent,
      threshold: this.memoryThresholdPercent,
      totalMemory: systemMetrics.totalMemory,
      usedMemory: systemMetrics.usedMemory,
    });
  } catch (error) {
    logger.warn('Recovery handler for memory threshold failed', error);
  }
}
```

**Lines to Modify:** 361-370 (+15 lines)

#### Integration Point 3: Process-Level Threshold with Circuit Breaker (Line 373-419)
**Strategy:** Circuit breaker per process to prevent flapping
**Pattern:**
```typescript
// NEW: Track circuit breakers per process
private processCircuitBreakers = new Map<number, CircuitBreaker>();

for (const [pid, tracking] of this.processMetrics) {
  try {
    tracking.fileHandles = await this.getFileDescriptorCount(pid);
    tracking.childProcessCount = this.getChildProcessCount(pid);
    tracking.timestamp = Date.now();

    const processMetrics = this._calculateProcessMetrics(tracking);
    const pidBreaker = this.getOrCreateProcessCircuitBreaker(pid);

    if (processMetrics.cpuUsagePercent > this.cpuThresholdPercent) {
      try {
        await pidBreaker.execute(async () => {
          this.emit('cpu-threshold', { ... });
          
          // Invoke recovery handler
          await this.invokeRecoveryHandler('CPU_THRESHOLD_EXCEEDED', {
            pid,
            current: processMetrics.cpuUsagePercent,
            threshold: this.cpuThresholdPercent,
          });
        });
      } catch (error) {
        if (error instanceof CircuitBreakerOpenError) {
          logger.warn(`Process ${pid} CPU threshold circuit open`, error);
          // Process is continuously over-using CPU, alert operations
        } else {
          throw error;
        }
      }
    }
  } catch (error) {
    logger.debug(`Error updating metrics for process ${pid}...`, ...);
    // Remove circuit breaker for dead process
    this.processCircuitBreakers.delete(pid);
  }
}

private getOrCreateProcessCircuitBreaker(pid: number): CircuitBreaker {
  if (!this.processCircuitBreakers.has(pid)) {
    this.processCircuitBreakers.set(pid, new CircuitBreaker({
      failureThreshold: 2,
      timeout: 60000,
      successThreshold: 1
    }));
  }
  return this.processCircuitBreakers.get(pid)!;
}
```

**Lines to Modify:** 373-419 (+50 lines)

#### Integration Point 4: Recovery Handler Registration (New)
**Strategy:** Allow dynamic registration of recovery handlers
**Pattern:**
```typescript
// NEW: Add recovery handlers support
private recoveryHandlers = new Map<string, (context: any) => Promise<void>>();

registerRecoveryHandler(
  thresholdType: 'MEMORY' | 'CPU' | 'FILE_HANDLES',
  handler: (context: any) => Promise<void>
): void {
  this.recoveryHandlers.set(thresholdType, handler);
  logger.debug(`Recovery handler registered for ${thresholdType}`, ...);
}

private async invokeRecoveryHandler(
  thresholdType: string,
  context: Record<string, unknown>
): Promise<void> {
  const handler = this.recoveryHandlers.get(thresholdType);
  if (!handler) {
    return;
  }

  try {
    await handler(context);
    logger.debug(`Recovery handler for ${thresholdType} succeeded`, ...);
  } catch (error) {
    logger.warn(`Recovery handler for ${thresholdType} failed`, error);
    throw error;
  }
}
```

**New Lines:** +30

### 4.3 Implementation Order for ResourceMonitor

1. **Step 1:** Add CircuitBreaker import
2. **Step 2:** Add monitoringCircuitBreaker property
3. **Step 3:** Add recovery handler registry
4. **Step 4:** Add circuit breaker to monitoring loop
5. **Step 5:** Modify threshold checks to invoke recovery handlers
6. **Step 6:** Add per-process circuit breaker map
7. **Step 7:** Wrap process-level threshold checks with circuit breaker
8. **Step 8:** Add recovery handler registry methods

**Estimated LOC: 50-100 lines**

---

## 5. INTEGRATION DEPENDENCIES & ORDER

### Dependency Graph

```
┌─────────────────────────────────────┐
│   Error System (Already Complete)   │
│ - ErrorTaxonomy                     │
│ - ErrorCategories                   │
└─────────────────┬───────────────────┘
                  │
        ┌─────────┴──────────┐
        │                    │
┌───────▼──────────┐  ┌──────▼──────────┐
│  Recovery System │  │ ProcessManager  │
│ - RetryStrategy  │  │ - Use recovery  │
│ - CircuitBreaker │  │ - Use CB for    │
│ - RecoveryHandler│  │   limits/stream │
└──────────────────┘  └──────┬──────────┘
        ▲                     │
        │                     │
        └──────┬──────────────┘
               │
     ┌─────────▼──────────┐
     │   SSH Module       │
     │ - Use recovery     │
     │ - Add CB per host  │
     │ - Retry transfers  │
     └─────────┬──────────┘
               │
     ┌─────────▼──────────────┐
     │  ResourceLimiter       │
     │ - Use recovery         │
     │ - Enforcement CB       │
     │ - Process termination  │
     └─────────┬──────────────┘
               │
     ┌─────────▼──────────────┐
     │  ResourceMonitor       │
     │ - Monitoring CB        │
     │ - Threshold recovery   │
     │ - Per-process CB       │
     └────────────────────────┘
```

### Implementation Sequence

**Phase 1: Foundation (Already Done)**
- ✅ Error Taxonomy System
- ✅ Recovery Strategies (Retry, CircuitBreaker, RecoveryHandler)

**Phase 2.3: Integration (This Analysis)**

1. **Day 1: ProcessManager (Highest Impact)**
   - Add recovery imports
   - Integrate RecoveryHandler for strategy execution
   - Add CircuitBreaker for concurrent limits
   - Add RetryStrategy for file I/O
   - Time: 2-3 hours

2. **Day 1-2: SSH Module (Most Error-Prone)**
   - ssh-command-executor: Add session circuit breaker + command retry
   - ssh-session-manager: Add session creation retry + exit categorization
   - Time: 3-4 hours

3. **Day 2: SSH Connection Wrapper + File Transfer**
   - Add per-host circuit breakers
   - Add file transfer retry/circuit breaker
   - Time: 2 hours

4. **Day 2-3: ResourceLimiter**
   - Add recovery handler invocation
   - Add enforcement circuit breaker
   - Add process termination recovery
   - Time: 1-2 hours

5. **Day 3: ResourceMonitor**
   - Add monitoring circuit breaker
   - Add threshold recovery handlers
   - Add per-process circuit breakers
   - Time: 1-2 hours

**Total Implementation Time: 10-14 hours (2 developer days)**

---

## 6. RECOVERY PATTERNS & WHICH TO USE

### Pattern Selection Matrix

| Component | Error Type | Pattern | Config |
|-----------|-----------|---------|--------|
| **ProcessManager** | | | |
| - Concurrent limits | Transient resource | CircuitBreaker | 5 failures, 60s timeout |
| - File I/O | Transient I/O | RetryStrategy | 3 attempts, 50-1000ms |
| - Terminal creation | Transient process | RetryStrategy | 2 attempts, 200-2000ms |
| - Command execution | Variable | RecoveryHandler | Mode-specific retry |
| - Stream pipeline | Cascading failures | CircuitBreaker | 3 failures, 30s timeout |
| **SSH Module** | | | |
| - Command executor | Session state | CircuitBreaker | Per-session, 30s timeout |
| - Command timeout | Network | RetryStrategy | 2 attempts, 100-1000ms |
| - Session creation | Network | RetryStrategy | 3 attempts, 100-2000ms |
| - Session exit | Protocol | Categorization | No retry (non-retryable) |
| - Connection pool | Host unavailable | CircuitBreaker | Per-host, 30s timeout |
| - File transfer | Network | Retry + CB | 2 retries, 500-5000ms |
| **ResourceLimiter** | | | |
| - Memory enforcement | System state | CircuitBreaker | 3 actions, 30s timeout |
| - CPU enforcement | System state | Warning only | No retry |
| - Process termination | Availability | Recovery handler | Grace period 5-10s |
| **ResourceMonitor** | | | |
| - Monitoring loop | Transient errors | CircuitBreaker | 3 errors, 30s timeout |
| - Threshold alerts | System state | Recovery handler | Custom per threshold |
| - Per-process tracking | Process gone | Silent failure | No retry |

### Retry Pattern Presets

```typescript
// Conservative: Few retries, long delays
const conservativeRetry: RetryConfig = {
  maxAttempts: 2,
  initialDelayMs: 500,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  useJitter: false
};

// Moderate: Balanced (DEFAULT)
const moderateRetry: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  useJitter: true
};

// Aggressive: Many retries, short delays (for transient I/O)
const aggressiveRetry: RetryConfig = {
  maxAttempts: 5,
  initialDelayMs: 50,
  maxDelayMs: 5000,
  backoffMultiplier: 1.5,
  useJitter: true
};
```

### Circuit Breaker Configurations

```typescript
// Defensive: Open quickly to prevent cascade
const defensiveCircuitBreaker: CircuitBreakerConfig = {
  failureThreshold: 3,
  successThreshold: 1,
  timeout: 30000,
  windowSize: 60000
};

// Balanced: Standard configuration
const balancedCircuitBreaker: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 60000,
  windowSize: 60000
};

// Lenient: Take more failures before opening
const lenientCircuitBreaker: CircuitBreakerConfig = {
  failureThreshold: 10,
  successThreshold: 3,
  timeout: 120000,
  windowSize: 120000
};
```

---

## 7. SPECIFIC LINE-BY-LINE MODIFICATIONS

### ProcessManager Modifications Summary

| Line(s) | Original | Modification | Type | LOC |
|---------|----------|--------------|------|-----|
| 1-40 | Imports | Add recovery imports | Import | +5 |
| 113 | Constructor | Add recovery handler registry | Property | +10 |
| 250-257 | Concurrent check | Wrap with CircuitBreaker | Logic | +20 |
| 291-309 | File read | Wrap with RetryStrategy | Logic | +15 |
| 336-370 | Terminal creation | Wrap with RetryStrategy | Logic | +15 |
| 386-398 | Strategy execution | Use RecoveryHandler | Logic | +40 |
| 458-606 | Stream execution | Add circuit breaker | Logic | +50 |

### SSH Module Modifications Summary (Per File)

**ssh-command-executor.ts**
- Lines 41-47: Session health check → CircuitBreaker (+20)
- Lines 62-102: Command polling → RetryStrategy (+35)
- Lines 119-143: Exit code handling → Error categorization (+25)

**ssh-session-manager.ts**
- Lines 79: Session creation → RetryStrategy (+10)
- Lines 120-131: Exit handling → Recovery categorization (+15)
- Lines 163-189: Session close → Graceful close with retry (+30)

**ssh-connection-pool-wrapper.ts**
- Lines 55-96: Connection acquisition → RetryStrategy (+15)
- Property: Host circuit breakers map (+5)
- Lines 143-158: Shutdown → Graceful cleanup (+25)

**ssh-file-transfer-handler.ts**
- Lines 49-195: Upload → RetryStrategy (+15)
- Lines 200-327: Download → CircuitBreaker + Retry (+20)
- New method: Error categorization (+20)

### ResourceLimiter Modifications Summary

| Line(s) | Modification | LOC |
|---------|--------------|-----|
| 1-10 | Add recovery imports | +5 |
| Constructor | Add recovery handler registry | +10 |
| 183-283 | Wrap limit checks with recovery | +30 |
| 288-302 | Enforcement with CircuitBreaker | +25 |
| 371-418 | Termination with recovery handler | +20 |
| 92-162 | Timeout configuration | +10 |

### ResourceMonitor Modifications Summary

| Line(s) | Modification | LOC |
|---------|--------------|-----|
| 1-5 | Add CircuitBreaker import | +2 |
| Property | Add circuit breakers | +15 |
| 143-151 | Monitoring loop with CB | +30 |
| 361-370 | Memory threshold recovery | +15 |
| 373-419 | Process threshold with CB | +50 |
| New | Recovery handler registry | +30 |

---

## 8. ESTIMATED LOC CHANGES SUMMARY

```
ProcessManager:           250-300 lines
  Imports:                    5 lines
  Constructor changes:       15 lines
  Concurrent limit:          20 lines
  File I/O:                  15 lines
  Terminal creation:         15 lines
  Strategy execution:        40 lines
  Stream pipeline:           50 lines
  Error categorization:      25 lines
  Misc/cleanup:              15 lines

SSH Module:               300-350 lines
  ssh-command-executor:   80 lines
  ssh-session-manager:    55 lines
  ssh-connection-wrapper: 80 lines
  ssh-file-transfer:      55 lines

ResourceLimiter:          100-150 lines
  Imports & init:         15 lines
  Limit checks:           30 lines
  Enforcement CB:         25 lines
  Termination recovery:   20 lines
  Config validation:      10 lines
  Misc:                   20 lines

ResourceMonitor:          50-100 lines
  Imports & init:         17 lines
  Monitoring CB:          30 lines
  Threshold recovery:     15 lines
  Process CB:             50 lines
  Handler registry:       30 lines

TOTAL:                    700-900 lines
With spacing/comments:    800-1000 lines
```

---

## 9. IMPLEMENTATION CHECKLIST

### Phase 2.3 Implementation Tasks

#### ProcessManager Tasks
- [ ] Add recovery strategy imports
- [ ] Create recovery handler instances map in constructor
- [ ] Register default recovery handlers for ProcessManager
- [ ] Wrap concurrent process limit check with CircuitBreaker
- [ ] Wrap file I/O operations with RetryStrategy
- [ ] Wrap terminal creation with RetryStrategy
- [ ] Replace strategy execution with RecoveryHandler
- [ ] Add circuit breaker to streaming pipeline
- [ ] Add error categorization for process exit codes
- [ ] Add metrics tracking for recovery attempts
- [ ] Test recovery patterns under resource pressure
- [ ] Document recovery behavior in JSDoc

#### SSH Module Tasks
- [ ] Add recovery strategy imports to all SSH modules
- [ ] Create session-level circuit breaker registry
- [ ] Create host-level circuit breaker registry
- [ ] Add command execution with retry for transient failures
- [ ] Add session creation retry with exponential backoff
- [ ] Add session exit code categorization
- [ ] Modify session close for graceful shutdown with retry
- [ ] Add connection acquisition with retry
- [ ] Add file transfer operations with retry + circuit breaker
- [ ] Add error categorization for SSH-specific errors
- [ ] Add event emission for circuit breaker transitions
- [ ] Test connection pool under cascading failures
- [ ] Document SSH error recovery in module docs

#### ResourceLimiter Tasks
- [ ] Add recovery handler support
- [ ] Create recovery handler registry
- [ ] Add memory limit check with recovery handler
- [ ] Add CPU limit check with recovery handler
- [ ] Add enforcement circuit breaker
- [ ] Wrap memory enforcement with circuit breaker
- [ ] Add process termination with recovery handler
- [ ] Add timeout configuration for enforcement grace period
- [ ] Add event emission for enforcement circuit breaker
- [ ] Test enforcement under repeated limit violations
- [ ] Document enforcement recovery behavior

#### ResourceMonitor Tasks
- [ ] Add circuit breaker support
- [ ] Create monitoring circuit breaker
- [ ] Create per-process circuit breaker map
- [ ] Add monitoring loop with circuit breaker
- [ ] Add recovery handler registry
- [ ] Add threshold checks with recovery handler invocation
- [ ] Add per-process circuit breaker tracking
- [ ] Test monitoring under errors and cascading failures
- [ ] Document monitoring recovery behavior

#### Testing Tasks
- [ ] Unit tests for each recovery pattern
- [ ] Integration tests for ProcessManager + recovery
- [ ] Integration tests for SSH + recovery
- [ ] Load tests to verify circuit breaker behavior
- [ ] Chaos tests for cascading failure scenarios
- [ ] Documentation of recovery patterns

---

## 10. EXAMPLE INTEGRATION SCENARIOS

### Scenario 1: ProcessManager Under Resource Pressure

**Situation:** System memory approaching limit while executing commands

**Flow:**
1. ProcessManager checks concurrent process limit → hits limit
2. CircuitBreaker for concurrent limits is consulted
3. Circuit is CLOSED (normal operation) → allows check to proceed
4. ResourceLimiter emits 'limit-exceeded' event
5. ProcessManager RecoveryHandler invoked → waits 100ms + exponential backoff
6. After delay, retry command execution
7. If retry succeeds → record success, circuit stays closed
8. If retries exhausted → throw error with recovery metadata

**Code:**
```typescript
async executeCommand(options: ExecutionOptions): Promise<ExecutionInfo> {
  try {
    // With recovery handler wrapping
    return await this.recoveryHandler.executeWithRecovery(
      () => this.executeCommandInternal(options),
      {
        circuitBreakerName: `proc-exec-${options.executionMode}`,
        timeout: options.timeoutSeconds * 1000,
        tag: options.command.substring(0, 50)
      }
    );
  } catch (error) {
    // Handle with detailed error metadata
    if (error instanceof CircuitBreakerOpenError) {
      // Circuit open → too many failures
    }
    throw error;
  }
}
```

### Scenario 2: SSH Under Cascading Network Failures

**Situation:** Host becomes unreachable, causing connection pool exhaustion

**Flow:**
1. SSH connection attempt fails (network timeout)
2. RetryStrategy retries up to 3 times with backoff
3. All retries fail → CircuitBreaker for host records failure
4. Circuit transitions from CLOSED → OPEN after 5 failures
5. New connection attempts immediately rejected with CircuitBreakerOpenError
6. After 60s timeout, circuit transitions to HALF_OPEN
7. Single connection attempt tried in HALF_OPEN
8. If success → circuit transitions back to CLOSED
9. If failure → circuit goes back to OPEN

**Code:**
```typescript
async getSSHConnection(options: GetSSHConnectionOptions): Promise<SSHConnection> {
  const hostKey = `${options.host}:${options.port}`;
  const breaker = this.getOrCreateCircuitBreaker(hostKey);
  
  try {
    const retryStrategy = new RetryStrategy({
      maxAttempts: 3,
      initialDelayMs: 100,
      maxDelayMs: 3000
    });

    return await breaker.execute(() =>
      retryStrategy.execute(() =>
        this.pool.getConnection(options)
      )
    );
  } catch (error) {
    if (error instanceof CircuitBreakerOpenError) {
      logger.warn(`Host ${hostKey} circuit open, retrying after ${error.timeUntilRetry}ms`);
      // Could emit event for monitoring
    }
    throw error;
  }
}
```

### Scenario 3: ResourceLimiter Enforcement with Recovery

**Situation:** Memory limit exceeded, need to enforce cleanup

**Flow:**
1. ResourceMonitor detects memory > threshold
2. ResourceLimiter.checkMemoryLimit() invoked
3. Recovery handler for MEMORY_LIMIT_EXCEEDED invoked
4. Handler attempts graceful cleanup (request process termination)
5. Recovery handler completes, enforcement circuit consulted
6. Circuit is CLOSED → enforcement proceeds
7. Oldest process identified and sent SIGTERM
8. Enforcement circuit records action as "success"
9. After 5000ms grace period, if not exited → SIGKILL sent

**Code:**
```typescript
checkMemoryLimit(currentUsageMB: number, totalAvailableMB: number): void {
  if (!this.memoryLimitMB || currentUsageMB <= this.memoryLimitMB) {
    return;
  }

  const info = {
    limitType: 'memory' as const,
    current: currentUsageMB,
    limit: this.memoryLimitMB,
    timestamp: Date.now(),
  };

  this.emit('limit-exceeded', info);

  if (this.enableEnforcement) {
    this.invokeRecoveryHandler('MEMORY_LIMIT_EXCEEDED', {
      current: currentUsageMB,
      limit: this.memoryLimitMB,
    }).then(() => {
      // After recovery attempt, check if enforcement still needed
      const updatedUsage = this.getCurrentMemoryUsage();
      if (updatedUsage > this.memoryLimitMB) {
        this._enforceMemoryLimit(updatedUsage);
      }
    }).catch(error => {
      logger.error('Recovery handler failed, proceeding with enforcement', error);
      this._enforceMemoryLimit(currentUsageMB);
    });
  }
}
```

---

## 11. KEY CONSIDERATIONS

### Error Categorization
- **Retryable errors:** Network timeouts, transient I/O failures, temporary resource limits
- **Non-retryable errors:** Permission denied, file not found, schema validation, security violations
- **Categorization strategy:** Use error codes from error-taxonomy.ts

### Timeout Management
- ProcessManager: Timeout per command + grace period for cleanup
- SSH: Per-command timeout + session-level timeout
- RecoveryHandler: Optional timeout per execution
- Backoff: Always exponential with jitter to avoid thundering herd

### Circuit Breaker Tuning
- **Aggressive (3 failures, 30s):** For critical operations
- **Balanced (5 failures, 60s):** For normal operations
- **Lenient (10 failures, 120s):** For naturally flaky operations
- Monitor via getMetrics() to tune parameters

### Recovery Handler Contracts
- Handler receives error + context
- Handler can perform cleanup/reset/logging
- Handler failures don't prevent retry (logged but ignored)
- Handlers should be idempotent (can be called multiple times)

### Metrics & Monitoring
- Track retry counts per component
- Track circuit breaker state transitions
- Track recovery handler invocations
- Expose via health check endpoints for observability

---

## 12. VALIDATION CHECKLIST

Before considering Phase 2.3 complete:

- [ ] All ProcessManager recovery patterns implemented
- [ ] All SSH Module recovery patterns implemented
- [ ] ResourceLimiter recovery handlers integrated
- [ ] ResourceMonitor circuit breaker and handlers integrated
- [ ] Unit tests passing (>90% coverage for recovery paths)
- [ ] Integration tests for cascading failure scenarios
- [ ] Load tests verify circuit breaker behavior
- [ ] Documentation updated for all recovery patterns
- [ ] Error codes mapped to retry/non-retry decisions
- [ ] Recovery handler contracts validated
- [ ] Metrics exposed and verified
- [ ] Performance impact assessed (<5% overhead)

---

## CONCLUSION

Phase 2.3 Error Integration will add **comprehensive error recovery** to the Infected MCP Server by:

1. **ProcessManager** - Retry/CB for command execution, file I/O, terminal creation, and streaming
2. **SSH Module** - Circuit breakers per host/session, retry for transient failures, error categorization
3. **ResourceLimiter** - Recovery handlers for enforcement, circuit breaker to prevent cascade
4. **ResourceMonitor** - Circuit breaker for monitoring loop, recovery handlers for thresholds

**Total estimated effort:** 10-14 developer hours (2 days)  
**Estimated LOC:** 800-1000 lines of implementation  
**Impact:** Dramatically improved resilience, reduced cascading failures, better observability

