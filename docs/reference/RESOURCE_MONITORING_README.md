# Resource Monitoring and Limiting System

## Overview

The Resource Monitoring and Limiting System provides comprehensive real-time tracking and enforcement of system resource constraints for the Infected MCP Server. It prevents resource exhaustion and maintains system stability through two coordinated components:

1. **ResourceMonitor** - Real-time metrics collection and threshold-based alerting
2. **ResourceLimiter** - Enforcement policies and resource constraint management

## Architecture

### ResourceMonitor

**Location:** `src/core/resource-monitor.ts`

The ResourceMonitor is a singleton that continuously tracks:

#### System Metrics
- Total, used, and free memory (bytes and percentages)
- CPU usage (user + system time)
- Load average (1, 5, 15 minute)
- System uptime
- Processor count

#### Per-Process Metrics
- CPU usage percentage
- Memory usage (MB and percentage of system)
- Open file descriptors
- Child process count
- Timestamp of last update

#### Key Features
- **Singleton Pattern:** Single instance across application
- **Non-blocking:** Uses async/await for file operations
- **Configurable Intervals:** Default 5 seconds, customizable
- **Threshold-based Events:** Emit events when thresholds exceed configured limits
- **Graceful Degradation:** Works on Linux with /proc filesystem; returns defaults on other OS
- **EventEmitter:** Full pub/sub support with multiple listeners

### ResourceLimiter

**Location:** `src/core/resource-limiter.ts`

The ResourceLimiter enforces hard constraints and takes corrective actions:

#### Configurable Limits
- **Memory Limit:** Max system memory in MB (default: 4096)
- **CPU Limit:** Max CPU usage percentage (default: 80)
- **File Handle Limit:** Max open file descriptors (default: 2048)
- **Connection Limit:** Max SSH connections (default: 50)

#### Enforcement Actions

| Limit Type | Exceeded | Action |
|---|---|---|
| Memory | Yes | Kill least recently used process with SIGTERM (force SIGKILL after 5s) |
| CPU | Yes | Issue warning to logs (throttling reserved for future) |
| File Handles | Yes | Block new process spawning until count decreases |
| Connections | Yes | Reject new SSH connection attempts |

#### Key Features
- **Graceful Enforcement:** SIGTERM → wait 5s → SIGKILL
- **Enforcement History:** Last 100 actions tracked with timestamps
- **Process Registration:** Track processes for LRU termination
- **No External Dependencies:** Pure Node.js implementation

## Configuration

Add to `infected.config.json`:

```json
{
  "resources": {
    "maxMemoryMB": 4096,
    "maxCPUPercent": 80,
    "maxFileHandles": 2048,
    "maxConnections": 50,
    "monitoringIntervalMs": 5000,
    "thresholdPercent": 85,
    "enableLimiting": true,
    "enableMonitoring": true
  }
}
```

### Configuration Options

| Option | Default | Description |
|---|---|---|
| `maxMemoryMB` | 4096 | Maximum memory limit in MB |
| `maxCPUPercent` | 80 | Maximum CPU usage threshold (%) |
| `maxFileHandles` | 2048 | Maximum open file descriptors |
| `maxConnections` | 50 | Maximum concurrent SSH connections |
| `monitoringIntervalMs` | 5000 | Metrics collection interval (ms) |
| `thresholdPercent` | 85 | Threshold for warning events (%) |
| `enableLimiting` | true | Enable enforcement actions |
| `enableMonitoring` | true | Enable metrics collection |

## Events and Monitoring

### ResourceMonitor Events

```typescript
// Memory threshold exceeded
monitor.on('memory-threshold', (info) => {
  console.log(`Memory: ${info.current}% > ${info.threshold}%`);
  console.log(`Available: ${info.metrics.freeMemory / 1024 / 1024}MB`);
});

// CPU threshold exceeded for process
monitor.on('cpu-threshold', (info) => {
  console.log(`Process ${info.pid} CPU: ${info.current.toFixed(2)}%`);
});

// File handles threshold exceeded
monitor.on('file-handles-threshold', (info) => {
  console.log(`Process ${info.pid} FDs: ${info.current} > ${info.maxAllowed}`);
});

// Process added to tracking
monitor.on('process-added', (info) => {
  console.log(`Tracking process ${info.pid}`);
});

// Process removed from tracking
monitor.on('process-removed', (info) => {
  console.log(`Stopped tracking process ${info.pid}`);
});
```

### ResourceLimiter Events

