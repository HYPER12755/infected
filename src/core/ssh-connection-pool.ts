import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import logger from './logger.js';

/**
 * Represents the state of an SSH connection
 */
export type ConnectionState = 'connected' | 'disconnected' | 'error' | 'idle';

/**
 * Configuration options for the SSH Connection Pool
 */
export interface SSHConnectionPoolConfig {
  /** Maximum number of concurrent connections in the pool (default: 50) */
  maxConnections?: number;
  /** Maximum idle time before a connection is closed (ms, default: 5 minutes) */
  maxIdleTime?: number;
  /** Maximum age of a connection before it must be recreated (ms, default: 1 hour) */
  maxConnectionAge?: number;
  /** Maximum number of times a single connection can be reused (default: 100) */
  maxReusesPerConnection?: number;
  /** Interval for checking stale connections (ms, default: 30 seconds) */
  staleCheckInterval?: number;
  /** Enable credential caching with hashing (default: true) */
  enableCredentialCaching?: boolean;
}

/**
 * Metadata and state for a pooled SSH connection
 */
export interface PooledSSHConnection {
  connectionId: string;
  host: string;
  port: number;
  username: string;
  state: ConnectionState;
  createdAt: number;
  lastUsed: number;
  useCount: number;
  credentialHash: string;
  inUse: boolean;
  connection?: any; // Placeholder for actual SSH connection object
}

/**
 * Statistics about the SSH connection pool
 */
export interface PoolStats {
  activeConnections: number;
  idleConnections: number;
  totalCreated: number;
  totalReused: number;
  totalClosed: number;
  cacheMissRate: number;
  avgConnectionAge: number;
  avgConnectionReuses: number;
  poolUtilization: number;
}

/**
 * Options for getting a connection from the pool
 */
export interface GetConnectionOptions {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  timeout?: number;
}

/**
 * Internal credential cache entry
 */
interface CredentialCacheEntry {
  hash: string;
  expiresAt: number;
}

/**
 * SSHConnectionPool manages a pool of SSH connections with intelligent caching,
 * lifecycle management, and automatic cleanup.
 *
 * @example
 * ```typescript
 * const pool = new SSHConnectionPool({
 *   maxConnections: 50,
 *   maxIdleTime: 300000, // 5 minutes
 *   maxConnectionAge: 3600000, // 1 hour
 * });
 *
 * // Get a connection
 * const conn = await pool.getConnection({
 *   host: 'remote.example.com',
 *   port: 22,
 *   username: 'ubuntu',
 *   privateKey: '/home/user/.ssh/id_rsa',
 * });
 *
 * // Use the connection...
 *
 * // Release it back to the pool
 * pool.releaseConnection(conn.connectionId);
 *
 * // Get stats
 * const stats = pool.getConnectionStats();
 * console.log(stats);
 *
 * // Graceful shutdown
 * await pool.shutdown();
 * ```
 */
export class SSHConnectionPool extends EventEmitter {
  private config: Required<SSHConnectionPoolConfig>;
  private connectionCache: Map<string, PooledSSHConnection>;
  private credentialCache: Map<string, CredentialCacheEntry>;
  private stats: {
    totalCreated: number;
    totalReused: number;
    totalClosed: number;
    cacheMisses: number;
    cacheHits: number;
  };
  private staleCheckTimer?: NodeJS.Timeout;
  private shutdownInProgress = false;

  /**
   * Creates a new SSH connection pool
   * @param config Optional configuration options
   */
  constructor(config?: SSHConnectionPoolConfig) {
    super();
    this.validateConfig(config);
    this.config = this.applyDefaults(config);
    this.connectionCache = new Map();
    this.credentialCache = new Map();
    this.stats = {
      totalCreated: 0,
      totalReused: 0,
      totalClosed: 0,
      cacheMisses: 0,
      cacheHits: 0,
    };

    logger.debug('SSH Connection Pool initialized', {
      component: 'SSHConnectionPool',
      config: {
        maxConnections: this.config.maxConnections,
        maxIdleTime: this.config.maxIdleTime,
        maxConnectionAge: this.config.maxConnectionAge,
        maxReusesPerConnection: this.config.maxReusesPerConnection,
      },
    });

    // Start the stale connection cleanup interval
    this.startStaleCheckInterval();
  }

