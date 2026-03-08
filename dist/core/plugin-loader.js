import logger from './logger.js';
import { isUnifiedPlugin } from './module-system/module-types.js';
export class PluginLoader {
    constructor(server, config, managers, moduleManager) {
        this.onModuleLoaded = this.handleModuleLoaded.bind(this);
        this.onModuleUnloaded = this.handleModuleUnloaded.bind(this);
        this.server = server;
        this.config = config;
        this.managers = managers;
        this.moduleManager = moduleManager;
    }
    async start() {
        logger.info('PluginLoader: Starting. Registering for module events from ModuleManager.');
        this.moduleManager.on('moduleLoaded', this.onModuleLoaded);
        this.moduleManager.on('moduleUnloaded', this.onModuleUnloaded);
        // Also, initialize any plugins that might have been loaded before this PluginLoader started
        for (const { moduleInstance, fullPath } of this.moduleManager.getAllLoadedModules().values()) {
            await this.handleModuleLoaded(moduleInstance, fullPath);
        }
    }
    async stop() {
        logger.info('PluginLoader: Stopping. Unloading all active plugins.');
        this.moduleManager.off('moduleLoaded', this.onModuleLoaded);
        this.moduleManager.off('moduleUnloaded', this.onModuleUnloaded);
        // For any plugins still active, call their onUnload explicitly.
        // ModuleManager will handle the core unloading, but PluginLoader ensures onUnload is called.
        for (const { moduleInstance } of this.moduleManager.getAllLoadedModules().values()) {
            if (isUnifiedPlugin(moduleInstance) && moduleInstance.onUnload) {
                try {
                    await moduleInstance.onUnload();
                    logger.debug(`PluginLoader: Plugin '${moduleInstance.manifest.name}' onUnload called during stop.`);
                }
                catch (error) {
                    logger.error(`PluginLoader: Error calling onUnload for plugin '${moduleInstance.manifest.name}': ${error}`);
                }
            }
        }
    }
    async handleModuleLoaded(module, fullPath) {
        if (isUnifiedPlugin(module)) {
            logger.info(`PluginLoader: Plugin '${module.manifest.name}' is active.`);
        }
    }
    async handleModuleUnloaded(module, fullPath) {
        if (isUnifiedPlugin(module)) {
            logger.info(`PluginLoader: ModuleManager unloaded a plugin: ${module.manifest.name}. Shutting down plugin.`);
            try {
                if (module.onUnload) {
                    await module.onUnload();
                }
                logger.info(`PluginLoader: Plugin '${module.manifest.name}' shut down.`);
            }
            catch (error) {
                logger.error(`PluginLoader: Error shutting down plugin '${module.manifest.name}': ${error}`);
                if (module.onError) {
                    await module.onError(error instanceof Error ? error : new Error(String(error)), this.moduleManager.createModuleContext());
                }
            }
        }
    }
    listPlugins() {
        return this.moduleManager.listLoadedModules()
            .filter(module => module.type === 'plugin')
            .map(module => ({
            id: module.id,
            name: module.name,
            version: module.version,
            description: module.description,
        }));
    }
}
