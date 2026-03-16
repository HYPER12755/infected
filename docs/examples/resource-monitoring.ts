/**
 * Resource Monitoring Examples
 * Demonstrates real-time monitoring, event subscription, and alerting patterns
 *
 * These examples show how to:
 * - Monitor system and process metrics
 * - Subscribe to threshold events
 * - Implement alerting patterns
 * - Use metrics for adaptive behavior
 */

import { ResourceMonitor } from '../core/resource-monitor.js';
import { ResourceLimiter } from '../core/resource-limiter.js';

// ============================================================================
// Example 1: Basic System Monitoring
// ============================================================================

export async function exampleBasicMonitoring(): Promise<void> {
  console.log('=== Example 1: Basic System Monitoring ===\n');

  const monitor = ResourceMonitor.getInstance();

  // Get current system metrics
  const systemMetrics = monitor.getSystemMetrics();

  console.log('System Metrics:');
  console.log(`  Total Memory: ${(systemMetrics.totalMemory / 1024 / 1024 / 1024).toFixed(2)}GB`);
  console.log(`  Used Memory: ${(systemMetrics.usedMemory / 1024 / 1024 / 1024).toFixed(2)}GB`);
  console.log(`  Free Memory: ${(systemMetrics.freeMemory / 1024 / 1024 / 1024).toFixed(2)}GB`);
  console.log(`  Memory Usage: ${systemMetrics.memoryPercent.toFixed(2)}%`);
  console.log(`  CPU Load (1min): ${systemMetrics.loadAverage[0].toFixed(2)}`);
  console.log(`  CPU Load (5min): ${systemMetrics.loadAverage[1].toFixed(2)}`);
  console.log(`  CPU Load (15min): ${systemMetrics.loadAverage[2].toFixed(2)}`);
  console.log(`  Uptime: ${Math.floor(systemMetrics.uptime / 60)} minutes`);
  console.log(`  Processors: ${systemMetrics.processors}`);
}

// ============================================================================
// Example 2: Process-Specific Monitoring
// ============================================================================

export async function exampleProcessMonitoring(): Promise<void> {
  console.log('\n=== Example 2: Process-Specific Monitoring ===\n');

  const monitor = ResourceMonitor.getInstance();

  // Track the current process
  const pid = process.pid;
  monitor.trackProcess(pid);

  console.log(`Tracking process ${pid}...\n`);

  // Get process metrics
  const processMetrics = monitor.getProcessMetrics(pid);

  if (processMetrics) {
    console.log(`Process Metrics (PID ${pid}):`);
    console.log(`  CPU Usage: ${processMetrics.cpuUsagePercent.toFixed(2)}%`);
    console.log(`  Memory: ${processMetrics.memoryUsageMB.toFixed(2)}MB`);
    console.log(`  Memory %: ${processMetrics.memoryPercent.toFixed(4)}%`);
    console.log(`  File Handles: ${processMetrics.fileHandles}`);
    console.log(`  Child Processes: ${processMetrics.childProcesses}`);
  }

  // Get all tracked processes
  const allMetrics = monitor.getAllProcessMetrics();
  console.log(`\nTotal processes tracked: ${allMetrics.length}`);

  // Untrack when done
  monitor.untrackProcess(pid);
  console.log(`Stopped tracking process ${pid}`);
}

// ============================================================================
// Example 3: Monitoring with Event Subscriptions
// ============================================================================