```typescript
// Limit exceeded
limiter.on('limit-exceeded', (info) => {
  console.log(`Limit exceeded: ${info.limitType}`);
  console.log(`Current: ${info.current}, Limit: ${info.limit}`);
});

// Enforcement action taken
limiter.on('action-taken', (action) => {
  console.log(`Action: ${action.action}`);
  console.log(`Reason: ${action.reason}`);
  if (action.target) {
    console.log(`Target: ${action.target}`);
  }
});

// Recovery from threshold
limiter.on('recovery', (info) => {
  console.log(`Resources recovered: ${info.metric}`);
});
```

## API Reference

### ResourceMonitor

#### Methods

```typescript
// Singleton access
static getInstance(): ResourceMonitor

// Configuration
configure(config: {
  memoryThresholdPercent?: number;
  cpuThresholdPercent?: number;
  fileHandleThresholdPercent?: number;
  monitoringIntervalMs?: number;
}): void

// Monitoring control
startMonitoring(intervalMs?: number): void
stopMonitoring(): void
isActive(): boolean

// Process management
trackProcess(pid: number): void
untrackProcess(pid: number): void

// Metrics retrieval
getSystemMetrics(): SystemMetrics
getProcessMetrics(pid: number): ProcessMetrics | null
getAllProcessMetrics(): ProcessMetrics[]
getFileDescriptorCount(pid: number): Promise<number>
getChildProcessCount(pid: number): number

// Status
getTrackedProcessCount(): number
clearTracking(): void
```

#### SystemMetrics Interface

```typescript
interface SystemMetrics {
  timestamp: number;           // Unix timestamp
  totalMemory: number;         // Bytes
  usedMemory: number;          // Bytes
  freeMemory: number;          // Bytes
  memoryPercent: number;       // 0-100
  cpuUsage: NodeJS.CpuUsage;   // {user, system} in microseconds
  loadAverage: number[];       // [1min, 5min, 15min]
  uptime: number;              // Seconds
  processors: number;          // CPU core count
}
```

#### ProcessMetrics Interface

```typescript
interface ProcessMetrics {
  pid: number;                 // Process ID
  cpuUsagePercent: number;     // 0-100+
  memoryUsageMB: number;       // Megabytes
  memoryPercent: number;       // 0-100+
  fileHandles: number;         // Count
  childProcesses: number;      // Count
  timestamp: number;           // Unix timestamp
}
```

### ResourceLimiter

#### Methods

```typescript
// Configuration
setMemoryLimit(limitMB: number): void
setCPULimit(limitPercent: number): void
setFileHandleLimit(limitCount: number): void
setConnectionLimit(limitCount: number): void
getLimits(): Required<ResourceLimits>

// Enforcement control
setEnforcementEnabled(enabled: boolean): void
setGracefulShutdownTimeout(timeoutMs: number): void

// Process tracking
registerProcess(pid: number): void
unregisterProcess(pid: number): void

// Limit checking (called by monitor or application)
checkMemoryLimit(currentUsageMB: number, totalAvailableMB: number): void
checkCPULimit(currentUsagePercent: number, processId?: number): void
checkFileHandleLimit(currentCount: number, processId?: number): void
checkConnectionLimit(currentCount: number): void

// Pre-action checks
canSpawnProcess(estimatedMemoryMB: number, currentMemoryUsageMB: number): boolean
canAcceptConnection(currentConnectionCount: number): boolean

// History and status
getEnforcementHistory(limit?: number): EnforcementAction[]
getMonitoredProcessCount(): number
clearProcesses(): void
clearHistory(): void
```

#### ResourceLimits Interface

```typescript
interface ResourceLimits {
  memoryLimitMB?: number;
  cpuLimitPercent?: number;
  fileHandleLimitCount?: number;
  connectionLimitCount?: number;
}
```

#### EnforcementAction Interface

```typescript
interface EnforcementAction {
  timestamp: number;
  limitType: 'memory' | 'cpu' | 'fileHandles' | 'connections';
  action: string;
  target?: number | string;     // PID or connection ID
  reason: string;
  details?: Record<string, unknown>;
}
```

## Integration Guide

### ProcessManager Integration

#### 1. Before Spawning

```typescript
import { ResourceLimiter } from './resource-limiter.js';

async spawnProcess(command: string): Promise<ChildProcess> {
  const limiter = ResourceLimiter.getInstance();
  const monitor = ResourceMonitor.getInstance();
  
  // Check if we can spawn
  const systemMetrics = monitor.getSystemMetrics();
  const estimatedMemory = 50; // MB
  
  if (!limiter.canSpawnProcess(
    estimatedMemory,
    systemMetrics.usedMemory / 1024 / 1024
  )) {
    throw new Error('Insufficient memory to spawn process');
  }
  
  const child = spawn(command);
  
  // Track the process
  monitor.trackProcess(child.pid!);
  limiter.registerProcess(child.pid!);
  
  return child;
}
```

