import logger from '../../core/logger.js';
import { SSHConnectionPool, } from '../../core/ssh-connection-pool.js';
/**
 * SSHConnectionPoolWrapper wraps the global SSHConnectionPool
 * - Creates and manages actual SSH connections
 * - Adapter between pool and SSH module
 * - Tracks connection lifecycle
 */
export class SSHConnectionPoolWrapper {
    constructor(config) {
        this.connectionMap = new Map();
        this.config = config || {};
        this.pool = new SSHConnectionPool(this.config);
        logger.info('SSH Connection Pool Wrapper initialized', {
            component: 'SSHConnectionPoolWrapper',
            maxConnections: this.config.maxConnections || 50,
        });
    }
    /**
     * Gets or creates an SSH connection from the pool
     */
    async getSSHConnection(options) {
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
            const sshConn = {
                host: pooledConn.host,
                port: pooledConn.port,
                username: pooledConn.username,
                connectionId: pooledConn.connectionId,
            };
            // Track the connection
            this.connectionMap.set(pooledConn.connectionId, sshConn);
            logger.debug('SSH connection acquired from pool', {
                component: 'SSHConnectionPoolWrapper',
                connectionId: pooledConn.connectionId,
                host: options.host,
                port: options.port,
                username: options.username,
            });
            return sshConn;
        }
        catch (error) {
            logger.error('Failed to get SSH connection from pool', {
                component: 'SSHConnectionPoolWrapper',
                host: options.host,
                port: options.port,
                username: options.username,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
    /**
     * Releases an SSH connection back to the pool
     */
    releaseSSHConnection(connectionId) {
        try {
            this.pool.releaseConnection(connectionId);
            this.connectionMap.delete(connectionId);
            logger.debug('SSH connection released to pool', {
                component: 'SSHConnectionPoolWrapper',
                connectionId,
            });
        }
        catch (error) {
            logger.error('Error releasing SSH connection', {
                component: 'SSHConnectionPoolWrapper',
                connectionId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    /**
     * Gets pool statistics
     */
    getPoolStats() {
        return this.pool.getConnectionStats();
    }
    /**
     * Gets information about tracked connections
     */
    getTrackedConnections() {
        return Array.from(this.connectionMap.values());
    }
    /**
     * Gets connection by ID
     */
    getConnection(connectionId) {
        return this.connectionMap.get(connectionId);
    }
    /**
     * Gracefully shuts down the pool
     */
    async shutdown() {
        try {
            this.connectionMap.clear();
            await this.pool.shutdown();
            logger.info('SSH Connection Pool Wrapper shutdown complete', {
                component: 'SSHConnectionPoolWrapper',
            });
        }
        catch (error) {
            logger.error('Error shutting down SSH Connection Pool Wrapper', {
                component: 'SSHConnectionPoolWrapper',
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
}
