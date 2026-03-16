# Phase 2 Implementation Checklist - Week 5
## Error Handling & Resilience Framework

---

## PRE-IMPLEMENTATION SETUP

### Code Review Phase
- [ ] Read entire PHASE2_ERROR_ANALYSIS.md
- [ ] Review current error handling in:
  - [ ] src/core/tool-error.ts (30 error codes)
  - [ ] src/utils/shell-errors.ts (error classes)
  - [ ] src/types/shell-server/index.ts (error categories)
- [ ] Identify all try-catch blocks:
  - [ ] src/core/process-manager.ts
  - [ ] src/core/ssh-connection-pool.ts
  - [ ] src/modules/ssh/ssh-command-executor.ts
- [ ] Review timeout constants across codebase
- [ ] Map error propagation paths

### Environment Setup
- [ ] Create feature branch: `git checkout -b feature/error-handling-phase2`
- [ ] Create test directory: `mkdir -p tests/unit/core/resilience`
- [ ] Create test fixtures: `mkdir -p tests/fixtures/error-scenarios`

---

## CORE FRAMEWORK IMPLEMENTATION (Days 1-2)

### Task 1: Create ExponentialBackoffRetry (2-3 hours)
**File:** `src/core/retry-strategy.ts` (200 lines)

**Implementation Checklist:**
- [ ] Define RetryConfig interface with:
  - [ ] maxAttempts (default: 3)
  - [ ] initialDelayMs (default: 100)
  - [ ] maxDelayMs (default: 5000)
  - [ ] backoffMultiplier (default: 2.0)
  - [ ] jitterFraction (default: 0.1 for 10% jitter)
- [ ] Implement ExponentialBackoffRetry class:
  - [ ] execute<T>() method
  - [ ] calculateDelay() private method (with jitter)
  - [ ] isRetryable() predicate check
- [ ] Define preset configs:
  - [ ] RETRY_CONFIGS.NETWORK (100ms initial, 3 attempts)
  - [ ] RETRY_CONFIGS.SSH_COMMAND (500ms initial, 2 attempts)
  - [ ] RETRY_CONFIGS.FILE_TRANSFER (1000ms initial, 3 attempts)
  - [ ] RETRY_CONFIGS.SPAWN (1000ms initial, 1 attempt)
- [ ] Add comprehensive logging at DEBUG level
- [ ] Export default instance

**Testing:**
- [ ] Test exponential calculation
- [ ] Test max delay boundary
- [ ] Test jitter application
- [ ] Test shouldRetry predicate
- [ ] Test with failing then succeeding function

---

### Task 2: Create CircuitBreaker Pattern (3-4 hours)
**File:** `src/core/circuit-breaker.ts` (250 lines)

**Implementation Checklist:**
- [ ] Define CircuitState enum:
  - [ ] CLOSED = normal operation
  - [ ] OPEN = rejecting requests
  - [ ] HALF_OPEN = testing recovery
- [ ] Implement CircuitBreaker class:
  - [ ] Constructor with config:
    - [ ] failureThreshold (default: 3)
    - [ ] successThreshold (default: 2)
    - [ ] timeout (default: 30s in OPEN state)
    - [ ] timeout multiplier (60s for repeated failures)
  - [ ] execute<T>() method:
    - [ ] Check state before executing
    - [ ] Reject if OPEN
    - [ ] Throw CIRCUIT_BREAKER_OPEN error if rejecting
  - [ ] recordSuccess() - decrement failure count, increment success count
  - [ ] recordFailure() - increment failure count, check threshold
  - [ ] reset() - go to CLOSED state
  - [ ] getState() - return current state
  - [ ] getMetrics() - return stats
- [ ] Implement CircuitBreakerRegistry class:
  - [ ] Singleton pattern
  - [ ] getBreaker(key: string) - create or retrieve
  - [ ] getAllBreakers() - return all instances
  - [ ] reset(key?: string) - reset one or all
- [ ] Add event emission on state changes
- [ ] Add comprehensive logging

