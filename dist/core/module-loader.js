import { fileURLToPath } from 'url';
import { dirname } from 'path';
import * as path from 'node:path';
import * as fsPromises from 'node:fs/promises';
import * as fs from 'node:fs';
import logger from './logger.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export class ModuleManager {
    constructor(server, config, managers) {
        this.loadedModules = new Map();
        this.server = server;
        this.config = config;
        this.managers = managers;
        const currentModuleDir = __dirname;
        this.moduleRootPath = path.resolve(currentModuleDir, '../modules');
    }
    setConfig(config) {
        this.config = config;
    }
    // New: Enable a module
    async enableModule(moduleName) {
        if (!this.config.modules.includes(moduleName)) {
            this.config.modules.push(moduleName); // Modify in-memory config
            logger.info(`ModuleManager: Enabled module '${moduleName}'. (Note: This change is not persistent across server restarts.)`);
            await this.loadModule(moduleName);
        }
        else {
            logger.warn(`ModuleManager: Module '${moduleName}' is already enabled.`);
        }
    }
    // New: Disable a module
    async disableModule(moduleName) {
        if (this.config.modules.includes(moduleName)) {
            this.config.modules = this.config.modules.filter(name => name !== moduleName); // Modify in-memory config
            logger.info(`ModuleManager: Disabled module '${moduleName}'. (Note: This change is not persistent across server restarts.)`);
            await this.unloadModule(moduleName);
        }
        else {
            logger.warn(`ModuleManager: Module '${moduleName}' is already disabled.`);
        }
    }
    async reloadModule(moduleName) {
        await this.unloadModule(moduleName);
        await this.loadModule(moduleName);
        logger.info(`ModuleManager: Reloaded module '${moduleName}'.`);
    }
    async startWatching() {
        await this.initialLoadModules();
        this.setupWatcher();
    }
    async initialLoadModules() {
        logger.info('Loading modules...');
        for (const moduleName of this.config.modules) {
            await this.loadModule(moduleName);
        }
        logger.info('All modules processed.');
    }
    setupWatcher() {
        if (!this.config.hotReload) {
            logger.info('Hot-reloading for modules is disabled.');
            return;
        }
        try {
            this.watcher = fs.watch(this.moduleRootPath, { recursive: true }, (eventType, filename) => {
                if (filename) {
                    const moduleNameMatch = filename.match(/^([^/]+)/);
                    const moduleName = moduleNameMatch ? moduleNameMatch[1] : null;
                    if (moduleName && this.config.modules.includes(moduleName)) {
                        const fullPath = path.join(this.moduleRootPath, filename);
                        setTimeout(() => this.handleFileChange(moduleName, eventType, fullPath), 100);
                    }
                }
            });
            logger.info(`Watching for module changes in ${this.moduleRootPath}...`);
        }
        catch (error) {
            logger.error(`Failed to set up watcher for module directory: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async handleFileChange(moduleName, eventType, fullPath) {
        if (!(fullPath.endsWith('.ts') || fullPath.endsWith('.js'))) {
            return;
        }
        const loadedModule = this.loadedModules.get(moduleName);
        switch (eventType) {
            case 'change':
                if (loadedModule) {
                    logger.info(`Module file changed: ${fullPath}. Reloading module '${moduleName}'.`);
                    await this.reloadModule(moduleName);
                }
                else {
                    logger.info(`New or unknown module file changed: ${fullPath}. Attempting to load.`);
                    await this.loadModule(moduleName);
                }
                break;
            case 'rename':
                try {
                    await fsPromises.access(fullPath);
                    if (!loadedModule) {
                        logger.info(`New module file detected: ${fullPath}. Loading module '${moduleName}'.`);
                        await this.loadModule(moduleName);
                    }
                    else {
                        logger.info(`Module file renamed or recreated: ${fullPath}. Reloading module '${moduleName}'.`);
                        await this.reloadModule(moduleName);
                    }
                }
                catch (error) {
                    if (error.code === 'ENOENT') {
                        if (loadedModule) {
                            logger.info(`Module file deleted: ${fullPath}. Unloading module '${moduleName}'.`);
                            await this.unloadModule(moduleName);
                        }
                    }
                    else {
                        logger.error(`Error accessing file ${fullPath} after rename event: ${error instanceof Error ? error.message : String(error)}`);
                    }
                }
                break;
            default:
                logger.debug(`Unhandled file event type: ${eventType} for ${fullPath}`);
        }
    }
    invalidateRequireCache(filePath) {
    }
    async loadModule(moduleName) {
        const moduleFilePath = path.join(this.moduleRootPath, moduleName, 'index.js');
        this.invalidateRequireCache(moduleFilePath);
        try {
            const { default: ModuleClass } = await import(`${moduleFilePath}?update=${Date.now()}`);
            const moduleInstance = new ModuleClass();
            if (this.loadedModules.has(moduleName)) {
                await this.unloadModule(moduleName);
            }
            await moduleInstance.register(this.server, this.config, this.managers);
            this.loadedModules.set(moduleName, { filePath: moduleFilePath, instance: moduleInstance });
            logger.info(`  Module '${moduleName}' loaded and registered from ${moduleFilePath}.`);
        }
        catch (error) {
            logger.error(`  Failed to load module '${moduleName}' from ${moduleFilePath}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async unloadModule(moduleName) {
        const loadedModule = this.loadedModules.get(moduleName);
        if (loadedModule) {
            if (loadedModule.instance.shutdown) {
                logger.info(`  Shutting down module '${moduleName}'.`);
                await loadedModule.instance.shutdown();
            }
            this.loadedModules.delete(moduleName);
            logger.info(`  Module '${moduleName}' unloaded.`);
        }
        else {
            logger.warn(`  Attempted to unload unknown module '${moduleName}'.`);
        }
    }
    stopWatching() {
        if (this.watcher) {
            this.watcher.close();
            logger.info(`Stopped watching for module changes in ${this.moduleRootPath}.`);
            this.watcher = undefined;
        }
    }
    listModules() {
        return Array.from(this.loadedModules.entries()).map(([name, moduleData]) => ({
            name,
            isLoaded: true, // If it's in loadedModules, it's loaded
            filePath: moduleData.filePath,
        }));
    }
}
