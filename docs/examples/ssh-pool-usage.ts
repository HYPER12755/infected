/**
 * SSH Connection Pool Usage Examples
 * Demonstrates connection pooling, statistics, and pool lifecycle management
 *
 * These examples show how to:
 * - Get connections from the pool
 * - Release connections for reuse
 * - Monitor pool statistics
 * - Handle pool lifecycle
 * - Optimize performance with pooling
 */

import { SSHConnectionPool, GetConnectionOptions } from '../core/ssh-connection-pool.js';

// ============================================================================
// Example 1: Basic Connection Pool Usage
// ============================================================================

export async function exampleBasicPoolUsage(): Promise<void> {
  console.log('=== Example 1: Basic Connection Pool Usage ===\n');

  const pool = new SSHConnectionPool({
    maxConnections: 50,
    maxIdleTime: 300000, // 5 minutes
    maxConnectionAge: 3600000, // 1 hour
    maxReusesPerConnection: 100,
  });

  // Get a connection
  const connOptions: GetConnectionOptions = {
    host: 'example.com',
    port: 22,
    username: 'ubuntu',
    privateKey: '/home/user/.ssh/id_rsa',
    timeout: 10000,
  };

  console.log('Getting connection from pool...');
  const connection = await pool.getConnection(connOptions);

  console.log(`Connected: ${connection.connectionId}`);
  console.log(`  Host: ${connection.host}:${connection.port}`);
  console.log(`  Username: ${connection.username}`);
  console.log(`  State: ${connection.state}`);
  console.log(`  Created at: ${new Date(connection.createdAt).toISOString()}`);

  // Use the connection...
  console.log('\nUsing connection for operations...');

  // Release the connection back to the pool
  pool.releaseConnection(connection.connectionId);
  console.log('Connection released back to pool for reuse\n');

  // Get the same connection again - it's reused!
  console.log('Getting a connection again...');
  const reusedConnection = await pool.getConnection(connOptions);

  if (reusedConnection.connectionId === connection.connectionId) {
    console.log('✓ Pool reused the same connection!');
    console.log(`  Reuse count: ${reusedConnection.useCount}`);
  } else {
    console.log('✗ New connection created');
  }

  await pool.shutdown();
}

// ============================================================================
// Example 2: Pool Statistics and Monitoring
// ============================================================================

export async function examplePoolStatistics(): Promise<void> {
  console.log('\n=== Example 2: Pool Statistics ===\n');

  const pool = new SSHConnectionPool({
    maxConnections: 50,
    staleCheckInterval: 30000,
  });

  const baseOptions: GetConnectionOptions = {
    port: 22,
    username: 'ubuntu',
    privateKey: '/home/user/.ssh/id_rsa',
  };

  // Simulate getting multiple connections
  console.log('Creating 5 connections...');
  const connections = [];

  for (let i = 0; i < 5; i++) {
    const conn = await pool.getConnection({
      ...baseOptions,
      host: `host${i}.example.com`,
    });
    connections.push(conn);
  }

  console.log('Connections created\n');

  // Get initial statistics
  let stats = pool.getConnectionStats();
  console.log('Pool Statistics (All Active):');
  console.log(`  Active connections: ${stats.activeConnections}`);
  console.log(`  Idle connections: ${stats.idleConnections}`);
  console.log(`  Total created: ${stats.totalCreated}`);
  console.log(`  Total reused: ${stats.totalReused}`);
  console.log(`  Cache hit rate: ${((1 - stats.cacheMissRate) * 100).toFixed(2)}%`);
  console.log(`  Avg connection age: ${(stats.avgConnectionAge / 1000).toFixed(2)}s`);
  console.log(`  Avg reuses per connection: ${stats.avgConnectionReuses.toFixed(2)}`);
  console.log(`  Pool utilization: ${stats.poolUtilization.toFixed(2)}%\n`);

  // Release some connections
  console.log('Releasing connections...');
  for (const conn of connections.slice(0, 3)) {
    pool.releaseConnection(conn.connectionId);
  }

  // Statistics after release
  stats = pool.getConnectionStats();
  console.log('\nPool Statistics (After Release):');
  console.log(`  Active connections: ${stats.activeConnections}`);
  console.log(`  Idle connections: ${stats.idleConnections}`);
  console.log(`  Total reused: ${stats.totalReused}`);

  // Reuse a connection
  console.log('\nReusing a connection...');
  const reusedConn = await pool.getConnection({
    ...baseOptions,
    host: 'host0.example.com', // Should reuse first connection
  });

  stats = pool.getConnectionStats();
  console.log(`Cache hit rate after reuse: ${((1 - stats.cacheMissRate) * 100).toFixed(2)}%`);

  await pool.shutdown();
}