  /**
   * Gets or creates an SSH connection from the pool
   * @param options Connection options
   * @returns Promise resolving to a pooled SSH connection
   *
   * @example
   * ```typescript
   * const conn = await pool.getConnection({
   *   host: 'server.com',
   *   port: 22,
   *   username: 'user',
   *   privateKey: '/path/to/key',
   * });
   * ```
   */
  async getConnection(options: GetConnectionOptions): Promise<PooledSSHConnection> {
    if (this.shutdownInProgress) {
      throw new Error('SSH Connection Pool is shutting down');
    }

    const cacheKey = this.generateCacheKey(options);
    const existingConnection = this.connectionCache.get(cacheKey);

    // Try to reuse an existing connection
    if (existingConnection && this.canReuseConnection(existingConnection)) {
      this.stats.totalReused++;
      this.stats.cacheHits++;
      existingConnection.lastUsed = Date.now();
      existingConnection.useCount++;
      existingConnection.inUse = true;

      this.emit('connection:reused', {
        connectionId: existingConnection.connectionId,
        host: existingConnection.host,
        port: existingConnection.port,
        reusesTotal: existingConnection.useCount,
      });

      logger.debug('Reused SSH connection from pool', {
        component: 'SSHConnectionPool',
        connectionId: existingConnection.connectionId,
        reuses: existingConnection.useCount,
      });

      return existingConnection;
    }

    // Create a new connection if we haven't hit the limit
    if (this.connectionCache.size >= this.config.maxConnections) {
      this.stats.cacheMisses++;
      await this.pruneStaleConnections();

      // If still at capacity, throw error
      if (this.connectionCache.size >= this.config.maxConnections) {
        throw new Error(
          `SSH Connection Pool is at maximum capacity (${this.config.maxConnections} connections)`
        );
      }
    }

    const newConnection = await this.createConnection(options, cacheKey);
    this.stats.totalCreated++;
    this.stats.cacheMisses++;

    this.emit('connection:created', {
      connectionId: newConnection.connectionId,
      host: newConnection.host,
      port: newConnection.port,
    });

    logger.info('Created new SSH connection', {
      component: 'SSHConnectionPool',
      connectionId: newConnection.connectionId,
      host: newConnection.host,
      port: newConnection.port,
    });

    return newConnection;
  }

  /**
   * Releases a connection back to the pool for reuse
   * @param connectionId The ID of the connection to release
   *
   * @example
   * ```typescript
   * pool.releaseConnection(conn.connectionId);
   * ```
   */
  releaseConnection(connectionId: string): void {
    const connection = Array.from(this.connectionCache.values()).find(
      (c) => c.connectionId === connectionId
    );

    if (!connection) {
      logger.warn('Attempted to release unknown connection', {
        component: 'SSHConnectionPool',
        connectionId,
      });
      return;
    }

    connection.inUse = false;
    connection.lastUsed = Date.now();
    connection.state = 'idle';

    // Check if connection should be removed based on reuse limits
    if (connection.useCount >= this.config.maxReusesPerConnection) {
      logger.debug('Connection reached max reuse limit, removing from pool', {
        component: 'SSHConnectionPool',
        connectionId,
        reuses: connection.useCount,
        maxReuses: this.config.maxReusesPerConnection,
      });
      void this.closeConnection(connectionId);
    } else {
      this.emit('connection:released', {
        connectionId,
        host: connection.host,
        port: connection.port,
      });
    }
  }

