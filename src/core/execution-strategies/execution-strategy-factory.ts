import {
  ExecutionStrategy,
  ExecutionStrategyConfig,
  StrategyExecutionResult,
} from './execution-strategy.js';
import {
  ForegroundStrategy,
  ForegroundStrategyConfig,
} from './foreground-strategy.js';
import {
  BackgroundStrategy,
  BackgroundStrategyConfig,
} from './background-strategy.js';
import {
  DetachedStrategy,
  DetachedStrategyConfig,
} from './detached-strategy.js';
import {
  AdaptiveStrategy,
  AdaptiveStrategyConfig,
  AdaptiveExecutionResult,
} from './adaptive-strategy.js';
import { ExecutionMode } from '../../types/shell-server/index.js';
import logger from '../logger.js';

/**
 * Factory options for strategy creation
 */
export interface StrategyFactoryOptions {
  /** Logger instance for strategy logging */
  logger?: any;
  /** Default timeout in milliseconds */
  defaultTimeoutMs?: number;
  /** Default kill grace period in milliseconds */
  defaultKillGracePeriodMs?: number;
}

/**
 * Registry of custom strategies
 */
export type StrategyRegistry = Map<ExecutionMode, new (config: any) => ExecutionStrategy>;

/**
 * Factory for creating execution strategy instances.
 * Supports built-in strategies and custom strategy registration.
 *
 * **Usage:**
 * ```typescript
 * const factory = new ExecutionStrategyFactory();
 *
 * // Create foreground strategy
 * const fgStrategy = factory.createStrategy('foreground', {
 *   timeoutMs: 30000,
 *   killGracePeriodMs: 5000,
 *   captureStderr: true,
 *   maxOutputSize: 1024 * 1024,
 *   workingDirectory: process.cwd()
 * });
 *
 * // Create background strategy
 * const bgStrategy = factory.createStrategy('background', {
 *   timeoutMs: 3600000,
 *   killGracePeriodMs: 10000,
 *   captureStderr: true,
 *   maxOutputSize: 100 * 1024 * 1024,
 *   workingDirectory: process.cwd()
 * });
 *
 * // Execute with strategy
 * const result = await fgStrategy.execute('echo hello', 'exec-123');
 * ```
 *
 * **Custom Strategy Registration:**
 * ```typescript
 * class CustomStrategy extends ExecutionStrategy {
 *   // ... implementation
 * }
 *
 * factory.registerStrategy('custom', CustomStrategy);
 * const custom = factory.createStrategy('custom', config);
 * ```
 */
export class ExecutionStrategyFactory {
  private customStrategies: StrategyRegistry;
  private options: StrategyFactoryOptions;

  constructor(options: StrategyFactoryOptions = {}) {
    this.customStrategies = new Map();
    this.options = {
      defaultTimeoutMs: 300000, // 5 minutes
      defaultKillGracePeriodMs: 5000, // 5 seconds
      ...options,
    };

    logger.debug('[ExecutionStrategyFactory] Initialized with options:', {
      defaultTimeoutMs: this.options.defaultTimeoutMs,
      defaultKillGracePeriodMs: this.options.defaultKillGracePeriodMs,
    });
  }

  /**
   * Create a strategy instance for the specified execution mode.
   * Validates mode parameter and applies defaults.
   *
   * @param mode The execution mode ('foreground', 'background', 'detached', 'adaptive')
   * @param config Partial configuration (will be merged with defaults)
   * @returns New strategy instance configured and ready for execution
   *
   * @throws Error if mode is not supported or invalid
   *
   * @example
   * const strategy = factory.createStrategy('foreground', {
   *   timeoutMs: 60000,
   *   captureStderr: true,
   *   maxOutputSize: 1024 * 1024,
   *   workingDirectory: '/tmp'
   * });
   */
  createStrategy<T extends ExecutionMode>(
    mode: T,
    config: Partial<ExecutionStrategyConfig>
  ): ExecutionStrategy {
    // Validate mode
    const validModes = ['foreground', 'background', 'detached', 'adaptive'];
    if (!validModes.includes(mode)) {
      const error = new Error(`Unsupported execution mode: ${mode}`);
      logger.error('[ExecutionStrategyFactory] Create strategy failed:', error);
      throw error;
    }

    // Apply defaults
    const mergedConfig = {
      timeoutMs: this.options.defaultTimeoutMs,
      killGracePeriodMs: this.options.defaultKillGracePeriodMs,
      captureStderr: true,
      maxOutputSize: 10 * 1024 * 1024, // 10MB default
      ...config,
    };

    logger.debug(`[ExecutionStrategyFactory] Creating ${mode} strategy with config:`, {
      timeoutMs: mergedConfig.timeoutMs,
      killGracePeriodMs: mergedConfig.killGracePeriodMs,
      maxOutputSize: mergedConfig.maxOutputSize,
    });

    switch (mode) {
      case 'foreground':
        return new ForegroundStrategy(mergedConfig as ForegroundStrategyConfig);

      case 'background':
        return new BackgroundStrategy(mergedConfig as BackgroundStrategyConfig);

      case 'detached':
        return new DetachedStrategy(mergedConfig as DetachedStrategyConfig);

      case 'adaptive':
        return new AdaptiveStrategy(mergedConfig as AdaptiveStrategyConfig);

      default:
        // Check custom strategies
        if (this.customStrategies.has(mode as any)) {
          const StrategyClass = this.customStrategies.get(mode as any)!;
          return new StrategyClass(mergedConfig);
        }

        const error = new Error(`No strategy found for mode: ${mode}`);
        logger.error('[ExecutionStrategyFactory] Create strategy failed:', error);
        throw error;
    }
  }