export async function exampleEventSubscription(): Promise<void> {
  console.log('\n=== Example 3: Event Subscription ===\n');

  const monitor = ResourceMonitor.getInstance();

  // Configure monitoring thresholds
  monitor.configure({
    memoryThresholdPercent: 80, // Alert at 80% memory
    cpuThresholdPercent: 75, // Alert at 75% CPU
    fileHandleThresholdPercent: 85, // Alert at 85% file handles
    monitoringIntervalMs: 2000, // Check every 2 seconds
  });

  // Subscribe to memory threshold events
  monitor.on('memory-threshold', (info) => {
    console.log('⚠️  Memory Threshold Event:');
    console.log(`  Current: ${info.current.toFixed(2)}%`);
    console.log(`  Threshold: ${info.threshold}%`);
    console.log(`  Total Memory: ${(info.metrics.totalMemory / 1024 / 1024 / 1024).toFixed(2)}GB`);
  });

  // Subscribe to CPU threshold events
  monitor.on('cpu-threshold', (info) => {
    console.log('⚠️  CPU Threshold Event:');
    console.log(`  Process ID: ${info.pid}`);
    console.log(`  Current Usage: ${info.current.toFixed(2)}%`);
    console.log(`  Threshold: ${info.threshold}%`);
  });

  // Subscribe to file handles threshold
  monitor.on('file-handles-threshold', (info) => {
    console.log('⚠️  File Handles Threshold Event:');
    console.log(`  Process ID: ${info.pid}`);
    console.log(`  Current: ${info.current}`);
    console.log(`  Max: ${info.maxAllowed}`);
    console.log(`  Usage: ${info.percent.toFixed(2)}%`);
  });

  // Subscribe to process lifecycle events
  monitor.on('process-added', (info) => {
    console.log(`✓ Started tracking process ${info.pid}`);
  });

  monitor.on('process-removed', (info) => {
    console.log(`✓ Stopped tracking process ${info.pid}`);
  });

  console.log('Monitoring started - subscribed to events');
  console.log('(Events will be logged as they occur)\n');

  // Start monitoring
  monitor.trackProcess(process.pid);
  monitor.startMonitoring(2000);

  // Run for 10 seconds to demonstrate event subscription
  await new Promise((resolve) => setTimeout(resolve, 10000));

  monitor.stopMonitoring();
  console.log('\nMonitoring stopped');
}

// ============================================================================
// Example 4: Resource Limiter - Enforcement
// ============================================================================

export async function exampleResourceLimiting(): Promise<void> {
  console.log('\n=== Example 4: Resource Limiter ===\n');

  const limiter = new ResourceLimiter();

  // Set resource limits
  limiter.setMemoryLimit(2048); // 2GB max memory
  limiter.setFileHandleLimit(1024); // Max 1024 open files
  limiter.setConnectionLimit(100); // Max 100 connections

  console.log('Set resource limits:');
  const limits = limiter.getLimits();
  console.log(`  Memory: ${limits.memoryLimitMB}MB`);
  console.log(`  CPU: ${limits.cpuLimitPercent}%`);
  console.log(`  File Handles: ${limits.fileHandleLimitCount}`);
  console.log(`  Connections: ${limits.connectionLimitCount}\n`);

  // Check before operation
  console.log('Checking resource availability before operations:\n');

  const canSpawnProcess = limiter.canSpawnProcess(256, 1024);
  console.log(`Can spawn process (256MB needed, 1024MB used): ${canSpawnProcess}`);

  const canAcceptConnection = limiter.canAcceptConnection(50);
  console.log(`Can accept connection (50 current): ${canAcceptConnection}`);

  // Subscribe to enforcement events
  limiter.on('limit-exceeded', (info) => {
    console.log('\n❌ Limit Exceeded:');
    console.log(`  Type: ${info.limitType}`);
    console.log(`  Current: ${info.current}`);
    console.log(`  Limit: ${info.limit}`);
  });

  limiter.on('action-taken', (action) => {
    console.log('\n🛡️  Enforcement Action:');
    console.log(`  Action: ${action.action}`);
    console.log(`  Reason: ${action.reason}`);
    if (action.details) {
      console.log(`  Details: ${JSON.stringify(action.details)}`);
    }
  });

  console.log('\nEnforcement events subscribed');
}

// ============================================================================
// Example 5: Adaptive Behavior Based on Metrics
// ============================================================================

