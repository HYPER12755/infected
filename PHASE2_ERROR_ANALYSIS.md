# Infected MCP Server - Error Handling & Classification Analysis
## Phase 2 Implementation Research Report

---

## EXECUTIVE SUMMARY

The Infected MCP Server has a **foundational error handling system** with:
- ✅ 30+ predefined error codes (tool-error.ts)
- ✅ 6 custom error classes with error categories
- ✅ Event-driven error handling via EventEmitter
- ✅ Timeout management and stream error handling
- ✅ Basic try-catch patterns

However, **critical gaps exist**:
- ❌ No retry logic (except implied rate-limit suggestions)
- ❌ No circuit breaker patterns
- ❌ No exponential backoff strategies
- ❌ Inconsistent error propagation across modules
- ❌ Limited error recovery mechanisms

---

## 1. CURRENT ERROR HANDLING OVERVIEW

### 1.1 Error Code System (tool-error.ts)
**Location:** `/root/sandbox/infected/src/core/tool-error.ts`

Defines 30 error codes organized by domain:

#### Connection & Authentication (5)
```
CONNECTION_FAILED - Network connection issues
AUTHENTICATION_FAILED - SSH/credential failures
NETWORK_ERROR - General network problems
COMMAND_TIMEOUT - Command execution timeout
RATE_LIMIT_EXCEEDED - Too many requests
```

#### File System (5)
```
FILE_TOO_LARGE - Exceeds size limits
PERMISSION_DENIED - Access denied
NOT_FOUND - Resource not found
INVALID_PATH - Invalid path format
PATH_OUTSIDE_ALLOWED - Security violation
```

#### Resource Management (3)
```
RESOURCE_NOT_FOUND - Resource doesn't exist
FILE_SYSTEM_ERROR - FS operations
DIRECTORY_NOT_EMPTY - Non-empty directory
```

#### Execution (4)
```
COMMAND_TIMEOUT - Execution timeout
TOOL_EXECUTION_ERROR - Tool failed
INVALID_INPUT - Bad input
VALIDATION_ERROR - Schema validation
```

#### Other (8)
```
SESSION_NOT_FOUND, SESSION_BUSY, SESSION_EXISTS
FILE_ALREADY_EXISTS, INVALID_FORMAT
FETCH_ERROR, HTTP_ERROR, MEMORY_ERROR, TERMINAL_ERROR
INTERNAL_ERROR
```

### 1.2 Error Class Hierarchy

```typescript
// Core error class (shell-errors.ts)
MCPShellError extends Error {
  code: string
  category: ErrorCategory
  details?: Record<string, unknown>
  timestamp: string
  requestId?: string
}

// Error categories
type ErrorCategory = 
  | 'AUTH'       // Authentication/authorization
  | 'PARAM'      // Invalid parameters
  | 'RESOURCE'   // Resource issues
  | 'EXECUTION'  // Execution failures
  | 'SYSTEM'     // System errors
  | 'SECURITY'   // Security violations

// Specialized error classes
class ResourceNotFoundError extends MCPShellError
class ExecutionError extends MCPShellError
class TimeoutError extends MCPShellError
class SecurityError extends MCPShellError
class ResourceLimitError extends MCPShellError
```

### 1.3 ToolError Interface (for API responses)
```typescript
interface ToolError {
  code: ErrorCode
  message: string
  details?: Record<string, unknown>
  recoverable?: boolean
  suggestion?: string
}
```

**Key Feature:** Every error includes recovery suggestions via `getErrorSuggestion()`

---

## 2. ERROR TAXONOMY - CURRENT STATE

### 2.1 Network Errors

**Files:** 
- `src/core/ssh-connection-pool.ts` (739 lines)
- `src/core/remote-http-client.ts` (69 lines)
- `src/modules/fetch/index.ts` (356 lines)

**Current Handling:**
```typescript
// Remote HTTP Client (15s timeout)
const DEFAULT_EXECUTOR_TIMEOUT = 15000;

// Fetch module (10s default)
const timeout = z.number().int().min(1).default(10000)

// SSH Connection Pool
interface SSHConnectionPoolConfig {
  maxConnections?: number          // default: 50
  maxIdleTime?: number             // default: 5 min
  maxConnectionAge?: number        // default: 1 hour
  maxReusesPerConnection?: number  // default: 100
  staleCheckInterval?: number      // default: 30 sec
}
```

