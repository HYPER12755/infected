# Resource Management with Correlation ID - Developer Guide

## Quick Start

The resource management modules now automatically track correlation context for all operations. No code changes are required to benefit from distributed tracing.

### Basic Usage (No Changes Needed)

```typescript
import ResourceMonitor from './core/resource-monitor.js';
import ResourceLimiter from './core/resource-limiter.js';

// Monitor works as before - correlation context is automatic
const monitor = ResourceMonitor.getInstance();
monitor.startMonitoring(5000);

// Limiter works as before - correlation context is automatic
const limiter = new ResourceLimiter();
limiter.setMemoryLimit(4096);
```

## Understanding Correlation Context in Logs

When you look at logs from resource operations, you'll see correlation IDs:

```
ResourceMonitor started with 5000ms interval {
  correlationId: "550e8400-e29b-41d4-a716-446655440000",
  component: "ResourceMonitor",
  monitoringInterval: 5000
}
```

### Log Structure

Every resource management log includes:
- **correlationId**: Unique identifier for tracing this operation
- **component**: "ResourceMonitor" or "ResourceLimiter"
- **resourceType**: Type being monitored (memory, cpu, fileHandles, connections, system, process)
- **action**: What operation was performed (e.g., process-added, warning-issued)
- Additional metadata specific to the operation

### Example Threshold Violation Log

```
Memory threshold exceeded: 90.5% > 85% {
  correlationId: "550e8400-e29b-41d4-a716-446655440001",
  component: "ResourceMonitor",
  resourceType: "memory",
  current: 90.5,
  threshold: 85,
  violation: true
}
```

## Advanced: Using Correlation Context

If you want to explicitly control correlation context for resource operations:

```typescript
import { CorrelationContext } from './logging/index.js';
import ResourceMonitor from './core/resource-monitor.js';

// Create a correlation context for a batch of operations
const operationContext = CorrelationContext.generate();

CorrelationContext.run(operationContext, () => {
  const monitor = ResourceMonitor.getInstance();
  
  // All monitor operations will be traced with operationContext
  monitor.trackProcess(1234);
  monitor.getSystemMetrics();
  monitor.getProcessMetrics(1234);
  
  // All logs will include the same correlationId
});
```

## Creating Child Contexts

For nested operations that should maintain parent-child relationships:

```typescript
import { CorrelationContext } from './logging/index.js';

const parentContext = CorrelationContext.generate();

CorrelationContext.run(parentContext, () => {
  // Parent operation
  monitor.startMonitoring(5000);
  
  // Create child context for nested operation
  const childContext = CorrelationContext.createChild();
  
  CorrelationContext.run(childContext, () => {
    // This will have parentId pointing to parentContext.correlationId
    limiter.setMemoryLimit(4096);
  });
});
```

## Log Aggregation with Correlation IDs

### Tracing a Single Request

All resource operations related to a single request will share the same correlation ID, making it easy to aggregate logs:

```bash
# All logs for a specific correlation ID
grep "correlationId.*550e8400-e29b-41d4-a716-446655440000" logs/*.json
```

### Hierarchical Tracing

Parent-child relationships enable distributed tracing across service boundaries:

```
ParentContext: 550e8400-e29b-41d4-a716-446655440000
├── ChildContext: 550e8401-e29b-41d4-a716-446655440001 (parentId: 550e8400...)
│   └── Memory limit check
├── ChildContext: 550e8402-e29b-41d4-a716-446655440002 (parentId: 550e8400...)
│   └── CPU limit check
└── ChildContext: 550e8403-e29b-41d4-a716-446655440003 (parentId: 550e8400...)
    └── File handle check
```

## Event Handling with Correlation

Events still work the same way, but now you can correlate them:

```typescript
import { CorrelationContext } from './logging/index.js';

const operationContext = CorrelationContext.generate();

CorrelationContext.run(operationContext, () => {
  const monitor = ResourceMonitor.getInstance();
  
  monitor.on('memory-threshold', (data) => {
    // Event is emitted within correlation context
    const currentContext = CorrelationContext.get();
    console.log(`Memory threshold event in context: ${currentContext.correlationId}`);
  });
  
  monitor.startMonitoring(100);
});
```

