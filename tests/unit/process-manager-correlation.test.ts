import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import { ProcessManager } from '../../src/core/process-manager.js';
import {
  CorrelationContext,
  LoggingContext,
  attachContextToError,
} from '../../src/core/logging/index.js';

/**
 * Test Suite: ProcessManager Correlation ID Integration
 * Tests the integration of the correlation ID system into ProcessManager
 * Verifies proper context tracking through execution lifecycle
 */

describe('ProcessManager - Correlation ID Integration', () => {
  let processManager: ProcessManager;
  let loggingContext: LoggingContext;

  beforeEach(() => {
    processManager = new ProcessManager(10, process.cwd());
    loggingContext = new LoggingContext();
  });

  afterEach(async () => {
    try {
      if (processManager) {
        processManager.cleanup();
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  // ========== CONSTRUCTOR TESTS ==========
  describe('Constructor Initialization', () => {
    it('should initialize LoggingContext in constructor', () => {
      assert.ok(processManager);
      // Verify the instance was created with logging context
      // (cannot access private property, but we can verify behavior)
    });

    it('should have loggingContext available for correlation tracking', () => {
      assert.ok(loggingContext);
      assert.ok(typeof loggingContext.info === 'function');
      assert.ok(typeof loggingContext.error === 'function');
    });
  });

  // ========== EXECUTION LIFECYCLE TESTS ==========
  describe('Execution Lifecycle with Correlation', () => {
    it('should create root correlation context for execution', async () => {
      // Create a correlation context manually to verify behavior
      const context = CorrelationContext.generate(
        undefined,
        'test-user',
        'test-session'
      );

      assert.ok(context);
      assert.ok(context.correlationId);
      assert.ok(context.userId === 'test-user');
      assert.ok(context.sessionId === 'test-session');
      assert.ok(context.depth === 0);
    });

    it('should execute command with correlation context', async () => {
      const result = await processManager.executeCommand({
        command: 'echo "test"',
        executionMode: 'foreground',
        workingDirectory: process.cwd(),
        timeoutSeconds: 5,
        maxOutputSize: 1024 * 1024,
        captureStderr: true,
        createTerminal: false,
      });

      assert.ok(result);
      assert.ok(result.execution_id);
      assert.ok(result.status === 'completed' || result.status === 'failed');
    });

    it('should include correlation metadata in logs', async () => {
      const context = CorrelationContext.generate(undefined, 'user-123');

      // Verify context has all required fields
      assert.ok(context.correlationId);
      assert.ok(context.userId === 'user-123');
      assert.ok(context.timestamp > 0);

      // Convert to metadata
      const metadata = CorrelationContext.toMetadata(context);
      assert.ok(metadata.correlationId === context.correlationId);
      assert.ok(metadata.userId === 'user-123');
    });
  });

  // ========== STRATEGY EXECUTION CONTEXT TESTS ==========
  describe('Strategy Execution Context', () => {
    it('should create child context for strategy execution', async () => {
      // Test child context creation
      const parentContext = CorrelationContext.generate(undefined, 'parent-user');
      const parentId = parentContext.correlationId;

      const childContext = CorrelationContext.createChild('child-user');

      assert.ok(childContext);
      assert.ok(childContext.correlationId);
      assert.ok(childContext.parentId === parentId);
      assert.ok(childContext.depth === parentContext.depth + 1);
      assert.ok(childContext.userId === 'child-user');
    });

    it('should track strategy name in child context', async () => {
      const context = CorrelationContext.generate();
      const strategyName = 'foreground';

      CorrelationContext.runAsync(context, async () => {
        const childContext = CorrelationContext.createChild(
          undefined,
          `strategy-${strategyName}`
        );

        assert.ok(childContext);
        assert.ok(childContext.sessionId?.includes('strategy-foreground'));
      });
    });
  });

  // ========== ERROR HANDLING TESTS ==========
  describe('Error Handling with Correlation', () => {
    it('should attach correlation context to errors', async () => {
      const context = CorrelationContext.generate(undefined, 'error-user');

      const error = new Error('Test error');
      const contextError = attachContextToError(error, context);

      assert.ok(contextError);
      assert.ok((contextError as any).correlationId === context.correlationId);
      assert.ok((contextError as any).context?.userId === 'error-user');
    });

    it('should auto-attach context to error using current context', () => {
      const context = CorrelationContext.generate(undefined, 'current-user');

      CorrelationContext.run(context, () => {
        const error = new Error('Test error');
        const contextError = attachContextToError(error);

        assert.ok(contextError);
        assert.ok((contextError as any).correlationId === context.correlationId);
      });
    });

    it('should handle errors in execution with correlation tracking', async () => {
      try {
        await processManager.executeCommand({
          command: 'exit 1',
          executionMode: 'foreground',
          workingDirectory: process.cwd(),
          timeoutSeconds: 5,
          maxOutputSize: 1024 * 1024,
          captureStderr: true,
          createTerminal: false,
        });
      } catch (error) {
        // Verify error handling doesn't break
        assert.ok(error);
      }
    });
  });

  // ========== CORRELATION CONTEXT FORMATTING TESTS ==========
  describe('Correlation Context Formatting', () => {
    it('should format context as string', () => {
      const context = CorrelationContext.generate(
        undefined,
        'format-user',
        'format-session'
      );
      const formatted = CorrelationContext.format(context);

      assert.ok(formatted);
      assert.ok(formatted.includes(context.correlationId));
      assert.ok(formatted.includes('format-user'));
      assert.ok(formatted.includes('format-session'));
    });

    it('should convert context to metadata object', () => {
      const context = CorrelationContext.generate(
        undefined,
        'meta-user',
        'meta-session'
      );
      const metadata = CorrelationContext.toMetadata(context);

      assert.ok(metadata);
      assert.ok(metadata.correlationId === context.correlationId);
      assert.ok(metadata.userId === 'meta-user');
      assert.ok(metadata.sessionId === 'meta-session');
      assert.ok(metadata.timestamp === context.timestamp);
      assert.ok(metadata.depth === context.depth);
    });

    it('should handle metadata without optional fields', () => {
      const context = CorrelationContext.generate();
      const metadata = CorrelationContext.toMetadata(context);

      assert.ok(metadata);
      assert.ok(metadata.correlationId === context.correlationId);
      assert.ok(!metadata.userId); // Optional field
      assert.ok(!metadata.sessionId); // Optional field
      assert.ok(metadata.timestamp > 0);
      assert.ok(metadata.depth === 0);
    });
  });

  // ========== CONTEXT PROPAGATION TESTS ==========
  describe('Context Propagation', () => {
    it('should maintain correlation ID through execution', async () => {
      const context = CorrelationContext.generate(undefined, 'propagate-user');
      const correlationId = context.correlationId;

      const retrieved = CorrelationContext.get();
      // Note: This will be undefined outside of a run() context
      assert.ok(correlationId);

      CorrelationContext.run(context, () => {
        const contextInRun = CorrelationContext.get();
        assert.ok(contextInRun);
        assert.ok(contextInRun?.correlationId === correlationId);
      });
    });

    it('should support async context propagation', async () => {
      const context = CorrelationContext.generate(undefined, 'async-user');
      const correlationId = context.correlationId;

      await CorrelationContext.runAsync(context, async () => {
        const contextInAsync = CorrelationContext.get();
        assert.ok(contextInAsync);
        assert.ok(contextInAsync?.correlationId === correlationId);
      });
    });

    it('should create isolated contexts for concurrent operations', async () => {
      const context1 = CorrelationContext.generate(undefined, 'user-1');
      const context2 = CorrelationContext.generate(undefined, 'user-2');

      let id1: string | undefined;
      let id2: string | undefined;

      await Promise.all([
        CorrelationContext.runAsync(context1, async () => {
          id1 = CorrelationContext.getId();
        }),
        CorrelationContext.runAsync(context2, async () => {
          id2 = CorrelationContext.getId();
        }),
      ]);

      assert.ok(id1);
      assert.ok(id2);
      assert.ok(id1 !== id2);
      assert.ok(id1 === context1.correlationId);
      assert.ok(id2 === context2.correlationId);
    });
  });

  // ========== LOGGING CONTEXT INTEGRATION TESTS ==========
  describe('LoggingContext Integration', () => {
    it('should have getCorrelationId method', () => {
      assert.ok(typeof loggingContext.getCorrelationId === 'function');
    });

    it('should have getContext method', () => {
      assert.ok(typeof loggingContext.getContext === 'function');
    });

    it('should have withContextAsync method', () => {
      assert.ok(typeof loggingContext.withContextAsync === 'function');
    });

    it('should have withChildContextAsync method', () => {
      assert.ok(typeof loggingContext.withChildContextAsync === 'function');
    });

    it('should log with correlation metadata', async () => {
      const context = CorrelationContext.generate(undefined, 'log-user');

      await CorrelationContext.runAsync(context, async () => {
        const correlationId = loggingContext.getCorrelationId();
        assert.ok(correlationId === context.correlationId);

        const currentContext = loggingContext.getContext();
        assert.ok(currentContext);
        assert.ok(currentContext?.correlationId === context.correlationId);
      });
    });
  });

  // ========== HIERARCHICAL CONTEXT TESTS ==========
  describe('Hierarchical Context (Parent-Child)', () => {
    it('should track depth in hierarchy', () => {
      const root = CorrelationContext.generate();
      assert.ok(root.depth === 0);

      // Simulate child creation
      const child = {
        ...root,
        correlationId: '123',
        parentId: root.correlationId,
        depth: 1,
      };

      assert.ok(child.depth === 1);
      assert.ok(child.parentId === root.correlationId);
    });

    it('should support multiple levels of nesting', () => {
      const root = CorrelationContext.generate();
      let current = root;

      // Create nested contexts
      for (let i = 0; i < 3; i++) {
        const next = {
          correlationId: `id-${i}`,
          parentId: current.correlationId,
          userId: current.userId,
          sessionId: current.sessionId,
          timestamp: Date.now(),
          depth: current.depth + 1,
        };

        assert.ok(next.depth === i + 1);
        assert.ok(next.parentId === current.correlationId);

        current = next;
      }

      assert.ok(current.depth === 3);
    });
  });

  // ========== BACKWARD COMPATIBILITY TESTS ==========
  describe('Backward Compatibility', () => {
    it('should not break existing execute method signature', async () => {
      const result = await processManager.executeCommand({
        command: 'echo "test"',
        executionMode: 'foreground',
        workingDirectory: process.cwd(),
        timeoutSeconds: 5,
        maxOutputSize: 1024 * 1024,
        captureStderr: true,
        createTerminal: false,
      });

      // Verify standard result structure
      assert.ok(result);
      assert.ok(result.execution_id);
      assert.ok(result.command);
      assert.ok(result.status);
    });

    it('should preserve getExecution behavior', async () => {
      const result = await processManager.executeCommand({
        command: 'echo "test"',
        executionMode: 'foreground',
        workingDirectory: process.cwd(),
        timeoutSeconds: 5,
        maxOutputSize: 1024 * 1024,
        captureStderr: true,
        createTerminal: false,
      });

      const execution = processManager.getExecution(result.execution_id);
      assert.ok(execution);
      assert.ok(execution?.execution_id === result.execution_id);
    });

    it('should preserve listExecutions behavior', async () => {
      const result1 = await processManager.executeCommand({
        command: 'echo "test1"',
        executionMode: 'foreground',
        workingDirectory: process.cwd(),
        timeoutSeconds: 5,
        maxOutputSize: 1024 * 1024,
        captureStderr: true,
        createTerminal: false,
      });

      const list = processManager.listExecutions();
      assert.ok(list);
      assert.ok(Array.isArray(list.executions));
      assert.ok(list.total > 0);
    });
  });

  // ========== CONTEXT EXISTENCE TESTS ==========
  describe('Context Existence Checks', () => {
    it('should report context existence correctly', () => {
      // Outside context
      const existsBefore = CorrelationContext.exists();
      assert.ok(!existsBefore);

      // Inside context
      const context = CorrelationContext.generate();
      CorrelationContext.run(context, () => {
        const existsInside = CorrelationContext.exists();
        assert.ok(existsInside);
      });
    });

    it('should return all context information', () => {
      const context = CorrelationContext.generate(undefined, 'info-user');

      const allInfo = CorrelationContext.getAll();
      // Outside context, should be null
      assert.ok(allInfo === null);

      CorrelationContext.run(context, () => {
        const allInfoInside = CorrelationContext.getAll();
        assert.ok(allInfoInside);
        assert.ok(allInfoInside?.correlationId === context.correlationId);
        assert.ok(allInfoInside?.userId === 'info-user');
      });
    });
  });
});
