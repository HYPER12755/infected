/**
 * Execution Strategies Module
 *
 * This module provides a pluggable strategy pattern for process execution modes.
 * Each strategy defines how processes are spawned, monitored, and cleaned up.
 *
 * **Available Strategies:**
 * - ForegroundStrategy: Waits for completion, real-time output streaming
 * - BackgroundStrategy: Returns immediately, continues in background
 * - DetachedStrategy: Fire-and-forget execution with minimal overhead
 * - AdaptiveStrategy: Smart mode with automatic background transition
 *
 * **Quick Start:**
 * ```typescript
 * import { ExecutionStrategyFactory, ForegroundStrategy } from './execution-strategies';
 *
 * // Using factory (recommended)
 * const factory = new ExecutionStrategyFactory();
 * const strategy = factory.createStrategy('foreground', {
 *   timeoutMs: 30000,
 *   captureStderr: true,
 *   maxOutputSize: 1024 * 1024,
 *   workingDirectory: process.cwd()
 * });
 *
 * const result = await strategy.execute('echo hello', 'exec-123');
 * console.log(result.stdout); // "hello"
 *
 * // Direct instantiation
 * const fgStrategy = new ForegroundStrategy({
 *   timeoutMs: 30000,
 *   killGracePeriodMs: 5000,
 *   captureStderr: true,
 *   maxOutputSize: 1024 * 1024,
 *   workingDirectory: process.cwd()
 * });
 * ```
 */
export { ExecutionStrategy, ExecutionTimeoutError, ProcessNotFoundError, ProcessTerminationError, } from './execution-strategy.js';
export { ForegroundStrategy, } from './foreground-strategy.js';
export { BackgroundStrategy, } from './background-strategy.js';
export { DetachedStrategy, } from './detached-strategy.js';
export { AdaptiveStrategy, } from './adaptive-strategy.js';
export { ExecutionStrategyFactory, defaultStrategyFactory, } from './execution-strategy-factory.js';