**Testing:**
- [ ] Test state transitions
- [ ] Test failure threshold
- [ ] Test success threshold in HALF_OPEN
- [ ] Test timeout multiplier
- [ ] Test registry get/create
- [ ] Test metrics collection

---

### Task 3: Create ErrorClassifier (2-3 hours)
**File:** `src/core/error-classifier.ts` (150 lines)

**Implementation Checklist:**
- [ ] Define ErrorClassification enum:
  - [ ] TRANSIENT - recoverable with retry
  - [ ] PERMANENT - will not recover with retry
  - [ ] SECURITY - security violation, log & alert
  - [ ] RESOURCE - resource constraint, queue/defer
  - [ ] TIMEOUT - timeout, may be transient
- [ ] Define ErrorSeverity enum:
  - [ ] WARNING
  - [ ] ERROR
  - [ ] CRITICAL
- [ ] Implement classifyError() function:
  - [ ] Check error code first
  - [ ] Check error message pattern
  - [ ] Check error type
  - [ ] Return classification with metadata
- [ ] Create classification rules:
  - [ ] Network errors → TRANSIENT
  - [ ] Timeout errors → TIMEOUT
  - [ ] Auth errors → PERMANENT
  - [ ] Resource limit → RESOURCE
  - [ ] Security violation → SECURITY
  - [ ] SSH session errors → varies
- [ ] Implement shouldRetry() utility:
  - [ ] Returns true for TRANSIENT/TIMEOUT
  - [ ] Returns false for PERMANENT/SECURITY/RESOURCE
- [ ] Implement shouldOpenCircuit() utility:
  - [ ] True for repeated PERMANENT errors
  - [ ] False for TRANSIENT/TIMEOUT
- [ ] Export classification utilities

**Testing:**
- [ ] Test each error code classification
- [ ] Test error message pattern matching
- [ ] Test shouldRetry logic
- [ ] Test shouldOpenCircuit logic
- [ ] Test edge cases (unknown error)

---

### Task 4: Unit Tests for Core Framework (4-5 hours)

**Test Files:**
- [ ] `tests/unit/core/retry-strategy.test.ts` (150 lines)
- [ ] `tests/unit/core/circuit-breaker.test.ts` (200 lines)
- [ ] `tests/unit/core/error-classifier.test.ts` (100 lines)

**Retry Tests:**
- [ ] Calculate exponential delays correctly
- [ ] Apply jitter within bounds
- [ ] Respect max delay limit
- [ ] Successfully retry failing function
- [ ] Stop retrying after max attempts
- [ ] Use custom shouldRetry predicate

**Circuit Breaker Tests:**
- [ ] Start in CLOSED state
- [ ] Transition CLOSED → OPEN after failures
- [ ] Transition OPEN → HALF_OPEN after timeout
- [ ] Transition HALF_OPEN → CLOSED on success
- [ ] Transition HALF_OPEN → OPEN on failure
- [ ] Reject requests while OPEN
- [ ] Emit state change events
- [ ] Track failure count correctly
- [ ] Increment timeout multiplier

**Classifier Tests:**
- [ ] Classify connection errors as TRANSIENT
- [ ] Classify auth errors as PERMANENT
- [ ] Classify timeout as TIMEOUT
- [ ] Classify resource limit as RESOURCE
- [ ] Classify security violation as SECURITY
- [ ] Determine shouldRetry correctly
- [ ] Determine shouldOpenCircuit correctly

**Coverage Target:** > 90% for all three modules

---

## SSH LAYER INTEGRATION (Days 3-4)

### Task 5: Update SSH Connection Pool (3-4 hours)
**File:** `src/core/ssh-connection-pool.ts` (+100 lines)

**Changes:**
- [ ] Import CircuitBreaker and CircuitBreakerRegistry
- [ ] Add circuit breaker per (host, port) tuple
  - [ ] Create registry: `private cbRegistry = new CircuitBreakerRegistry()`
  - [ ] Key format: `{host}:{port}`
