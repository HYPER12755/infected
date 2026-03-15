/**
 * EXECUTION STRATEGIES ARCHITECTURE
 *
 * This document describes the execution strategy pattern implemented in ProcessManager.
 * It provides a pluggable architecture for process execution modes.
 *
 * ============================================================================
 * OVERVIEW
 * ============================================================================
 *
 * The execution strategy pattern extracts the 5 execution modes from ProcessManager
 * into independent, pluggable strategy classes. Each strategy encapsulates:
 * - Process spawning logic
 * - Output capture behavior
 * - Signal handling
 * - Resource cleanup
 * - Lifecycle management
 *
 * ============================================================================
 * ARCHITECTURE
 * ============================================================================
 *
 * ExecutionStrategy (Base Class)
 * ├── ForegroundStrategy
 * ├── BackgroundStrategy
 * ├── DetachedStrategy
 * └── AdaptiveStrategy
 *
 * ExecutionStrategyFactory (Factory Pattern)
 * └── Creates and manages strategy instances
 *
 * ============================================================================
 * EXECUTION MODES
 * ============================================================================
 *
 * 1. FOREGROUND STRATEGY
 *    Purpose: Real-time execution with streaming output
 *    - Blocks until process completes
 *    - Streams stdout/stderr in real-time
 *    - Handles SIGINT → SIGTERM → SIGKILL chain
 *    - Suitable for: interactive commands, monitoring, testing
 *    - Time Complexity: O(n) where n = output size
 *    - Memory: Buffers output up to maxOutputSize
 *
 *    Use Cases:
 *    - npm test
 *    - Interactive shell commands
 *    - Long-running monitoring processes
 *
 * 2. BACKGROUND STRATEGY
 *    Purpose: Non-blocking execution with deferred monitoring
 *    - Returns immediately with process ID
 *    - Continues execution in background
 *    - Auto-cleanup after TTL (default 24h)
 *    - Suitable for: build processes, long-running tasks
 *    - Time Complexity: O(1) return time
 *    - Memory: Buffers output asynchronously
 *
 *    Use Cases:
 *    - npm run build (large projects)
 *    - Database migrations
 *    - File processing jobs
 *
 * 3. DETACHED STRATEGY
 *    Purpose: Fire-and-forget execution with minimal overhead
 *    - Returns immediately
 *    - No output capture
 *    - No signal handling
 *    - Process survives parent process death
 *    - Suitable for: daemon processes, background jobs
 *    - Time Complexity: O(1)
 *    - Memory: Minimal (no output buffering)
 *
 *    Use Cases:
 *    - nohup daemon start
 *    - Background service spawning
 *    - Scheduled jobs
 *
 * 4. ADAPTIVE STRATEGY
 *    Purpose: Smart execution with automatic mode transition
 *    - Starts in foreground mode
 *    - Transitions to background if:
 *      * Output exceeds threshold (default 1MB)
 *      * Foreground timeout exceeded (default 480s)
 *    - Graceful degradation for large outputs
 *    - Suitable for: general-purpose execution
 *    - Time Complexity: O(1) with possible O(n) transition
 *    - Memory: Buffers up to threshold, then streams
 *
 *    Use Cases:
 *    - Generic command execution
 *    - Unknown output size
 *    - Heterogeneous workload handling
 *
 * ============================================================================
 * FACTORY PATTERN USAGE
 * ============================================================================
 *
 * The ExecutionStrategyFactory provides a unified interface for:
 * - Creating strategy instances
 * - Registering custom strategies
 * - Validating execution modes
 * - Applying default configurations
 *
 * Example: Creating Strategies
 * ────────────────────────────
 *
 * import { ExecutionStrategyFactory } from './execution-strategies';
 *
 * const factory = new ExecutionStrategyFactory({
 *   defaultTimeoutMs: 300000,
 *   defaultKillGracePeriodMs: 5000
 * });
 *
 * // Create specific strategy
 * const fgStrategy = factory.createStrategy('foreground', {
 *   timeoutMs: 30000,
 *   captureStderr: true,
 *   maxOutputSize: 1024 * 1024,
 *   workingDirectory: process.cwd()
 * });
 *
 * // Execute command
 * const result = await fgStrategy.execute('npm test', 'exec-123');
 * console.log(`Exit code: ${result.exitCode}`);
 * console.log(`Duration: ${result.duration}ms`);
 *
 * Example: Batch Strategy Creation
 * ────────────────────────────────
 *
 * const strategies = factory.createAllStrategies({
 *   captureStderr: true,
 *   maxOutputSize: 10 * 1024 * 1024,
 *   workingDirectory: '/tmp'
 * });
 *
 * // Use strategies
 * const fgResult = await strategies.get('foreground')!.execute(cmd, id);
 * const bgResult = await strategies.get('background')!.execute(cmd, id);
 *
 * Example: Custom Strategy Registration
 * ──────────────────────────────────────
 *
 * class CustomStreamingStrategy extends ExecutionStrategy {
 *   async execute(command, executionId) { ... }
 *   async cleanup(childProcess, timeout) { ... }
 *   supportsInteractive() { return true; }
 *   getExecutionMode() { return 'custom'; }
 * }
 *
 * factory.registerStrategy('custom', CustomStreamingStrategy);
 * const custom = factory.createStrategy('custom', config);
 *
 * ============================================================================
 * INTEGRATION WITH PROCESSMANAGER
 * ============================================================================
 *
 * ProcessManager Integration Steps (Wave 2):
 *
 * 1. Import factory
 *    import { ExecutionStrategyFactory } from './execution-strategies';
 *
 * 2. Initialize in ProcessManager constructor
 *    this.strategyFactory = new ExecutionStrategyFactory();
 *
 * 3. Replace execution mode switch statement
 *    OLD:
 *    switch (options.executionMode) {
 *      case 'foreground':
 *        return await this.executeForegroundCommand(...);
 *      // ...
 *    }
 *
 *    NEW:
 *    const strategy = this.strategyFactory.createStrategy(
 *      options.executionMode,
 *      {
 *        timeoutMs: options.timeoutSeconds * 1000,
 *        killGracePeriodMs: GRACEFUL_SHUTDOWN_TIMEOUT,
 *        captureStderr: options.captureStderr,
 *        maxOutputSize: options.maxOutputSize,
 *        workingDirectory: this.resolveWorkingDirectory(options.workingDirectory),
 *        environmentVariables: options.environmentVariables,
 *        inputData: options.inputData
 *      }
 *    );
 *
 *    return await strategy.execute(options.command, executionId);
 *
 * 4. Remove individual execute*Command methods from ProcessManager
 *    - executeForegroundCommand
 *    - executeAdaptiveCommand
 *    - executeBackgroundCommand
 *    - executeDetachedCommand
 *
 * 5. Update tests to use ExecutionStrategyFactory
 *
 * ============================================================================
 * CONFIGURATION REFERENCE
 * ============================================================================
 *
 * ExecutionStrategyConfig Interface:
 * ──────────────────────────────────
 *
 * interface ExecutionStrategyConfig {
 *   // Timeout for overall execution (milliseconds)
 *   timeoutMs: number;
 *
 *   // Grace period for SIGTERM before SIGKILL (milliseconds)
 *   killGracePeriodMs: number;
 *
 *   // Whether to capture stderr output
 *   captureStderr: boolean;
 *
 *   // Maximum output size before truncation (bytes)
 *   maxOutputSize: number;
 *
 *   // Working directory for process execution
 *   workingDirectory: string;
 *
 *   // Environment variables to pass to process
 *   environmentVariables?: EnvironmentVariables;
 *
 *   // Input data to send via stdin
 *   inputData?: string;
 * }
 *
 * Strategy-Specific Config:
 * ──────────────────────────
 *
 * ForegroundStrategyConfig:
 *   - shellPath: '/bin/bash' (defaults to /bin/bash)
 *
 * BackgroundStrategyConfig:
 *   - shellPath: '/bin/bash'
 *   - historyTTLMs: 24 * 60 * 60 * 1000 (default 24 hours)
 *
 * AdaptiveStrategyConfig:
 *   - shellPath: '/bin/bash'
 *   - foregroundTimeoutMs: 480000 (default 480 seconds / 8 minutes)
 *   - outputSizeThreshold: 1048576 (default 1MB)
 *
 * ============================================================================
 * RESULT TYPES
 * ============================================================================
 *
 * StrategyExecutionResult:
 * ───────────────────────
 * {
 *   exitCode?: number;           // Process exit code
 *   stdout: string;              // Standard output
 *   stderr: string;              // Standard error (if captureStderr=true)
 *   duration: number;            // Execution time in milliseconds
 *   signalReceived?: string;     // If terminated by signal
 *   outputTruncated: boolean;    // Whether output was truncated
 *   error?: Error;               // Execution error if any
 * }
 *
 * AdaptiveExecutionResult (extends StrategyExecutionResult):
 * ──────────────────────────────────────────────────────────
 * {
 *   ...StrategyExecutionResult,
 *   transitionedToBackground?: boolean;  // Whether mode switched
 *   transitionReason?: 'timeout' | 'output_size_limit';
 * }
 *
 * ============================================================================
 * ERROR HANDLING
 * ============================================================================
 *
 * Strategies may throw:
 * - ExecutionTimeoutError: Process exceeded timeout
 * - ProcessNotFoundError: Process PID not found
 * - ProcessTerminationError: Failed to terminate process
 * - Error: Process execution failed
 *
 * Example Error Handling:
 * ───────────────────────
 *
 * try {
 *   const result = await strategy.execute(command, id);
 * } catch (error) {
 *   if (error instanceof ExecutionTimeoutError) {
 *     console.error(`Process timed out after ${error.message}`);
 *   } else if (error instanceof ProcessNotFoundError) {
 *     console.error(`Process no longer exists`);
 *   } else {
 *     console.error(`Execution failed: ${error.message}`);
 *   }
 * }
 *
 * ============================================================================
 * PERFORMANCE CHARACTERISTICS
 * ============================================================================
 *
 * Strategy      Time Complexity    Memory Complexity    Best For
 * ──────────────────────────────────────────────────────────────────
 * Foreground    O(n)              O(min(n, maxSize))   Real-time interactive
 * Background    O(1)              O(min(n, maxSize))   Deferred monitoring
 * Detached      O(1)              O(1)                 Fire-and-forget
 * Adaptive      O(1) to O(n)      O(min(n, maxSize))   Unknown output size
 *
 * Where n = output size
 *
 * ============================================================================
 * TESTING
 * ============================================================================
 *
 * Unit Testing Strategies:
 *
 * describe('ForegroundStrategy', () => {
 *   it('should execute command and return output', async () => {
 *     const strategy = new ForegroundStrategy(config);
 *     const result = await strategy.execute('echo hello', 'test-1');
 *     expect(result.stdout).toContain('hello');
 *     expect(result.exitCode).toBe(0);
 *   });
 *
 *   it('should timeout on long-running process', async () => {
 *     const strategy = new ForegroundStrategy({
 *       ...config,
 *       timeoutMs: 100
 *     });
 *     await expect(
 *       strategy.execute('sleep 10', 'test-2')
 *     ).rejects.toThrow(ExecutionTimeoutError);
 *   });
 * });
 *
 * Integration Testing Factory:
 *
 * describe('ExecutionStrategyFactory', () => {
 *   it('should create all strategies', () => {
 *     const factory = new ExecutionStrategyFactory();
 *     const fg = factory.createStrategy('foreground', config);
 *     const bg = factory.createStrategy('background', config);
 *     const dt = factory.createStrategy('detached', config);
 *     const ad = factory.createStrategy('adaptive', config);
 *
 *     expect(fg.getExecutionMode()).toBe('foreground');
 *     expect(bg.getExecutionMode()).toBe('background');
 *     expect(dt.getExecutionMode()).toBe('detached');
 *     expect(ad.getExecutionMode()).toBe('adaptive');
 *   });
 * });
 *
 * ============================================================================
 * MIGRATION GUIDE
 * ============================================================================
 *
 * Step 1: Create Strategy Factory
 *   - Add factory initialization to ProcessManager
 *   - Initialize with default timeout/gracePeriod configs
 *
 * Step 2: Replace Strategy Selection Logic
 *   - Replace switch statement with factory.createStrategy()
 *   - Map ExecutionOptions to ExecutionStrategyConfig
 *
 * Step 3: Update Execution Logic
 *   - Replace individual execute*Command() calls with strategy.execute()
 *   - Update result handling for unified StrategyExecutionResult format
 *
 * Step 4: Clean Up Legacy Code
 *   - Remove executeForegroundCommand, executeAdaptiveCommand, etc.
 *   - Remove handleBackgroundProcess, handleAdaptiveBackgroundTransition, etc.
 *   - Remove executeCommandWithInputStream (move to ForegroundStrategy if needed)
 *
 * Step 5: Update Tests
 *   - Add ExecutionStrategyFactory tests
 *   - Update ProcessManager tests to verify factory integration
 *   - Add integration tests for strategy selection
 *
 * ============================================================================
 */

// This file serves as comprehensive documentation.
// For implementation details, see individual strategy files.
export {};
