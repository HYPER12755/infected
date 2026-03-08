import logger from './logger.js';
import { isUnifiedTool } from './module-system/module-types.js';
import { EventEmitter } from 'node:events'; // Import EventEmitter
export class ToolLoader extends EventEmitter {
    constructor(server, config, moduleManager) {
        super(); // Call the EventEmitter constructor
        this.deregisterFunctions = new Map(); // fullPath -> deregisterFn
        this.onModuleLoaded = this.handleModuleLoaded.bind(this);
        this.onModuleUnloaded = this.handleModuleUnloaded.bind(this);
        this.server = server;
        this.config = config;
        this.moduleManager = moduleManager;
    }
    async start() {
        logger.info('ToolLoader: Starting. Registering for module events from ModuleManager.');
        // Listen for tools being loaded and unloaded by the ModuleManager
        this.moduleManager.on('moduleLoaded', this.onModuleLoaded);
        this.moduleManager.on('moduleUnloaded', this.onModuleUnloaded);
        // Also, register any tools that might have been loaded before this ToolLoader started
        // (e.g., during initial ModuleManager scan)
        for (const { moduleInstance, fullPath } of this.moduleManager.getAllLoadedModules().values()) {
            this.handleModuleLoaded(moduleInstance, fullPath);
        }
    }
    async stop() {
        logger.info('ToolLoader: Stopping. Deregistering all tools.');
        this.moduleManager.off('moduleLoaded', this.onModuleLoaded);
        this.moduleManager.off('moduleUnloaded', this.onModuleUnloaded);
        for (const deregisterFn of this.deregisterFunctions.values()) {
            deregisterFn();
        }
        this.deregisterFunctions.clear();
    }
    handleModuleLoaded(module, fullPath) {
        if (isUnifiedTool(module)) {
            logger.info(`ToolLoader: ModuleManager loaded a tool: ${module.manifest.name}. Registering with McpServer.`);
            const deregisterFn = this.moduleManager.registerToolExecution(module.manifest.id, // Use module ID as the key for registration
            async (args) => module.execute(args, this.moduleManager.createModuleContext()), module.manifest.name, module.manifest.description, module.manifest.inputs, module.manifest.id);
            this.deregisterFunctions.set(module.manifest.id, deregisterFn);
        }
    }
    handleModuleUnloaded(module, fullPath) {
        if (isUnifiedTool(module)) {
            logger.info(`ToolLoader: ModuleManager unloaded a tool: ${module.manifest.name}. Deregistering from McpServer.`);
            const deregisterFn = this.deregisterFunctions.get(module.manifest.id);
            if (deregisterFn) {
                deregisterFn();
                this.deregisterFunctions.delete(module.manifest.id);
            }
        }
    }
    listTools() {
        return this.moduleManager.listLoadedModules()
            .filter(module => module.type === 'tool')
            .map(module => ({
            id: module.id,
            name: module.name,
            description: module.description,
            parameters: module.inputs,
        }));
    }
}