#### 2. On Process Exit

```typescript
child.on('exit', () => {
  const monitor = ResourceMonitor.getInstance();
  const limiter = ResourceLimiter.getInstance();
  
  monitor.untrackProcess(child.pid!);
  limiter.unregisterProcess(child.pid!);
});
```

#### 3. Connect Monitor Events

```typescript
private setupResourceHandlers(): void {
  const monitor = ResourceMonitor.getInstance();
  const limiter = ResourceLimiter.getInstance();
  
  monitor.on('memory-threshold', (info) => {
    limiter.checkMemoryLimit(
      info.metrics.usedMemory / 1024 / 1024,
      info.metrics.totalMemory / 1024 / 1024
    );
  });
  
  monitor.on('file-handles-threshold', (info) => {
    // May need to block new spawns
    this.shouldAllowSpawn = false;
  });
  
  limiter.on('action-taken', (action) => {
    logger.warn(`Enforcement: ${action.action} - ${action.reason}`);
  });
}
```

### SSHConnectionPool Integration

#### 1. Check Connection Limits

```typescript
async getConnection(options: GetConnectionOptions): Promise<PooledSSHConnection> {
  const limiter = ResourceLimiter.getInstance();
  const stats = this.getStats();
  
  if (!limiter.canAcceptConnection(stats.activeConnections)) {
    limiter.checkConnectionLimit(stats.activeConnections);
    throw new Error(`Connection limit reached: ${stats.activeConnections}`);
  }
  
  // Create connection...
}
```

#### 2. Monitor Pool Health

```typescript
private monitorPoolHealth(): void {
  const monitor = ResourceMonitor.getInstance();
  const limiter = ResourceLimiter.getInstance();
  
  setInterval(() => {
    const metrics = monitor.getSystemMetrics();
    const stats = this.getStats();
    const limits = limiter.getLimits();
    
    const memoryUtilization = metrics.memoryPercent;
    const connectionUtilization = (stats.activeConnections / limits.connectionLimitCount) * 100;
    
    if (connectionUtilization > 85) {
      logger.warn('Connection pool approaching limit');
      // May trigger cleanup
    }
  }, 30000);
}
```

## Example Metrics Output

### System Metrics Example

```typescript
const metrics = monitor.getSystemMetrics();
// Output:
{
  timestamp: 1710489600000,
  totalMemory: 16777216000,        // 16GB
  usedMemory: 8388608000,          // 8GB
  freeMemory: 8388608000,          // 8GB
  memoryPercent: 50.0,
  cpuUsage: {
    user: 5000000,                 // microseconds
    system: 2000000
  },
  loadAverage: [2.45, 2.10, 1.98],
  uptime: 86400,                   // 1 day
  processors: 8
}
```

### Process Metrics Example

```typescript
const processMetrics = monitor.getProcessMetrics(1234);
// Output:
{
  pid: 1234,
  cpuUsagePercent: 12.5,
  memoryUsageMB: 256.7,
  memoryPercent: 1.6,
  fileHandles: 128,
  childProcesses: 4,
  timestamp: 1710489600000
}
```

### All Process Metrics Example

```typescript
const allMetrics = monitor.getAllProcessMetrics();
// Output:
[
  {
    pid: 1234,
    cpuUsagePercent: 12.5,
    memoryUsageMB: 256.7,
    memoryPercent: 1.6,
    fileHandles: 128,
    childProcesses: 4,
    timestamp: 1710489600000
  },
  {
    pid: 5678,
    cpuUsagePercent: 3.2,
    memoryUsageMB: 512.1,
    memoryPercent: 3.2,
    fileHandles: 64,
    childProcesses: 2,
    timestamp: 1710489600000
  }
]
```

## Event System Overview

### Event Architecture

The system uses Node.js EventEmitter for non-blocking event handling:

```
    ResourceMonitor (Event Source)
           │
           ├─→ 'memory-threshold' ─→ Application Handlers
           ├─→ 'cpu-threshold'
           ├─→ 'file-handles-threshold'
           ├─→ 'process-added'
           └─→ 'process-removed'
    
    ResourceLimiter (Event Source)
           │
           ├─→ 'limit-exceeded' ─→ Application Handlers
           └─→ 'action-taken'
```

### Event Handling Best Practices