- [ ] Update getConnection() method:
  - [ ] Get circuit breaker for host
  - [ ] Check if breaker is OPEN
  - [ ] Throw CIRCUIT_BREAKER_OPEN if rejecting
  - [ ] Execute within breaker context
  - [ ] Call recordSuccess() on success
  - [ ] Call recordFailure() on error
- [ ] Implement classifyConnectionError():
  - [ ] Import ErrorClassifier
  - [ ] Distinguish between:
    - [ ] Connection timeout (TRANSIENT)
    - [ ] Auth failure (PERMANENT)
    - [ ] DNS failure (TRANSIENT)
    - [ ] Network error (TRANSIENT)
- [ ] Add error pattern tracking:
  - [ ] Track consecutive failures per host
  - [ ] Track failure timestamps
  - [ ] Log patterns for debugging
- [ ] Update connection validation:
  - [ ] Health check on reuse
  - [ ] Discard stale/failed connections

**Testing:**
- [ ] Integration test: circuit breaker opens after failures
- [ ] Integration test: circuit breaker half-opens after timeout
- [ ] Integration test: successful retry closes breaker
- [ ] Integration test: auth error doesn't open breaker

---

### Task 6: Update SSH Command Executor (2-3 hours)
**File:** `src/modules/ssh/ssh-command-executor.ts` (+50 lines)

**Changes:**
- [ ] Import ExponentialBackoffRetry
- [ ] Import ErrorClassifier
- [ ] Wrap executeCommand() in retry logic:
  - [ ] Check if error is TRANSIENT
  - [ ] Retry with RETRY_CONFIGS.SSH_COMMAND
  - [ ] Max 2 attempts total
- [ ] Handle timeout specifically:
  - [ ] Detect timeout condition
  - [ ] Classify as TIMEOUT
  - [ ] Allow retry even if marked TRANSIENT
- [ ] Add logging:
  - [ ] Log retry attempt #
  - [ ] Log delay before retry
  - [ ] Log final result (success/exhausted)
- [ ] Add metrics:
  - [ ] Track attempt count
  - [ ] Track total delay
  - [ ] Track success rate

**Testing:**
- [ ] Test retry on transient error
- [ ] Test no retry on permanent error
- [ ] Test timeout handling
- [ ] Test exhaust retries

---

### Task 7: Update SSH File Transfer Handler (3-4 hours)
**File:** `src/modules/ssh/ssh-file-transfer-handler.ts` (+80 lines)

**Changes:**
- [ ] Add checkpoint tracking:
  - [ ] Create checkpoint interface with:
    - [ ] bytesTransferred
    - [ ] timestamp
    - [ ] remoteHash (MD5/SHA256 of uploaded portion)
  - [ ] Save checkpoint every 1MB or 5 seconds
  - [ ] Check for existing checkpoint on retry
- [ ] Implement resume logic:
  - [ ] Get file size on remote
  - [ ] Compare with expected
  - [ ] Resume from checkpoint if partial
  - [ ] Retry remainder
- [ ] Update uploadFile() for retry:
  - [ ] Use ExponentialBackoffRetry
  - [ ] Max 3 attempts
  - [ ] Use RETRY_CONFIGS.FILE_TRANSFER
- [ ] Add circuit breaker per host:
  - [ ] Same approach as connection pool
  - [ ] Track transfer failures
  - [ ] Open after 3 consecutive failures
- [ ] Add error classification:
  - [ ] Network timeout → TRANSIENT
  - [ ] Permission denied → PERMANENT
  - [ ] File not found → PERMANENT
- [ ] Add logging:
  - [ ] Log checkpoint saves
  - [ ] Log resume attempts
  - [ ] Log retry attempts
  - [ ] Log transfer progress

**Testing:**
- [ ] Test upload success
- [ ] Test retry on timeout
- [ ] Test resume from checkpoint
- [ ] Test no resume on permanent error
- [ ] Test circuit breaker for host

---

### Task 8: Integration Tests for SSH (4-5 hours)

**Test Files:**
- [ ] `tests/integration/ssh-resilience.test.ts` (300 lines)

