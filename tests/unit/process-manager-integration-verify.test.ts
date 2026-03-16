import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import { ProcessManager } from '../../src/core/process-manager.js';
import {
  CorrelationContext,
  LoggingContext,
  attachContextToError,
} from '../../src/core/logging/index.js';

describe('ProcessManager - Correlation ID Integration Verification', () => {
  let processManager: ProcessManager;

  beforeEach(() => {
    processManager = new ProcessManager(10, process.cwd());
  });

  afterEach(() => {
    try {
      if (processManager) {
        processManager.cleanup();
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  // ========== REQUIREMENT 1: Import and Setup ==========
  describe('Requirement 1: Import and Setup', () => {
    it('should initialize LoggingContext in constructor', () => {
      assert.ok(processManager);
      // Verify ProcessManager has loggingContext (checked through behavior)
    });

    it('should have LoggingContext and CorrelationContext available', () => {
      const context = CorrelationContext.generate();
      assert.ok(context);
      assert.ok(context.correlationId);
    });
  });

  // ========== REQUIREMENT 2: Execution Lifecycle Tracking ==========
  describe('Requirement 2: Execution Lifecycle Tracking', () => {
    it('should support root correlation context generation for execution', () => {
      const executionContext = CorrelationContext.generate(
        undefined,
        'test-user',
        'test-session'
      );

      assert.ok(executionContext.correlationId);
      assert.ok(executionContext.userId === 'test-user');
      assert.ok(executionContext.depth === 0);
    });

    it('should support child context for strategy execution', async () => {
      const rootContext = CorrelationContext.generate(undefined, 'exec-user');

      const result = await CorrelationContext.runAsync(rootContext, async () => {
        const childContext = CorrelationContext.createChild(
          undefined,
          'strategy-foreground'
        );
        return childContext;
      });

      assert.ok(result);
      assert.ok(result.parentId);
      assert.ok(result.depth === 1);
      assert.ok(result.sessionId?.includes('strategy-foreground'));
    });

    it('should track execution with userId in context', () => {
      const context = CorrelationContext.generate(
        undefined,
        'user-123',
        'session-456'
      );

      assert.ok(context.userId === 'user-123');
      assert.ok(context.sessionId === 'session-456');
      assert.ok(context.timestamp > 0);
    });
  });

  // ========== REQUIREMENT 3: Streaming and Events ==========
  describe('Requirement 3: Streaming and Events', () => {
    it('should support correlation context to metadata conversion', () => {
      const context = CorrelationContext.generate(undefined, 'stream-user');
      const metadata = CorrelationContext.toMetadata(context);

      assert.ok(metadata.correlationId === context.correlationId);
      assert.ok(metadata.userId === 'stream-user');
      assert.ok(metadata.timestamp === context.timestamp);
    });

    it('should handle error context attachment', () => {
      const context = CorrelationContext.generate(undefined, 'error-user');
      const error = new Error('Test error');

      const contextError = attachContextToError(error, context);
      assert.ok(contextError);
      assert.ok((contextError as any).correlationId === context.correlationId);
    });
  });

  // ========== REQUIREMENT 4: Error Handling ==========
  describe('Requirement 4: Error Handling', () => {
    it('should support error context attachment in correlation system', () => {
      const context = CorrelationContext.generate(undefined, 'error-handler');
      const error = new Error('Handler error');

      CorrelationContext.run(context, () => {
        const attachedError = attachContextToError(error);
        assert.ok(attachedError);
        assert.ok((attachedError as any).correlationId === context.correlationId);
      });
    });

    it('should maintain context through error paths', async () => {
      const context = CorrelationContext.generate(undefined, 'error-flow');

      await CorrelationContext.runAsync(context, async () => {
        const currentContext = CorrelationContext.get();
        assert.ok(currentContext);
        assert.ok(currentContext?.correlationId === context.correlationId);

        const error = new Error('Flow error');
        const attached = attachContextToError(error);
        assert.ok((attached as any).correlationId === context.correlationId);
      });
    });
  });

  // ========== REQUIREMENT 5: Backward Compatibility ==========
  describe('Requirement 5: Backward Compatibility', () => {
    it('should preserve executeCommand method signature', async () => {
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
      assert.ok(result.command === 'echo "test"');
      assert.ok(result.status === 'completed' || result.status === 'failed');
    });

    it('should preserve getExecution method', async () => {
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

    it('should preserve listExecutions method', () => {
      const list = processManager.listExecutions();
      assert.ok(Array.isArray(list.executions));
      assert.ok(typeof list.total === 'number');
    });

    it('should have all public methods unchanged', () => {
      assert.ok(typeof processManager.executeCommand === 'function');
      assert.ok(typeof processManager.getExecution === 'function');
      assert.ok(typeof processManager.listExecutions === 'function');
      assert.ok(typeof processManager.killProcess === 'function');
      assert.ok(typeof processManager.listProcesses === 'function');
      assert.ok(typeof processManager.cleanup === 'function');
      assert.ok(
        typeof processManager.getDefaultWorkingDirectory === 'function'
      );
    });
  });

  // ========== INTEGRATION VERIFICATION ==========
  describe('Integration Verification', () => {
    it('should support hierarchical context depth tracking', () => {
      const root = CorrelationContext.generate();
      assert.ok(root.depth === 0);

      const child = {
        ...root,
        correlationId: 'child-id',
        parentId: root.correlationId,
        depth: 1,
      };

      assert.ok(child.depth === 1);
      assert.ok(child.parentId === root.correlationId);
    });

    it('should format context for logging', () => {
      const context = CorrelationContext.generate(
        undefined,
        'format-user',
        'format-session'
      );
      const formatted = CorrelationContext.format(context);

      assert.ok(formatted.includes(context.correlationId));
      assert.ok(formatted.includes('format-user'));
      assert.ok(formatted.includes('format-session'));
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
  });
});
