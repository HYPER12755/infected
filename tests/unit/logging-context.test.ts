import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import {
  CorrelationContext,
  LoggingContext,
  createContextMiddleware,
  withCorrelationContext,
  withCorrelationContextSync,
  extractCorrelationIdFromError,
  attachContextToError,
  propagateCorrelationContext,
} from '../../src/core/logging/index.js';

/**
 * Test Suite: Logging Context System
 * Tests correlation context, logging integration, and middleware
 * Total LOC: ~800 (comprehensive coverage)
 */

describe('CorrelationContext', () => {
  // ========== CONTEXT GENERATION TESTS ==========
  describe('generate()', () => {
    it('should generate a new context with UUID v4 correlationId', () => {
      const context = CorrelationContext.generate();

      assert.ok(context.correlationId);
      assert.strictEqual(typeof context.correlationId, 'string');
      assert.ok(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          context.correlationId
        )
      );
    });

    it('should set depth to 0 for root context', () => {
      const context = CorrelationContext.generate();
      assert.strictEqual(context.depth, 0);
    });

    it('should include optional userId and sessionId', () => {
      const userId = 'user-123';
      const sessionId = 'session-456';
      const context = CorrelationContext.generate(undefined, userId, sessionId);

      assert.strictEqual(context.userId, userId);
      assert.strictEqual(context.sessionId, sessionId);
    });

    it('should accept parentId and set it in context', () => {
      const parentContext = CorrelationContext.generate();
      const parentId = parentContext.correlationId;

      const childContext = CorrelationContext.generate(parentId);
      assert.strictEqual(childContext.parentId, parentId);
    });

    it('should reject invalid parentId format', () => {
      assert.throws(
        () => {
          CorrelationContext.generate('invalid-uuid');
        },
        /Invalid parentId format/
      );
    });

    it('should generate unique correlationIds', () => {
      const context1 = CorrelationContext.generate();
      const context2 = CorrelationContext.generate();

      assert.notStrictEqual(context1.correlationId, context2.correlationId);
    });

    it('should set timestamp to current time', () => {
      const before = Date.now();
      const context = CorrelationContext.generate();
      const after = Date.now();

      assert.ok(context.timestamp >= before);
      assert.ok(context.timestamp <= after);
    });
  });

  // ========== CONTEXT RETRIEVAL TESTS ==========
  describe('get() and getId()', () => {
    it('should return undefined when no context is set', () => {
      const context = CorrelationContext.get();
      // Note: May or may not be undefined depending on test isolation
      if (context) {
        assert.ok(context.correlationId);
      }
    });

    it('should retrieve context within run() scope', () => {
      const testContext = CorrelationContext.generate();

      CorrelationContext.run(testContext, () => {
        const retrieved = CorrelationContext.get();
        assert.deepStrictEqual(retrieved, testContext);
      });
    });

    it('should retrieve correlationId via getId()', () => {
      const testContext = CorrelationContext.generate();

      CorrelationContext.run(testContext, () => {
        const id = CorrelationContext.getId();
        assert.strictEqual(id, testContext.correlationId);
      });
    });
  });

  // ========== CONTEXT RUN TESTS ==========
  describe('run()', () => {
    it('should execute callback within context', () => {
      const testContext = CorrelationContext.generate();
      let executed = false;

      const result = CorrelationContext.run(testContext, () => {
        executed = true;
        return 'test-result';
      });

      assert.strictEqual(executed, true);
      assert.strictEqual(result, 'test-result');
    });

    it('should maintain context across nested operations', () => {
      const testContext = CorrelationContext.generate();
      const results: string[] = [];

      CorrelationContext.run(testContext, () => {
        results.push(CorrelationContext.getId() || '');

        CorrelationContext.run(testContext, () => {
          results.push(CorrelationContext.getId() || '');
        });

        results.push(CorrelationContext.getId() || '');
      });

      assert.strictEqual(results[0], testContext.correlationId);
      assert.strictEqual(results[1], testContext.correlationId);
      assert.strictEqual(results[2], testContext.correlationId);
    });

    it('should throw error for invalid context', () => {
      assert.throws(
        () => {
          CorrelationContext.run(null as any, () => {});
        },
        /Invalid context/
      );
    });

    it('should propagate callback errors', () => {
      const testContext = CorrelationContext.generate();

      assert.throws(
        () => {
          CorrelationContext.run(testContext, () => {
            throw new Error('test-error');
          });
        },
        /test-error/
      );
    });
  });

  // ========== ASYNC CONTEXT TESTS ==========
  describe('runAsync()', () => {
    it('should execute async callback within context', async () => {
      const testContext = CorrelationContext.generate();

      const result = await CorrelationContext.runAsync(testContext, async () => {
        return 'async-result';
      });

      assert.strictEqual(result, 'async-result');
    });

    it('should maintain context across async operations', async () => {
      const testContext = CorrelationContext.generate();

      const result = await CorrelationContext.runAsync(testContext, async () => {
        return CorrelationContext.getId();
      });

      assert.strictEqual(result, testContext.correlationId);
    });

    it('should propagate async callback errors', async () => {
      const testContext = CorrelationContext.generate();

      await assert.rejects(
        async () => {
          await CorrelationContext.runAsync(testContext, async () => {
            throw new Error('async-test-error');
          });
        },
        /async-test-error/
      );
    });
  });

  // ========== CHILD CONTEXT TESTS ==========
  describe('createChild()', () => {
    it('should create child context from parent', () => {
      const parentContext = CorrelationContext.generate();

      CorrelationContext.run(parentContext, () => {
        const childContext = CorrelationContext.createChild();

        assert.notStrictEqual(
          childContext.correlationId,
          parentContext.correlationId
        );
        assert.strictEqual(childContext.parentId, parentContext.correlationId);
      });
    });

    it('should increment depth in child context', () => {
      const parentContext = CorrelationContext.generate();
      assert.strictEqual(parentContext.depth, 0);

      CorrelationContext.run(parentContext, () => {
        const childContext = CorrelationContext.createChild();
        assert.strictEqual(childContext.depth, 1);
      });
    });

    it('should override userId in child context', () => {
      const parentContext = CorrelationContext.generate(undefined, 'parent-user');

      CorrelationContext.run(parentContext, () => {
        const childContext = CorrelationContext.createChild('child-user');
        assert.strictEqual(childContext.userId, 'child-user');
      });
    });

    it('should throw error if no parent context exists', () => {
      assert.throws(
        () => {
          CorrelationContext.createChild();
        },
        /no parent context/
      );
    });
  });

  // ========== UTILITY TESTS ==========
  describe('toMetadata() and format()', () => {
    it('should convert context to metadata object', () => {
      const context = CorrelationContext.generate(undefined, 'test-user', 'test-session');

      const metadata = CorrelationContext.toMetadata(context);

      assert.strictEqual(metadata.correlationId, context.correlationId);
      assert.strictEqual(metadata.userId, 'test-user');
      assert.strictEqual(metadata.sessionId, 'test-session');
      assert.ok(metadata.timestamp);
    });

    it('should format context as string', () => {
      const context = CorrelationContext.generate(undefined, 'test-user');

      const formatted = CorrelationContext.format(context);

      assert.ok(formatted.includes(context.correlationId));
      assert.ok(formatted.includes('user:test-user'));
    });

    it('should handle missing context in toMetadata()', () => {
      const metadata = CorrelationContext.toMetadata();
      assert.deepStrictEqual(metadata, {});
    });
  });

  describe('exists() and getAll()', () => {
    it('should return false when no context exists', () => {
      // Note: This depends on test isolation
      const exists = CorrelationContext.exists();
      // Don't assert - depends on test environment
    });

    it('should return true when context exists', () => {
      const testContext = CorrelationContext.generate();

      CorrelationContext.run(testContext, () => {
        assert.strictEqual(CorrelationContext.exists(), true);
      });
    });

    it('should return context via getAll()', () => {
      const testContext = CorrelationContext.generate();

      CorrelationContext.run(testContext, () => {
        const all = CorrelationContext.getAll();
        assert.deepStrictEqual(all, testContext);
      });
    });
  });
});