**Test Scenarios:**
- [ ] SSH connection pool:
  - [ ] Normal connection success
  - [ ] Connection timeout → retry
  - [ ] Circuit breaker opens
  - [ ] Circuit breaker half-opens
  - [ ] Successful recovery
- [ ] SSH command execution:
  - [ ] Command success
  - [ ] Timeout → retry → success
  - [ ] Auth error (no retry)
  - [ ] Persistent failure (open circuit)
- [ ] File transfer:
  - [ ] Small file success
  - [ ] Large file with checkpoint
  - [ ] Transfer interrupted → resume
  - [ ] Transfer failure → circuit open
- [ ] End-to-end:
  - [ ] Multiple commands to same host
  - [ ] Cascade failure handling
  - [ ] Pool cleanup on shutdown

**Mocking/Fixtures:**
- [ ] Mock SSH server (node-pty)
- [ ] Simulate timeout conditions
- [ ] Simulate partial file transfers
- [ ] Simulate connection failures

---

## REMAINING MODULES INTEGRATION (Day 5)

### Task 9: Update Process Manager (2-3 hours)
**File:** `src/core/process-manager.ts` (+70 lines)

**Changes:**
- [ ] Add spawn retry logic:
  - [ ] Retry spawn once on EMFILE/ENOMEM
  - [ ] Use 1 second delay
  - [ ] Don't retry other errors
- [ ] Add resource exhaustion handling:
  - [ ] Detect ResourceLimitError
  - [ ] Classify as RESOURCE
  - [ ] Optionally queue request (future)
- [ ] Add timeout classification:
  - [ ] Link timeout to TIMEOUT error class
  - [ ] Allow retry on caller request
- [ ] Improve error messages:
  - [ ] Include exit code in error
  - [ ] Include signal name if killed
  - [ ] Include resource status

**Testing:**
- [ ] Test spawn retry
- [ ] Test no retry on permission error
- [ ] Test resource limit error
- [ ] Test timeout handling

---

### Task 10: Update Remote HTTP Client (2-3 hours)
**File:** `src/core/remote-http-client.ts` (+60 lines)

**Changes:**
- [ ] Import ExponentialBackoffRetry
- [ ] Import ErrorClassifier
- [ ] Wrap fetch operations in retry:
  - [ ] Use RETRY_CONFIGS.NETWORK
  - [ ] Max 3 attempts
  - [ ] Classify errors before retry
- [ ] Add circuit breaker:
  - [ ] Monitor executor service health
  - [ ] Open after 5 failures in 1 minute
  - [ ] Test in HALF_OPEN state
- [ ] Distinguish error types:
  - [ ] Timeout (TRANSIENT)
  - [ ] Connection refused (TRANSIENT)
  - [ ] 4xx errors (PERMANENT)
  - [ ] 5xx errors (TRANSIENT)
- [ ] Add logging:
  - [ ] Log retry attempts
  - [ ] Log circuit breaker state changes

**Testing:**
- [ ] Test retry on timeout
- [ ] Test no retry on 401/403
- [ ] Test circuit breaker
- [ ] Test half-open recovery

---

### Task 11: Update Tool Error Codes (1 hour)
**File:** `src/core/tool-error.ts` (+10 lines)

**Changes:**
- [ ] Add new error codes:
  - [ ] CONNECTION_TIMEOUT = 'CONNECTION_TIMEOUT'
  - [ ] DNS_RESOLUTION_FAILED = 'DNS_RESOLUTION_FAILED'
  - [ ] SSH_KEY_PERMISSION_ERROR = 'SSH_KEY_PERMISSION_ERROR'
  - [ ] RESOURCE_EXHAUSTED = 'RESOURCE_EXHAUSTED'
  - [ ] CIRCUIT_BREAKER_OPEN = 'CIRCUIT_BREAKER_OPEN'
- [ ] Add recovery suggestions for new codes:
  - [ ] CONNECTION_TIMEOUT: "Check network connectivity"
  - [ ] DNS_RESOLUTION_FAILED: "Verify hostname/DNS"
  - [ ] SSH_KEY_PERMISSION_ERROR: "Check SSH key permissions (chmod 600)"
  - [ ] RESOURCE_EXHAUSTED: "Close some resources and retry"
  - [ ] CIRCUIT_BREAKER_OPEN: "Host temporarily unavailable, try again in 30s"

