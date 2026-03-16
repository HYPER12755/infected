/**
 * Advanced ExecutionStrategy Examples
 * Demonstrates custom strategy implementation and factory usage
 *
 * These examples show how to:
 * - Create custom execution strategies
 * - Configure strategies with custom parameters
 * - Register and use custom strategies
 * - Handle execution results and errors
 */

import { ExecutionStrategyFactory } from '../core/execution-strategies/index.js';
import {
  ExecutionStrategy,
  ExecutionStrategyConfig,
  StrategyExecutionResult,
} from '../core/execution-strategies/execution-strategy.js';

// ============================================================================
// Example 1: Creating Built-in Strategies with Custom Configuration
// ============================================================================

export async function exampleBuiltInStrategies(
  factory: ExecutionStrategyFactory
): Promise<void> {
  console.log('=== Example 1: Built-in Strategies ===\n');

  // Create a foreground strategy with custom timeout
  const foregroundStrategy = factory.createStrategy('foreground', {
    timeoutMs: 60000, // 60 second timeout
    captureStderr: true,
    maxOutputSize: 50 * 1024 * 1024, // 50MB max output
    workingDirectory: process.cwd(),
  });

  console.log('Created foreground strategy');
  const fgResult = await foregroundStrategy.execute(
    'echo "Hello from foreground"',
    'fg-example-1'
  );
  console.log(`Exit code: ${fgResult.exitCode}`);
  console.log(`Output: ${fgResult.stdout}`);
  console.log(`Execution time: ${fgResult.executionTimeMs}ms\n`);

  // Create a background strategy for long-running tasks
  const backgroundStrategy = factory.createStrategy('background', {
    timeoutMs: 3600000, // 1 hour timeout
    captureStderr: true,
    maxOutputSize: 100 * 1024 * 1024, // 100MB max output
  });

  console.log('Created background strategy');
  const bgResult = await backgroundStrategy.execute(
    'sleep 2 && echo "Background task complete"',
    'bg-example-1'
  );
  console.log(`Process will run in background`);
  console.log(`Result: ${JSON.stringify(bgResult, null, 2)}\n`);
}

// ============================================================================
// Example 2: Custom Strategy Implementation
// ============================================================================

/**
 * A custom strategy that adds retry logic and exponential backoff
 */
class RetryableStrategy extends ExecutionStrategy {
  private maxRetries: number;
  private baseDelayMs: number;

  constructor(config: ExecutionStrategyConfig & { maxRetries?: number; baseDelayMs?: number }) {
    super(config);
    this.maxRetries = config.maxRetries ?? 3;
    this.baseDelayMs = config.baseDelayMs ?? 1000;
  }

  async execute(command: string, executionId: string): Promise<StrategyExecutionResult> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = this.baseDelayMs * Math.pow(2, attempt - 1);
          console.log(`Retry attempt ${attempt} after ${delay}ms delay`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        // Execute command
        const result = await this._executeCommand(command);

        // Retry on specific exit codes
        if (result.exitCode === 0 || attempt === this.maxRetries) {
          return result;
        }

        lastError = new Error(`Command failed with exit code ${result.exitCode}`);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt === this.maxRetries) {
          throw lastError;
        }
      }
    }

    throw lastError;
  }

  private async _executeCommand(command: string): Promise<StrategyExecutionResult> {
    // Simulated execution - replace with actual command execution
    const startTime = Date.now();

    return {
      exitCode: 0,
      stdout: `Executed: ${command}`,
      stderr: '',
      executionTimeMs: Date.now() - startTime,
      signal: null,
    };
  }
}

/**
 * A custom strategy that adds detailed logging for auditing
 */
class AuditedStrategy extends ExecutionStrategy {
  private auditLog: Array<{
    timestamp: string;
    command: string;
    result: StrategyExecutionResult;
  }> = [];

