import { ProcessManager } from './process-manager.js';
import { TerminalManager } from './terminal-manager.js';
import { FileManager } from './file-manager.js';
import { MonitoringManager } from './monitoring-manager.js';
import { SecurityManager } from '../security/manager.js';
import { CommandHistoryManager } from './enhanced-history-manager.js';
import { McpShellConfigManager } from './shell-config-manager.js';
import { ToolCacheManager } from './tool-cache-manager.js';
import { PermissionManager } from './permission-manager.js';
// Corrected imports for the new module system loaders and manager
import { ModuleManager } from './module-system/module-manager.js';
import { ToolLoader } from './tool-loader.js';
import { PluginLoader } from './plugin-loader.js';
// Phase 1 Integration imports
import { ExecutionStrategyFactory } from './execution-strategies/index.js';
import { SSHConnectionPool } from './ssh-connection-pool.js';
import resourceMonitorInstance from './resource-monitor.js';
import { ResourceLimiter } from './resource-limiter.js';
import logger from './logger.js';
export class ServiceContainer {
    constructor(server, config) {
        this.services = new Map();
        // Phase 1 Integration: Lazy-loaded managers
        this.executionStrategyFactory = null;
        this.sshConnectionPool = null;
        this.resourceMonitor = null;
        this.resourceLimiter = null;
        this.server = server;
        this.config = config;
        this.registerAll();
    }
    registerAll() {
        // Instantiate core managers first as they are often dependencies
        const fileManager = new FileManager();
        this.services.set('fileManager', fileManager);
        const mcpShellConfigManager = new McpShellConfigManager();
        this.services.set('mcpShellConfigManager', mcpShellConfigManager);
        const processManager = new ProcessManager(this.config.processManager?.maxConcurrentProcesses ?? 50, this.config.processManager?.outputDir ?? '/tmp/mcp-shell-outputs', fileManager);
        this.services.set('processManager', processManager);
        const terminalManager = new TerminalManager();
        this.services.set('terminalManager', terminalManager);
        // Set dependency
        processManager.setTerminalManager(terminalManager);
        const commandHistoryManager = new CommandHistoryManager(mcpShellConfigManager.getEnhancedSecurityConfig());
        this.services.set('commandHistoryManager', commandHistoryManager);
        const securityManager = new SecurityManager(mcpShellConfigManager.getEnhancedSecurityConfig(), this.config.llmSecurity);
        this.services.set('securityManager', securityManager);
        const toolCacheManager = new ToolCacheManager(this.config.cache);
        this.services.set('toolCacheManager', toolCacheManager);
        const permissionManager = new PermissionManager(this.config);
        this.services.set('permissionManager', permissionManager);
        const monitoringManager = new MonitoringManager();
        this.services.set('monitoringManager', monitoringManager);
        // Now, instantiate the ModuleManager and the module loaders, as they depend on the core managers
        // It's crucial to pass a *partial* managers object to ModuleManager to avoid circular dependencies
        // or to initialize moduleManager first and then update the managers object.
        // For now, let's pass a set of managers and then update the main managers object for the loaders.
        // Temporarily create a partial managers object for ModuleManager's constructor
        const partialManagers = {
            processManager, terminalManager, fileManager, monitoringManager,
            securityManager, commandHistoryManager, mcpShellConfigManager,
            toolCacheManager, permissionManager
        };
        const moduleManager = new ModuleManager(this.server, this.config, partialManagers, // Cast as ManagerInstances, will be fully populated later
        toolCacheManager, permissionManager, monitoringManager);
        this.services.set('moduleManager', moduleManager);
        // Now instantiate the loaders, passing the moduleManager
        const toolLoader = new ToolLoader(this.server, this.config, moduleManager);
        this.services.set('toolLoader', toolLoader);
        // Reconstruct the full managers object before passing to PluginLoader
        const fullManagers = {
            ...partialManagers,
            moduleManager,
            toolLoader,
            pluginLoader: null, // Placeholder, will be set next
        };
        const pluginLoader = new PluginLoader(this.server, this.config, fullManagers, moduleManager);
        this.services.set('pluginLoader', pluginLoader);
        fullManagers.pluginLoader = pluginLoader; // Update fullManagers reference
        // Set tool managers for monitoring after all are instantiated
        monitoringManager.setToolManagers(toolLoader, toolCacheManager);
        // Phase 1 Integration: Initialize Resource Monitor if enabled in config
        this.initializeResourceMonitor();
    }
    get(name) {
        const service = this.services.get(name);
        if (!service) {
            throw new Error(`Service '${name}' not found.`);
        }
        return service;
    }
    getAllManagers() {
        // This method now dynamically retrieves from the services map, ensuring all are instantiated
        // The previous explicit return was problematic if services were not fully set up.
        return {
            processManager: this.get('processManager'),
            terminalManager: this.get('terminalManager'),
            fileManager: this.get('fileManager'),
            monitoringManager: this.get('monitoringManager'),
            securityManager: this.get('securityManager'),
            commandHistoryManager: this.get('commandHistoryManager'),
            mcpShellConfigManager: this.get('mcpShellConfigManager'),
            toolCacheManager: this.get('toolCacheManager'),
            permissionManager: this.get('permissionManager'),
            moduleManager: this.get('moduleManager'),
            toolLoader: this.get('toolLoader'),
            pluginLoader: this.get('pluginLoader'),
        };
    }
    // Phase 1 Integration: New getters for lazy-loaded managers
    /**
     * Get the ExecutionStrategyFactory singleton
     * Lazy-loaded on first access with configuration from infected.config.json
     */
    getExecutionStrategyFactory() {
        if (this.executionStrategyFactory === null) {
            const factoryConfig = {
                defaultTimeoutMs: this.config.execution?.defaultTimeoutMs ?? 300000,
                defaultKillGracePeriodMs: this.config.execution?.defaultKillGracePeriodMs ?? 5000,
            };
            this.executionStrategyFactory = new ExecutionStrategyFactory(factoryConfig);
            logger.debug('ExecutionStrategyFactory initialized', { component: 'ServiceContainer' });
        }
        return this.executionStrategyFactory;
    }
    /**
     * Get the SSHConnectionPool singleton
     * Lazy-loaded on first access with configuration from infected.config.json
     */
    getSSHConnectionPool() {
        if (this.sshConnectionPool === null) {
            const poolConfig = {
                maxConnections: this.config.sshConnectionPool?.maxConnections ?? 50,
                maxIdleTime: this.config.sshConnectionPool?.maxIdleTime ?? 5 * 60 * 1000,
                maxConnectionAge: this.config.sshConnectionPool?.maxConnectionAge ?? 60 * 60 * 1000,
                maxReusesPerConnection: this.config.sshConnectionPool?.maxReusesPerConnection ?? 100,
                staleCheckInterval: this.config.sshConnectionPool?.staleCheckInterval ?? 30 * 1000,
                enableCredentialCaching: this.config.sshConnectionPool?.enableCredentialCaching ?? true,
            };
            this.sshConnectionPool = new SSHConnectionPool(poolConfig);
            logger.debug('SSHConnectionPool initialized', { component: 'ServiceContainer' });
        }
        return this.sshConnectionPool;
    }
    /**
     * Get the ResourceMonitor singleton
     * Lazy-loaded on first access with configuration from infected.config.json
     */
    getResourceMonitor() {
        if (this.resourceMonitor === null) {
            this.resourceMonitor = resourceMonitorInstance;
            const monitorConfig = {
                memoryThresholdPercent: this.config.resources?.thresholdPercent ?? 85,
                cpuThresholdPercent: this.config.resources?.cpuThresholdPercent ?? 80,
                fileHandleThresholdPercent: this.config.resources?.fileHandleThresholdPercent ?? 90,
                monitoringIntervalMs: this.config.resources?.monitoringIntervalMs ?? 5000,
            };
            this.resourceMonitor.configure(monitorConfig);
            logger.debug('ResourceMonitor initialized', { component: 'ServiceContainer' });
        }
        return this.resourceMonitor;
    }
    /**
     * Get the ResourceLimiter singleton
     * Lazy-loaded on first access with configuration from infected.config.json
     */
    getResourceLimiter() {
        if (this.resourceLimiter === null) {
            this.resourceLimiter = new ResourceLimiter();
            const limits = {
                memoryLimitMB: this.config.resources?.maxMemoryMB,
                cpuLimitPercent: this.config.resources?.maxCPUPercent,
                fileHandleLimitCount: this.config.resources?.maxFileHandles,
                connectionLimitCount: this.config.resources?.maxConnections,
            };
            if (limits.memoryLimitMB !== undefined) {
                this.resourceLimiter.setMemoryLimit(limits.memoryLimitMB);
            }
            if (limits.cpuLimitPercent !== undefined) {
                this.resourceLimiter.setCPULimit(limits.cpuLimitPercent);
            }
            if (limits.fileHandleLimitCount !== undefined) {
                this.resourceLimiter.setFileHandleLimit(limits.fileHandleLimitCount);
            }
            if (limits.connectionLimitCount !== undefined) {
                this.resourceLimiter.setConnectionLimit(limits.connectionLimitCount);
            }
            const enforcementEnabled = this.config.resources?.enableLimiting ?? true;
            this.resourceLimiter.setEnforcementEnabled(enforcementEnabled);
            logger.debug('ResourceLimiter initialized', { component: 'ServiceContainer' });
        }
        return this.resourceLimiter;
    }
    /**
     * Phase 1 Integration: Initialize ResourceMonitor if enabled in config
     * Called during bootstrap to start monitoring if configured
     */
    initializeResourceMonitor() {
        if (!this.config.resources?.enableMonitoring) {
            logger.debug('Resource monitoring disabled in config', { component: 'ServiceContainer' });
            return;
        }
        try {
            const monitor = this.getResourceMonitor();
            const interval = this.config.resources?.monitoringIntervalMs ?? 5000;
            monitor.startMonitoring(interval);
            logger.info('ResourceMonitor started during bootstrap', {
                component: 'ServiceContainer',
                interval
            });
        }
        catch (error) {
            logger.error('Failed to initialize ResourceMonitor', {
                component: 'ServiceContainer',
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
}
