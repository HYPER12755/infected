import { spawn, ChildProcess } from 'node:child_process';
import {
  ExecutionStrategy,
  ExecutionStrategyConfig,
  StrategyExecutionResult,
  AdvancedExecutionStrategy,
} from './execution-strategy.js';
import { getSafeEnvironment, sanitizeString } from '../../utils/shell-helpers.js';
import logger from '../logger.js';

/**
 * Configuration specific to adaptive strategy
 */
export interface AdaptiveStrategyConfig extends ExecutionStrategyConfig {
  /** Shell path to use (defaults to '/bin/bash') */
  shellPath?: string;
  /** Foreground timeout in milliseconds before transitioning to background (default: 480s) */
  foregroundTimeoutMs?: number;
  /** Size threshold in bytes for transitioning to background (default: 1MB) */
  outputSizeThreshold?: number;
}

/**
 * Result with additional adaptive-specific information
 */
export interface AdaptiveExecutionResult extends StrategyExecutionResult {
  /** Whether process transitioned to background */
  transitionedToBackground?: boolean;
  /** Reason for transition if it occurred */
  transitionReason?: 'timeout' | 'output_size_limit';
}

/**
 * Adaptive execution strategy.
 * Smart mode that streams if output is small, buffers if output is large.
 * Automatically transitions to background if foreground timeout or output limit is exceeded.
 *
 * **Characteristics:**
 * - Auto-detects expected output size
 * - Streams for small output (< 1MB)
 * - Transitions to background for large output or long-running processes
 * - Graceful degradation if output exceeds limit
 * - Suitable for general-purpose command execution
 *
 * **Transition Logic:**
 * 1. Process starts in foreground mode
 * 2. If output size exceeds threshold → transitions to background
 * 3. If foreground timeout exceeded → transitions to background
 * 4. Otherwise completes normally
 *
 * **Example:**
 * ```typescript
 * const strategy = new AdaptiveStrategy({
 *   timeoutMs: 600000, // Overall timeout: 10 minutes
 *   foregroundTimeoutMs: 30000, // Foreground-only: 30 seconds
 *   outputSizeThreshold: 1024 * 1024, // Transition at 1MB
 *   killGracePeriodMs: 10000,
 *   captureStderr: true,
 *   maxOutputSize: 100 * 1024 * 1024, // Allow up to 100MB output
 *   workingDirectory: process.cwd()
 * });
 *
 * const result = await strategy.execute('npm run test', 'exec-999');
 * if (result.transitionedToBackground) {
 *   console.log(`Process transitioned due to: ${result.transitionReason}`);
 * }
 * ```
 */