**Error Codes Used:**
- `CONNECTION_FAILED` - SSH connection issues
- `NETWORK_ERROR` - General network problems
- `AUTHENTICATION_FAILED` - SSH auth
- `TIMEOUT` - Request timeouts

**Gaps:**
- ❌ No DNS failure distinction
- ❌ No connection retry logic
- ❌ No exponential backoff for failed connections
- ❌ No circuit breaker for failing hosts
- ❌ AbortController used but no detailed error categorization

### 2.2 Process Errors

**Files:**
- `src/core/process-manager.ts` (982 lines)
- `src/modules/shell/main.ts` (494 lines)

**Current Handling:**
```typescript
// Error types thrown:
throw new ResourceLimitError('concurrent processes', maxConcurrentProcesses)
throw new ExecutionError('FileManager is not available...')
throw new ExecutionError(`Failed to create terminal: ${error}`)

// Process lifecycle errors:
child.on('error', (error) => {
  // Process spawn failed
})

child.on('close', async (code) => {
  // Handle exit codes: 0 (success), 1+ (failure), negative (signal)
})

// Timeout handling:
const timeout = setTimeout(() => {
  logger.warn(`Process timeout for ${executionId}`)
}, options.timeoutSeconds * 1000)
```

**Error Codes Used:**
- `COMMAND_TIMEOUT` - Timeout exceeded
- `TOOL_EXECUTION_ERROR` - Execution failed
- `RESOURCE_NOT_FOUND` - Process not found

**Gaps:**
- ❌ No distinction between different exit codes (permission, not found, etc.)
- ❌ No signal-specific handling (SIGSEGV, SIGPIPE, etc.)
- ❌ No process respawn logic
- ❌ Timeout returns partial output but no retry option

### 2.3 SSH/File Transfer Errors

**Files:**
- `src/modules/ssh/ssh-command-executor.ts` (284 lines)
- `src/modules/ssh/ssh-file-transfer-handler.ts` (430 lines)
- `src/modules/ssh/ssh-session-manager.ts` (261 lines)

**Current Handling:**
```typescript
// SSH Command Executor
async executeCommand(session: Session, command: string, timeout: number) {
  if (!session.isConnected) {
    throw new Error(`Session ${session.id} is not connected`)
  }
  if (!session.isReady) {
    throw new Error(`Session ${session.id} is busy executing: ${session.lastCommand}`)
  }
  // Timeout handling with polling
}

// File Transfer
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const FILE_TRANSFER_TIMEOUT = 300000    // 5 minutes

if (stats.size > MAX_FILE_SIZE) {
  throw new Error(`File size exceeds the 10MB limit`)
}

// Session creation
if (this.sessions.has(sessionId)) {
  throw new Error(`Session ${sessionId} already exists`)
}
```

**Error Codes Used:**
- `SESSION_NOT_FOUND` - Session doesn't exist
- `SESSION_BUSY` - Session executing
- `SESSION_EXISTS` - Session already exists
- `COMMAND_TIMEOUT` - Timeout
- `FILE_TOO_LARGE` - File size exceeded
- `PERMISSION_DENIED` - Access denied

**Gaps:**
- ❌ No SSH key permission errors (distinct)
- ❌ No SCP/SFTP failure codes
- ❌ No automatic reconnection on disconnect
- ❌ No command retry on transient failures
- ❌ File transfer failures not distinguished by type

### 2.4 Resource Errors

**Files:**
- `src/core/resource-monitor.ts` (446 lines)
- `src/core/resource-limiter.ts`
- `src/core/process-manager.ts`

**Current Handling:**
```typescript
// Resource Monitor
private memoryThresholdPercent = 85
private cpuThresholdPercent = 80
private fileHandleThresholdPercent = 90
private monitoringIntervalMs = 5000

monitor.on('memory-threshold', (metrics) => {
  // Emit event when threshold exceeded
})

// Resource Limiter
throw new ResourceLimitError('concurrent processes', this.maxConcurrentProcesses)
throw new ResourceLimitError('terminals', this.maxTerminals)
```

