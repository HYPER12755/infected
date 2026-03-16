import { spawn } from 'node:child_process';
import { ExecutionStrategy, } from './execution-strategy.js';
import { getSafeEnvironment } from '../../utils/shell-helpers.js';
import logger from '../logger.js';
/**
 * Detached execution strategy.
 * Spawns process completely detached from parent, minimal overhead.
 *
 * **Characteristics:**
 * - Returns immediately with process ID only
 * - No output capture or signal handling
 * - Minimal overhead (perfect for fire-and-forget)
 * - Process continues even if parent process dies
 * - Suitable for daemon processes and background jobs
 *
 * **Example:**
 * ```typescript
 * const strategy = new DetachedStrategy({
 *   timeoutMs: 300000, // Ignored for detached processes
 *   killGracePeriodMs: 0, // Ignored
 *   captureStderr: false,
 *   maxOutputSize: 0, // No output capture
 *   workingDirectory: process.cwd()
 * });
 *
 * const result = await strategy.execute('nohup npm run serve', 'exec-789');
 * console.log(`Detached process ID: ${result.processId}`);
 * // Process runs completely independently
 * ```
 */
export class DetachedStrategy extends ExecutionStrategy {
    constructor(config) {
        super(config);
        this.config = {
            shellPath: '/bin/bash',
            ...config,
        };
    }
    /**
     * Execute a command in detached mode.
     * Returns immediately without waiting for completion.
     */
    async execute(command, executionId) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            // Prepare environment variables
            const env = getSafeEnvironment(process.env, this.config.environmentVariables);
            // Spawn completely detached process
            // stdio: ['ignore', 'ignore', 'ignore'] - no I/O with parent
            this.childProcess = spawn(this.config.shellPath || '/bin/bash', ['-c', command], {
                cwd: this.config.workingDirectory,
                env,
                stdio: ['ignore', 'ignore', 'ignore'], // Complete isolation
                detached: true, // Create new process group
            });
            const pid = this.childProcess.pid;
            if (!pid) {
                return reject(new Error('Failed to spawn detached process'));
            }
            logger.debug(`[DetachedStrategy] Spawned detached process ${pid} for execution ${executionId}`);
            // Immediately unref to allow parent to exit
            // This is critical for true detached execution
            this.childProcess.unref();
            // Return immediately with minimal info
            const duration = Date.now() - startTime;
            resolve({
                exitCode: undefined,
                stdout: '',
                stderr: '',
                duration,
                outputTruncated: false,
            });
        });
    }
    /**
     * Clean up is minimal for detached processes since they're independent
     */
    async cleanup(childProcess) {
        // Detached processes don't need cleanup
        // Parent should not manage their lifecycle
        logger.debug('[DetachedStrategy] Detached process cleanup called (no-op)');
    }
    /**
     * Detached processes do not support interactive input
     */
    supportsInteractive() {
        return false;
    }
    /**
     * Get execution mode
     */
    getExecutionMode() {
        return 'detached';
    }
}