export async function exampleAdaptiveBehavior(): Promise<void> {
  console.log('\n=== Example 5: Adaptive Behavior ===\n');

  const monitor = ResourceMonitor.getInstance();
  const limiter = new ResourceLimiter();

  // Configure limits
  limiter.setMemoryLimit(3000);
  limiter.setConnectionLimit(50);

  // Adaptive task execution based on system load
  async function adaptiveTaskExecution(taskName: string, heavyOperations: number) {
    const systemMetrics = monitor.getSystemMetrics();
    const memoryPercent = systemMetrics.memoryPercent;
    const loadAvg = systemMetrics.loadAverage[0];

    console.log(`\nExecuting task: ${taskName}`);
    console.log(`  Memory usage: ${memoryPercent.toFixed(2)}%`);
    console.log(`  System load: ${loadAvg.toFixed(2)}`);

    // Adapt parallelism based on memory
    let parallelism = 4;
    if (memoryPercent > 80) {
      parallelism = 2;
      console.log('  ⚠️  High memory - reducing parallelism to 2');
    } else if (memoryPercent > 60) {
      parallelism = 3;
      console.log('  ⚠️  Moderate memory - reducing parallelism to 3');
    }

    // Adapt batch size based on load
    let batchSize = heavyOperations;
    if (loadAvg > 4) {
      batchSize = Math.max(1, Math.ceil(heavyOperations / 2));
      console.log(`  ⚠️  High load - reducing batch size to ${batchSize}`);
    }

    console.log(`  Executing with parallelism=${parallelism}, batchSize=${batchSize}`);
  }

  // Simulate different scenarios
  await adaptiveTaskExecution('DataProcessing', 100);

  // Check resource availability before spawning
  const currentMemory = monitor.getSystemMetrics().usedMemory / 1024 / 1024;
  const estimatedProcessMemory = 512; // 512MB

  if (limiter.canSpawnProcess(estimatedProcessMemory, currentMemory)) {
    console.log(`\n✓ Safe to spawn process (${estimatedProcessMemory}MB needed)`);
  } else {
    console.log(`\n✗ Cannot spawn process - would exceed memory limit`);
  }
}

// ============================================================================
// Example 6: Alerting Patterns
// ============================================================================

export async function exampleAlertingPatterns(): Promise<void> {
  console.log('\n=== Example 6: Alerting Patterns ===\n');

  const monitor = ResourceMonitor.getInstance();
  const limiter = new ResourceLimiter();

  // Setup severity levels based on thresholds
  const alertLevels = {
    info: 70,
    warning: 80,
    critical: 90,
  };

  monitor.configure({
    memoryThresholdPercent: alertLevels.warning,
    monitoringIntervalMs: 5000,
  });

  // Setup tiered alerting
  monitor.on('memory-threshold', (info) => {
    const percent = info.current;

    if (percent >= alertLevels.critical) {
      console.log(`🚨 CRITICAL: Memory at ${percent.toFixed(2)}% - IMMEDIATE ACTION REQUIRED`);
      // Trigger emergency response
      console.log('  Actions: Killing least important processes, requesting help');
    } else if (percent >= alertLevels.warning) {
      console.log(`⚠️  WARNING: Memory at ${percent.toFixed(2)}% - REDUCING LOAD`);
      // Trigger mitigation
      console.log('  Actions: Reducing task concurrency, flushing caches');
    } else {
      console.log(`ℹ️  INFO: Memory at ${percent.toFixed(2)}% - MONITORING`);
    }
  });

  // Setup enforcement action tracking
  limiter.on('action-taken', (action) => {
    console.log(`\n📋 Action Log: ${action.action}`);
    console.log(`   Reason: ${action.reason}`);
    console.log(`   Timestamp: ${new Date(action.timestamp).toISOString()}`);
  });

  // Get enforcement history
  const history = limiter.getEnforcementHistory(5);
  if (history.length > 0) {
    console.log('\nRecent enforcement actions:');
    history.forEach((action, index) => {
      console.log(`  ${index + 1}. ${action.action} (${action.reason})`);
    });
  } else {
    console.log('\nNo enforcement actions yet');
  }
}

// ============================================================================
// Main Execution
// ============================================================================

export async function runAllExamples(): Promise<void> {
  try {
    await exampleBasicMonitoring();
    await exampleProcessMonitoring();
    await exampleEventSubscription();
    await exampleResourceLimiting();
    await exampleAdaptiveBehavior();
    await exampleAlertingPatterns();

    console.log('\n=== All Examples Completed Successfully ===\n');
  } catch (error) {
    console.error(
      'Error running examples:',
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}

// Run examples if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllExamples();
}
