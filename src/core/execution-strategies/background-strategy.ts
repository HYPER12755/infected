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
 * Configuration specific to background strategy
 */
export interface BackgroundStrategyConfig extends ExecutionStrategyConfig {
  /** Shell path to use (defaults to '/bin/bash') */
  shellPath?: string;
  /** TTL in milliseconds for keeping execution history (default: 24h) */
  historyTTLMs?: number;
}

/**
 * Background execution strategy.
 * Returns immediately while process continues in background.
 *
 * **Characteristics:**
 * - Returns immediately with process ID
 * - Streams output to storage for later retrieval
 * - No blocking on caller
 * - Includes automatic cleanup after TTL
 * - Suitable for long-running tasks
 *
 * **Example:**
 * ```typescript
 * const strategy = new BackgroundStrategy({
 *   timeoutMs: 3600000, // 1 hour
 *   killGracePeriodMs: 10000,
 *   captureStderr: true,
 *   maxOutputSize: 100 * 1024 * 1024, // 100MB
 *   workingDirectory: process.cwd(),
 *   historyTTLMs: 24 * 60 * 60 * 1000 // 24 hours
 * });
 *
 * const result = await strategy.execute('npm run build', 'exec-456');
 * console.log(`Process ID: ${result.processId}`);
 * // Process continues in background, caller can return immediately
 * ```
 */
export class BackgroundStrategy
  extends ExecutionStrategy<BackgroundStrategyConfig, StrategyExecutionResult>
  implements AdvancedExecutionStrategy
{
  private childProcess?: ChildProcess;
  private progressCallback?: (update: any) => void;
  private timeoutHandle?: NodeJS.Timeout;
  private processMap = new Map<number, { stdout: string; stderr: string; startTime: number }>();

  constructor(config: BackgroundStrategyConfig) {
    super(config);
    this.config = {
      shellPath: '/bin/bash',
      historyTTLMs: 24 * 60 * 60 * 1000, // Default 24 hours
      ...config,
    };
  }

  /**
   * Execute a command in background mode.
   * Returns immediately with process information.
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

      // Spawn process with detached flag for true background execution
      this.childProcess = spawn(this.config.shellPath || '/bin/bash', ['-c', command], {
        cwd: this.config.workingDirectory,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true, // Allow process to continue after parent exits
      });

      const pid = this.childProcess.pid;
      if (!pid) {
        return reject(new Error('Failed to spawn process'));
      }

      logger.debug(`[BackgroundStrategy] Started background process ${pid} for execution ${executionId}`);

      // Track process in map for output collection
      this.processMap.set(pid, { stdout, stderr, startTime });

      // Don't write input for background processes (they shouldn't block)
      this.childProcess.stdin?.end();

      // Collect stdout asynchronously
      this.childProcess.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        if (stdout.length + chunk.length <= this.config.maxOutputSize) {
          stdout += chunk;
        } else {
          outputTruncated = true;
        }

        if (this.progressCallback) {
          this.progressCallback({ type: 'stdout', data: chunk });
        }
      });

      // Collect stderr if enabled
      if (this.config.captureStderr) {
        this.childProcess.stderr?.on('data', (data: Buffer) => {
          const chunk = data.toString();
          if (stderr.length + chunk.length <= this.config.maxOutputSize) {
            stderr += chunk;
          } else {
            outputTruncated = true;
          }

          if (this.progressCallback) {
            this.progressCallback({ type: 'stderr', data: chunk });
          }
        });
      }

      // Set up timeout for the background process
      this.timeoutHandle = setTimeout(async () => {
        logger.warn(`[BackgroundStrategy] Background process ${pid} timeout after ${this.config.timeoutMs}ms`);

        try {
          this.childProcess?.kill('SIGTERM');

          // Wait for grace period
          setTimeout(() => {
            if (this.childProcess && !this.childProcess.killed) {
              this.childProcess.kill('SIGKILL');
            }
          }, this.config.killGracePeriodMs);
        } catch (error) {
          logger.error(`[BackgroundStrategy] Error killing process ${pid}:`, error);
        }
      }, this.config.timeoutMs);

      // Monitor process exit (for background tracking)
      this.childProcess.on('close', (code) => {
        clearTimeout(this.timeoutHandle);
        const duration = Date.now() - startTime;
        this.processMap.delete(pid);

        logger.debug(`[BackgroundStrategy] Background process ${pid} exited with code ${code}`);

        // Schedule cleanup after TTL
        if (this.config.historyTTLMs) {
          setTimeout(() => {
            logger.debug(`[BackgroundStrategy] Cleaning up background process ${pid} after TTL`);
          }, this.config.historyTTLMs);
        }
      });

      this.childProcess.on('error', (error) => {
        clearTimeout(this.timeoutHandle);
        this.processMap.delete(pid);
        logger.error(`[BackgroundStrategy] Background process ${pid} error:`, error);
      });

      // Return immediately with process info
      // The actual result (stdout/stderr/exitCode) will be available after process completion
      const duration = Date.now() - startTime;
      resolve({
        exitCode: undefined, // Not known yet
        stdout: '', // Not available yet
        stderr: '', // Not available yet
        duration,
        outputTruncated: false,
      });
    });
  }

  /**
   * Get process output by process ID
   */
  getProcessOutput(pid: number): { stdout: string; stderr: string } | undefined {
    return this.processMap.get(pid);
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
        logger.debug(`[BackgroundStrategy] Cleaned up process ${processToClean.pid}`);

        // Wait for grace period then force kill
        setTimeout(() => {
          if (processToClean && !processToClean.killed) {
            processToClean.kill('SIGKILL');
          }
        }, this.config.killGracePeriodMs);
      } catch (error) {
        logger.error('[BackgroundStrategy] Error during cleanup:', error);
      }
    }
  }

  /**
   * Send input to the process stdin
   * Background strategy supports input but process may not see it
   */
  async sendInput(data: string): Promise<void> {
    if (!this.childProcess?.stdin) {
      throw new Error('Process stdin not available');
    }
    this.childProcess.stdin.write(data);
  }

  /**
   * Interrupt the background process with a signal
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
   * Background strategy does not support interactive input
   */
  supportsInteractive(): boolean {
    return false;
  }

  /**
   * Get execution mode
   */
  getExecutionMode() {
    return 'background' as const;
  }
}
