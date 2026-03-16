import logger from '../../core/logger.js';
import { LoggingContext } from '../../core/logging/logging-context.js';
import { CorrelationContext } from '../../core/logging/correlation-context.js';
import { RetryStrategy } from '../../core/recovery/retry-strategy.js';
import { CircuitBreaker } from '../../core/recovery/circuit-breaker.js';
import { SSHError } from '../../core/error-system/error-categories.js';
import { SSHErrorCode, NetworkErrorCode, ErrorSeverity } from '../../core/error-system/error-taxonomy.js';
import { NetworkError } from '../../core/error-system/error-categories.js';
import {
  SSHConnectionPool,
  type SSHConnectionPoolConfig,
  type PoolStats,
  type GetConnectionOptions,
} from '../../core/ssh-connection-pool.js';

/**
 * Information about an SSH connection
 */
export interface SSHConnection {
  host: string;
  port: number;
  username: string;
  connectionId: string;
}

/**
 * Options for getting an SSH connection
 */
export interface GetSSHConnectionOptions {
  host: string;
  port: number;
  username: string;
  password?: string;
  identityFile?: string;
  timeout?: number;
}

/**
 * SSHConnectionPoolWrapper wraps the global SSHConnectionPool
 * - Creates and manages actual SSH connections
 * - Adapter between pool and SSH module
 * - Tracks connection lifecycle
 */
export class SSHConnectionPoolWrapper {
  private hostCircuitBreakers = new Map<string, CircuitBreaker>();
  private connectionAcquisitionRetry = new RetryStrategy({
    maxAttempts: 3,
    initialDelayMs: 100,
    maxDelayMs: 2000,
    useJitter: true
  });

  private getHostCircuitBreaker(host: string): CircuitBreaker {
    const key = host;
    if (!this.hostCircuitBreakers.has(key)) {
      this.hostCircuitBreakers.set(key, new CircuitBreaker({
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 30000,
        windowSize: 60000
      }));
    }
    return this.hostCircuitBreakers.get(key)!;
  }
  private pool: SSHConnectionPool;
  private connectionMap = new Map<string, SSHConnection>();
  private config: SSHConnectionPoolConfig;
  private loggingContext: LoggingContext;

  constructor(config?: SSHConnectionPoolConfig) {
    this.config = config || {};
    this.pool = new SSHConnectionPool(this.config);
    this.loggingContext = new LoggingContext();

    const context = CorrelationContext.generate();
    CorrelationContext.run(context, () => {
      this.loggingContext.info('SSH Connection Pool Wrapper initialized', {
        maxConnections: this.config.maxConnections || 50,
      });
    });
  }

  /**
   * Gets or creates an SSH connection from the pool
   */
  async getSSHConnection(options: GetSSHConnectionOptions): Promise<SSHConnection> {
    const context = CorrelationContext.generate();
    
    return CorrelationContext.runAsync(context, async () => {
      try {
        // Get connection from pool
        const pooledConn = await this.pool.getConnection({
          host: options.host,
          port: options.port,
          username: options.username,
          password: options.password,
          privateKey: options.identityFile,
          timeout: options.timeout,
        });

        const sshConn: SSHConnection = {
          host: pooledConn.host,
          port: pooledConn.port,
          username: pooledConn.username,
          connectionId: pooledConn.connectionId,
        };

        // Track the connection
        this.connectionMap.set(pooledConn.connectionId, sshConn);

        const poolStats = this.pool.getConnectionStats();
        this.loggingContext.debug('SSH connection acquired from pool', {
          connectionId: pooledConn.connectionId,
          host: options.host,
          port: options.port,
          username: options.username,
          activeConnections: poolStats.activeConnections,
          idleConnections: poolStats.idleConnections,
        });

        return sshConn;
      } catch (error) {
        this.loggingContext.error('Failed to get SSH connection from pool', {
          host: options.host,
          port: options.port,
          username: options.username,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    });
  }

  /**
   * Releases an SSH connection back to the pool
   */
  releaseSSHConnection(connectionId: string): void {
    const context = CorrelationContext.generate();
    
    CorrelationContext.run(context, () => {
      try {
        this.pool.releaseConnection(connectionId);
        this.connectionMap.delete(connectionId);

         const poolStats = this.pool.getConnectionStats();
         this.loggingContext.debug('SSH connection released to pool', {
           connectionId,
           activeConnections: poolStats.activeConnections,
           idleConnections: poolStats.idleConnections,
         });
      } catch (error) {
        this.loggingContext.error('Error releasing SSH connection', {
          connectionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  /**
   * Gets pool statistics
   */
  getPoolStats(): PoolStats {
    return this.pool.getConnectionStats();
  }

  /**
   * Gets information about tracked connections
   */
  getTrackedConnections(): SSHConnection[] {
    return Array.from(this.connectionMap.values());
  }

  /**
   * Gets connection by ID
   */
  getConnection(connectionId: string): SSHConnection | undefined {
    return this.connectionMap.get(connectionId);
  }

  /**
   * Gracefully shuts down the pool
   */
  async shutdown(): Promise<void> {
    const context = CorrelationContext.generate();
    
    return CorrelationContext.runAsync(context, async () => {
      try {
        this.connectionMap.clear();
        await this.pool.shutdown();

        this.loggingContext.info('SSH Connection Pool Wrapper shutdown complete');
      } catch (error) {
        this.loggingContext.error('Error shutting down SSH Connection Pool Wrapper', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    });
  }
}
