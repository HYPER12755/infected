import { spawn, ChildProcess } from 'node:child_process';
import {
  ExecutionStrategy,
  ExecutionStrategyConfig,
  StrategyExecutionResult,
  ExecutionTimeoutError,
  AdvancedExecutionStrategy,
} from './execution-strategy.js';
import { getSafeEnvironment, sanitizeString } from '../../utils/shell-helpers.js';
import logger from '../logger.js';

/**
 * Configuration specific to foreground strategy
 */
export interface ForegroundStrategyConfig extends ExecutionStrategyConfig {
  /** Shell path to use (defaults to '/bin/bash') */
  shellPath?: string;
}

/**
 * Foreground execution strategy.
 * Waits for process completion with real-time output streaming.
 * Handles signals: SIGINT → SIGTERM → SIGKILL
 *
 * **Characteristics:**
 * - Blocks until process completes or times out
 * - Streams stdout/stderr in real-time
 * - Supports interactive stdin
 * - Handles graceful shutdown sequence
 * - Suitable for interactive commands and monitoring
 *
 * **Example:**
 * ```typescript
 * const strategy = new ForegroundStrategy({
 *   timeoutMs: 30000,
 *   killGracePeriodMs: 5000,
 *   captureStderr: true,
 *   maxOutputSize: 1024 * 1024,
 *   workingDirectory: process.cwd(),
 *   shellPath: '/bin/bash'
 * });
 *
 * const result = await strategy.execute('npm test', 'exec-123');
 * console.log(`Exit code: ${result.exitCode}`);
 * ```
 */
export class ForegroundStrategy
  extends ExecutionStrategy<ForegroundStrategyConfig, StrategyExecutionResult>
  implements AdvancedExecutionStrategy
{
  private childProcess?: ChildProcess;
  private progressCallback?: (update: any) => void;
  private timeoutHandle?: NodeJS.Timeout;

  constructor(config: ForegroundStrategyConfig) {
    super(config);
    this.config = {
      shellPath: '/bin/bash',
      ...config,
    };
  }

  /**
   * Execute a command in foreground mode.
   * Waits for completion and streams output.
   */
  async execute(command: string, executionId: string): Promise<StrategyExecutionResult> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';
      let outputTruncated = false;

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
      logger.debug(`[ForegroundStrategy] Started process ${pid} for execution ${executionId}`);

      // Set up timeout
      this.timeoutHandle = setTimeout(async () => {
        logger.warn(`[ForegroundStrategy] Timeout for execution ${executionId}, starting graceful shutdown`);
        this.childProcess?.kill('SIGTERM');

        // Wait for grace period, then force kill
        setTimeout(() => {
          if (this.childProcess && !this.childProcess.killed) {
            logger.warn(`[ForegroundStrategy] Force killing process ${pid}`);
            this.childProcess.kill('SIGKILL');
          }
        }, this.config.killGracePeriodMs);

        const duration = Date.now() - startTime;
        reject(new ExecutionTimeoutError(this.config.timeoutMs));
      }, this.config.timeoutMs);

      // Send input data
      if (this.config.inputData) {
        this.childProcess.stdin?.write(this.config.inputData);
        this.childProcess.stdin?.end();
      } else {
        this.childProcess.stdin?.end();
      }

      // Handle stdout
      this.childProcess.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        if (stdout.length + chunk.length <= this.config.maxOutputSize) {
          stdout += chunk;
        } else {
          stdout += chunk.substring(0, this.config.maxOutputSize - stdout.length);
          outputTruncated = true;
        }

        if (this.progressCallback) {
          this.progressCallback({ type: 'stdout', data: chunk });
        }
      });

      // Handle stderr
      if (this.config.captureStderr) {
        this.childProcess.stderr?.on('data', (data: Buffer) => {
          const chunk = data.toString();
          if (stderr.length + chunk.length <= this.config.maxOutputSize) {
            stderr += chunk;
          } else {
            stderr += chunk.substring(0, this.config.maxOutputSize - stderr.length);
            outputTruncated = true;
          }

          if (this.progressCallback) {
            this.progressCallback({ type: 'stderr', data: chunk });
          }
        });
      }

      // Handle process close
      this.childProcess.on('close', async (code) => {
        clearTimeout(this.timeoutHandle);
        const duration = Date.now() - startTime;

        logger.debug(`[ForegroundStrategy] Process ${pid} closed with exit code ${code}`);

        resolve({
          exitCode: code || 0,
          stdout: sanitizeString(stdout),
          stderr: sanitizeString(stderr),
          duration,
          outputTruncated,
        });
      });

      // Handle process error
      this.childProcess.on('error', (error) => {
        clearTimeout(this.timeoutHandle);
        const duration = Date.now() - startTime;

        logger.error(`[ForegroundStrategy] Process error for ${executionId}:`, error);

        reject(error);
      });
    });
  }

  /**
   * Clean up resources
   */
  async cleanup(childProcess?: ChildProcess, timeoutHandle?: NodeJS.Timeout): Promise<void> {
    if (timeoutHandle) clearTimeout(timeoutHandle);

    const processToClean = childProcess || this.childProcess;
    if (processToClean && !processToClean.killed) {
      try {
        processToClean.kill('SIGTERM');
        logger.debug(`[ForegroundStrategy] Cleaned up process ${processToClean.pid}`);
      } catch (error) {
        logger.error('[ForegroundStrategy] Error during cleanup:', error);
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
   * Foreground strategy supports interactive input
   */
  supportsInteractive(): boolean {
    return true;
  }

  /**
   * Get execution mode
   */
  getExecutionMode() {
    return 'foreground' as const;
  }
}
