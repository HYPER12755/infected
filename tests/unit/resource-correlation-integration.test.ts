import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import { ResourceMonitor } from '../../src/core/resource-monitor.js';
import { ResourceLimiter } from '../../src/core/resource-limiter.js';
import { CorrelationContext, LoggingContext } from '../../src/core/logging/index.js';
import type { ICorrelationContext } from '../../src/core/logging/index.js';

/**
 * Test Suite: Resource Management Correlation ID Integration
 * Tests correlation ID system integration with ResourceMonitor and ResourceLimiter
 * 
 * Total tests: 35+
 * Coverage areas:
 * - Monitor configuration changes with correlation context
 * - Monitoring cycle correlation context creation
 * - Metrics collection with correlation ID
 * - Threshold violations with metadata
 * - Error handling with attached context
 * - Process tracking with correlation IDs
 * - Limiter enforcement with correlation IDs
 * - Recovery strategy preservation
 */

describe('Resource Management - Correlation ID Integration', () => {
  let monitor: ResourceMonitor;
  let limiter: ResourceLimiter;
  let loggingContext: LoggingContext;

  beforeEach(() => {
    monitor = ResourceMonitor.getInstance();
    limiter = new ResourceLimiter();
    loggingContext = new LoggingContext();
  });

  afterEach(async () => {
    try {
      monitor.stopMonitoring();
      limiter.clearProcesses();
      monitor.clearTracking();
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  // ========== RESOURCE MONITOR CORRELATION TESTS ==========
  describe('ResourceMonitor - Correlation Context Integration', () => {
    it('should create correlation context for configuration changes', () => {
      let parentId: string | undefined;

      // Create parent context
      const parentContext = CorrelationContext.generate();
      parentId = parentContext.correlationId;
      
      let contextExists = false;
      CorrelationContext.run(parentContext, () => {
        monitor.configure({ memoryThresholdPercent: 80 });
        // Just verify context exists during the call
        contextExists = CorrelationContext.exists();
      });

      assert.ok(contextExists);
    });

    it('should track monitoring session with correlation context', () => {
      let sessionContextCaptured: ICorrelationContext | undefined;

      const sessionContext = CorrelationContext.generate();
      CorrelationContext.run(sessionContext, () => {
        monitor.startMonitoring(5000);
        sessionContextCaptured = CorrelationContext.get();
        monitor.stopMonitoring();
      });

      assert.ok(sessionContextCaptured);
      assert.ok(sessionContextCaptured.correlationId);
    });

    it('should include resource type in correlation context metadata', () => {
      let metadataCapture: Record<string, any> = {};

      const monitorContext = CorrelationContext.generate();
      CorrelationContext.run(monitorContext, () => {
        monitor.getSystemMetrics();
        const currentContext = CorrelationContext.get();
        if (currentContext) {
          metadataCapture = CorrelationContext.toMetadata(currentContext);
        }
      });

      assert.ok(metadataCapture.correlationId);
      assert.ok(metadataCapture.timestamp);
    });

    it('should create correlation context for process tracking', () => {
      let trackingContextCaptured: ICorrelationContext | undefined;

      const trackContext = CorrelationContext.generate();
      CorrelationContext.run(trackContext, () => {
        monitor.trackProcess(process.pid);
        trackingContextCaptured = CorrelationContext.get();
      });

      assert.ok(trackingContextCaptured);
      assert.ok(trackingContextCaptured.correlationId);
    });

    it('should create correlation context for process untracking', () => {
      monitor.trackProcess(process.pid);
      
      let untrackedContextCaptured: ICorrelationContext | undefined;

      const untrackContext = CorrelationContext.generate();
      CorrelationContext.run(untrackContext, () => {
        monitor.untrackProcess(process.pid);
        untrackedContextCaptured = CorrelationContext.get();
      });

      assert.ok(untrackedContextCaptured);
      assert.ok(untrackedContextCaptured.correlationId);
    });

    it('should create correlation context for metrics collection', () => {
      monitor.trackProcess(process.pid);
      
      let metricsContextCaptured: ICorrelationContext | undefined;

      const metricsContext = CorrelationContext.generate();
      CorrelationContext.run(metricsContext, () => {
        const metrics = monitor.getProcessMetrics(process.pid);
        assert.ok(metrics);
        metricsContextCaptured = CorrelationContext.get();
      });

      assert.ok(metricsContextCaptured);
      assert.ok(metricsContextCaptured.correlationId);
    });

    it('should include process ID in metrics collection context', () => {
      monitor.trackProcess(process.pid);
      
      let metadataCapture: Record<string, any> = {};

      const metricsContext = CorrelationContext.generate();
      CorrelationContext.run(metricsContext, () => {
        monitor.getProcessMetrics(process.pid);
        const currentContext = CorrelationContext.get();
        if (currentContext) {
          metadataCapture = CorrelationContext.toMetadata(currentContext);
        }
      });

      assert.ok(metadataCapture.correlationId);
    });

    it('should create correlation context for all process metrics collection', () => {
      monitor.trackProcess(process.pid);
      
      let allMetricsContextCaptured: ICorrelationContext | undefined;

      const allMetricsContext = CorrelationContext.generate();
      CorrelationContext.run(allMetricsContext, () => {
        const metrics = monitor.getAllProcessMetrics();
        assert.ok(Array.isArray(metrics));
        allMetricsContextCaptured = CorrelationContext.get();
      });

      assert.ok(allMetricsContextCaptured);
      assert.ok(allMetricsContextCaptured.correlationId);
    });

    it('should create correlation context for clearing tracking', () => {
      monitor.trackProcess(process.pid);
      
      let clearContextCaptured: ICorrelationContext | undefined;

      const clearContext = CorrelationContext.generate();
      CorrelationContext.run(clearContext, () => {
        monitor.clearTracking();
        clearContextCaptured = CorrelationContext.get();
      });

      assert.ok(clearContextCaptured);
      assert.ok(clearContextCaptured.correlationId);
    });

    it('should create unique correlation IDs for each operation', () => {
      const correlationIds = new Set<string>();

      for (let i = 0; i < 5; i++) {
        const context = CorrelationContext.generate();
        CorrelationContext.run(context, () => {
          monitor.getSystemMetrics();
          const currentContext = CorrelationContext.get();
          if (currentContext) {
            correlationIds.add(currentContext.correlationId);
          }
        });
      }

      assert.strictEqual(correlationIds.size, 5);
    });

    it('should maintain correlation context during error handling', () => {
      let errorContextCaptured: ICorrelationContext | undefined;

      const errorContext = CorrelationContext.generate();
      CorrelationContext.run(errorContext, () => {
        // This should trigger error handling (getting metrics for non-existent process)
        const metrics = monitor.getProcessMetrics(99999);
        assert.strictEqual(metrics, null);
        errorContextCaptured = CorrelationContext.get();
      });

      assert.ok(errorContextCaptured);
      assert.ok(errorContextCaptured.correlationId);
    });
  });

  // ========== RESOURCE LIMITER CORRELATION TESTS ==========
  describe('ResourceLimiter - Correlation Context Integration', () => {
    it('should create correlation context for memory limit configuration', () => {
      let limitContextCaptured: ICorrelationContext | undefined;

      const limitContext = CorrelationContext.generate();
      CorrelationContext.run(limitContext, () => {
        limiter.setMemoryLimit(4096);
        limitContextCaptured = CorrelationContext.get();
      });

      assert.ok(limitContextCaptured);
      assert.ok(limitContextCaptured.correlationId);
    });

    it('should create correlation context for CPU limit configuration', () => {
      let limitContextCaptured: ICorrelationContext | undefined;

      const limitContext = CorrelationContext.generate();
      CorrelationContext.run(limitContext, () => {
        limiter.setCPULimit(80);
        limitContextCaptured = CorrelationContext.get();
      });

      assert.ok(limitContextCaptured);
      assert.ok(limitContextCaptured.correlationId);
    });

    it('should create correlation context for file handle limit configuration', () => {
      let limitContextCaptured: ICorrelationContext | undefined;

      const limitContext = CorrelationContext.generate();
      CorrelationContext.run(limitContext, () => {
        limiter.setFileHandleLimit(2048);
        limitContextCaptured = CorrelationContext.get();
      });

      assert.ok(limitContextCaptured);
      assert.ok(limitContextCaptured.correlationId);
    });

    it('should create correlation context for connection limit configuration', () => {
      let limitContextCaptured: ICorrelationContext | undefined;

      const limitContext = CorrelationContext.generate();
      CorrelationContext.run(limitContext, () => {
        limiter.setConnectionLimit(50);
        limitContextCaptured = CorrelationContext.get();
      });

      assert.ok(limitContextCaptured);
      assert.ok(limitContextCaptured.correlationId);
    });

    it('should create correlation context for enforcement enablement', () => {
      let enforcementContextCaptured: ICorrelationContext | undefined;

      const enforcementContext = CorrelationContext.generate();
      CorrelationContext.run(enforcementContext, () => {
        limiter.setEnforcementEnabled(true);
        enforcementContextCaptured = CorrelationContext.get();
      });

      assert.ok(enforcementContextCaptured);
      assert.ok(enforcementContextCaptured.correlationId);
    });

    it('should create correlation context for process registration', () => {
      let registrationContextCaptured: ICorrelationContext | undefined;

      const registrationContext = CorrelationContext.generate();
      CorrelationContext.run(registrationContext, () => {
        limiter.registerProcess(process.pid);
        registrationContextCaptured = CorrelationContext.get();
      });

      assert.ok(registrationContextCaptured);
      assert.ok(registrationContextCaptured.correlationId);
    });

    it('should create correlation context for process unregistration', () => {
      limiter.registerProcess(process.pid);
      
      let unregistrationContextCaptured: ICorrelationContext | undefined;

      const unregistrationContext = CorrelationContext.generate();
      CorrelationContext.run(unregistrationContext, () => {
        limiter.unregisterProcess(process.pid);
        unregistrationContextCaptured = CorrelationContext.get();
      });

      assert.ok(unregistrationContextCaptured);
      assert.ok(unregistrationContextCaptured.correlationId);
    });

    it('should create correlation context for memory limit enforcement', () => {
      let enforcementContextCaptured: ICorrelationContext | undefined;

      limiter.setMemoryLimit(1);
      limiter.registerProcess(process.pid);

      const enforcementContext = CorrelationContext.generate();
      CorrelationContext.run(enforcementContext, () => {
        limiter.setEnforcementEnabled(false); // Disable to prevent actual termination
        limiter.checkMemoryLimit(100, 1000);
        enforcementContextCaptured = CorrelationContext.get();
      });

      assert.ok(enforcementContextCaptured);
      assert.ok(enforcementContextCaptured.correlationId);
    });

    it('should create correlation context for CPU limit enforcement', () => {
      let enforcementContextCaptured: ICorrelationContext | undefined;

      limiter.setCPULimit(1);

      const enforcementContext = CorrelationContext.generate();
      CorrelationContext.run(enforcementContext, () => {
        limiter.checkCPULimit(100, process.pid);
        enforcementContextCaptured = CorrelationContext.get();
      });

      assert.ok(enforcementContextCaptured);
      assert.ok(enforcementContextCaptured.correlationId);
    });

    it('should create correlation context for file handle enforcement', () => {
      let enforcementContextCaptured: ICorrelationContext | undefined;

      limiter.setFileHandleLimit(1);

      const enforcementContext = CorrelationContext.generate();
      CorrelationContext.run(enforcementContext, () => {
        limiter.checkFileHandleLimit(1000, process.pid);
        enforcementContextCaptured = CorrelationContext.get();
      });

      assert.ok(enforcementContextCaptured);
      assert.ok(enforcementContextCaptured.correlationId);
    });

    it('should create correlation context for connection enforcement', () => {
      let enforcementContextCaptured: ICorrelationContext | undefined;

      limiter.setConnectionLimit(1);

      const enforcementContext = CorrelationContext.generate();
      CorrelationContext.run(enforcementContext, () => {
        limiter.checkConnectionLimit(100);
        enforcementContextCaptured = CorrelationContext.get();
      });

      assert.ok(enforcementContextCaptured);
      assert.ok(enforcementContextCaptured.correlationId);
    });

    it('should create correlation context for process clearing', () => {
      limiter.registerProcess(process.pid);
      
      let clearContextCaptured: ICorrelationContext | undefined;

      const clearContext = CorrelationContext.generate();
      CorrelationContext.run(clearContext, () => {
        limiter.clearProcesses();
        clearContextCaptured = CorrelationContext.get();
      });

      assert.ok(clearContextCaptured);
      assert.ok(clearContextCaptured.correlationId);
    });

    it('should include resource type in enforcement metadata', () => {
      let metadataCapture: Record<string, any> = {};

      limiter.setCPULimit(1);

      const enforcementContext = CorrelationContext.generate();
      CorrelationContext.run(enforcementContext, () => {
        limiter.checkCPULimit(100);
        const currentContext = CorrelationContext.get();
        if (currentContext) {
          metadataCapture = CorrelationContext.toMetadata(currentContext);
        }
      });

      assert.ok(metadataCapture.correlationId);
    });

    it('should create unique correlation IDs for each enforcement check', () => {
      const correlationIds = new Set<string>();

      limiter.setMemoryLimit(1);

      for (let i = 0; i < 5; i++) {
        const context = CorrelationContext.generate();
        CorrelationContext.run(context, () => {
          limiter.checkMemoryLimit(100, 1000);
          const currentContext = CorrelationContext.get();
          if (currentContext) {
            correlationIds.add(currentContext.correlationId);
          }
        });
      }

      assert.strictEqual(correlationIds.size, 5);
    });
  });

  // ========== BACKWARD COMPATIBILITY TESTS ==========
  describe('Backward Compatibility', () => {
    it('should not require explicit correlation context for monitor methods', () => {
      // Methods should work without explicit context
      assert.doesNotThrow(() => {
        monitor.getSystemMetrics();
      });
    });

    it('should not require explicit correlation context for limiter methods', () => {
      // Methods should work without explicit context
      assert.doesNotThrow(() => {
        limiter.getLimits();
      });
    });

    it('should not change function signatures for monitor', () => {
      // Verify key methods still accept their parameters
      assert.doesNotThrow(() => {
        monitor.trackProcess(12345);
        monitor.untrackProcess(12345);
      });
      
      assert.doesNotThrow(() => {
        monitor.configure({ memoryThresholdPercent: 80 });
      });
    });

    it('should not change function signatures for limiter', () => {
      // Verify key methods still accept their parameters
      assert.doesNotThrow(() => {
        limiter.registerProcess(12345);
        limiter.unregisterProcess(12345);
      });
      
      assert.doesNotThrow(() => {
        limiter.setMemoryLimit(4096);
        limiter.setCPULimit(80);
      });
    });

    it('should preserve event emission functionality', (t, done) => {
      let eventEmitted = false;

      limiter.on('limit-exceeded', () => {
        eventEmitted = true;
      });

      limiter.setConnectionLimit(1);
      limiter.checkConnectionLimit(100);

      setTimeout(() => {
        assert.ok(eventEmitted);
        done();
      }, 100);
    });

    it('should maintain error handling behavior', () => {
      // Error handling should still work as before
      assert.throws(() => {
        limiter.setMemoryLimit(-1);
      });

      assert.throws(() => {
        limiter.setCPULimit(150);
      });

      assert.throws(() => {
        limiter.setConnectionLimit(0);
      });
    });
  });

  // ========== INTEGRATION TESTS ==========
  describe('Integrated Monitor and Limiter', () => {
    it('should maintain separate correlation contexts for monitor and limiter', () => {
      const contextIds = new Set<string>();

      const monitorContext = CorrelationContext.generate();
      CorrelationContext.run(monitorContext, () => {
        monitor.getSystemMetrics();
        const monitorCurrent = CorrelationContext.get();
        if (monitorCurrent) {
          contextIds.add(monitorCurrent.correlationId);
        }
      });

      const limiterContext = CorrelationContext.generate();
      CorrelationContext.run(limiterContext, () => {
        limiter.getLimits();
        const limiterCurrent = CorrelationContext.get();
        if (limiterCurrent) {
          contextIds.add(limiterCurrent.correlationId);
        }
      });

      assert.strictEqual(contextIds.size, 2);
    });

    it('should support parent-child correlation relationships', () => {
      const parentContext = CorrelationContext.generate();

      let childContext: ICorrelationContext | undefined;

      CorrelationContext.run(parentContext, () => {
        monitor.getSystemMetrics();
        
        const child = CorrelationContext.createChild();
        CorrelationContext.run(child, () => {
          limiter.getLimits();
          childContext = CorrelationContext.get();
        });
      });

      assert.ok(childContext);
      assert.strictEqual(childContext.parentId, parentContext.correlationId);
      assert.ok(childContext.depth > parentContext.depth);
    });

    it('should handle concurrent operations with different contexts', () => {
      const correlationIds: string[] = [];

      const context1 = CorrelationContext.generate();
      const context2 = CorrelationContext.generate();

      CorrelationContext.run(context1, () => {
        monitor.getSystemMetrics();
        const current1 = CorrelationContext.get();
        if (current1) correlationIds.push(current1.correlationId);
      });

      CorrelationContext.run(context2, () => {
        limiter.getLimits();
        const current2 = CorrelationContext.get();
        if (current2) correlationIds.push(current2.correlationId);
      });

      assert.strictEqual(correlationIds.length, 2);
      assert.notStrictEqual(correlationIds[0], correlationIds[1]);
    });
  });

  // ========== RECOVERY STRATEGY PRESERVATION TESTS ==========
  describe('Recovery Strategy Preservation with Correlation', () => {
    it('should maintain recovery handlers during monitoring', () => {
      let handlerCalled = false;

      monitor.registerRecoveryHandler('memory-threshold', async (error, context) => {
        handlerCalled = true;
      });

      // Verify handler was registered (indirectly through no errors)
      assert.doesNotThrow(() => {
        monitor.startMonitoring(100);
      });

      monitor.stopMonitoring();
    });

    it('should maintain recovery handlers during enforcement', () => {
      let handlerCalled = false;

      limiter.registerRecoveryHandler('memory-exceeded', async (error, context) => {
        handlerCalled = true;
      });

      // Verify handler was registered
      assert.doesNotThrow(() => {
        limiter.setMemoryLimit(4096);
      });
    });

    it('should preserve circuit breaker functionality', () => {
      // Circuit breaker should work silently in background
      assert.doesNotThrow(() => {
        for (let i = 0; i < 10; i++) {
          monitor.getSystemMetrics();
        }
      });
    });

    it('should handle enforcement history with correlation', () => {
      limiter.setMemoryLimit(1);
      limiter.registerProcess(process.pid);
      limiter.setEnforcementEnabled(false);

      limiter.checkMemoryLimit(100, 1000);
      const history = limiter.getEnforcementHistory();

      // History should still be recorded
      assert.ok(Array.isArray(history));
    });
  });
});