**Error Codes Used:**
- `RESOURCE_NOT_FOUND` - Resource doesn't exist
- `MEMORY_ERROR` - Memory operations
- (Custom codes via shell-errors.ts - see section 1.2)

**Gaps:**
- ❌ No OOM killer handling
- ❌ No file handle exhaustion recovery
- ❌ No disk space errors
- ❌ No graceful degradation on resource constraints

### 2.5 Security Errors

**Files:**
- `src/security/manager.ts`
- `src/core/module-system/module-manager.ts`
- `src/core/terminal-manager.ts`

**Current Handling:**
```typescript
// Security Manager
throw new SecurityError(`Command '${command}' is not allowed in restrictive mode`, {
  command,
  mode: 'restrictive'
})

// Module Manager
throw new SecurityError(`Permission denied to execute tool: ${toolId}`)

// Terminal Manager
throw new ExecutionError(`Program guard failed: input rejected for target "${sendTo}"`)
```

**Error Codes Used:**
- `SECURITY_001` - Security violations (custom)
- (No dedicated error code in tool-error.ts)

**Gaps:**
- ❌ No rate limiting on failed attempts
- ❌ No policy audit logging
- ❌ No intrusion detection
- ❌ Limited security error specificity

### 2.6 Timeout Errors

**Files:**
- `src/core/stream-error-handler.ts` (332 lines)
- `src/core/process-manager.ts`
- `src/modules/ssh/ssh-command-executor.ts`

**Current Handling:**
```typescript
// Stream Error Handler
interface StreamError {
  type: 'timeout' | 'overflow' | 'disconnected' | 'execution_error' | 'cleanup_error'
  message: string
  severity: 'warning' | 'error' | 'critical'
}

// Timeout constants
const DEFAULT_PROCESS_TIMEOUT = 5000      // 5 sec
const DEFAULT_TIMEOUT_MS = 30000          // 30 sec
const MAX_TIMEOUT_MS = 120000             // 2 min
const FILE_TRANSFER_TIMEOUT = 300000      // 5 min

// Timeout handling pattern
const timeout = setTimeout(() => {
  metrics.timeoutTriggered = true
  this.emitError({
    type: 'timeout',
    message: `Stream execution timeout after ${timeoutMs}ms`,
    severity: 'error'
  })
  this.cleanupStream(executionId)
}, timeoutMs)
```

**Error Codes Used:**
- `COMMAND_TIMEOUT` - Timeout exceeded
- (Custom timeout errors via stream-error-handler.ts)

**Gaps:**
- ❌ No distinction between soft/hard timeouts
- ❌ No timeout escalation (warning → error → kill)
- ❌ No adaptive timeout based on operation type
- ❌ No timeout statistics/trending

### 2.7 File System Errors

**Files:**
- `src/modules/filesystem/errors.ts` (6 lines)
- `src/core/file-manager.ts`
- `src/modules/filesystem/path-validation.ts`

**Current Handling:**
```typescript
// File System Errors Module
export class ResourceNotFoundError extends Error {
  constructor(resourceType: string, resourceId: string) {
    super(`${resourceType} with ID '${resourceId}' not found.`)
  }
}

// Error codes used in file operations
INVALID_PATH - Path format invalid
PERMISSION_DENIED - Access denied
NOT_FOUND - File/directory not found
FILE_ALREADY_EXISTS - File exists
DIRECTORY_NOT_EMPTY - Dir not empty
FILE_TOO_LARGE - Size exceeded
```

**Gaps:**
- ❌ No symlink error handling
- ❌ No mount/filesystem errors
- ❌ No path traversal detection errors
- ❌ No ENOSPC (no space left) specific handling
- ❌ Limited directory operation errors

---

## 3. RETRY OPPORTUNITIES

### High Priority - Transient Errors

#### 3.1 Network Connection Failures
**Where:** SSH connections, HTTP requests
**Current:** No retry
**Recommended Strategy:** 
- Exponential backoff: 100ms → 200ms → 400ms → 800ms (max 5s)
- Max retries: 3-5
- Backoff multiplier: 2x

**Affected Modules:**
```
src/core/ssh-connection-pool.ts - getConnection()
src/core/remote-http-client.ts - get/post()
src/modules/fetch/index.ts - axios requests
```