  /**
   * Closes a specific connection and removes it from the pool
   * @param connectionId The ID of the connection to close
   * @returns Promise that resolves when the connection is closed
   *
   * @example
   * ```typescript
   * await pool.closeConnection(connectionId);
   * ```
   */
  async closeConnection(connectionId: string): Promise<void> {
    const connection = Array.from(this.connectionCache.values()).find(
      (c) => c.connectionId === connectionId
    );

    if (!connection) {
      return;
    }

    try {
      // Close the actual SSH connection if it exists
      if (connection.connection && typeof connection.connection.end === 'function') {
        await new Promise<void>((resolve) => {
          connection.connection.end();
          // Give it a short time to close gracefully
          setTimeout(resolve, 100);
        });
      }

      connection.state = 'disconnected';
      this.stats.totalClosed++;

      // Remove from cache
      const cacheKey = Array.from(this.connectionCache.entries()).find(
        ([_, v]) => v.connectionId === connectionId
      )?.[0];

      if (cacheKey) {
        this.connectionCache.delete(cacheKey);
      }

      this.emit('connection:closed', {
        connectionId,
        host: connection.host,
        port: connection.port,
      });

      logger.debug('Closed SSH connection', {
        component: 'SSHConnectionPool',
        connectionId,
        reasonMaxReuses: connection.useCount >= this.config.maxReusesPerConnection,
      });
    } catch (error) {
      logger.error('Error closing SSH connection', {
        component: 'SSHConnectionPool',
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      });

      this.emit('connection:error', {
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Retrieves current pool statistics
   * @returns Pool statistics object
   *
   * @example
   * ```typescript
   * const stats = pool.getConnectionStats();
   * console.log(`Active: ${stats.activeConnections}, Idle: ${stats.idleConnections}`);
   * ```
   */
  getConnectionStats(): PoolStats {
    const connections = Array.from(this.connectionCache.values());
    const activeConnections = connections.filter((c) => c.inUse).length;
    const idleConnections = connections.filter((c) => !c.inUse).length;
    const cacheHitRate =
      this.stats.cacheHits + this.stats.cacheMisses > 0
        ? this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses)
        : 0;
    const cacheMissRate = 1 - cacheHitRate;

    const avgConnectionAge =
      connections.length > 0
        ? connections.reduce((sum, c) => sum + (Date.now() - c.createdAt), 0) /
          connections.length
        : 0;

    const avgConnectionReuses =
      connections.length > 0
        ? connections.reduce((sum, c) => sum + c.useCount, 0) / connections.length
        : 0;

    const poolUtilization =
      this.config.maxConnections > 0
        ? (this.connectionCache.size / this.config.maxConnections) * 100
        : 0;

    return {
      activeConnections,
      idleConnections,
      totalCreated: this.stats.totalCreated,
      totalReused: this.stats.totalReused,
      totalClosed: this.stats.totalClosed,
      cacheMissRate,
      avgConnectionAge,
      avgConnectionReuses,
      poolUtilization,
    };
  }

  /**
   * Removes stale connections from the pool
   * @returns Promise that resolves when pruning is complete
   *
   * Removes connections that are:
   * - Idle beyond maxIdleTime
   * - Older than maxConnectionAge
   * - Have exceeded maxReusesPerConnection
   *
   * @example
   * ```typescript
   * await pool.pruneStaleConnections();
   * ```
   */
  async pruneStaleConnections(): Promise<void> {
    const now = Date.now();
    const connectionsToPrune: string[] = [];

    const entries = Array.from(this.connectionCache.entries());
    for (const [cacheKey, connection] of entries) {
      // Skip connections currently in use
      if (connection.inUse) {
        continue;
      }

      // Check if idle too long
      if (now - connection.lastUsed > this.config.maxIdleTime) {
        connectionsToPrune.push(connection.connectionId);
        logger.debug('Pruning idle connection', {
          component: 'SSHConnectionPool',
          connectionId: connection.connectionId,
          idleTime: now - connection.lastUsed,
          maxIdleTime: this.config.maxIdleTime,
        });
        continue;
      }

      // Check if too old
      if (now - connection.createdAt > this.config.maxConnectionAge) {
        connectionsToPrune.push(connection.connectionId);
        logger.debug('Pruning old connection', {
          component: 'SSHConnectionPool',
          connectionId: connection.connectionId,
          age: now - connection.createdAt,
          maxAge: this.config.maxConnectionAge,
        });
        continue;
      }

      // Check if exceeded max reuses
      if (connection.useCount >= this.config.maxReusesPerConnection) {
        connectionsToPrune.push(connection.connectionId);
        logger.debug('Pruning overused connection', {
          component: 'SSHConnectionPool',
          connectionId: connection.connectionId,
          reuses: connection.useCount,
          maxReuses: this.config.maxReusesPerConnection,
        });
      }
    }

    // Close all stale connections in parallel
    await Promise.all(
      connectionsToPrune.map((connectionId) => this.closeConnection(connectionId))
    );

    if (connectionsToPrune.length > 0) {
      this.emit('stale:pruned', { count: connectionsToPrune.length });
    }
  }

  /**
   * Gracefully shuts down the connection pool
   * @returns Promise that resolves when all connections are closed
   *
   * This will:
   * - Stop accepting new connections
   * - Wait for in-use connections to be released
   * - Close all remaining connections
   * - Stop the stale check interval
   *
   * @example
   * ```typescript
   * await pool.shutdown();
   * console.log('Pool shutdown complete');
   * ```
   */
  async shutdown(): Promise<void> {
    this.shutdownInProgress = true;

    logger.info('SSH Connection Pool shutting down', {
      component: 'SSHConnectionPool',
      activeConnections: this.getConnectionStats().activeConnections,
    });

    // Stop the stale check interval
    if (this.staleCheckTimer) {
      clearInterval(this.staleCheckTimer);
      this.staleCheckTimer = undefined;
    }

    // Wait for in-use connections to be released (with timeout)
    let waitTime = 0;
    const maxWaitTime = 10000; // 10 seconds max
    const pollInterval = 100;

    while (this.getConnectionStats().activeConnections > 0 && waitTime < maxWaitTime) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      waitTime += pollInterval;
    }

    // Close all remaining connections
    const connectionIds = Array.from(this.connectionCache.values()).map(
      (c) => c.connectionId
    );

    await Promise.all(connectionIds.map((id) => this.closeConnection(id)));

    this.removeAllListeners();
    this.connectionCache.clear();
    this.credentialCache.clear();

    logger.info('SSH Connection Pool shutdown complete', {
      component: 'SSHConnectionPool',
      totalClosed: this.stats.totalClosed,
    });

    this.emit('pool:shutdown');
  }

  /**
   * Clears all credentials from the cache
   * @internal
   */
  clearCredentialCache(): void {
    this.credentialCache.clear();
    logger.debug('Credential cache cleared', { component: 'SSHConnectionPool' });
  }

  // ========== PRIVATE METHODS ==========

  /**
   * Validates the provided configuration
   */
  private validateConfig(config?: SSHConnectionPoolConfig): void {
    if (!config) return;

    if (config.maxConnections !== undefined && config.maxConnections < 1) {
      throw new Error('maxConnections must be at least 1');
    }

    if (config.maxIdleTime !== undefined && config.maxIdleTime < 1000) {
      throw new Error('maxIdleTime must be at least 1000ms');
    }

    if (config.maxConnectionAge !== undefined && config.maxConnectionAge < 5000) {
      throw new Error('maxConnectionAge must be at least 5000ms');
    }

    if (config.maxReusesPerConnection !== undefined && config.maxReusesPerConnection < 1) {
      throw new Error('maxReusesPerConnection must be at least 1');
    }

    if (config.staleCheckInterval !== undefined && config.staleCheckInterval < 1000) {
      throw new Error('staleCheckInterval must be at least 1000ms');
    }
  }

  /**
   * Applies default values to configuration
   */
  private applyDefaults(config?: SSHConnectionPoolConfig): Required<SSHConnectionPoolConfig> {
    return {
      maxConnections: config?.maxConnections ?? 50,
      maxIdleTime: config?.maxIdleTime ?? 5 * 60 * 1000, // 5 minutes
      maxConnectionAge: config?.maxConnectionAge ?? 60 * 60 * 1000, // 1 hour
      maxReusesPerConnection: config?.maxReusesPerConnection ?? 100,
      staleCheckInterval: config?.staleCheckInterval ?? 30 * 1000, // 30 seconds
      enableCredentialCaching: config?.enableCredentialCaching ?? true,
    };
  }

  /**
   * Creates a unique cache key for a connection configuration
   */
  private generateCacheKey(options: GetConnectionOptions): string {
    const keyComponents = [
      options.host,
      String(options.port),
      options.username,
      this.hashCredentials(options.password, options.privateKey),
    ];
    return keyComponents.join(':');
  }

  /**
   * Creates a hash of credentials for caching/comparison
   */
   private hashCredentials(password?: string, privateKey?: string): string {
     if (!this.config.enableCredentialCaching) {
       return `${Math.random()}`;
     }

     const credentialString = `${password || ''}:${privateKey || ''}`;
     return createHash('sha256').update(credentialString).digest('hex');
   }

  /**
   * Checks if a connection can be reused
   */
  private canReuseConnection(connection: PooledSSHConnection): boolean {
    const now = Date.now();

    // Cannot reuse if currently in use
    if (connection.inUse) {
      return false;
    }

    // Cannot reuse if disconnected or errored
    if (connection.state !== 'idle' && connection.state !== 'connected') {
      return false;
    }

    // Cannot reuse if idle too long
    if (now - connection.lastUsed > this.config.maxIdleTime) {
      return false;
    }

    // Cannot reuse if too old
    if (now - connection.createdAt > this.config.maxConnectionAge) {
      return false;
    }

    // Cannot reuse if exceeded max reuses
    if (connection.useCount >= this.config.maxReusesPerConnection) {
      return false;
    }

    return true;
  }

  /**
   * Creates a new SSH connection
   */
  private async createConnection(
    options: GetConnectionOptions,
    cacheKey: string
  ): Promise<PooledSSHConnection> {
    const connectionId = randomUUID();
    const credentialHash = this.hashCredentials(options.password, options.privateKey);

    // In a real implementation, this would actually establish an SSH connection
    // For now, we create the metadata structure
    const connection: PooledSSHConnection = {
      connectionId,
      host: options.host,
      port: options.port,
      username: options.username,
      state: 'connected',
      createdAt: Date.now(),
      lastUsed: Date.now(),
      useCount: 0,
      credentialHash,
      inUse: true,
      connection: null, // Placeholder for actual SSH connection object
    };

    this.connectionCache.set(cacheKey, connection);

    // Cache credentials if enabled (with short TTL)
    if (this.config.enableCredentialCaching) {
      this.credentialCache.set(credentialHash, {
        hash: credentialHash,
        expiresAt: Date.now() + 3600000, // 1 hour TTL
      });
    }

    return connection;
  }

  /**
   * Starts the interval timer for checking stale connections
   */
  private startStaleCheckInterval(): void {
    if (this.staleCheckTimer) {
      clearInterval(this.staleCheckTimer);
    }

    this.staleCheckTimer = setInterval(async () => {
      try {
        await this.pruneStaleConnections();
      } catch (error) {
        logger.error('Error during stale connection pruning', {
          component: 'SSHConnectionPool',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, this.config.staleCheckInterval);

    // Don't keep the process alive just for this interval
    if (this.staleCheckTimer.unref) {
      this.staleCheckTimer.unref();
    }
  }
}

/**
 * Creates a singleton instance of the SSH Connection Pool with default configuration
 * @returns The global SSHConnectionPool instance
 *
 * @example
 * ```typescript
 * const pool = getGlobalSSHConnectionPool();
 * const conn = await pool.getConnection({...});
 * ```
 */
let globalPool: SSHConnectionPool | undefined;

export function getGlobalSSHConnectionPool(
  config?: SSHConnectionPoolConfig
): SSHConnectionPool {
  if (!globalPool) {
    globalPool = new SSHConnectionPool(config);
  }
  return globalPool;
}

/**
 * Resets the global pool instance (useful for testing)
 * @internal
 */
export function resetGlobalSSHConnectionPool(): void {
  if (globalPool) {
    void globalPool.shutdown().catch((error) => {
      logger.error('Error resetting global SSH pool', {
        component: 'SSHConnectionPool',
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
  globalPool = undefined;
}