// ============================================================================
// Example 3: Connection Lifecycle and Events
// ============================================================================

export async function exampleConnectionLifecycle(): Promise<void> {
  console.log('\n=== Example 3: Connection Lifecycle ===\n');

  const pool = new SSHConnectionPool({
    maxConnections: 10,
    maxReusesPerConnection: 3, // Low value for demo
  });

  // Listen to pool events
  pool.on('connection:created', (info) => {
    console.log(`✓ Connection created: ${info.connectionId}`);
    console.log(`  ${info.host}:${info.port}`);
  });

  pool.on('connection:reused', (info) => {
    console.log(`↻ Connection reused: ${info.connectionId}`);
    console.log(`  Total reuses: ${info.reusesTotal}`);
  });

  pool.on('connection:released', (info) => {
    console.log(`⇥ Connection released: ${info.connectionId}`);
    console.log(`  ${info.host}:${info.port}`);
  });

  pool.on('connection:closed', (info) => {
    console.log(`✗ Connection closed: ${info.connectionId}`);
  });

  pool.on('stale:pruned', (info) => {
    console.log(`🧹 Pruned ${info.count} stale connections`);
  });

  const connOptions: GetConnectionOptions = {
    host: 'example.com',
    port: 22,
    username: 'ubuntu',
    privateKey: '/home/user/.ssh/id_rsa',
  };

  // Create connection
  console.log('Creating connection...');
  let conn = await pool.getConnection(connOptions);

  // Reuse multiple times
  for (let i = 0; i < 3; i++) {
    console.log(`\nReleasing connection (reuse ${i + 1})...`);
    pool.releaseConnection(conn.connectionId);

    console.log('Reusing connection...');
    conn = await pool.getConnection(connOptions);
  }

  // After max reuses, connection is closed
  console.log('\nReleasing connection (max reuses reached)...');
  pool.releaseConnection(conn.connectionId);

  console.log('Attempting to reuse maxed-out connection...');
  const newConn = await pool.getConnection(connOptions);
  console.log(`New connection created: ${newConn.connectionId !== conn.connectionId}`);

  await pool.shutdown();
}

// ============================================================================
// Example 4: Handling Multiple Hosts and Credentials
// ============================================================================