  async execute(command: string, executionId: string): Promise<StrategyExecutionResult> {
    const startTime = Date.now();
    console.log(`[AUDIT] Starting execution: ${executionId}`);
    console.log(`[AUDIT] Command: ${command}`);

    try {
      const result = await this._executeCommand(command);

      // Log execution
      this.auditLog.push({
        timestamp: new Date().toISOString(),
        command,
        result,
      });

      console.log(`[AUDIT] Exit code: ${result.exitCode}`);
      console.log(`[AUDIT] Duration: ${result.executionTimeMs}ms`);

      return result;
    } catch (error) {
      console.error(`[AUDIT] Error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  getAuditLog() {
    return this.auditLog;
  }

  private async _executeCommand(command: string): Promise<StrategyExecutionResult> {
    const startTime = Date.now();
    return {
      exitCode: 0,
      stdout: `Executed: ${command}`,
      stderr: '',
      executionTimeMs: Date.now() - startTime,
      signal: null,
    };
  }
}

export async function exampleCustomStrategies(
  factory: ExecutionStrategyFactory
): Promise<void> {
  console.log('=== Example 2: Custom Strategies ===\n');

  // Register custom strategies
  factory.registerStrategy('retryable', RetryableStrategy);
  factory.registerStrategy('audited', AuditedStrategy);

  console.log('Registered custom strategies\n');

  // Use retryable strategy
  const retryableStrategy = factory.createStrategy('retryable', {
    maxRetries: 3,
    baseDelayMs: 500,
    timeoutMs: 30000,
  });

  console.log('Created retryable strategy (will retry up to 3 times)');
  const retryResult = await retryableStrategy.execute(
    'npm install',
    'retry-example-1'
  );
  console.log(`Final result: ${JSON.stringify(retryResult, null, 2)}\n`);

  // Use audited strategy
  const auditedStrategy = factory.createStrategy('audited', {
    timeoutMs: 30000,
  });

  console.log('Created audited strategy');
  const auditResult = await auditedStrategy.execute(
    'npm run build',
    'audit-example-1'
  );
  console.log(`Audit result: ${JSON.stringify(auditResult, null, 2)}\n`);

  // Get audit log
  if (auditedStrategy instanceof AuditedStrategy) {
    console.log('Audit log:');
    console.log(JSON.stringify(auditedStrategy.getAuditLog(), null, 2));
  }
}

// ============================================================================
// Example 3: Factory Configuration and Strategy Selection
// ============================================================================

export async function exampleFactoryConfiguration(
  factory: ExecutionStrategyFactory
): Promise<void> {
  console.log('=== Example 3: Factory Configuration ===\n');

  // Create strategies with different configurations for different scenarios
  const config = {
    // Quick commands - short timeout, small output
    quick: {
      timeoutMs: 5000,
      maxOutputSize: 1024 * 1024, // 1MB
      captureStderr: false,
    },

    // Long-running commands - long timeout, large output
    longRunning: {
      timeoutMs: 3600000, // 1 hour
      maxOutputSize: 500 * 1024 * 1024, // 500MB
      captureStderr: true,
    },

    // Build commands - moderate timeout, clean up on failure
    build: {
      timeoutMs: 300000, // 5 minutes
      maxOutputSize: 100 * 1024 * 1024, // 100MB
      captureStderr: true,
      workingDirectory: './project',
    },
  };

  // Create strategies with appropriate configurations
  const strategies = {
    quick: factory.createStrategy('foreground', config.quick),
    longRunning: factory.createStrategy('background', config.longRunning),
    build: factory.createStrategy('foreground', config.build),
  };

  console.log('Created configured strategies:');
  console.log(`- quick: timeout=${config.quick.timeoutMs}ms`);
  console.log(`- longRunning: timeout=${config.longRunning.timeoutMs}ms`);
  console.log(`- build: working dir=${config.build.workingDirectory}\n`);

  // Use the appropriate strategy based on command type
  const commandType = 'quick'; // or 'longRunning', 'build'
  const strategy = strategies[commandType as keyof typeof strategies];

  console.log(`Using '${commandType}' strategy for command execution`);
  const result = await strategy.execute('echo "Quick command"', 'config-example-1');
  console.log(`Result: ${JSON.stringify(result, null, 2)}\n`);
}

// ============================================================================
// Example 4: Error Handling and Resilience
// ============================================================================

export async function exampleErrorHandling(
  factory: ExecutionStrategyFactory
): Promise<void> {
  console.log('=== Example 4: Error Handling ===\n');

  const strategy = factory.createStrategy('foreground', {
    timeoutMs: 10000,
    captureStderr: true,
  });

  // Example 1: Successful execution
  try {
    console.log('Attempting successful command...');
    const result = await strategy.execute('echo "Success"', 'error-example-1');
    if (result.exitCode === 0) {
      console.log('✓ Command succeeded');
      console.log(`  Output: ${result.stdout.trim()}`);
    }
  } catch (error) {
    console.error(
      '✗ Command failed:',
      error instanceof Error ? error.message : String(error)
    );
  }

  console.log();

  // Example 2: Command with error output
  try {
    console.log('Attempting command with error output...');
    const result = await strategy.execute('ls /nonexistent 2>&1', 'error-example-2');
    if (result.exitCode !== 0) {
      console.log('⚠ Command failed with error:');
      console.log(`  Exit code: ${result.exitCode}`);
      console.log(`  Error: ${result.stderr || result.stdout}`);
    }
  } catch (error) {
    console.error(
      '✗ Unexpected error:',
      error instanceof Error ? error.message : String(error)
    );
  }

  console.log();

  // Example 3: Timeout handling
  try {
    console.log('Attempting command with timeout...');
    const timeoutStrategy = factory.createStrategy('foreground', {
      timeoutMs: 100, // Very short timeout
      captureStderr: true,
    });
    const result = await timeoutStrategy.execute('sleep 5', 'error-example-3');
    console.log(`Result: ${JSON.stringify(result, null, 2)}`);
  } catch (error) {
    console.error(
      '⚠ Command timed out:',
      error instanceof Error ? error.message : String(error)
    );
  }
}

// ============================================================================
// Main Execution
// ============================================================================

export async function runAllExamples(): Promise<void> {
  const factory = new ExecutionStrategyFactory({
    defaultTimeoutMs: 30000,
    defaultKillGracePeriodMs: 5000,
  });

  try {
    await exampleBuiltInStrategies(factory);
    await exampleCustomStrategies(factory);
    await exampleFactoryConfiguration(factory);
    await exampleErrorHandling(factory);

    console.log('=== All Examples Completed Successfully ===');
  } catch (error) {
    console.error(
      'Error running examples:',
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}

// Run examples if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllExamples();
}