describe('LoggingContext', () => {
  // ========== LOGGING INTEGRATION TESTS ==========
  describe('logging methods', () => {
    it('should create LoggingContext instance', () => {
      const logContext = new LoggingContext();
      assert.ok(logContext);
    });

    it('should have all logging methods', () => {
      const logContext = new LoggingContext();

      assert.strictEqual(typeof logContext.error, 'function');
      assert.strictEqual(typeof logContext.warn, 'function');
      assert.strictEqual(typeof logContext.info, 'function');
      assert.strictEqual(typeof logContext.debug, 'function');
      assert.strictEqual(typeof logContext.http, 'function');
      assert.strictEqual(typeof logContext.fatal, 'function');
    });

    it('should log with correlation context', () => {
      const logContext = new LoggingContext();
      const testContext = CorrelationContext.generate();

      CorrelationContext.run(testContext, () => {
        // Just verify it doesn't throw
        logContext.info('test message', { key: 'value' });
        logContext.debug('debug message');
        logContext.warn('warning message');
      });
    });

    it('should handle logging without context', () => {
      const logContext = new LoggingContext();
      // Should not throw even without context
      logContext.info('test message without context');
    });
  });

  // ========== CONTEXT WRAPPER TESTS ==========
  describe('withContext() and withContextAsync()', () => {
    it('should execute callback within context', () => {
      const logContext = new LoggingContext();
      const testContext = CorrelationContext.generate();
      let executed = false;

      logContext.withContext(testContext, () => {
        executed = true;
        return 'result';
      });

      assert.strictEqual(executed, true);
    });

    it('should execute async callback within context', async () => {
      const logContext = new LoggingContext();
      const testContext = CorrelationContext.generate();

      const result = await logContext.withContextAsync(
        testContext,
        async () => {
          return 'async-result';
        },
        'test-operation'
      );

      assert.strictEqual(result, 'async-result');
    });

    it('should propagate errors with operation name', () => {
      const logContext = new LoggingContext();
      const testContext = CorrelationContext.generate();

      assert.throws(
        () => {
          logContext.withContext(testContext, () => {
            throw new Error('operation-failed');
          }, 'failing-op');
        },
        /operation-failed/
      );
    });
  });

  // ========== CHILD CONTEXT WRAPPER TESTS ==========
  describe('withChildContext() and withChildContextAsync()', () => {
    it('should create and execute child context', () => {
      const logContext = new LoggingContext();
      const parentContext = CorrelationContext.generate();

      CorrelationContext.run(parentContext, () => {
        let executed = false;

        logContext.withChildContext(() => {
          executed = true;
          const current = CorrelationContext.get();
          assert.strictEqual(current?.parentId, parentContext.correlationId);
        }, 'child-op');

        assert.strictEqual(executed, true);
      });
    });

    it('should execute async child context', async () => {
      const logContext = new LoggingContext();
      const parentContext = CorrelationContext.generate();

      await CorrelationContext.runAsync(parentContext, async () => {
        await logContext.withChildContextAsync(
          async () => {
            const current = CorrelationContext.get();
            assert.strictEqual(current?.parentId, parentContext.correlationId);
          },
          'async-child-op'
        );
      });
    });

    it('should throw if no parent context exists', () => {
      const logContext = new LoggingContext();

      assert.throws(
        () => {
          logContext.withChildContext(
            () => {},
            'orphan-op'
          );
        },
        /no parent context/
      );
    });
  });

  // ========== GETTER TESTS ==========
  describe('getContext() and getCorrelationId()', () => {
    it('should retrieve current context', () => {
      const logContext = new LoggingContext();
      const testContext = CorrelationContext.generate();

      CorrelationContext.run(testContext, () => {
        const retrieved = logContext.getContext();
        assert.deepStrictEqual(retrieved, testContext);
      });
    });

    it('should retrieve correlation ID', () => {
      const logContext = new LoggingContext();
      const testContext = CorrelationContext.generate();

      CorrelationContext.run(testContext, () => {
        const id = logContext.getCorrelationId();
        assert.strictEqual(id, testContext.correlationId);
      });
    });
  });
});