#### 3.2 DNS Resolution Failures
**Where:** Any remote operation with hostname
**Current:** Implicit in connection failures
**Recommended Strategy:**
- Exponential backoff same as network
- Distinguish from other network errors

#### 3.3 SSH Session Timeouts
**Where:** Interactive SSH sessions
**Current:** Timeout detected, no reconnect
**Recommended Strategy:**
- Detect idle timeout
- Attempt reconnect with exponential backoff
- Preserve command history on reconnect

**Code Location:**
```
src/modules/ssh/ssh-command-executor.ts - executeCommand()
Lines 60-100: Timeout polling logic
```

#### 3.4 File Transfer Interruptions
**Where:** Large file transfers
**Current:** No resume logic
**Recommended Strategy:**
- Resume from last checkpoint
- Exponential backoff between retries
- Max retries: 3

**Code Location:**
```
src/modules/ssh/ssh-file-transfer-handler.ts
Lines 49-100: uploadFile()
```

### Medium Priority - Rare Errors

#### 3.5 Process Spawn Failures
**Where:** Process execution
**Current:** Direct throw
**Recommended Strategy:**
- Retry once with 1s delay
- Check for resource availability
- Escalate to EMFILE/ENFILE handling

**Code Location:**
```
src/core/process-manager.ts
Lines 200+: executeCommand() -> spawn()
```

#### 3.6 Resource Exhaustion
**Where:** Connection pool, terminal creation
**Current:** Throw immediately
**Recommended Strategy:**
- Backoff and retry with resource cleanup
- 500ms delay before retry
- Max retries: 1-2

**Code Locations:**
```
src/core/process-manager.ts - Lines that throw ResourceLimitError
src/core/terminal-manager.ts - createTerminal()
```

### Low Priority - Manual Retries

#### 3.7 Command Execution with Non-Zero Exit
**Where:** Shell command execution
**Current:** Return result, allow caller to retry
**Recommended Strategy:**
- Optional `allowFailure` flag exists (line 70 in ssh/index.ts)
- Allow caller to implement retry logic
- No server-side retry needed

---

## 4. CIRCUIT BREAKER CANDIDATES

### 4.1 SSH Connection Pool (HIGH PRIORITY)

**Problem:** Multiple failed attempts to same host → cascading failures

**Current State:**
```typescript
// SSHConnectionPool tracks connection state
export type ConnectionState = 'connected' | 'disconnected' | 'error' | 'idle'

interface PooledSSHConnection {
  state: ConnectionState
  createdAt: number
  lastUsed: number
  useCount: number
}

// But NO circuit breaker logic
```

**Implementation Opportunity:**
```typescript
Circuit Breaker States:
- CLOSED: Normal operation (0 failures)
- OPEN: Host failing, reject requests immediately
- HALF_OPEN: Testing if host recovered

Triggers:
- 3+ consecutive connection failures
- All retries exhausted
- Error rate > 50% in last 5 minutes

Recovery:
- Wait 30 seconds in OPEN state
- Try 1 request in HALF_OPEN
- If succeeds → CLOSED, if fails → OPEN + wait 60s

Code Location: src/core/ssh-connection-pool.ts
```

### 4.2 Remote Executor Service (MEDIUM PRIORITY)

**Problem:** Failing executor service blocks all remote commands

**Current State:**
```typescript
// RemoteHttpClient (69 lines)
const DEFAULT_EXECUTOR_TIMEOUT = 15000

// But no fault tolerance
async get<T = unknown>(path: string): Promise<T> {
  const controller = new AbortController()
  // Direct throw on HTTP error
}
```

**Implementation Opportunity:**
```typescript
Circuit Breaker:
- Monitor /health or similar endpoint
- Open after 5 failed requests in 1 minute
- Half-open: test every 30 seconds

Code Location: src/core/remote-http-client.ts
```

### 4.3 Process Spawn (LOW PRIORITY)

**Problem:** Resource exhaustion prevents new processes

**Current State:**
```typescript
// Throws immediately on resource limit
throw new ResourceLimitError('concurrent processes', maxConcurrentProcesses)
```

**Implementation Opportunity:**
```typescript
Circuit Breaker:
- Not needed; queue requests instead
- Implement bounded queue with max wait time
- Reject after timeout if queue full

Code Location: src/core/process-manager.ts - execute()
```