export class AdaptiveStrategy
  extends ExecutionStrategy<AdaptiveStrategyConfig, AdaptiveExecutionResult>
  implements AdvancedExecutionStrategy
{
  private childProcess?: ChildProcess;
  private progressCallback?: (update: any) => void;
  private foregroundTimeoutHandle?: NodeJS.Timeout;
  private finalTimeoutHandle?: NodeJS.Timeout;
  private transitioned = false;

  constructor(config: AdaptiveStrategyConfig) {
    super(config);
    this.config = {
      shellPath: '/bin/bash',
      foregroundTimeoutMs: 480 * 1000, // 480 seconds = 8 minutes
      outputSizeThreshold: 1024 * 1024, // 1MB
      ...config,
    };
  }

  /**
   * Execute a command in adaptive mode.
   * May return early if transitioning to background.
   */
  async execute(command: string, executionId: string): Promise<AdaptiveExecutionResult> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';
      let outputTruncated = false;
      let transitionReason: 'timeout' | 'output_size_limit' | null = null;

      // Prepare environment variables
      const env = getSafeEnvironment(
        process.env as Record<string, string>,
        this.config.environmentVariables
      );

      // Spawn process
      this.childProcess = spawn(this.config.shellPath || '/bin/bash', ['-c', command], {
        cwd: this.config.workingDirectory,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const pid = this.childProcess.pid;
      logger.debug(`[AdaptiveStrategy] Started process ${pid} for execution ${executionId}`);

      // Set foreground timeout
      this.foregroundTimeoutHandle = setTimeout(() => {
        if (!this.transitioned) {
          logger.info(
            `[AdaptiveStrategy] Foreground timeout for ${pid}, transitioning to background`
          );
          transitionReason = 'timeout';
          this.transitionToBackground(
            resolve,
            reject,
            startTime,
            stdout,
            stderr,
            outputTruncated,
            transitionReason
          );
        }
      }, this.config.foregroundTimeoutMs || 480000);

      // Set final timeout
      this.finalTimeoutHandle = setTimeout(async () => {
        logger.warn(`[AdaptiveStrategy] Final timeout for process ${pid}, killing`);
        this.childProcess?.kill('SIGTERM');

        setTimeout(() => {
          if (this.childProcess && !this.childProcess.killed) {
            this.childProcess.kill('SIGKILL');
          }
        }, this.config.killGracePeriodMs);

        if (!this.transitioned) {
          reject(new Error(`Process timeout after ${this.config.timeoutMs}ms`));
        }
      }, this.config.timeoutMs);

      // Send input
      if (this.config.inputData) {
        this.childProcess.stdin?.write(this.config.inputData);
        this.childProcess.stdin?.end();
      } else {
        this.childProcess.stdin?.end();
      }

      // Handle stdout
      this.childProcess.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();

        if (!this.transitioned) {
          if (stdout.length + chunk.length <= this.config.maxOutputSize) {
            stdout += chunk;

            // Check if we should transition based on size
            if (
              stdout.length > (this.config.outputSizeThreshold || 1024 * 1024) &&
              !transitionReason
            ) {
              logger.info(
                `[AdaptiveStrategy] Output size exceeded threshold for ${pid}, transitioning`
              );
              transitionReason = 'output_size_limit';
              this.transitionToBackground(
                resolve,
                reject,
                startTime,
                stdout,
                stderr,
                outputTruncated,
                transitionReason
              );
            }
          } else {
            stdout += chunk.substring(0, this.config.maxOutputSize - stdout.length);
            outputTruncated = true;
          }
        }

        if (this.progressCallback) {
          this.progressCallback({ type: 'stdout', data: chunk });
        }
      });

      // Handle stderr
      if (this.config.captureStderr) {
        this.childProcess.stderr?.on('data', (data: Buffer) => {
          const chunk = data.toString();

          if (!this.transitioned) {
            if (stderr.length + chunk.length <= this.config.maxOutputSize) {
              stderr += chunk;
            } else {
              stderr += chunk.substring(0, this.config.maxOutputSize - stderr.length);
              outputTruncated = true;
            }
          }

          if (this.progressCallback) {
            this.progressCallback({ type: 'stderr', data: chunk });
          }
        });
      }

      // Handle process close
      this.childProcess.on('close', async (code) => {
        clearTimeout(this.foregroundTimeoutHandle);
        clearTimeout(this.finalTimeoutHandle);
        const duration = Date.now() - startTime;

        if (!this.transitioned) {
          logger.debug(`[AdaptiveStrategy] Process ${pid} completed with code ${code}`);
          resolve({
            exitCode: code || 0,
            stdout: sanitizeString(stdout),
            stderr: sanitizeString(stderr),
            duration,
            outputTruncated,
            transitionedToBackground: false,
          });
        }
      });

      // Handle error
      this.childProcess.on('error', (error) => {
        clearTimeout(this.foregroundTimeoutHandle);
        clearTimeout(this.finalTimeoutHandle);

        if (!this.transitioned) {
          logger.error(`[AdaptiveStrategy] Process ${pid} error:`, error);
          reject(error);
        }
      });
    });
  }

  /**
   * Transition process to background execution
   */
  private transitionToBackground(
    resolve: (value: AdaptiveExecutionResult) => void,
    reject: (reason?: any) => void,
    startTime: number,
    stdout: string,
    stderr: string,
    outputTruncated: boolean,
    transitionReason: 'timeout' | 'output_size_limit'
  ): void {
    this.transitioned = true;
    clearTimeout(this.foregroundTimeoutHandle);

    const duration = Date.now() - startTime;

    // Return partial results with transition indication
    resolve({
      exitCode: undefined,
      stdout: sanitizeString(stdout),
      stderr: sanitizeString(stderr),
      duration,
      outputTruncated,
      transitionedToBackground: true,
      transitionReason,
    });

    // Continue background processing without blocking caller
    this.continueBackgroundExecution();
  }

  /**
   * Continue execution in background after transition
   */
  private continueBackgroundExecution(): void {
    if (!this.childProcess) return;

    const pid = this.childProcess.pid;
    logger.debug(`[AdaptiveStrategy] Continuing process ${pid} in background`);

    let bgStdout = '';
    let bgStderr = '';

    // Collect background output
    this.childProcess.stdout?.on('data', (data: Buffer) => {
      bgStdout += data.toString();
    });

    if (this.config.captureStderr) {
      this.childProcess.stderr?.on('data', (data: Buffer) => {
        bgStderr += data.toString();
      });
    }

    // Monitor background completion
    this.childProcess.on('close', (code) => {
      logger.debug(`[AdaptiveStrategy] Background process ${pid} completed with code ${code}`);
    });

    this.childProcess.on('error', (error) => {
      logger.error(`[AdaptiveStrategy] Background process ${pid} error:`, error);
    });
  }

  /**
   * Clean up resources
   */
  async cleanup(childProcess?: ChildProcess, timeoutHandle?: NodeJS.Timeout): Promise<void> {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (this.foregroundTimeoutHandle) clearTimeout(this.foregroundTimeoutHandle);
    if (this.finalTimeoutHandle) clearTimeout(this.finalTimeoutHandle);

    const processToClean = childProcess || this.childProcess;
    if (processToClean && !processToClean.killed) {
      try {
        processToClean.kill('SIGTERM');
        logger.debug(`[AdaptiveStrategy] Cleaned up process ${processToClean.pid}`);

        setTimeout(() => {
          if (processToClean && !processToClean.killed) {
            processToClean.kill('SIGKILL');
          }
        }, this.config.killGracePeriodMs);
      } catch (error) {
        logger.error('[AdaptiveStrategy] Error during cleanup:', error);
      }
    }
  }

  /**
   * Send input to the process stdin
   */
  async sendInput(data: string): Promise<void> {
    if (!this.childProcess?.stdin) {
      throw new Error('Process stdin not available');
    }
    this.childProcess.stdin.write(data);
  }

  /**
   * Interrupt the process with a signal
   */
  async interrupt(signal: NodeJS.Signals): Promise<void> {
    if (!this.childProcess) {
      throw new Error('No active process to interrupt');
    }
    this.childProcess.kill(signal);
  }

  /**
   * Register progress callback
   */
  onProgressUpdate(callback: (update: any) => void): void {
    this.progressCallback = callback;
  }

  /**
   * Adaptive strategy supports interactive input
   */
  supportsInteractive(): boolean {
    return true;
  }

  /**
   * Get execution mode
   */
  getExecutionMode() {
    return 'adaptive' as const;
  }
}