## Recovery Handler Integration

Recovery handlers automatically preserve correlation context:

```typescript
monitor.registerRecoveryHandler('memory-threshold', async (error, context) => {
  // Context will include the correlation ID
  const correlationId = CorrelationContext.getId();
  console.log(`Recovery handler running for correlation: ${correlationId}`);
  
  // Perform recovery action
  // ... recovery logic ...
});
```

## Metadata Reference

### ResourceMonitor Metadata Fields

| Field | Values | Purpose |
|-------|--------|---------|
| `component` | "ResourceMonitor" | Component identifier |
| `resourceType` | system, memory, cpu, fileHandles, process | Resource being monitored |
| `processId` | number | PID for process operations |
| `action` | process-added, process-removed, clear-tracking | Operation performed |
| `violation` | boolean | Whether threshold was violated |
| `current` | number | Current value |
| `threshold` | number | Threshold value |

### ResourceLimiter Metadata Fields

| Field | Values | Purpose |
|-------|--------|---------|
| `component` | "ResourceLimiter" | Component identifier |
| `resourceType` | memory, cpu, fileHandles, connections | Resource being limited |
| `processId` | number | PID for process operations |
| `action` | set-limit, register-process, warning-issued, etc. | Operation performed |
| `violation` | boolean | Whether limit was exceeded |
| `current` | number | Current value |
| `limit` | number | Limit value |
| `enforcementEnabled` | boolean | Whether enforcement is active |

## Error Context Preservation

When errors occur during resource operations, the correlation context is automatically preserved:

```typescript
// Error in metrics collection
try {
  monitor.getProcessMetrics(invalidPid);
  // Logged with correlation context
  // {
  //   correlationId: "...",
  //   component: "ResourceMonitor",
  //   processId: <invalid>,
  //   errorType: "Error",
  // }
} catch (error) {
  // Error handling already logs with context
}
```

## Testing with Correlation Context

When writing tests, you can verify correlation behavior:

```typescript
import { CorrelationContext } from './logging/index.js';

it('should use correlation context for metrics', () => {
  const testContext = CorrelationContext.generate();
  
  let contextInOperation: ICorrelationContext | undefined;
  
  CorrelationContext.run(testContext, () => {
    monitor.getSystemMetrics();
    contextInOperation = CorrelationContext.get();
  });
  
  assert.ok(contextInOperation);
  assert.strictEqual(contextInOperation.correlationId, testContext.correlationId);
});
```

## Performance Considerations

- Correlation context generation is minimal overhead (~0.1ms per operation)
- AsyncLocalStorage is used for efficient async context tracking
- No additional memory allocation for operations without explicit context
- Metadata is only included in log entries (not in performance-critical paths)

## Migration Guide

### From Old Implementation

If you were using the old logger directly:

**Before:**
```typescript
logger.info('Message', { component: 'ResourceMonitor' });
```

**After (automatic):**
```typescript
// No code change needed - correlation context is added automatically
this.loggingContext.info('Message', { component: 'ResourceMonitor' });
```

Both approaches work. The new `LoggingContext` automatically injects correlation metadata, while the raw logger still works without it.

## Troubleshooting

### Missing Correlation IDs in Logs

If you don't see correlation IDs:
1. Check that you're using the resource modules (ResourceMonitor/ResourceLimiter)
2. Ensure logging level is set to capture the operation's log level
3. Verify log format includes the metadata object

### Correlation Context Not Found

If you need to access correlation context but it's not available:

```typescript
const context = CorrelationContext.get();
if (!context) {
  // Create one if needed
  const newContext = CorrelationContext.generate();
  // Use newContext for logging
}
```

## API Stability

- All existing APIs remain unchanged
- Correlation tracking is additive (doesn't affect existing behavior)
- No breaking changes to method signatures
- Backward compatible with existing code

## See Also

- [Correlation ID System Overview](src/core/logging/README.md)
- [Test Examples](tests/unit/resource-correlation-integration.test.ts)
- [Full Integration Summary](CORRELATION_ID_RESOURCE_INTEGRATION.md)