### 4.4 File Transfer Operations (MEDIUM PRIORITY)

**Problem:** Large file transfers fail → entire operation fails

**Current State:**
```typescript
const MAX_FILE_SIZE = 10 * 1024 * 1024  // 10MB hard limit
const FILE_TRANSFER_TIMEOUT = 300000    // 5 min

// No retry or partial transfer
```

**Implementation Opportunity:**
```typescript
Circuit Breaker per (host, port, user):
- Track transfer success/failure rate
- Open after 3 failures to same host
- Prevent new transfers to that host for 60s

Code Location: src/modules/ssh/ssh-file-transfer-handler.ts
```

---

## 5. ERROR PROPAGATION PATTERNS

### 5.1 Current Propagation Model

**Pattern 1: Direct Throw (Most Common)**
```typescript
// src/core/process-manager.ts
if (!this.fileManager) {
  throw new ExecutionError('FileManager is not available...')
}

// src/modules/ssh/
throw new Error(`Session ${sessionId} is not connected`)
```

**Pattern 2: Catch & Rethrow (Enhanced)**
```typescript
// src/core/process-manager.ts
try {
  const inputStream = await this.fileManager.createReadStream(...)
} catch (error) {
  throw new ExecutionError(
    `Failed to read input from output_id: ${options.inputOutputId}`,
    {
      inputOutputId: options.inputOutputId,
      originalError: String(error),
    }
  )
}
```

**Pattern 3: Event Emission (Error Handler)**
```typescript
// src/core/stream-error-handler.ts
if (metrics.bytesTransferred > this.MAX_STREAM_BUFFER) {
  this.emitError({
    type: 'overflow',
    message: `Stream buffer overflow...`,
    severity: 'critical'
  })
}
```

**Pattern 4: Logging Only (Fire & Forget)**
```typescript
// src/modules/shell/main.ts
commandHistoryManager.loadHistory().catch(error => {
  logger.warn('Failed to load command history:', { 
    error: error instanceof Error ? error.message : String(error) 
  })
})
```

### 5.2 Error Conversion Chain

```
Standard Error
    ↓
MCPShellError (code, category, details, timestamp)
    ↓
ToolError (for API response)
    ↓
CallToolResult { isError: true, content: [...], structuredContent: { error } }
    ↓
McpError (SDK level) [if needed]
```

### 5.3 Gaps in Propagation

- ❌ Not all catch blocks preserve original error context
- ❌ Stack traces sometimes lost in conversion
- ❌ Request ID not consistently threaded through
- ❌ Error category sometimes generic (SYSTEM) instead of specific

---

## 6. ERROR LOGGING & REPORTING

### 6.1 Logging Infrastructure

**Logger:** Central singleton in `src/core/logger.ts`

**Usage Pattern:**
```typescript
logger.error('message', { context: 'data' })
logger.warn('message', { context: 'data' })
logger.debug('message', { context: 'data' })
```

**Example Logging:**
```typescript
// src/core/stream-error-handler.ts
logger.error(`Failed to save output for ${executionId}:`, {
  error: error instanceof Error ? error.message : String(error),
})

// src/core/process-manager.ts
logger.warn(`Process timeout for ${executionId}`)
```

### 6.2 Error Reporting via Events

```typescript
// StreamErrorHandler emits errors
streamHandler.on('error', (error: StreamError) => {
  // error.type, error.severity, error.metadata
})

// ModuleManager emits module events
moduleManager.on('moduleLoaded', (...) => {})
moduleManager.on('moduleUnloaded', (...) => {})
```

### 6.3 Gaps in Error Reporting

- ❌ No error metrics/counters
- ❌ No error trend analysis
- ❌ No alert system for critical errors
- ❌ Error details not captured for debugging
- ❌ No error correlation across operations

---

## 7. PHASE 2 IMPLEMENTATION RECOMMENDATIONS

### Week 5: Core Retry & Circuit Breaker Framework

#### 7.1 New Files to Create

