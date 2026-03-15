/**
 * EXECUTION STRATEGY PATTERN - QUICK REFERENCE
 *
 * This file contains quick code snippets for common usage patterns.
 */
// ============================================================================
// BASIC USAGE
// ============================================================================
// Import the factory
import { ExecutionStrategyFactory } from './execution-strategies';
// Create factory instance
const factory = new ExecutionStrategyFactory({
    defaultTimeoutMs: 300000, // 5 minutes
    defaultKillGracePeriodMs: 5000
});
// Create a foreground strategy
const fgStrategy = factory.createStrategy('foreground', {
    timeoutMs: 30000,
    killGracePeriodMs: 5000,
    captureStderr: true,
    maxOutputSize: 1024 * 1024, // 1MB
    workingDirectory: process.cwd()
});
// Execute command
const result = await fgStrategy.execute('npm test', 'exec-123');
console.log(`Exit code: ${result.exitCode}`);
console.log(`Stdout: ${result.stdout}`);
console.log(`Duration: ${result.duration}ms`);
// ============================================================================
// STRATEGY SELECTION
// ============================================================================
// Based on command type
function getStrategy(commandType, factory) {
    switch (commandType) {
        case 'interactive':
            // For interactive commands like 'bash', 'node repl', etc.
            return factory.createStrategy('foreground', {
                timeoutMs: 3600000, // 1 hour
                killGracePeriodMs: 5000,
                captureStderr: true,
                maxOutputSize: 10 * 1024 * 1024, // 10MB
                workingDirectory: process.cwd()
            });
        case 'long_running':
            // For build processes, migrations, etc.
            return factory.createStrategy('background', {
                timeoutMs: 3600000, // 1 hour
                killGracePeriodMs: 10000,
                captureStderr: true,
                maxOutputSize: 100 * 1024 * 1024, // 100MB
                workingDirectory: process.cwd()
            });
        case 'daemon':
            // For daemon processes
            return factory.createStrategy('detached', {
                timeoutMs: 300000,
                killGracePeriodMs: 0,
                captureStderr: false,
                maxOutputSize: 0,
                workingDirectory: process.cwd()
            });
        default:
            // For general purpose
            return factory.createStrategy('adaptive', {
                timeoutMs: 600000,
                killGracePeriodMs: 5000,
                captureStderr: true,
                maxOutputSize: 50 * 1024 * 1024, // 50MB
                workingDirectory: process.cwd()
            });
    }
}
// ============================================================================
// BATCH EXECUTION
// ============================================================================
// Execute multiple commands with same strategy
async function executeBatch(commands, strategyMode) {
    const strategy = factory.createStrategy(strategyMode, {
        timeoutMs: 60000,
        killGracePeriodMs: 5000,
        captureStderr: true,
        maxOutputSize: 10 * 1024 * 1024,
        workingDirectory: process.cwd()
    });
    const results = [];
    for (const cmd of commands) {
        const execId = `exec-${Date.now()}-${Math.random()}`;
        try {
            const result = await strategy.execute(cmd, execId);
            results.push({ command: cmd, result, success: true });
        }
        catch (error) {
            results.push({ command: cmd, error, success: false });
        }
    }
    return results;
}
// ============================================================================
// ERROR HANDLING
// ============================================================================
import { ExecutionTimeoutError, ProcessNotFoundError } from './execution-strategies';
async function executeWithErrorHandling(cmd, execId) {
    const strategy = factory.createStrategy('foreground', {
        timeoutMs: 30000,
        killGracePeriodMs: 5000,
        captureStderr: true,
        maxOutputSize: 1024 * 1024,
        workingDirectory: process.cwd()
    });
    try {
        const result = await strategy.execute(cmd, execId);
        return {
            success: true,
            data: result
        };
    }
    catch (error) {
        if (error instanceof ExecutionTimeoutError) {
            return {
                success: false,
                error: 'Process timed out',
                code: 'TIMEOUT'
            };
        }
        else if (error instanceof ProcessNotFoundError) {
            return {
                success: false,
                error: 'Process not found',
                code: 'NOT_FOUND'
            };
        }
        else if (error instanceof Error) {
            return {
                success: false,
                error: error.message,
                code: 'EXECUTION_ERROR'
            };
        }
        throw error;
    }
}
// ============================================================================
// CUSTOM STRATEGY REGISTRATION
// ============================================================================
import { ExecutionStrategy } from './execution-strategies';
class MyCustomStrategy extends ExecutionStrategy {
    async execute(command, executionId) {
        // Custom implementation
        return {
            exitCode: 0,
            stdout: 'Custom output',
            stderr: '',
            duration: 100,
            outputTruncated: false
        };
    }
    async cleanup() {
        // Custom cleanup
    }
    supportsInteractive() {
        return false;
    }
    getExecutionMode() {
        return 'custom';
    }
}
// Register custom strategy
factory.registerStrategy('custom', MyCustomStrategy);
// Use custom strategy
const customStrategy = factory.createStrategy('custom', {
    timeoutMs: 30000,
    killGracePeriodMs: 5000,
    captureStderr: true,
    maxOutputSize: 1024 * 1024,
    workingDirectory: process.cwd()
});
// ============================================================================
// ADAPTIVE STRATEGY WITH TRANSITION HANDLING
// ============================================================================
async function executeAdaptiveWithTracking(cmd, execId) {
    const strategy = factory.createStrategy('adaptive', {
        timeoutMs: 600000, // 10 minutes total
        killGracePeriodMs: 5000,
        captureStderr: true,
        maxOutputSize: 50 * 1024 * 1024,
        workingDirectory: process.cwd()
    });
    const result = await strategy.execute(cmd, execId);
    if (result.transitionedToBackground) {
        console.log(`Process transitioned to background due to: ${result.transitionReason}`);
        console.log(`Partial output captured: ${result.stdout.length} bytes`);
        // In production, you might poll for completion or subscribe to updates
    }
    else {
        console.log(`Process completed normally in ${result.duration}ms`);
    }
    return result;
}
// ============================================================================
// CHECK SUPPORTED MODES
// ============================================================================
// Get list of all supported modes
const supportedModes = factory.getSupportedModes();
console.log('Supported modes:', supportedModes);
// Check if specific mode is supported
if (factory.isSupported('adaptive')) {
    console.log('Adaptive mode is supported');
}
// Get mode information
for (const mode of supportedModes) {
    console.log(`${mode}: ${factory.getModeInfo(mode)}`);
}
// ============================================================================
// PROCESSMANAGER INTEGRATION PATTERN
// ============================================================================
// In ProcessManager.ts executeCommand() method:
async;
executeCommand(options, ExecutionOptions);
Promise < ExecutionInfo > {
    const: strategy = this.strategyFactory.createStrategy(options.executionMode, {
        timeoutMs: options.timeoutSeconds * 1000,
        killGracePeriodMs: GRACEFUL_SHUTDOWN_TIMEOUT,
        captureStderr: options.captureStderr,
        maxOutputSize: options.maxOutputSize,
        workingDirectory: this.resolveWorkingDirectory(options.workingDirectory),
        environmentVariables: options.environmentVariables,
        inputData: options.inputData
    }),
    try: {
        const: result = await strategy.execute(options.command, executionId),
        // Convert StrategyExecutionResult to ExecutionInfo
        const: executionInfo, ExecutionInfo = {
            execution_id: executionId,
            command: options.command,
            status: result.exitCode === 0 ? 'completed' : 'failed',
            exit_code: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            execution_time_ms: result.duration,
            output_truncated: result.outputTruncated,
            created_at: getCurrentTimestamp(),
            completed_at: getCurrentTimestamp()
        },
        this: .executions.set(executionId, executionInfo),
        return: executionInfo
    }, catch(error) {
        // Handle errors
        const executionInfo = this.executions.get(executionId);
        if (executionInfo) {
            executionInfo.status = 'failed';
            executionInfo.message = error instanceof Error ? error.message : String(error);
        }
        throw error;
    }
};
// ============================================================================
// PERFORMANCE OPTIMIZATION
// ============================================================================
// Create all strategies once for reuse
class CommandExecutor {
    constructor() {
        this.factory = new ExecutionStrategyFactory();
        this.strategies = new Map();
        // Pre-create strategies
        for (const mode of this.factory.getSupportedModes()) {
            this.strategies.set(mode, this.factory.createStrategy(mode, {
                timeoutMs: 300000,
                killGracePeriodMs: 5000,
                captureStderr: true,
                maxOutputSize: 10 * 1024 * 1024,
                workingDirectory: process.cwd()
            }));
        }
    }
    async execute(cmd, mode, execId) {
        const strategy = this.strategies.get(mode);
        if (!strategy) {
            throw new Error(`Unknown mode: ${mode}`);
        }
        return await strategy.execute(cmd, execId);
    }
}
// Usage
const executor = new CommandExecutor();
const result = await executor.execute('npm test', 'adaptive', 'exec-123');
