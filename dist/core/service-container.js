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
export class ServiceContainer {
    constructor(server, config) {
        this.services = new Map();
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
}