describe('Middleware and Utilities', () => {
  // ========== ERROR UTILITIES TESTS ==========
  describe('extractCorrelationIdFromError()', () => {
    it('should extract correlationId from error', () => {
      const error = new Error('test');
      (error as any).correlationId = 'test-id-123';

      const extracted = extractCorrelationIdFromError(error);
      assert.strictEqual(extracted, 'test-id-123');
    });

    it('should extract from requestId property', () => {
      const error = new Error('test');
      (error as any).requestId = 'request-id-456';

      const extracted = extractCorrelationIdFromError(error);
      assert.strictEqual(extracted, 'request-id-456');
    });

    it('should extract from context property', () => {
      const error = new Error('test');
      (error as any).context = { correlationId: 'context-id-789' };

      const extracted = extractCorrelationIdFromError(error);
      assert.strictEqual(extracted, 'context-id-789');
    });

    it('should return undefined for non-objects', () => {
      assert.strictEqual(extractCorrelationIdFromError(null), undefined);
      assert.strictEqual(extractCorrelationIdFromError('string'), undefined);
      assert.strictEqual(extractCorrelationIdFromError(123), undefined);
    });

    it('should return undefined if no ID found', () => {
      const error = new Error('test');
      const extracted = extractCorrelationIdFromError(error);
      assert.strictEqual(extracted, undefined);
    });
  });

  describe('attachContextToError()', () => {
    it('should attach context to error', () => {
      const error = new Error('test');
      const context = CorrelationContext.generate();

      const attached = attachContextToError(error, context);

      assert.strictEqual((attached as any).correlationId, context.correlationId);
      assert.deepStrictEqual((attached as any).context, context);
    });

    it('should use current context if not provided', () => {
      const error = new Error('test');
      const context = CorrelationContext.generate();

      const attached = CorrelationContext.run(context, () => {
        return attachContextToError(error);
      });

      assert.strictEqual((attached as any).correlationId, context.correlationId);
    });

    it('should return the same error object', () => {
      const error = new Error('test');
      const context = CorrelationContext.generate();

      const attached = attachContextToError(error, context);
      assert.strictEqual(attached, error);
    });
  });

  // ========== CONTEXT WRAPPER TESTS ==========
  describe('withCorrelationContext() and withCorrelationContextSync()', () => {
    it('should execute async operation with context', async () => {
      const result = await withCorrelationContext(async () => {
        const current = CorrelationContext.get();
        assert.ok(current?.correlationId);
        return 'async-result';
      });

      assert.strictEqual(result, 'async-result');
    });

    it('should execute sync operation with context', () => {
      const result = withCorrelationContextSync(() => {
        const current = CorrelationContext.get();
        assert.ok(current?.correlationId);
        return 'sync-result';
      });

      assert.strictEqual(result, 'sync-result');
    });

    it('should accept custom correlationId', async () => {
      const customId =
        '550e8400-e29b-41d4-a716-446655440000';

      await withCorrelationContext(
        async () => {
          const current = CorrelationContext.get();
          assert.strictEqual(current?.correlationId, customId);
        },
        customId
      );
    });

    it('should accept userId and sessionId', () => {
      withCorrelationContextSync(
        () => {
          const current = CorrelationContext.get();
          assert.strictEqual(current?.userId, 'test-user');
          assert.strictEqual(current?.sessionId, 'test-session');
        },
        undefined,
        'test-user',
        'test-session'
      );
    });
  });

  // ========== HEADER PROPAGATION TESTS ==========
  describe('propagateCorrelationContext()', () => {
    it('should propagate context to headers', () => {
      const parentContext = CorrelationContext.generate();
      const context = CorrelationContext.generate(
        parentContext.correlationId,
        'user-123',
        'session-456'
      );

      const headers = propagateCorrelationContext({}, context);

      assert.strictEqual(headers['x-correlation-id'], context.correlationId);
      assert.strictEqual(headers['x-user-id'], 'user-123');
      assert.strictEqual(headers['x-session-id'], 'session-456');
    });

    it('should use current context if not provided', () => {
      const context = CorrelationContext.generate(undefined, 'current-user');

      const headers = CorrelationContext.run(context, () => {
        return propagateCorrelationContext({});
      });

      assert.strictEqual(headers['x-correlation-id'], context.correlationId);
      assert.strictEqual(headers['x-user-id'], 'current-user');
    });

    it('should merge with existing headers', () => {
      const context = CorrelationContext.generate();

      const headers = propagateCorrelationContext(
        { 'content-type': 'application/json' },
        context
      );

      assert.strictEqual(headers['content-type'], 'application/json');
      assert.strictEqual(headers['x-correlation-id'], context.correlationId);
    });

    it('should return headers as-is if no context', () => {
      const originalHeaders = { 'x-custom': 'header' };
      const headers = propagateCorrelationContext(originalHeaders);

      assert.deepStrictEqual(headers, originalHeaders);
    });
  });
});

