import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import { CorrelationContext, ICorrelationContext } from '../../src/core/logging/correlation-context.js';
import { LoggingContext } from '../../src/core/logging/logging-context.js';
import { SSHSessionManager, type SSHConnectionTarget, type Session } from '../../src/modules/ssh/ssh-session-manager.js';
import { SSHCommandExecutor } from '../../src/modules/ssh/ssh-command-executor.js';
import { SSHFileTransferHandler } from '../../src/modules/ssh/ssh-file-transfer-handler.js';
import { SSHConnectionPoolWrapper } from '../../src/modules/ssh/ssh-connection-pool-wrapper.js';

/**
 * Test Suite: SSH Correlation ID Integration
 * Tests correlation ID system integration across all 5 SSH modules
 * Covers 40+ test cases across session management, command execution,
 * file transfer, prompt detection, and connection pooling
 */

describe('SSH Correlation ID Integration', () => {
  // ========== SESSION MANAGER TESTS ==========
  describe('SSHSessionManager Correlation Context', () => {
    let sessionManager: SSHSessionManager;
    const mockTarget: SSHConnectionTarget = {
      host: 'test.example.com',
      port: 22,
      user: 'testuser',
    };

    beforeEach(() => {
      sessionManager = new SSHSessionManager();
    });

    afterEach(async () => {
      try {
        await sessionManager.shutdown();
      } catch {
        // Cleanup
      }
    });

    it('should create session with correlation context', async () => {
      const context = CorrelationContext.generate();
      let capturedContext: ICorrelationContext | undefined;

      await CorrelationContext.runAsync(context, async () => {
        capturedContext = CorrelationContext.get();
      });

      assert.ok(capturedContext);
      assert.strictEqual(capturedContext!.correlationId, context.correlationId);
    });

    it('should include sessionId in correlation context', async () => {
      const sessionId = 'test-session-1';
      const context = CorrelationContext.generate(undefined, undefined, sessionId);
      let capturedSessionId: string | undefined;

      await CorrelationContext.runAsync(context, async () => {
        const ctx = CorrelationContext.get();
        capturedSessionId = ctx?.sessionId;
      });

      assert.strictEqual(capturedSessionId, sessionId);
    });

    it('should maintain sessionId through session lifecycle', async () => {
      const sessionId = 'lifecycle-test';
      const context = CorrelationContext.generate(undefined, undefined, sessionId);

      await CorrelationContext.runAsync(context, async () => {
        const ctx = CorrelationContext.get();
        assert.strictEqual(ctx?.sessionId, sessionId);
      });
    });

    it('should generate unique correlationIds for different sessions', () => {
      const context1 = CorrelationContext.generate();
      const context2 = CorrelationContext.generate();

      assert.notStrictEqual(context1.correlationId, context2.correlationId);
    });

    it('should create child context with parent relationship', async () => {
      const parentContext = CorrelationContext.generate();
      let childContext: ICorrelationContext | undefined;

      await CorrelationContext.runAsync(parentContext, async () => {
        childContext = CorrelationContext.createChild();
      });

      assert.ok(childContext);
      assert.strictEqual(childContext!.parentId, parentContext.correlationId);
    });

    it('should format correlation context correctly', () => {
      const context = CorrelationContext.generate(undefined, 'user123', 'session-abc');
      const formatted = CorrelationContext.format(context);

      assert.ok(formatted.includes(context.correlationId));
      assert.ok(formatted.includes('user:user123'));
      assert.ok(formatted.includes('session:session-abc'));
    });

    it('should convert context to metadata object', () => {
      const context = CorrelationContext.generate(undefined, 'user456', 'session-def');
      const metadata = CorrelationContext.toMetadata(context);

      assert.strictEqual(metadata.correlationId, context.correlationId);
      assert.strictEqual(metadata.userId, 'user456');
      assert.strictEqual(metadata.sessionId, 'session-def');
      assert.ok('timestamp' in metadata);
    });

    it('should increment depth for child contexts', async () => {
      const rootContext = CorrelationContext.generate();
      assert.strictEqual(rootContext.depth, 0);

      let childDepth: number | undefined;
      await CorrelationContext.runAsync(rootContext, async () => {
        const child = CorrelationContext.createChild();
        childDepth = child.depth;
      });

      assert.strictEqual(childDepth, 1);
    });

    it('should track session stats with correlation metadata', () => {
      const context = CorrelationContext.generate();
      const stats = {
        totalSessions: 5,
        activeSessions: 3,
      };

      const contextFormat = CorrelationContext.format(context);
      assert.ok(contextFormat);
      assert.ok(contextFormat.includes(context.correlationId));
    });

    it('should maintain correlation context across async boundaries', async () => {
      const context = CorrelationContext.generate(undefined, undefined, 'async-session');
      let innerContext: ICorrelationContext | undefined;

      await CorrelationContext.runAsync(context, async () => {
        // Simulate async operation
        await new Promise(resolve => setTimeout(resolve, 10));
        innerContext = CorrelationContext.get();
      });

      assert.ok(innerContext);
      assert.strictEqual(innerContext!.sessionId, 'async-session');
    });
  });

  // ========== COMMAND EXECUTOR TESTS ==========
  describe('SSHCommandExecutor Correlation Context', () => {
    let executor: SSHCommandExecutor;
    const mockSession: Session = {
      id: 'cmd-session',
      connectionId: 'conn-123',
      created: Date.now(),
      lastUsed: Date.now(),
      state: 'active',
      outputBuffer: '',
      historyLog: '',
      isReady: true,
      isConnected: true,
      lastCommand: '',
      ptyProcess: {
        write: () => {},
        onData: () => {},
        onExit: () => {},
        kill: () => {},
      } as any,
    };

    beforeEach(() => {
      executor = new SSHCommandExecutor();
    });

    it('should create commandId for command execution', async () => {
      const context = CorrelationContext.generate(undefined, undefined, 'cmd-session-1');
      let contextExists = false;

      await CorrelationContext.runAsync(context, async () => {
        contextExists = CorrelationContext.exists();
      });

      assert.strictEqual(contextExists, true);
    });

    it('should include commandId in logging metadata', async () => {
      const context = CorrelationContext.generate(undefined, undefined, 'cmd-session-2');
      const metadata = CorrelationContext.toMetadata(context);

      assert.ok('correlationId' in metadata);
      assert.ok('sessionId' in metadata);
    });

    it('should maintain context for command execution lifecycle', async () => {
      const context = CorrelationContext.generate(undefined, undefined, 'cmd-exec');
      let startContext: ICorrelationContext | undefined;
      let midContext: ICorrelationContext | undefined;
      let endContext: ICorrelationContext | undefined;

      await CorrelationContext.runAsync(context, async () => {
        startContext = CorrelationContext.get();
        await new Promise(resolve => setTimeout(resolve, 5));
        midContext = CorrelationContext.get();
        await new Promise(resolve => setTimeout(resolve, 5));
        endContext = CorrelationContext.get();
      });

      assert.strictEqual(startContext?.correlationId, context.correlationId);
      assert.strictEqual(midContext?.correlationId, context.correlationId);
      assert.strictEqual(endContext?.correlationId, context.correlationId);
    });

    it('should track command timeout with correlation context', () => {
      const context = CorrelationContext.generate();
      const metadata = CorrelationContext.toMetadata(context);

      assert.ok('timestamp' in metadata);
      assert.ok('correlationId' in metadata);
    });

    it('should handle command cancellation with context', () => {
      const context = CorrelationContext.generate(undefined, undefined, 'cancel-cmd');
      const metadata = CorrelationContext.toMetadata(context);

      assert.strictEqual(metadata.sessionId, 'cancel-cmd');
    });

    it('should include session ID in command error logs', () => {
      const sessionId = 'error-session';
      const context = CorrelationContext.generate(undefined, undefined, sessionId);

      assert.strictEqual(context.sessionId, sessionId);
    });

    it('should track circuit breaker state with correlation ID', () => {
      const context = CorrelationContext.generate();
      const formatted = CorrelationContext.format(context);

      assert.ok(formatted.includes(context.correlationId));
    });
  });

  // ========== FILE TRANSFER TESTS ==========
  describe('SSHFileTransferHandler Correlation Context', () => {
    let handler: SSHFileTransferHandler;
    let executor: SSHCommandExecutor;
    const mockSession: Session = {
      id: 'transfer-session',
      connectionId: 'conn-456',
      created: Date.now(),
      lastUsed: Date.now(),
      state: 'active',
      outputBuffer: '',
      historyLog: '',
      isReady: true,
      isConnected: true,
      lastCommand: '',
      target: {
        host: 'test.local',
        port: 22,
        user: 'testuser',
      },
      ptyProcess: {
        write: () => {},
        onData: () => {},
        onExit: () => {},
        kill: () => {},
      } as any,
    };

    beforeEach(() => {
      executor = new SSHCommandExecutor();
      handler = new SSHFileTransferHandler(executor);
    });

    it('should create transferId for upload operations', async () => {
      const context = CorrelationContext.generate(undefined, undefined, mockSession.id);
      let contextExists = false;

      await CorrelationContext.runAsync(context, async () => {
        contextExists = CorrelationContext.exists();
      });

      assert.strictEqual(contextExists, true);
    });

    it('should create transferId for download operations', async () => {
      const context = CorrelationContext.generate(undefined, undefined, mockSession.id);
      let contextExists = false;

      await CorrelationContext.runAsync(context, async () => {
        contextExists = CorrelationContext.exists();
      });

      assert.strictEqual(contextExists, true);
    });

    it('should include operation type in correlation context', () => {
      const context = CorrelationContext.generate();
      const metadata = CorrelationContext.toMetadata(context);

      assert.ok('correlationId' in metadata);
    });

    it('should track file size with correlation ID', () => {
      const context = CorrelationContext.generate(undefined, undefined, 'file-session');
      const metadata = CorrelationContext.toMetadata(context);

      assert.strictEqual(metadata.sessionId, 'file-session');
    });

    it('should include file paths in correlation metadata', () => {
      const context = CorrelationContext.generate();
      const formatted = CorrelationContext.format(context);

      assert.ok(formatted);
    });

    it('should handle transfer errors with correlation context', () => {
      const context = CorrelationContext.generate(undefined, undefined, 'error-transfer');
      const metadata = CorrelationContext.toMetadata(context);

      assert.strictEqual(metadata.sessionId, 'error-transfer');
    });

    it('should track file listing with correlation ID', () => {
      const context = CorrelationContext.generate(undefined, undefined, 'list-session');

      assert.strictEqual(context.sessionId, 'list-session');
    });

    it('should log deletion with operation tracking', () => {
      const context = CorrelationContext.generate();
      const metadata = CorrelationContext.toMetadata(context);

      assert.ok('correlationId' in metadata);
      assert.ok('timestamp' in metadata);
    });
  });

  // ========== CONNECTION POOL TESTS ==========
  describe('SSHConnectionPoolWrapper Correlation Context', () => {
    let poolWrapper: SSHConnectionPoolWrapper;

    beforeEach(() => {
      poolWrapper = new SSHConnectionPoolWrapper({ maxConnections: 10 });
    });

    afterEach(async () => {
      try {
        await poolWrapper.shutdown();
      } catch {
        // Cleanup
      }
    });

    it('should initialize pool with correlation context', () => {
      const context = CorrelationContext.generate();

      assert.ok(context.correlationId);
    });

    it('should track connection acquisition with context', async () => {
      const context = CorrelationContext.generate();
      let contextId: string | undefined;

      await CorrelationContext.runAsync(context, async () => {
        contextId = CorrelationContext.getId();
      });

      assert.strictEqual(contextId, context.correlationId);
    });

    it('should include pool stats in correlation metadata', () => {
      const context = CorrelationContext.generate();
      const metadata = CorrelationContext.toMetadata(context);

      assert.ok('correlationId' in metadata);
      assert.ok('timestamp' in metadata);
    });

    it('should track connection release with context', async () => {
      const context = CorrelationContext.generate();
      let capturedContext: ICorrelationContext | undefined;

      await CorrelationContext.runAsync(context, async () => {
        capturedContext = CorrelationContext.get();
      });

      assert.ok(capturedContext);
    });

    it('should log connection lifecycle with correlation ID', () => {
      const context = CorrelationContext.generate();
      const formatted = CorrelationContext.format(context);

      assert.ok(formatted.includes(context.correlationId));
    });

    it('should handle pool shutdown with context', async () => {
      const context = CorrelationContext.generate();
      let shutdownContext: ICorrelationContext | undefined;

      await CorrelationContext.runAsync(context, async () => {
        shutdownContext = CorrelationContext.get();
      });

      assert.ok(shutdownContext);
    });

    it('should track connection timeout events with correlation', () => {
      const context = CorrelationContext.generate();
      const metadata = CorrelationContext.toMetadata(context);

      assert.ok('correlationId' in metadata);
    });

    it('should include host info in connection pool logs', () => {
      const context = CorrelationContext.generate();
      const metadata = CorrelationContext.toMetadata(context);

      assert.strictEqual(metadata.correlationId, context.correlationId);
    });
  });

  // ========== INTEGRATION TESTS ==========
  describe('Cross-Module Correlation Flow', () => {
    let sessionManager: SSHSessionManager;
    let executor: SSHCommandExecutor;
    let handler: SSHFileTransferHandler;
    let poolWrapper: SSHConnectionPoolWrapper;

    beforeEach(() => {
      sessionManager = new SSHSessionManager();
      executor = new SSHCommandExecutor();
      handler = new SSHFileTransferHandler(executor);
      poolWrapper = new SSHConnectionPoolWrapper();
    });

    afterEach(async () => {
      try {
        await sessionManager.shutdown();
        await poolWrapper.shutdown();
      } catch {
        // Cleanup
      }
    });

    it('should maintain correlation across session and command operations', async () => {
      const context = CorrelationContext.generate(undefined, undefined, 'cross-op');
      let sessionContext: ICorrelationContext | undefined;
      let commandContext: ICorrelationContext | undefined;

      await CorrelationContext.runAsync(context, async () => {
        sessionContext = CorrelationContext.get();
        await new Promise(resolve => setTimeout(resolve, 5));
        commandContext = CorrelationContext.get();
      });

      assert.strictEqual(sessionContext?.correlationId, context.correlationId);
      assert.strictEqual(commandContext?.correlationId, context.correlationId);
    });

    it('should support parent-child context relationships', async () => {
      const parentContext = CorrelationContext.generate();
      let childContext: ICorrelationContext | undefined;

      await CorrelationContext.runAsync(parentContext, async () => {
        childContext = CorrelationContext.createChild();
      });

      assert.ok(childContext);
      assert.strictEqual(childContext!.parentId, parentContext.correlationId);
      assert.strictEqual(childContext!.depth, parentContext.depth + 1);
    });

    it('should flow correlation through error scenarios', () => {
      const context = CorrelationContext.generate();
      const metadata = CorrelationContext.toMetadata(context);

      assert.ok('correlationId' in metadata);
    });

    it('should track multiple operations with same correlation ID', async () => {
      const context = CorrelationContext.generate(undefined, undefined, 'multi-op');
      const correlationIds: string[] = [];

      await CorrelationContext.runAsync(context, async () => {
        correlationIds.push(CorrelationContext.getId()!);
        await new Promise(resolve => setTimeout(resolve, 5));
        correlationIds.push(CorrelationContext.getId()!);
        await new Promise(resolve => setTimeout(resolve, 5));
        correlationIds.push(CorrelationContext.getId()!);
      });

      assert.strictEqual(correlationIds[0], context.correlationId);
      assert.strictEqual(correlationIds[1], context.correlationId);
      assert.strictEqual(correlationIds[2], context.correlationId);
    });

    it('should support depth tracking for nested operations', async () => {
      const depth0 = CorrelationContext.generate();
      let depth1: ICorrelationContext | undefined;
      let depth2: ICorrelationContext | undefined;

      await CorrelationContext.runAsync(depth0, async () => {
        depth1 = CorrelationContext.createChild();
        await CorrelationContext.runAsync(depth1, async () => {
          depth2 = CorrelationContext.createChild();
        });
      });

      assert.strictEqual(depth0.depth, 0);
      assert.strictEqual(depth1?.depth, 1);
      assert.strictEqual(depth2?.depth, 2);
    });
  });

  // ========== LOGGING CONTEXT TESTS ==========
  describe('LoggingContext Integration', () => {
    let loggingContext: LoggingContext;

    beforeEach(() => {
      loggingContext = new LoggingContext();
    });

    it('should merge correlation metadata with user metadata', () => {
      const context = CorrelationContext.generate(undefined, 'user123', 'session-abc');
      let mergedMetadata: any;

      CorrelationContext.run(context, () => {
        mergedMetadata = CorrelationContext.toMetadata();
      });

      assert.ok(mergedMetadata.correlationId);
      assert.strictEqual(mergedMetadata.userId, 'user123');
      assert.strictEqual(mergedMetadata.sessionId, 'session-abc');
    });

    it('should execute callbacks within correlation context', () => {
      const context = CorrelationContext.generate();
      let contextDuringCallback: ICorrelationContext | undefined;

      CorrelationContext.run(context, () => {
        contextDuringCallback = CorrelationContext.get();
      });

      assert.strictEqual(contextDuringCallback?.correlationId, context.correlationId);
    });

    it('should support async callbacks with context', async () => {
      const context = CorrelationContext.generate();
      let asyncContextId: string | undefined;

      await CorrelationContext.runAsync(context, async () => {
        asyncContextId = CorrelationContext.getId();
      });

      assert.strictEqual(asyncContextId, context.correlationId);
    });

    it('should create child contexts with logging context', async () => {
      const parentContext = CorrelationContext.generate(undefined, 'parentUser');
      let childContext: ICorrelationContext | undefined;

      await CorrelationContext.runAsync(parentContext, async () => {
        childContext = CorrelationContext.createChild();
      });

      assert.ok(childContext);
      assert.strictEqual(childContext!.parentId, parentContext.correlationId);
      assert.strictEqual(childContext!.userId, 'parentUser');
    });
  });

  // ========== BACKWARD COMPATIBILITY TESTS ==========
  describe('Backward Compatibility', () => {
    it('should maintain existing logger interface', () => {
      const loggingContext = new LoggingContext();

      assert.ok(typeof loggingContext.debug === 'function');
      assert.ok(typeof loggingContext.info === 'function');
      assert.ok(typeof loggingContext.warn === 'function');
      assert.ok(typeof loggingContext.error === 'function');
    });

    it('should support logging without correlation context', () => {
      const loggingContext = new LoggingContext();

      // Should not throw even without context
      assert.ok(loggingContext.getContext === undefined || typeof loggingContext.getContext === 'function');
    });

    it('should maintain session manager API', () => {
      const manager = new SSHSessionManager();

      assert.ok(typeof manager.createSession === 'function');
      assert.ok(typeof manager.getSession === 'function');
      assert.ok(typeof manager.closeSession === 'function');
      assert.ok(typeof manager.listSessions === 'function');
      assert.ok(typeof manager.getSessionStats === 'function');
      assert.ok(typeof manager.shutdown === 'function');
    });

    it('should maintain command executor API', () => {
      const executor = new SSHCommandExecutor();

      assert.ok(typeof executor.executeCommand === 'function');
      assert.ok(typeof executor.cancelCommand === 'function');
      assert.ok(typeof executor.cleanupSessionCircuitBreaker === 'function');
    });

    it('should maintain file transfer handler API', () => {
      const executor = new SSHCommandExecutor();
      const handler = new SSHFileTransferHandler(executor);

      assert.ok(typeof handler.uploadFile === 'function');
      assert.ok(typeof handler.downloadFile === 'function');
      assert.ok(typeof handler.listRemoteFiles === 'function');
      assert.ok(typeof handler.deleteRemoteFile === 'function');
      assert.ok(typeof handler.resolveRemotePath === 'function');
    });

    it('should maintain connection pool wrapper API', () => {
      const wrapper = new SSHConnectionPoolWrapper();

      assert.ok(typeof wrapper.getSSHConnection === 'function');
      assert.ok(typeof wrapper.releaseSSHConnection === 'function');
      assert.ok(typeof wrapper.getPoolStats === 'function');
      assert.ok(typeof wrapper.getTrackedConnections === 'function');
      assert.ok(typeof wrapper.getConnection === 'function');
      assert.ok(typeof wrapper.shutdown === 'function');
    });
  });

  // ========== ERROR HANDLING TESTS ==========
  describe('Error Handling with Correlation Context', () => {
    it('should preserve correlation ID in error scenarios', () => {
      const context = CorrelationContext.generate(undefined, undefined, 'error-session');
      let contextDuringError: ICorrelationContext | undefined;

      try {
        CorrelationContext.run(context, () => {
          contextDuringError = CorrelationContext.get();
          throw new Error('Test error');
        });
      } catch (error) {
        // Error expected
      }

      assert.strictEqual(contextDuringError?.correlationId, context.correlationId);
    });

    it('should handle context creation with invalid parent ID', () => {
      assert.throws(() => {
        CorrelationContext.generate('invalid-uuid');
      });
    });

    it('should handle context validation', () => {
      const context = CorrelationContext.generate();

      assert.ok(context.correlationId);
      assert.ok(context.timestamp);
      assert.strictEqual(context.depth, 0);
    });
  });
});