**1. `src/core/retry-strategy.ts` (200 lines)**
```typescript
export interface RetryConfig {
  maxAttempts: number
  initialDelayMs: number
  maxDelayMs: number
  backoffMultiplier: number
  jitterFraction: number  // 0.1 = 10% jitter
}

export class ExponentialBackoffRetry {
  async execute<T>(
    fn: () => Promise<T>,
    config: RetryConfig,
    shouldRetry?: (error: Error) => boolean
  ): Promise<T>
}

export const RETRY_CONFIGS = {
  NETWORK: { maxAttempts: 3, initialDelayMs: 100, ... }
  SSH_COMMAND: { maxAttempts: 2, initialDelayMs: 500, ... }
  FILE_TRANSFER: { maxAttempts: 3, initialDelayMs: 1000, ... }
}
```

**2. `src/core/circuit-breaker.ts` (250 lines)**
```typescript
export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN'
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED
  private failureCount = 0
  private successCount = 0
  private lastFailureTime: number | null = null

  async execute<T>(fn: () => Promise<T>): Promise<T>
  
  recordSuccess(): void
  recordFailure(): void
  
  getState(): CircuitState
}

export class CircuitBreakerRegistry {
  getBreaker(key: string): CircuitBreaker
}
```

**3. `src/core/error-classifier.ts` (150 lines)**
```typescript
export enum ErrorClassification {
  TRANSIENT = 'TRANSIENT',      // Retry
  PERMANENT = 'PERMANENT',      // Don't retry
  SECURITY = 'SECURITY',        // Log & alert
  RESOURCE = 'RESOURCE',        // Queue or reject
}

export function classifyError(error: unknown): {
  classification: ErrorClassification
  shouldRetry: boolean
  shouldOpenCircuit: boolean
  severity: 'warning' | 'error' | 'critical'
}
```

#### 7.2 Module Updates

**1. `src/core/ssh-connection-pool.ts` (Add 100 lines)**
- Add CircuitBreaker per (host, port)
- Implement `classifyConnectionError()`
- Add retry logic to `getConnection()`
- Track error patterns

**2. `src/modules/ssh/ssh-command-executor.ts` (Add 50 lines)**
- Wrap executeCommand in retry logic
- Use error classifier for TRANSIENT errors
- Add exponential backoff on timeout

**3. `src/modules/ssh/ssh-file-transfer-handler.ts` (Add 80 lines)**
- Implement resume-from-checkpoint
- Add circuit breaker per host
- Retry on transient failures

**4. `src/core/process-manager.ts` (Add 70 lines)**
- Add process spawn retry (once)
- Exponential backoff for resource errors
- Track spawn failure patterns

**5. `src/core/remote-http-client.ts` (Add 60 lines)**
- Implement exponential backoff
- Add circuit breaker for executor service
- Distinguish timeout vs connection errors

#### 7.3 New Error Codes (tool-error.ts)
```typescript
// Add more specific network errors
CONNECTION_TIMEOUT = 'CONNECTION_TIMEOUT'
DNS_RESOLUTION_FAILED = 'DNS_RESOLUTION_FAILED'
SSH_KEY_PERMISSION_ERROR = 'SSH_KEY_PERMISSION_ERROR'
RESOURCE_EXHAUSTED = 'RESOURCE_EXHAUSTED'
CIRCUIT_BREAKER_OPEN = 'CIRCUIT_BREAKER_OPEN'

// Add recovery hints
recoverable?: boolean  // Can retry?
retryable?: boolean    // Should auto-retry?
```

### Week 5 Estimated Effort

| Component | Lines | Effort | Priority |
|-----------|-------|--------|----------|
| retry-strategy.ts | 200 | 4-6h | HIGH |
| circuit-breaker.ts | 250 | 6-8h | HIGH |
| error-classifier.ts | 150 | 3-4h | HIGH |
| SSH pool updates | 100 | 3-4h | HIGH |
| Command executor updates | 50 | 2-3h | HIGH |
| File transfer updates | 80 | 3-4h | MEDIUM |
| Process manager updates | 70 | 2-3h | MEDIUM |
| HTTP client updates | 60 | 2-3h | MEDIUM |
| Tests & integration | - | 10-15h | HIGH |
| **Total** | **960** | **35-50h** | - |

### Week 5 Milestones

**Day 1-2:** Implement core framework
- retry-strategy.ts
- circuit-breaker.ts
- error-classifier.ts
- Tests for each

