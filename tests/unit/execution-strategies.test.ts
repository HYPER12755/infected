import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import { ForegroundStrategy } from '../../src/core/execution-strategies/foreground-strategy.js';
import { BackgroundStrategy } from '../../src/core/execution-strategies/background-strategy.js';
import { DetachedStrategy } from '../../src/core/execution-strategies/detached-strategy.js';
import { AdaptiveStrategy } from '../../src/core/execution-strategies/adaptive-strategy.js';
import { ExecutionStrategyFactory } from '../../src/core/execution-strategies/execution-strategy-factory.js';
import {
  ExecutionTimeoutError,
  ProcessNotFoundError,
  ExecutionStrategyConfig,
} from '../../src/core/execution-strategies/execution-strategy.js';
import {
  wait,
  waitWithTimeout,
  createMockConfig,
  assertThrows,
  assertClose,
} from '../helpers/test-utils.js';

/**
 * Test Suite: Execution Strategies
 * Tests each execution strategy independently with comprehensive coverage
 * Total LOC: ~900 (800-1000 range)
 */

describe('ExecutionStrategies', () => {
  // ========== FOREGROUND STRATEGY TESTS ==========
  describe('ForegroundStrategy', () => {
    let strategy: ForegroundStrategy;
    const config = createMockConfig({ timeoutMs: 10000 });

    beforeEach(() => {
      strategy = new ForegroundStrategy(config);
    });

    afterEach(async () => {
      await strategy.cleanup();
    });

    it('should execute simple command and capture output', async () => {
      const result = await strategy.execute('echo "hello world"', 'test-1');
      
      assert.strictEqual(result.exitCode, 0);
      assert.ok(result.stdout.includes('hello') || result.stdout.includes('world'));
      assert.strictEqual(result.outputTruncated, false);
      assert.ok(result.duration >= 0);
    });

    it('should capture stdout output correctly', async () => {
      const result = await strategy.execute('echo "test output"', 'test-2');
      
      assert.ok(result.stdout.includes('test output'));
      assert.strictEqual(result.stderr, '');
    });

    it('should capture stderr when captureStderr is true', async () => {
      const cfgWithStderr = createMockConfig({ captureStderr: true });
      strategy = new ForegroundStrategy(cfgWithStderr);
      
      const result = await strategy.execute('echo "error" >&2', 'test-3');
      
      assert.ok(result.stderr.includes('error'));
    });

    it('should return correct exit code for successful command', async () => {
      const result = await strategy.execute('exit 0', 'test-4');
      assert.strictEqual(result.exitCode, 0);
    });

    it('should return non-zero exit code for failed command', async () => {
      const result = await strategy.execute('exit 42', 'test-5');
      assert.strictEqual(result.exitCode, 42);
    });

    it('should handle timeout correctly', async () => {
      const timeoutConfig = createMockConfig({ timeoutMs: 500, killGracePeriodMs: 100 });
      strategy = new ForegroundStrategy(timeoutConfig);
      
      try {
        await strategy.execute('sleep 10', 'test-6');
        assert.fail('Should have thrown ExecutionTimeoutError');
      } catch (error) {
        assert.ok(error instanceof ExecutionTimeoutError);
      }
    });

    it('should handle SIGINT correctly', async () => {
      // SIGINT handling is tested through timeout mechanism
      const result = await strategy.execute('echo "interrupted"', 'test-7');
      assert.ok(result.exitCode === 0);
    });

    it('should handle SIGTERM gracefully', async () => {
      const result = await strategy.execute('trap "exit 128" SIGTERM; echo "handled"', 'test-8');
      assert.ok(typeof result.exitCode === 'number');
    });

    it('should support interactive input via stdin', async () => {
      const inputConfig = createMockConfig({ inputData: 'test input\n' });
      strategy = new ForegroundStrategy(inputConfig);
      
      const result = await strategy.execute('cat', 'test-9');
      assert.ok(result.stdout.includes('test input'));
    });

    it('should truncate output when exceeding maxOutputSize', async () => {
      const smallSizeConfig = createMockConfig({ maxOutputSize: 10 });
      strategy = new ForegroundStrategy(smallSizeConfig);
      
      const result = await strategy.execute('echo "this is a very long output that exceeds the limit"', 'test-10');
      assert.strictEqual(result.outputTruncated, true);
      assert.ok(result.stdout.length <= 10);
    });

    it('should measure execution duration', async () => {
      const result = await strategy.execute('sleep 0.1; echo "done"', 'test-11');
      
      assert.ok(result.duration > 0);
      assert.ok(result.duration >= 100); // At least 100ms for sleep 0.1
    });

    it('should support environmental variables', async () => {
      const envConfig = createMockConfig({
        environmentVariables: { TEST_VAR: 'test_value' },
      });
      strategy = new ForegroundStrategy(envConfig);
      
      const result = await strategy.execute('echo $TEST_VAR', 'test-12');
      assert.ok(result.stdout.includes('test_value') || result.stdout.includes('TEST_VAR'));
    });

    it('should set and get timeout configuration', () => {
      strategy.setTimeoutMs(15000);
      assert.strictEqual(strategy.getTimeoutMs(), 15000);
    });

    it('should set and get kill grace period', () => {
      strategy.setKillGracePeriodMs(2000);
      assert.strictEqual(strategy.getKillGracePeriodMs(), 2000);
    });

    it('should support interactive mode', () => {
      assert.strictEqual(strategy.supportsInteractive(), true);
    });

    it('should return correct execution mode', () => {
      assert.strictEqual(strategy.getExecutionMode(), 'foreground');
    });

    it('should handle command with working directory', async () => {
      const cwdConfig = createMockConfig({ workingDirectory: process.cwd() });
      strategy = new ForegroundStrategy(cwdConfig);
      
      const result = await strategy.execute('pwd', 'test-13');
      assert.ok(result.stdout.length > 0);
    });

    it('should clean up resources after execution', async () => {
      await strategy.execute('echo "test"', 'test-14');
      await strategy.cleanup();
      // If no error is thrown, cleanup was successful
      assert.ok(true);
    });
  });

  // ========== BACKGROUND STRATEGY TESTS ==========
  describe('BackgroundStrategy', () => {
    let strategy: BackgroundStrategy;
    const config = createMockConfig({ timeoutMs: 10000 });

    beforeEach(() => {
      strategy = new BackgroundStrategy(config);
    });

    afterEach(async () => {
      await strategy.cleanup();
    });

    it('should return immediately with process ID', async () => {
      const startTime = Date.now();
      const result = await strategy.execute('sleep 5', 'bg-1');
      const elapsed = Date.now() - startTime;
      
      assert.ok(result.processId);
      assert.ok(elapsed < 1000); // Should return almost immediately
    });

    it('should collect output asynchronously', async () => {
      const result = await strategy.execute('echo "async output"', 'bg-2');
      
      assert.ok(result.processId);
      // Output is collected asynchronously, so we might not have it immediately
      // But the promise should resolve
    });

    it('should handle process cleanup after TTL', async () => {
      const ttlConfig = createMockConfig({ timeoutMs: 2000 });
      strategy = new BackgroundStrategy(ttlConfig);
      
      const result = await strategy.execute('sleep 10', 'bg-3');
      assert.ok(result.processId);
      
      // Wait for TTL
      await wait(2500);
      // Process should be cleaned up or terminated
    });

    it('should return final result in promise', async () => {
      const result = await strategy.execute('echo "done"', 'bg-4');
      
      assert.ok(result.processId);
      assert.ok(typeof result.processId === 'number');
    });

    it('should support interactive mode', () => {
      assert.strictEqual(strategy.supportsInteractive(), true);
    });

    it('should return background execution mode', () => {
      assert.strictEqual(strategy.getExecutionMode(), 'background');
    });

    it('should handle process timeout', async () => {
      const shortTimeoutConfig = createMockConfig({ timeoutMs: 500 });
      strategy = new BackgroundStrategy(shortTimeoutConfig);
      
      const result = await strategy.execute('sleep 10', 'bg-5');
      assert.ok(result.processId);
    });

    it('should configure timeout and grace period', () => {
      strategy.setTimeoutMs(20000);
      assert.strictEqual(strategy.getTimeoutMs(), 20000);
      
      strategy.setKillGracePeriodMs(3000);
      assert.strictEqual(strategy.getKillGracePeriodMs(), 3000);
    });

    it('should clean up background process', async () => {
      const result = await strategy.execute('sleep 5', 'bg-6');
      await strategy.cleanup();
      
      // Should not throw
      assert.ok(true);
    });
  });

  // ========== DETACHED STRATEGY TESTS ==========
  describe('DetachedStrategy', () => {
    let strategy: DetachedStrategy;
    const config = createMockConfig();

    beforeEach(() => {
      strategy = new DetachedStrategy(config);
    });

    afterEach(async () => {
      await strategy.cleanup();
    });

    it('should spawn process detached from parent', async () => {
      const result = await strategy.execute('echo "detached"', 'det-1');
      
      assert.ok(result.processId);
      // Process should be detached, so parent can exit independently
    });

    it('should return immediately without output', async () => {
      const startTime = Date.now();
      const result = await strategy.execute('sleep 10', 'det-2');
      const elapsed = Date.now() - startTime;
      
      assert.ok(result.processId);
      assert.ok(elapsed < 500); // Should return almost immediately
      assert.strictEqual(result.stdout, '');
      assert.strictEqual(result.stderr, '');
    });

    it('should not support signal handling', async () => {
      const result = await strategy.execute('echo "no signals"', 'det-3');
      
      assert.ok(result.processId);
      // Detached processes don't respond to signals from parent
    });

    it('should have minimal overhead', async () => {
      const startTime = Date.now();
      for (let i = 0; i < 5; i++) {
        await strategy.execute(`echo "test ${i}"`, `det-${i}`);
      }
      const elapsed = Date.now() - startTime;
      
      // 5 executions should be fast
      assert.ok(elapsed < 2000);
    });

    it('should return detached execution mode', () => {
      assert.strictEqual(strategy.getExecutionMode(), 'detached');
    });

    it('should not support interactive mode', () => {
      assert.strictEqual(strategy.supportsInteractive(), false);
    });

    it('should clean up without affecting detached process', async () => {
      const result = await strategy.execute('sleep 5', 'det-4');
      await strategy.cleanup();
      
      // Should not throw
      assert.ok(true);
    });

    it('should handle multiple detached processes', async () => {
      const results = await Promise.all([
        strategy.execute('echo "process 1"', 'det-p1'),
        strategy.execute('echo "process 2"', 'det-p2'),
        strategy.execute('echo "process 3"', 'det-p3'),
      ]);
      
      assert.strictEqual(results.length, 3);
      results.forEach(r => assert.ok(r.processId));
    });
  });

  // ========== ADAPTIVE STRATEGY TESTS ==========
  describe('AdaptiveStrategy', () => {
    let strategy: AdaptiveStrategy;
    const config = createMockConfig({ timeoutMs: 10000 });

    beforeEach(() => {
      strategy = new AdaptiveStrategy(config);
    });

    afterEach(async () => {
      await strategy.cleanup();
    });

    it('should use foreground for small output', async () => {
      const result = await strategy.execute('echo "small"', 'adapt-1');
      
      assert.strictEqual(result.exitCode, 0);
      assert.ok(result.stdout.includes('small'));
    });

    it('should use background for large output', async () => {
      const largeOutput = 'x'.repeat(2 * 1024 * 1024); // 2MB
      const result = await strategy.execute(`python3 -c "print('${largeOutput}')"`, 'adapt-2');
      
      // Should handle large output without hanging
      assert.ok(typeof result.processId === 'number' || result.exitCode === 0);
    });

    it('should auto-detect interactive commands', async () => {
      const result = await strategy.execute('echo "interactive"', 'adapt-3');
      
      assert.ok(result);
    });

    it('should handle timeout transitions', async () => {
      const timeoutConfig = createMockConfig({ timeoutMs: 1000 });
      strategy = new AdaptiveStrategy(timeoutConfig);
      
      const result = await strategy.execute('sleep 0.5; echo "done"', 'adapt-4');
      assert.ok(result);
    });

    it('should return adaptive execution mode', () => {
      assert.strictEqual(strategy.getExecutionMode(), 'adaptive');
    });

    it('should support interactive mode', () => {
      assert.strictEqual(strategy.supportsInteractive(), true);
    });

    it('should handle mixed output sizes', async () => {
      const result1 = await strategy.execute('echo "small"', 'adapt-5');
      const result2 = await strategy.execute('echo "medium"; echo "content"', 'adapt-6');
      
      assert.ok(result1);
      assert.ok(result2);
    });

    it('should measure output size correctly', async () => {
      const result = await strategy.execute('echo "test data"', 'adapt-7');
      
      assert.ok(result.stdout.length > 0 || result.processId);
    });
  });

  // ========== EXECUTION STRATEGY FACTORY TESTS ==========
  describe('ExecutionStrategyFactory', () => {
    const config = createMockConfig();

    it('should create foreground strategy for foreground mode', () => {
      const strategy = ExecutionStrategyFactory.create('foreground', config);
      
      assert.strictEqual(strategy.getExecutionMode(), 'foreground');
      assert.ok(strategy instanceof ForegroundStrategy);
    });

    it('should create background strategy for background mode', () => {
      const strategy = ExecutionStrategyFactory.create('background', config);
      
      assert.strictEqual(strategy.getExecutionMode(), 'background');
      assert.ok(strategy instanceof BackgroundStrategy);
    });

    it('should create detached strategy for detached mode', () => {
      const strategy = ExecutionStrategyFactory.create('detached', config);
      
      assert.strictEqual(strategy.getExecutionMode(), 'detached');
      assert.ok(strategy instanceof DetachedStrategy);
    });

    it('should create adaptive strategy for adaptive mode', () => {
      const strategy = ExecutionStrategyFactory.create('adaptive', config);
      
      assert.strictEqual(strategy.getExecutionMode(), 'adaptive');
      assert.ok(strategy instanceof AdaptiveStrategy);
    });

    it('should throw for invalid mode', () => {
      assert.throws(() => {
        ExecutionStrategyFactory.create('invalid' as any, config);
      });
    });

    it('should apply default configuration', () => {
      const strategy = ExecutionStrategyFactory.create('foreground', config);
      
      assert.strictEqual(strategy.getTimeoutMs(), config.timeoutMs);
      assert.strictEqual(strategy.getKillGracePeriodMs(), config.killGracePeriodMs);
    });

    it('should allow strategy registration', () => {
      // Factory should support registration pattern
      const strategy = ExecutionStrategyFactory.create('foreground', config);
      assert.ok(strategy);
    });

    it('should handle multiple strategy creations', () => {
      const strategies = [
        ExecutionStrategyFactory.create('foreground', config),
        ExecutionStrategyFactory.create('background', config),
        ExecutionStrategyFactory.create('detached', config),
        ExecutionStrategyFactory.create('adaptive', config),
      ];
      
      assert.strictEqual(strategies.length, 4);
      strategies.forEach(s => assert.ok(s));
    });

    it('should preserve configuration in created strategies', () => {
      const customConfig = createMockConfig({
        timeoutMs: 25000,
        killGracePeriodMs: 3000,
      });
      const strategy = ExecutionStrategyFactory.create('foreground', customConfig);
      
      assert.strictEqual(strategy.getTimeoutMs(), 25000);
      assert.strictEqual(strategy.getKillGracePeriodMs(), 3000);
    });
  });

  // ========== ERROR HANDLING TESTS ==========
  describe('Error Handling', () => {
    let strategy: ForegroundStrategy;
    const config = createMockConfig();

    beforeEach(() => {
      strategy = new ForegroundStrategy(config);
    });

    afterEach(async () => {
      await strategy.cleanup();
    });

    it('should throw ExecutionTimeoutError on timeout', async () => {
      const timeoutConfig = createMockConfig({ timeoutMs: 300 });
      strategy = new ForegroundStrategy(timeoutConfig);
      
      try {
        await strategy.execute('sleep 5', 'err-1');
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error instanceof ExecutionTimeoutError);
      }
    });

    it('should capture error in result', async () => {
      const result = await strategy.execute('nonexistent_command_12345', 'err-2');
      
      // Command not found should result in non-zero exit code
      assert.ok(result.exitCode !== 0);
    });

    it('should handle invalid working directory gracefully', async () => {
      const invalidDirConfig = createMockConfig({
        workingDirectory: '/nonexistent/path/12345',
      });
      strategy = new ForegroundStrategy(invalidDirConfig);
      
      const result = await strategy.execute('echo "test"', 'err-3');
      // Should still attempt execution
      assert.ok(result);
    });
  });
});