  /**
   * Register a custom execution strategy.
   * Allows extending the factory with application-specific execution modes.
   *
   * @param mode The custom mode name
   * @param StrategyClass Constructor for the strategy class
   *
   * @example
   * class CustomStreamingStrategy extends ExecutionStrategy {
   *   async execute() { ... }
   *   async cleanup() { ... }
   *   supportsInteractive() { return true; }
   *   getExecutionMode() { return 'custom'; }
   * }
   *
   * factory.registerStrategy('custom', CustomStreamingStrategy);
   * const strategy = factory.createStrategy('custom', config);
   */
  registerStrategy(
    mode: ExecutionMode | string,
    StrategyClass: new (config: ExecutionStrategyConfig) => ExecutionStrategy
  ): void {
    logger.info(`[ExecutionStrategyFactory] Registering custom strategy: ${mode}`);
    this.customStrategies.set(mode as ExecutionMode, StrategyClass);
  }

  /**
   * Check if a strategy mode is supported (built-in or custom).
   *
   * @param mode The mode to check
   * @returns true if mode is supported, false otherwise
   *
   * @example
   * if (factory.isSupported('custom')) {
   *   const strategy = factory.createStrategy('custom', config);
   * }
   */
  isSupported(mode: string): mode is ExecutionMode {
    const builtIn = ['foreground', 'background', 'detached', 'adaptive'];
    return builtIn.includes(mode) || this.customStrategies.has(mode as ExecutionMode);
  }

  /**
   * Get list of all supported modes (built-in and custom).
   *
   * @returns Array of supported mode names
   *
   * @example
   * const modes = factory.getSupportedModes();
   * console.log(modes); // ['foreground', 'background', 'detached', 'adaptive', 'custom']
   */
  getSupportedModes(): ExecutionMode[] {
    const builtIn: ExecutionMode[] = ['foreground', 'background', 'detached', 'adaptive'];
    const custom = Array.from(this.customStrategies.keys());
    return [...builtIn, ...custom];
  }

  /**
   * Get information about a specific mode.
   *
   * @param mode The mode to get info for
   * @returns Human-readable description of the mode
   *
   * @example
   * const info = factory.getModeInfo('background');
   * console.log(info);
   * // "Background: Returns immediately while process continues. No blocking on caller."
   */
  getModeInfo(mode: ExecutionMode | string): string {
    const descriptions: Record<string, string> = {
      foreground: 'Foreground: Waits for completion, streams output in real-time. Supports interactive input.',
      background: 'Background: Returns immediately with process ID. Continues in background.',
      detached: 'Detached: Fire-and-forget execution. Minimal overhead, no output capture.',
      adaptive:
        'Adaptive: Smart mode. Streams small output, transitions to background for large output or long-running processes.',
    };

    return descriptions[mode as string] || `Unknown mode: ${mode}`;
  }

  /**
   * Create all default strategies for a given configuration.
   * Useful for initializing all modes at once.
   *
   * @param baseConfig Base configuration to apply to all strategies
   * @returns Map of mode to strategy instance
   *
   * @example
   * const strategies = factory.createAllStrategies({
   *   captureStderr: true,
   *   maxOutputSize: 10 * 1024 * 1024,
   *   workingDirectory: '/tmp'
   * });
   *
   * const fgResult = await strategies.get('foreground')!.execute(cmd, id);
   */
  createAllStrategies(
    baseConfig: Partial<ExecutionStrategyConfig>
  ): Map<ExecutionMode, ExecutionStrategy> {
    const strategies = new Map<ExecutionMode, ExecutionStrategy>();

    const modes: ExecutionMode[] = ['foreground', 'background', 'detached', 'adaptive'];

    for (const mode of modes) {
      try {
        strategies.set(mode, this.createStrategy(mode, baseConfig));
      } catch (error) {
        logger.error(`[ExecutionStrategyFactory] Failed to create ${mode} strategy:`, error);
      }
    }

    logger.info(`[ExecutionStrategyFactory] Created ${strategies.size} strategies`);
    return strategies;
  }
}

/**
 * Singleton instance of the execution strategy factory.
 * Use this for default strategy creation.
 */
export const defaultStrategyFactory = new ExecutionStrategyFactory();