**Day 3-4:** Integrate SSH layer
- Update ssh-connection-pool.ts
- Update ssh-command-executor.ts
- Update ssh-file-transfer-handler.ts
- Integration tests

**Day 5:** Integrate remaining modules
- Update process-manager.ts
- Update remote-http-client.ts
- End-to-end testing
- Documentation

---

## 8. RISK ASSESSMENT

### High Risk Areas

1. **SSH Connection Pool Failures**
   - Impact: All SSH operations blocked
   - Mitigation: Circuit breaker + detailed state tracking

2. **File Transfer Interruptions**
   - Impact: Data loss/corruption
   - Mitigation: Checkpoint + resume logic

3. **Process Spawn Exhaustion**
   - Impact: No new processes possible
   - Mitigation: Queue + resource monitoring

### Medium Risk Areas

4. **Timeout Ambiguity**
   - Impact: Unclear if operation succeeded
   - Mitigation: Clear error codes + partial output

5. **Security Error Handling**
   - Impact: Security violations not logged
   - Mitigation: Dedicated security error path

---

## 9. TESTING STRATEGY FOR PHASE 2

### Unit Tests (Per Module)
- Retry logic with mock failures
- Circuit breaker state transitions
- Error classification accuracy
- Timeout handling

### Integration Tests
- SSH connection pool resilience
- File transfer resume
- Cascading error propagation
- Recovery from transient failures

### Chaos Testing
- Kill network mid-transfer
- Exhaust resources
- Timeout scenarios
- Circuit breaker scenarios

---

## 10. SUMMARY TABLE

| Aspect | Current State | Gap | Phase 2 Solution |
|--------|---------------|-----|-----------------|
| **Retry Logic** | None | High | ExponentialBackoffRetry |
| **Circuit Breaker** | None | High | CircuitBreaker framework |
| **Error Classification** | Generic | High | ErrorClassifier |
| **SSH Resilience** | Basic | High | Pool + CB + Retry |
| **File Transfer** | No resume | Medium | Checkpoint logic |
| **Process Management** | Basic | Medium | Spawn retry + queue |
| **Network Timeouts** | Hardcoded | Medium | Configurable + escalation |
| **Error Logging** | Basic | Low | Metrics + trending |
| **Security Errors** | Limited | Medium | Dedicated error path |
| **Resource Errors** | Generic | Medium | Specific error codes |

---

## APPENDIX A: File Locations Reference

### Error Definitions
- `src/core/tool-error.ts` - Error codes (30)
- `src/utils/shell-errors.ts` - Error classes (6)
- `src/modules/filesystem/errors.ts` - FS errors
- `src/types/shell-server/index.ts` - Error categories

### SSH/Network
- `src/core/ssh-connection-pool.ts` - Connection management
- `src/modules/ssh/ssh-session-manager.ts` - Session lifecycle
- `src/modules/ssh/ssh-command-executor.ts` - Command execution
- `src/modules/ssh/ssh-file-transfer-handler.ts` - File transfer
- `src/core/remote-http-client.ts` - Remote executor client

### Process/Execution
- `src/core/process-manager.ts` - Process lifecycle (982 lines)
- `src/core/stream-error-handler.ts` - Stream management (332 lines)
- `src/core/resource-monitor.ts` - Resource monitoring

### Module System
- `src/core/module-system/module-manager.ts` - Module lifecycle

---

## APPENDIX B: Error Code → Category Mapping

```
VALIDATION_ERROR → PARAM
SESSION_* → RESOURCE
CONNECTION_FAILED → EXECUTION
AUTHENTICATION_FAILED → AUTH
COMMAND_TIMEOUT → EXECUTION
FILE_* → RESOURCE
PERMISSION_DENIED → AUTH
NOT_FOUND → RESOURCE
INTERNAL_ERROR → SYSTEM
INVALID_INPUT → PARAM
TOOL_EXECUTION_ERROR → EXECUTION
NETWORK_ERROR → EXECUTION
SECURITY_* → SECURITY
MEMORY_ERROR → SYSTEM
TERMINAL_ERROR → RESOURCE
FETCH_ERROR → EXECUTION
HTTP_ERROR → EXECUTION
RATE_LIMIT_EXCEEDED → RESOURCE
```

