import { ExecutionInfo, ExecutionMode, EnvironmentVariables } from '../../types/shell-server/index.js';
import { ChildProcess } from 'node:child_process';

/**
 * Configuration options for execution strategies
 */
export interface ExecutionStrategyConfig {
  /** Timeout in milliseconds for overall execution */
  timeoutMs: number;
  /** Grace period in milliseconds for SIGTERM before SIGKILL */
  killGracePeriodMs: number;
  /** Whether to capture stderr output */
  captureStderr: boolean;
  /** Maximum output size in bytes before truncation */
  maxOutputSize: number;
  /** Working directory for process execution */
  workingDirectory: string;
  /** Environment variables to pass to process */
  environmentVariables?: EnvironmentVariables;
  /** Input data to send via stdin */
  inputData?: string;
  /** Callback invoked when the strategy reports completion (background/async flows) */
  onComplete?: (executionId: string, result: StrategyExecutionResult) => void;
}

/**
 * Result from strategy execution with timing and status information
 */
export interface StrategyExecutionResult {
  exitCode?: number;
  stdout: string;
  stderr: string;
  duration: number; // milliseconds
  signalReceived?: string;
  outputTruncated: boolean;
  processId?: number;
  error?: Error;
}

/**
 * Base interface for all execution strategies.
 * Each strategy defines how processes are spawned, monitored, and cleaned up.
 *
 * @template TConfig Configuration type for this strategy
 * @template TResult Result type returned by this strategy
 */
export abstract class ExecutionStrategy<
  TConfig extends ExecutionStrategyConfig = ExecutionStrategyConfig,
  TResult = StrategyExecutionResult
> {
  /**
   * Execution configuration
   */
  protected config: TConfig;

  /**
   * Create a new execution strategy with given configuration
   */
  constructor(config: TConfig) {
    this.config = config;
  }

  /**
   * Execute the command with this strategy's execution mode.
   *
   * @param command The shell command to execute
   * @param executionId Unique identifier for this execution
   * @returns Promise resolving to the strategy-specific result
   *
   * @example
   * const strategy = new ForegroundStrategy(config);
   * const result = await strategy.execute('echo hello', 'exec-123');
   * console.log(result.stdout); // "hello"
   */
  abstract execute(command: string, executionId: string): Promise<TResult>;

  /**
   * Clean up resources used by this strategy.
   * Called after execution completes or on error.
   *
   * @param childProcess The child process to clean up (if applicable)
   * @param timeoutHandle The timeout handle to clear (if applicable)
   *
   * @example
   * await strategy.cleanup(childProcess, timeoutHandle);
   */
  abstract cleanup(childProcess?: ChildProcess, timeoutHandle?: NodeJS.Timeout): Promise<void>;

  /**
   * Check if this strategy supports interactive input via stdin
   *
   * @returns true if interactive input is supported, false otherwise
   *
   * @example
   * if (strategy.supportsInteractive()) {
   *   await strategy.sendInput('user input');
   * }
   */
  abstract supportsInteractive(): boolean;

  /**
   * Get the execution mode name for this strategy
   *
   * @returns The execution mode (e.g., 'foreground', 'background')
   */
  abstract getExecutionMode(): ExecutionMode;

  /**
   * Get current timeout configuration
   */
  getTimeoutMs(): number {
    return this.config.timeoutMs;
  }

  /**
   * Set timeout configuration
   */
  setTimeoutMs(timeoutMs: number): void {
    this.config.timeoutMs = timeoutMs;
  }

  /**
   * Get kill grace period configuration
   */
  getKillGracePeriodMs(): number {
    return this.config.killGracePeriodMs;
  }

  /**
   * Set kill grace period configuration
   */
  setKillGracePeriodMs(gracePeriodMs: number): void {
    this.config.killGracePeriodMs = gracePeriodMs;
  }
}

/**
 * Extended strategy interface for strategies that support additional lifecycle hooks.
 * Used by foreground, background, and adaptive strategies.
 */
export interface AdvancedExecutionStrategy extends ExecutionStrategy {
  /**
   * Send input data via stdin during execution
   */
  sendInput(data: string): Promise<void>;

  /**
   * Interrupt the process with a signal (SIGTERM, SIGINT, etc.)
   */
  interrupt(signal: NodeJS.Signals): Promise<void>;

  /**
   * Monitors process and returns updates about execution status
   */
  onProgressUpdate?(
    callback: (update: { type: 'stdout' | 'stderr' | 'status'; data?: string; status?: string }) => void
  ): void;
}

/**
 * Error thrown when a process execution times out
 */
export class ExecutionTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Process execution timed out after ${timeoutMs}ms`);
    this.name = 'ExecutionTimeoutError';
  }
}

/**
 * Error thrown when a process cannot be found (already terminated)
 */
export class ProcessNotFoundError extends Error {
  constructor(pid: number) {
    super(`Process with PID ${pid} not found`);
    this.name = 'ProcessNotFoundError';
  }
}

/**
 * Error thrown when process termination fails
 */
export class ProcessTerminationError extends Error {
  constructor(pid: number, signal: string, message: string) {
    super(`Failed to terminate process ${pid} with signal ${signal}: ${message}`);
    this.name = 'ProcessTerminationError';
  }
}