export async function exampleMultipleHosts(): Promise<void> {
  console.log('\n=== Example 4: Multiple Hosts ===\n');

  const pool = new SSHConnectionPool({
    maxConnections: 50,
    enableCredentialCaching: true,
  });

  const hosts = [
    { host: 'web-server-1.example.com', user: 'ubuntu' },
    { host: 'web-server-2.example.com', user: 'ubuntu' },
    { host: 'db-server.example.com', user: 'postgres' },
    { host: 'cache-server.example.com', user: 'redis' },
  ];

  // Get connections to multiple hosts
  console.log('Establishing connections to multiple hosts...');
  const hostConnections: Record<string, string> = {};

  for (const { host, user } of hosts) {
    const conn = await pool.getConnection({
      host,
      port: 22,
      username: user,
      privateKey: `/home/user/.ssh/${user}_id_rsa`,
      timeout: 10000,
    });
    hostConnections[host] = conn.connectionId;
    console.log(`✓ Connected to ${host} as ${user}`);
  }

  console.log();

  // Demonstrate connection reuse across the pool
  console.log('Reusing connections...');

  // Release all
  for (const [host, connId] of Object.entries(hostConnections)) {
    pool.releaseConnection(connId);
  }

  // Reconnect - should reuse
  let reusedCount = 0;
  for (const { host, user } of hosts) {
    const conn = await pool.getConnection({
      host,
      port: 22,
      username: user,
      privateKey: `/home/user/.ssh/${user}_id_rsa`,
    });

    if (conn.connectionId === hostConnections[host]) {
      reusedCount++;
      console.log(`↻ Reused connection to ${host}`);
    }
  }

  console.log(`\nReused ${reusedCount}/${hosts.length} connections`);

  // Show pool statistics
  const stats = pool.getConnectionStats();
  console.log('\nPool Statistics:');
  console.log(`  Total connections: ${stats.activeConnections + stats.idleConnections}`);
  console.log(`  Cache hit rate: ${((1 - stats.cacheMissRate) * 100).toFixed(2)}%`);
  console.log(`  Connections created: ${stats.totalCreated}`);
  console.log(`  Connections reused: ${stats.totalReused}`);

  await pool.shutdown();
}

// ============================================================================
// Example 5: Pool Optimization Strategies
// ============================================================================

export async function exampleOptimizationStrategies(): Promise<void> {
  console.log('\n=== Example 5: Pool Optimization ===\n');

  // Strategy 1: Adjust pool size based on workload
  console.log('Strategy 1: Workload-Based Pool Sizing\n');

  const lightWorkloadPool = new SSHConnectionPool({
    maxConnections: 10, // Small pool for light workload
    maxIdleTime: 60000, // Shorter idle timeout
  });

  const heavyWorkloadPool = new SSHConnectionPool({
    maxConnections: 100, // Large pool for heavy workload
    maxIdleTime: 600000, // Longer idle timeout
  });

  console.log('Light workload: maxConnections=10, maxIdleTime=1min');
  console.log('Heavy workload: maxConnections=100, maxIdleTime=10min\n');

  // Strategy 2: Connection aging
  console.log('Strategy 2: Connection Aging\n');

  const aggressiveAging = new SSHConnectionPool({
    maxConnectionAge: 60000, // Recreate connections every minute
    maxReusesPerConnection: 10, // Or after 10 reuses
  });

  const conservativeAging = new SSHConnectionPool({
    maxConnectionAge: 86400000, // Recreate connections daily
    maxReusesPerConnection: 1000, // Or after 1000 reuses
  });

  console.log('Aggressive aging: recreate every 1min or 10 reuses');
  console.log('Conservative aging: recreate daily or 1000 reuses\n');

  // Strategy 3: Monitor and adapt
  console.log('Strategy 3: Adaptive Pool Management\n');

  const adaptivePool = new SSHConnectionPool({
    maxConnections: 50,
    staleCheckInterval: 10000, // Check more frequently
  });

  // Monitor utilization
  setInterval(async () => {
    const stats = adaptivePool.getConnectionStats();

    if (stats.poolUtilization > 80) {
      console.log('⚠️  Pool utilization >80% - consider increasing maxConnections');
    }

    if (stats.cacheMissRate > 0.3) {
      console.log('⚠️  Cache miss rate >30% - connections not being reused effectively');
    }

    if (stats.avgConnectionAge > 3600000) {
      console.log('ℹ️  Avg connection age >1 hour - may be accumulating stale connections');
      await adaptivePool.pruneStaleConnections();
    }
  }, 30000);

  console.log('Monitoring pool health every 30 seconds...\n');

  // Cleanup
  await lightWorkloadPool.shutdown();
  await heavyWorkloadPool.shutdown();
  await adaptivePool.shutdown();
}

// ============================================================================
// Main Execution
// ============================================================================

export async function runAllExamples(): Promise<void> {
  try {
    await exampleBasicPoolUsage();
    await examplePoolStatistics();
    await exampleConnectionLifecycle();
    await exampleMultipleHosts();
    await exampleOptimizationStrategies();

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