**Testing:**
- [ ] Verify all error codes are defined
- [ ] Verify all codes have suggestions
- [ ] Verify error response formatting

---

### Task 12: Update Error Types (1 hour)
**File:** `src/types/shell-server/index.ts` (modify ErrorCategory)

**Changes:**
- [ ] Consider adding timeout-specific category:
  - [ ] Keep existing ErrorCategory as-is (don't break compatibility)
  - [ ] Or extend enum if safe: 'EXECUTION' already covers timeouts
- [ ] Add retryable/recoverable hints to error response
- [ ] Document error recovery expectations

---

### Task 13: End-to-End Testing (4-5 hours)

**Test Files:**
- [ ] `tests/e2e/resilience.test.ts` (200+ lines)

**Scenarios:**
- [ ] Execute SSH command with transient failure:
  - [ ] First attempt times out
  - [ ] Second attempt succeeds
  - [ ] Return success to user
- [ ] Transfer large file with interruption:
  - [ ] Transfer interrupted at 50%
  - [ ] Retry with checkpoint
  - [ ] Complete successfully
- [ ] Handle cascading failures:
  - [ ] SSH pool circuit opens
  - [ ] New attempts rejected immediately
  - [ ] Wait period expires
  - [ ] Recovery attempt succeeds
- [ ] Process spawn exhaustion:
  - [ ] Create max processes
  - [ ] Try to spawn more
  - [ ] Get RESOURCE_EXHAUSTED
  - [ ] Wait, retry successfully
- [ ] Fetch with timeout:
  - [ ] First attempt times out
  - [ ] Retry with backoff
  - [ ] Eventually succeed or exhaust retries

---

## DOCUMENTATION & CLEANUP (Day 5 Afternoon)

### Task 14: Code Documentation (1-2 hours)
- [ ] Add JSDoc to all new classes
- [ ] Document retry strategies
- [ ] Document circuit breaker behavior
- [ ] Add code examples for each component
- [ ] Document configuration options
- [ ] Document error classification rules

### Task 15: Update Project Documentation (1 hour)
- [ ] Update README.md with error handling info
- [ ] Add troubleshooting guide
- [ ] Document circuit breaker states
- [ ] Document retry strategies
- [ ] Link to PHASE2_ERROR_ANALYSIS.md

### Task 16: Code Quality & Cleanup (1-2 hours)
- [ ] Run linter: `npm run lint`
- [ ] Fix any warnings
- [ ] Run formatter: `npm run format`
- [ ] Remove console.log statements
- [ ] Review logging consistency
- [ ] Check for dead code

### Task 17: Testing & Coverage (2-3 hours)
- [ ] Run all tests: `npm test`
- [ ] Check coverage: `npm run coverage`
- [ ] Target: > 85% overall
- [ ] Target: > 90% for resilience code
- [ ] Fix any failing tests
- [ ] Add missing test cases

### Task 18: Final Verification (1 hour)
- [ ] Build project: `npm run build`
- [ ] Type check: `npm run type-check`
- [ ] No TypeScript errors
- [ ] All tests passing
- [ ] Documentation complete

---

## GIT WORKFLOW

### Commit Strategy
```
// Core framework
commit: "feat(resilience): add ExponentialBackoffRetry strategy"
commit: "feat(resilience): add CircuitBreaker pattern"
commit: "feat(resilience): add ErrorClassifier utility"

// SSH integration
commit: "refactor(ssh): integrate retry strategy"
commit: "refactor(ssh): add circuit breaker for connection pool"
commit: "refactor(ssh): implement file transfer resume logic"

// Remaining modules
commit: "refactor(process): add spawn retry logic"
commit: "refactor(http): add exponential backoff to client"

// Error codes
commit: "feat(errors): add new error codes for Phase 2"

// Tests
commit: "test(resilience): comprehensive unit tests"
commit: "test(ssh): integration tests for resilience"
commit: "test(e2e): end-to-end resilience scenarios"

// Docs
commit: "docs: add Phase 2 error handling documentation"

// Final
commit: "chore: Phase 2 implementation complete"
```

### Before Final Merge
- [ ] All tests passing
- [ ] Coverage > 85%
- [ ] No linter warnings
- [ ] Documentation complete
- [ ] Code review approved
- [ ] Create pull request with detailed summary
- [ ] Link to PHASE2_ERROR_ANALYSIS.md
- [ ] Link to this checklist

---

## SUCCESS CRITERIA

### Code Quality
- [ ] All new code has > 90% test coverage
- [ ] No TypeScript errors or warnings
- [ ] Linter passes without warnings
- [ ] Code formatted consistently

### Functionality
- [ ] Retry logic works for transient errors
- [ ] Circuit breaker prevents cascading failures
- [ ] Error classification accurate
- [ ] SSH resilience improved (no manual retries needed)
- [ ] File transfers can resume
- [ ] Process spawn retries once on resource error

### Performance
- [ ] No significant performance degradation
- [ ] Retry backoff doesn't exceed 5 seconds
- [ ] Circuit breaker doesn't add overhead
- [ ] Normal operations < 5% slower

### Reliability
- [ ] Transient SSH failures auto-retry
- [ ] Large file transfers resume properly
- [ ] Process spawn errors handled gracefully
- [ ] HTTP timeouts retried automatically

### Documentation
- [ ] PHASE2_ERROR_ANALYSIS.md complete
- [ ] Code documented with JSDoc
- [ ] Examples provided for each component
- [ ] Troubleshooting guide updated

---

## RISK MITIGATION

### High Risk: Circular Dependencies
- [ ] Careful import ordering in new files
- [ ] No imports from shell/main.ts in core
- [ ] Review import tree before merge

### High Risk: Infinite Retry Loops
- [ ] Max attempts enforced in every strategy
- [ ] shouldRetry() predicate prevents retrying permanent errors
- [ ] Circuit breaker prevents repeated attempts to failing service
- [ ] Comprehensive testing of retry limits

### High Risk: Data Loss in File Transfer
- [ ] Checkpoints saved before resume
- [ ] Hash verification of transferred portion
- [ ] Tests with simulated interruptions
- [ ] Graceful fallback if resume fails

### Medium Risk: Performance Impact
- [ ] Backoff delays must not exceed 5s
- [ ] Circuit breaker initialized lazily
- [ ] No unnecessary memory allocation
- [ ] Load test with high concurrency

---

## ESTIMATED TIMELINE

| Phase | Days | Hours | Status |
|-------|------|-------|--------|
| Core Framework | 2 | 15-18 | Starting |
| SSH Integration | 2 | 12-15 | After framework |
| Remaining | 0.5 | 5-8 | After SSH |
| Docs & Testing | 0.5 | 8-10 | Final |
| **Total Week 5** | **5** | **40-51** | - |

---

## NOTES FOR DEVELOPER

1. **Start with core framework first** - Don't integrate before tests pass
2. **Write tests as you code** - Not after (TDD approach)
3. **Keep commits small** - One feature per commit
4. **Review imports carefully** - Check for circular deps
5. **Use meaningful variable names** - No abbreviations
6. **Document as you go** - Don't save for end
7. **Test edge cases** - Timeouts, max retries, state transitions
8. **Consider backwards compatibility** - Don't break existing callers
9. **Log comprehensively** - DEBUG level for all operations
10. **Run tests frequently** - After each major change

---

## USEFUL COMMANDS

```bash
# Run all tests
npm test

# Run specific test file
npm test -- retry-strategy.test.ts

# Check coverage
npm run coverage

# Type check
npm run type-check

# Lint and fix
npm run lint:fix

# Build
npm run build

# Run with debug logging
DEBUG=* npm test

# Create test file
npm run new:test tests/unit/core/my-test.ts
```

---

**Created:** 2026-03-15
**Week:** 5 (Phase 2)
**Status:** Ready for implementation
**Estimated Hours:** 40-51