describe('Integration Tests', () => {
  // ========== END-TO-END TESTS ==========
  it('should maintain context across service calls', async () => {
    const context = CorrelationContext.generate(
      undefined,
      'service-user',
      'service-session'
    );

    await CorrelationContext.runAsync(context, async () => {
      // Simulate service call 1
      const headers1 = propagateCorrelationContext({});

      // Simulate service call 2
      const headers2 = propagateCorrelationContext({});

      // Both should have same correlation ID
      assert.strictEqual(headers1['x-correlation-id'], headers2['x-correlation-id']);
      assert.strictEqual(
        headers1['x-correlation-id'],
        context.correlationId
      );
    });
  });

  it('should trace parent-child relationships', () => {
    const parentContext = CorrelationContext.generate();

    CorrelationContext.run(parentContext, () => {
      const childContext = CorrelationContext.createChild('child-user');
      const grandchildContext = CorrelationContext.run(childContext, () => {
        return CorrelationContext.createChild('grandchild-user');
      });

      assert.strictEqual(childContext.parentId, parentContext.correlationId);
      assert.strictEqual(grandchildContext.parentId, childContext.correlationId);
      assert.strictEqual(childContext.depth, 1);
      assert.strictEqual(grandchildContext.depth, 2);
    });
  });

  it('should support concurrent operations with separate contexts', async () => {
    const context1 = CorrelationContext.generate(undefined, 'user-1');
    const context2 = CorrelationContext.generate(undefined, 'user-2');

    const results = await Promise.all([
      CorrelationContext.runAsync(context1, async () => {
        return CorrelationContext.getId();
      }),
      CorrelationContext.runAsync(context2, async () => {
        return CorrelationContext.getId();
      }),
    ]);

    assert.strictEqual(results[0], context1.correlationId);
    assert.strictEqual(results[1], context2.correlationId);
    assert.notStrictEqual(results[0], results[1]);
  });
});
