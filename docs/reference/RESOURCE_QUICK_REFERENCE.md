# Resource Monitoring System - Quick Reference Guide

## Import & Initialize

```typescript
import ResourceMonitor from './core/resource-monitor.js';
import ResourceLimiter from './core/resource-limiter.js';
import config from '../infected.config.json';

// Initialize monitoring
ResourceMonitor.configure({
  memoryThresholdPercent: config.resources.thresholdPercent,
  cpuThresholdPercent: config.resources.maxCPUPercent,
  monitoringIntervalMs: config.resources.monitoringIntervalMs,
});

if (config.resources.enableMonitoring) {
  ResourceMonitor.startMonitoring();
}

// Initialize limiting
if (config.resources.enableLimiting) {
  ResourceLimiter.setMemoryLimit(config.resources.maxMemoryMB);
  ResourceLimiter.setCPULimit(config.resources.maxCPUPercent);
  ResourceLimiter.setFileHandleLimit(config.resources.maxFileHandles);
  ResourceLimiter.setConnectionLimit(config.resources.maxConnections);
}
```

## Get System Metrics

```typescript
const metrics = ResourceMonitor.getSystemMetrics();

console.log(`Memory: ${metrics.memoryPercent.toFixed(2)}%`);
console.log(`Free: ${(metrics.freeMemory / 1024 / 1024).toFixed(2)}MB`);
console.log(`Load: ${metrics.loadAverage[0].toFixed(2)}`);
```

## Track a Process

```typescript
// When spawning
const child = spawn('command');
ResourceMonitor.trackProcess(child.pid);
ResourceLimiter.registerProcess(child.pid);

// Get metrics
const pMetrics = ResourceMonitor.getProcessMetrics(child.pid);
console.log(`CPU: ${pMetrics?.cpuUsagePercent.toFixed(2)}%`);
console.log(`Memory: ${pMetrics?.memoryUsageMB.toFixed(2)}MB`);

// When exiting
child.on('exit', () => {
  ResourceMonitor.untrackProcess(child.pid);
  ResourceLimiter.unregisterProcess(child.pid);
});
```

## Listen for Threshold Events

```typescript
// Memory threshold
ResourceMonitor.on('memory-threshold', (info) => {
  logger.warn(`Memory: ${info.current.toFixed(2)}% > ${info.threshold}%`);
  ResourceLimiter.checkMemoryLimit(
    info.metrics.usedMemory / 1024 / 1024,
    info.metrics.totalMemory / 1024 / 1024
  );
});

// CPU threshold
ResourceMonitor.on('cpu-threshold', (info) => {
  logger.warn(`Process ${info.pid} CPU: ${info.current.toFixed(2)}%`);
  ResourceLimiter.checkCPULimit(info.current, info.pid);
});

// File handles
ResourceMonitor.on('file-handles-threshold', (info) => {
  logger.warn(`Process ${info.pid} FDs: ${info.current} > ${info.maxAllowed}`);
  ResourceLimiter.checkFileHandleLimit(info.current, info.pid);
});
```

## Listen for Enforcement Events

```typescript
ResourceLimiter.on('limit-exceeded', (info) => {
  logger.error(`${info.limitType} limit exceeded: ${info.current} > ${info.limit}`);
});

ResourceLimiter.on('action-taken', (action) => {
  logger.info(`${action.action}: ${action.reason}`);
  if (action.target) {
    logger.info(`  Target: ${action.target}`);
  }
});
```

## Check Before Operations

```typescript
// Before spawning a process
const systemMetrics = ResourceMonitor.getSystemMetrics();
if (!ResourceLimiter.canSpawnProcess(50, systemMetrics.usedMemory / 1024 / 1024)) {
  throw new Error('Insufficient memory to spawn process');
}

// Before accepting SSH connection
const stats = sshPool.getStats();
if (!ResourceLimiter.canAcceptConnection(stats.activeConnections)) {
  throw new Error('Connection limit reached');
}
```

## Get All Metrics

```typescript
// All process metrics
const allMetrics = ResourceMonitor.getAllProcessMetrics();
allMetrics.forEach(m => {
  console.log(`PID ${m.pid}: ${m.cpuUsagePercent.toFixed(2)}% CPU, ${m.memoryUsageMB.toFixed(2)}MB RAM`);
});

// Enforcement history
const history = ResourceLimiter.getEnforcementHistory(10);
history.forEach(action => {
  console.log(`[${new Date(action.timestamp).toISOString()}] ${action.action}: ${action.reason}`);
});
```

## Configuration Reference

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

## Shutdown