```typescript
// Always check which limit to act on
limiter.on('limit-exceeded', (info) => {
  switch (info.limitType) {
    case 'memory':
      handleMemoryExceeded(info);
      break;
    case 'connections':
      handleConnectionExceeded(info);
      break;
    // ...
  }
});

// Prevent event listener leaks
const handler = (info) => { /* ... */ };
monitor.once('memory-threshold', handler);  // One-time listener
monitor.removeListener('memory-threshold', handler);  // Cleanup
```

## Performance Characteristics

### ResourceMonitor Performance

| Metric | Value |
|---|---|
| System metrics collection | < 1ms |
| Per-process metric collection | < 5ms per process |
| Event emission overhead | < 1ms |
| Total per cycle (default 5s) | ~5-20ms |
| CPU overhead | ~0.1% |
| Base memory | ~2KB |
| Per-tracked process | ~200 bytes |
| Max efficient process tracking | 1000+ |

### ResourceLimiter Performance

| Metric | Value |
|---|---|
| Limit check | < 1ms |
| Enforcement action | ~5ms (process termination) |
| Memory overhead (base) | ~1KB |
| Memory overhead (per process) | ~50 bytes |
| Enforcement history (100 entries) | ~15KB |

### Optimization Tips

1. **Disable when not needed:** Set `enableMonitoring: false` if not using
2. **Adjust interval:** Increase `monitoringIntervalMs` for high-volume scenarios
3. **Filter events:** Use `.once()` instead of `.on()` for one-time checks
4. **Clear tracking:** Call `clearTracking()` to prevent memory leaks
5. **Enforce selectively:** Disable enforcement if not needed

## Logging

All operations are logged through the central logger with `component: 'ResourceMonitor'` or `component: 'ResourceLimiter'`:

```
DEBUG [ResourceMonitor] Tracking process 1234
INFO [ResourceMonitor] ResourceMonitor started with 5000ms interval
WARN [ResourceMonitor] Memory threshold exceeded: 85.50% > 85%
INFO [ResourceLimiter] Memory limit set to 4096MB
WARN [ResourceLimiter] File handle limit enforcement: New process spawn blocked
ERROR [ResourceLimiter] Could not terminate process 1234: No such process
```

## Error Handling

### LimitExceededError

```typescript
import { LimitExceededError } from './resource-limiter.js';

try {
  // ... process operations ...
} catch (error) {
  if (error instanceof LimitExceededError) {
    console.log(`Limit type: ${error.limitType}`);
    console.log(`Current: ${error.current}, Limit: ${error.limit}`);
    console.log(`Process: ${error.processId}`);
  }
}
```

## Graceful Shutdown

```typescript
async function shutdown(): Promise<void> {
  const monitor = ResourceMonitor.getInstance();
  const limiter = ResourceLimiter.getInstance();
  
  // Stop monitoring
  monitor.stopMonitoring();
  monitor.clearTracking();
  
  // Clean up limiter
  limiter.clearProcesses();
  limiter.clearHistory();
  
  logger.info('Resource management shut down');
}

process.on('SIGTERM', () => shutdown());
process.on('SIGINT', () => shutdown());
```

## Future Enhancements

Potential improvements for Wave 2:

1. **CPU Throttling:** Implement SIGSTOP/SIGCONT for CPU limits
2. **Memory Limits:** Use cgroup v2 for hard memory limits
3. **Adaptive Thresholds:** ML-based threshold adjustment
4. **Persistent History:** Log metrics to database
5. **Web Dashboard:** Real-time metrics visualization
6. **Predictive Alerts:** Forecast resource exhaustion
7. **Custom Enforcement:** Plugin-based enforcement actions
8. **Per-user Limits:** Granular resource quotas

## Troubleshooting

### Monitor not collecting metrics

```typescript
const monitor = ResourceMonitor.getInstance();
if (!monitor.isActive()) {
  monitor.startMonitoring();
}
console.log(`Tracked processes: ${monitor.getTrackedProcessCount()}`);
```

### Limits not enforcing

```typescript
const limiter = ResourceLimiter.getInstance();
// Check if enforcement is enabled
const limits = limiter.getLimits();
console.log(limits);
```

### High memory usage from monitor

```typescript
// Clear old process tracking
const monitor = ResourceMonitor.getInstance();
const allMetrics = monitor.getAllProcessMetrics();
allMetrics.forEach(m => {
  if (Date.now() - m.timestamp > 300000) { // 5 minutes old
    monitor.untrackProcess(m.pid);
  }
});
```

## License

Part of the Infected MCP Server project.