```typescript
function shutdown() {
  ResourceMonitor.stopMonitoring();
  ResourceMonitor.clearTracking();
  ResourceLimiter.clearProcesses();
  ResourceLimiter.clearHistory();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

## Common Patterns

### Pattern 1: Resource-Aware Process Spawning

```typescript
async function spawnWithResourceCheck(command: string): Promise<ChildProcess> {
  const systemMetrics = ResourceMonitor.getSystemMetrics();
  const estimatedMemory = 50;

  if (!ResourceLimiter.canSpawnProcess(estimatedMemory, systemMetrics.usedMemory / 1024 / 1024)) {
    throw new Error('Insufficient memory');
  }

  const child = spawn(command);
  ResourceMonitor.trackProcess(child.pid!);
  ResourceLimiter.registerProcess(child.pid!);

  child.on('exit', () => {
    ResourceMonitor.untrackProcess(child.pid!);
    ResourceLimiter.unregisterProcess(child.pid!);
  });

  return child;
}
```

### Pattern 2: Connection Pool with Resource Limits

```typescript
async function getConnectionWithLimits(options: GetConnectionOptions): Promise<Connection> {
  const stats = pool.getStats();

  if (!ResourceLimiter.canAcceptConnection(stats.activeConnections)) {
    ResourceLimiter.checkConnectionLimit(stats.activeConnections);
    throw new Error('Connection limit reached');
  }

  return pool.getConnection(options);
}
```

### Pattern 3: Health Check with Auto-Recovery

```typescript
function startHealthCheck() {
  setInterval(() => {
    const metrics = ResourceMonitor.getSystemMetrics();
    
    if (metrics.memoryPercent > 90) {
      logger.error('Critical memory usage');
      triggerGracefulShutdown();
    } else if (metrics.memoryPercent > 85) {
      logger.warn('High memory usage');
      cleanupResources();
    }
  }, 30000);
}
```

### Pattern 4: Detailed Process Monitoring

```typescript
function monitorProcess(pid: number, interval: number = 5000) {
  const monitor = setInterval(() => {
    const pMetrics = ResourceMonitor.getProcessMetrics(pid);
    
    if (!pMetrics) {
      clearInterval(monitor);
      return;
    }

    console.log(`PID ${pid}:`);
    console.log(`  CPU: ${pMetrics.cpuUsagePercent.toFixed(2)}%`);
    console.log(`  Memory: ${pMetrics.memoryUsageMB.toFixed(2)}MB (${pMetrics.memoryPercent.toFixed(2)}%)`);
    console.log(`  FDs: ${pMetrics.fileHandles}`);
  }, interval);
}
```

## Troubleshooting

### Monitor not collecting metrics?
```typescript
if (!ResourceMonitor.isActive()) {
  ResourceMonitor.startMonitoring();
}
```

### Check what's being tracked?
```typescript
console.log(`Tracked processes: ${ResourceMonitor.getTrackedProcessCount()}`);
console.log(`Monitored by limiter: ${ResourceLimiter.getMonitoredProcessCount()}`);
```

### View recent enforcement actions?
```typescript
const history = ResourceLimiter.getEnforcementHistory(5);
history.forEach(action => console.log(action));
```

### Debug memory usage?
```typescript
const metrics = ResourceMonitor.getSystemMetrics();
console.log(`Total: ${(metrics.totalMemory / 1024 / 1024).toFixed(2)}MB`);
console.log(`Used: ${(metrics.usedMemory / 1024 / 1024).toFixed(2)}MB`);
console.log(`Free: ${(metrics.freeMemory / 1024 / 1024).toFixed(2)}MB`);
console.log(`Percent: ${metrics.memoryPercent.toFixed(2)}%`);
```

## Limits Summary

| Limit | Default | Min | Max |
|-------|---------|-----|-----|
| Memory | 4096 MB | 1 MB | System dependent |
| CPU | 80% | 1% | 100% |
| File Handles | 2048 | 1 | System dependent |
| Connections | 50 | 1 | System dependent |

## Events Summary

| Event | Source | Data |
|-------|--------|------|
| memory-threshold | Monitor | current, threshold, metrics |
| cpu-threshold | Monitor | pid, current, threshold, metrics |
| file-handles-threshold | Monitor | pid, current, maxAllowed, percent |
| process-added | Monitor | pid, timestamp |
| process-removed | Monitor | pid, timestamp |
| limit-exceeded | Limiter | limitType, current, limit, processId? |
| action-taken | Limiter | action, reason, target?, details? |

## Performance Tips

1. **Disable if not needed:** `enableMonitoring: false` in config
2. **Increase interval for low-frequency checks:** Higher `monitoringIntervalMs`
3. **Use `.once()` for one-time events** instead of `.on()`
4. **Clean up tracked processes** to prevent memory buildup
5. **Configure appropriate thresholds** for your workload

## Documentation Links

- Full Documentation: `RESOURCE_MONITORING_README.md`
- Integration Guide: `RESOURCE_INTEGRATION_GUIDE.ts`
- Implementation Summary: `RESOURCE_SYSTEM_SUMMARY.md`
- Verification Report: `IMPLEMENTATION_VERIFICATION.md`

---

**Location:** `src/core/resource-monitor.ts` and `src/core/resource-limiter.ts`
