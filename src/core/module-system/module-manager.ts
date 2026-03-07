import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InfectedConfig, getInstallRoot, getRuntimeMode, getWorkspaceRoot } from '../../config/index.js';
import logger from '../logger.js';
import * as path from 'node:path';
import * as url from 'node:url';
import * as fs from 'node:fs';
import { ManagerInstances } from '../../types/index.js'; // The updated ManagerInstances
import {
  IUnifiedModule,
  UnifiedModuleContext,
  UnifiedModuleManifest,
  UnifiedModuleManifestSchema,
  ModuleType,
} from './module-types.js';
import { ModuleWatcher } from './module-watcher.js';
import { ToolCacheManager } from '../tool-cache-manager.js';
import { PermissionManager } from '../permission-manager.js';
import { MonitoringManager } from '../monitoring-manager.js';
import { SecurityError } from '../../utils/shell-errors.js';
import { hrtime } from 'node:process';
import { z } from 'zod';
import { EventEmitter } from 'node:events'; // Import EventEmitter

interface LegacyModuleLike {
  name?: string;
  register: (server: McpServer, config: InfectedConfig, managers: ManagerInstances) => Promise<void> | void;
  shutdown?: () => Promise<void> | void;
}

export class ModuleManager extends EventEmitter {
  private server: McpServer;
  private config: InfectedConfig;
  private managers: ManagerInstances;
  private moduleWatcher: ModuleWatcher;
  // Use module ID as key for loadedModules to prevent duplicates and easier access
  private loadedModules: Map<string, { moduleInstance: IUnifiedModule; fullPath: string }> = new Map();
  private loadingModules: Set<string> = new Set(); // To prevent re-entry during hot reload cycles
  private deregisterFunctions: Map<string, RegisteredTool> = new Map(); // K: toolId, V: registered tool metadata
  
  private toolCacheManager: ToolCacheManager;
  private permissionManager: PermissionManager;
  private monitoringManager: MonitoringManager;
  private workspaceRoot: string;
  private installRoot: string;
  private runtimeMode: 'development' | 'production';

  private resolveConfiguredDir(root: string, configuredPath: string | undefined, defaultDirName: string): string {
    const candidate = configuredPath && configuredPath.trim().length > 0 ? configuredPath.trim() : `./${defaultDirName}`;
    return path.isAbsolute(candidate)
      ? path.resolve(candidate)
      : path.resolve(root, candidate);
  }

  private isInstallPath(moduleDirPath: string): boolean {
    const normalizedInstallRoot = path.resolve(this.installRoot) + path.sep;
    const normalizedModuleDir = path.resolve(moduleDirPath);
    return normalizedModuleDir.startsWith(normalizedInstallRoot);
  }

  constructor(server: McpServer, config: InfectedConfig, managers: ManagerInstances, toolCacheManager: ToolCacheManager, permissionManager: PermissionManager, monitoringManager: MonitoringManager) {
    super(); // Call EventEmitter constructor
    this.server = server;
    this.config = config;
    this.managers = managers; // Pass all managers here
    this.toolCacheManager = toolCacheManager;
    this.permissionManager = permissionManager;
    this.monitoringManager = monitoringManager;
    this.workspaceRoot = getWorkspaceRoot();
    this.installRoot = getInstallRoot();
    this.runtimeMode = getRuntimeMode();
    const isProductionRuntime = this.runtimeMode === 'production';

    const workspaceToolsDir = this.resolveConfiguredDir(this.workspaceRoot, this.config.toolsDir, 'tools');
    const installToolsDir = this.resolveConfiguredDir(this.installRoot, this.config.toolsDir, 'tools');
    const workspacePluginsDir = this.resolveConfiguredDir(this.workspaceRoot, this.config.pluginsDir, 'plugins');
    const installPluginsDir = this.resolveConfiguredDir(this.installRoot, this.config.pluginsDir, 'plugins');
    const workspaceSrcModulesDir = path.resolve(this.workspaceRoot, 'src/modules');
    const workspaceDistModulesDir = path.resolve(this.workspaceRoot, 'dist/modules');
    const installSrcModulesDir = path.resolve(this.installRoot, 'src/modules');
    const installDistModulesDir = path.resolve(this.installRoot, 'dist/modules');
    const candidateWatchDirs = isProductionRuntime
      ? Array.from(new Set([
          installToolsDir,
          installPluginsDir,
          installDistModulesDir,
        ]))
      : Array.from(new Set([
          workspaceToolsDir,
          installToolsDir,
          workspacePluginsDir,
          installPluginsDir,
          workspaceSrcModulesDir,
          installSrcModulesDir,
        ]));
    const directoriesToWatch = candidateWatchDirs.filter((dirPath) => {
      try {
        fs.accessSync(dirPath, fs.constants.R_OK);
        return true;
      } catch {
        return false;
      }
    });

    this.moduleWatcher = new ModuleWatcher(directoriesToWatch);
    this.setupListeners();
  }

  private setupListeners(): void {
    // Only listen for changes to files directly within a module directory
    this.moduleWatcher.on('moduleAdded', this.handleFileChange.bind(this, 'added'));
    this.moduleWatcher.on('moduleChanged', this.handleFileChange.bind(this, 'changed'));
    this.moduleWatcher.on('moduleRemoved', this.handleFileChange.bind(this, 'removed'));
  }

  public async start(): Promise<void> {
    logger.info('Starting ModuleManager...');
    await this.moduleWatcher.start();
    // Initial scan and load for all modules that exist before watching starts
    await this.initialScanAndLoad();
    logger.info('ModuleManager started.');
  }

  public async stop(): Promise<void> {
    logger.info('Stopping ModuleManager...');
    await this.moduleWatcher.close();
    await this.unloadAllModules();
    logger.info('ModuleManager stopped.');
  }

  private async initialScanAndLoad(): Promise<void> {
    const moduleDirsToProcess = new Set<string>();
    const addDirIfReadable = (dirPath: string) => {
      try {
        fs.accessSync(dirPath, fs.constants.R_OK);
        moduleDirsToProcess.add(dirPath);
      } catch {
        // Skip non-existent or inaccessible directories during initial scan
      }
    };
    const firstReadableDir = (candidates: string[]): string | null => {
      for (const dirPath of candidates) {
        try {
          fs.accessSync(dirPath, fs.constants.R_OK);
          return dirPath;
        } catch {
          // try next candidate
        }
      }
      return null;
    };

    for (const watchDir of this.moduleWatcher['directoriesToWatch']) {
        try {
            const dirents = await fs.promises.readdir(watchDir, { withFileTypes: true });
            for (const dirent of dirents) {
                if (dirent.isDirectory()) {
                    moduleDirsToProcess.add(path.join(watchDir, dirent.name));
                }
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                logger.error(`Error scanning initial module directory ${watchDir}: ${error}`);
            }
        }
    }

    for (const moduleName of this.config.modules || []) {
      if (this.runtimeMode === 'development') {
        const preferredDevModuleDir = firstReadableDir([
          path.resolve(this.workspaceRoot, 'src/modules', moduleName),
          path.resolve(this.installRoot, 'src/modules', moduleName),
          path.resolve(this.workspaceRoot, 'dist/modules', moduleName),
          path.resolve(this.installRoot, 'dist/modules', moduleName),
        ]);
        if (preferredDevModuleDir) {
          moduleDirsToProcess.add(preferredDevModuleDir);
        }
      } else {
        addDirIfReadable(path.resolve(this.installRoot, 'dist/modules', moduleName));
      }
    }

    logger.info(`ModuleManager: Performing initial load of ${moduleDirsToProcess.size} potential module directories...`);
    await Promise.all(Array.from(moduleDirsToProcess).map(dirPath => this.loadModuleFromDirectory(dirPath)));
    logger.info('ModuleManager: Initial module load complete.');
  }

  // Refined file change handler to process changes at a module directory level
  private async handleFileChange(eventType: 'added' | 'changed' | 'removed', fullPath: string): Promise<void> {
    // Determine the root watch directory this file belongs to
    const rootWatchDir = this.moduleWatcher['directoriesToWatch'].find(dir => fullPath.startsWith(dir));
    if (!rootWatchDir) {
        logger.debug(`File change in ${fullPath} not within a watched module root. Skipping.`);
        return;
    }

    const moduleIdentifier = this.resolveModuleRootFromFile(fullPath, rootWatchDir);
    if (!moduleIdentifier) {
        logger.debug(`ModuleManager: Could not resolve module root for ${fullPath}. Skipping.`);
        return;
    }

    if (this.loadingModules.has(moduleIdentifier)) {
        logger.debug(`ModuleManager: Module directory ${moduleIdentifier} is currently being processed. Skipping redundant event for ${fullPath}.`);
        return;
    }

    this.loadingModules.add(moduleIdentifier);
    try {
        if (eventType === 'removed') {
            logger.info(`ModuleManager: Detected file removal in module directory: ${moduleIdentifier}. Attempting to unload.`);
            await this.unloadModuleFromDirectory(moduleIdentifier);
        } else if (eventType === 'changed' || eventType === 'added') {
            logger.info(`ModuleManager: Detected file change/add in module directory: ${moduleIdentifier}. Attempting to reload/load.`);
            await this.reloadModuleFromDirectory(moduleIdentifier);
        }
    } finally {
        this.loadingModules.delete(moduleIdentifier);
    }
  }

  private resolveModuleRootFromFile(fullPath: string, rootWatchDir: string): string | undefined {
    let bestMatch: string | undefined;
    let bestMatchLength = 0;

    for (const moduleInfo of this.loadedModules.values()) {
      const modulePath = moduleInfo.fullPath;
      if (fullPath === modulePath || fullPath.startsWith(modulePath + path.sep)) {
        if (modulePath.length > bestMatchLength) {
          bestMatchLength = modulePath.length;
          bestMatch = modulePath;
        }
      }
    }

    if (bestMatch) {
      return bestMatch;
    }

    const relative = path.relative(rootWatchDir, fullPath);
    if (!relative || relative.startsWith('..')) {
      return rootWatchDir;
    }
    const segments = relative.split(path.sep).filter(Boolean);
    if (segments.length === 0) {
      return rootWatchDir;
    }

    return path.join(rootWatchDir, segments[0]);
  }


  private getModuleTypeFromPath(fullPath: string): ModuleType | null {
    let relativePath = path.relative(process.cwd(), fullPath);
    if (path.sep === '\\') {
      relativePath = relativePath.replace(/\\/g, '/');
    }
    if (relativePath.startsWith((this.config.toolsDir || 'tools') + path.sep) || fullPath.includes('tools/')) {
      return 'tool';
    }
    if (relativePath.startsWith('dist/tools' + path.sep) || fullPath.includes(`${path.sep}dist${path.sep}tools${path.sep}`)) {
      return 'tool';
    }
    if (relativePath.startsWith((this.config.pluginsDir || 'plugins') + path.sep) || fullPath.includes('plugins/')) {
      return 'plugin';
    }
    if (relativePath.startsWith('dist/plugins' + path.sep) || fullPath.includes(`${path.sep}dist${path.sep}plugins${path.sep}`)) {
      return 'plugin';
    }
    return null;
  }

  private invalidateModuleCache(filePath: string): void {
    // For ESM, appending a unique query parameter to the import path handles invalidation.
  }

  public createModuleContext(): UnifiedModuleContext {
    return {
      server: this.server,
      config: this.config,
      managers: this.managers,
      logger,
      moduleManager: this,
    };
  }

  private isLegacyModule(moduleCandidate: any): moduleCandidate is LegacyModuleLike {
    return !!moduleCandidate && typeof moduleCandidate.register === 'function';
  }

  private createLegacyModuleAdapter(moduleDirPath: string, legacyModule: LegacyModuleLike): IUnifiedModule {
    const inferredName = legacyModule.name || path.basename(moduleDirPath);
    const inferredId = `module.${inferredName}`;
    const inferredVersion = '1.0.0';

    return {
      manifest: {
        id: inferredId,
        name: inferredName,
        version: inferredVersion,
        type: 'plugin',
        entry: path.basename(moduleDirPath),
        description: `Legacy module adapter for ${inferredName}`,
      },
      onLoad: async (context: UnifiedModuleContext) => {
        await legacyModule.register(context.server, context.config, context.managers);
      },
      onUnload: legacyModule.shutdown
        ? async () => {
            await legacyModule.shutdown?.();
          }
        : undefined,
      onError: async (error: Error, context: UnifiedModuleContext) => {
        context.logger.error(`Legacy module '${inferredName}' failed: ${error.message}`, { error });
      },
    };
  }

  // New method to load a module given its directory path
  public async loadModuleFromDirectory(moduleDirPath: string): Promise<void> {
    if (this.loadingModules.has(moduleDirPath)) {
      logger.warn(`ModuleManager: Module directory ${moduleDirPath} is already being processed. Skipping redundant request.`);
      return;
    }

    // Check if a module with this ID (derived from path) is already loaded to prevent duplicates
    // This requires that each module in a directory has a unique ID, usually from its manifest
    // For now, let's rely on the moduleDirPath as the unique identifier until a module ID is extracted
    if (Array.from(this.loadedModules.values()).some(m => m.fullPath === moduleDirPath)) {
        logger.debug(`ModuleManager: Module from directory ${moduleDirPath} is already loaded. Skipping.`);
        return;
    }

    this.loadingModules.add(moduleDirPath);
    this.invalidateModuleCache(moduleDirPath); // Invalidate cache for the whole directory

    let manifest: UnifiedModuleManifest | null = null;
    let moduleEntryFile: string | null = null;
    const manifestPath = path.join(moduleDirPath, 'module.json');
    
    // 1. Try to load manifest from module.json
    try {
      const manifestContent = await fs.promises.readFile(manifestPath, 'utf-8');
      const parsedManifest = UnifiedModuleManifestSchema.safeParse(JSON.parse(manifestContent));
      if (parsedManifest.success) {
        manifest = parsedManifest.data;
        if (manifest.entry) {
            moduleEntryFile = path.resolve(moduleDirPath, manifest.entry);
        } else {
            // Default entry if not specified in manifest
            moduleEntryFile = path.join(moduleDirPath, 'index.js'); // Assuming .js after transpile
            try { await fs.promises.access(moduleEntryFile); } catch { moduleEntryFile = path.join(moduleDirPath, 'index.ts'); }
            try { await fs.promises.access(moduleEntryFile); } catch { moduleEntryFile = null; }
        }
      } else {
        logger.warn(`ModuleManager: Invalid module.json in ${manifestPath}: ${parsedManifest.error.errors.map(e => e.message).join(', ')}`);
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        logger.warn(`ModuleManager: Error reading module.json for ${moduleDirPath}: ${error.message}`);
      }
    }

    // 2. If no valid module.json or entry found, try to infer from index.ts/js
    if (!moduleEntryFile) {
        const potentialEntryJs = path.join(moduleDirPath, 'index.js');
        const potentialEntryTs = path.join(moduleDirPath, 'index.ts');
        const preferJs = this.runtimeMode === 'production' && this.isInstallPath(moduleDirPath);
        try {
            if (preferJs) {
              await fs.promises.access(potentialEntryJs);
              moduleEntryFile = potentialEntryJs;
            } else {
              await fs.promises.access(potentialEntryTs);
              moduleEntryFile = potentialEntryTs;
            }
        } catch {
            try {
                if (preferJs) {
                  await fs.promises.access(potentialEntryTs);
                  moduleEntryFile = potentialEntryTs;
                } else {
                  await fs.promises.access(potentialEntryJs);
                  moduleEntryFile = potentialEntryJs;
                }
            } catch {
                logger.debug(`ModuleManager: No module.json or index.ts/js found in ${moduleDirPath}. Skipping.`);
                this.loadingModules.delete(moduleDirPath);
                return;
            }
        }
    }

    const isProductionInstallModule = this.runtimeMode === 'production' && this.isInstallPath(moduleDirPath);
    if (isProductionInstallModule && moduleEntryFile?.endsWith('.ts')) {
      const jsFallback = moduleEntryFile.slice(0, -3) + '.js';
      try {
        await fs.promises.access(jsFallback);
        moduleEntryFile = jsFallback;
      } catch {
        logger.warn(
          `ModuleManager: Skipping TypeScript entry in production for ${moduleDirPath}. Expected transpiled JS entry at ${jsFallback}.`
        );
        this.loadingModules.delete(moduleDirPath);
        return;
      }
    }

    if (!moduleEntryFile || (!moduleEntryFile.endsWith('.js') && !moduleEntryFile.endsWith('.ts'))) {
        logger.debug(`ModuleManager: Skipping non-entry file or invalid entry file for directory ${moduleDirPath}.`);
        this.loadingModules.delete(moduleDirPath);
        return;
    }

    try {
      const absoluteModulePath = url.pathToFileURL(moduleEntryFile).href;
      const importedModule = await import(`${absoluteModulePath}?update=${Date.now()}`);
      
      let moduleInstance: IUnifiedModule;

      if (typeof importedModule.default === 'function') {
        moduleInstance = new importedModule.default();
      } else if (typeof importedModule.default === 'object' && importedModule.default !== null) {
        moduleInstance = importedModule.default;
      } else {
        throw new Error('Module default export must be a class or an object implementing IUnifiedModule.');
      }

      // If manifest was not loaded from module.json, expect it from the module instance
      if (!manifest) {
        if (!moduleInstance.manifest) {
          if (this.isLegacyModule(moduleInstance as any)) {
            moduleInstance = this.createLegacyModuleAdapter(moduleDirPath, moduleInstance as unknown as LegacyModuleLike);
            manifest = moduleInstance.manifest;
          } else {
            throw new Error(`Module from ${moduleDirPath} does not provide a manifest property.`);
          }
        }
        if (!manifest) {
          manifest = moduleInstance.manifest;
        }
      } else {
        // Ensure the instance's manifest is updated or set from the file
        moduleInstance.manifest = manifest;
      }

      const parsedManifest = UnifiedModuleManifestSchema.safeParse(manifest);
      if (!parsedManifest.success) {
        throw new Error(`Invalid manifest for module from ${moduleDirPath}: ${parsedManifest.error.errors.map(e => e.message).join(', ')}`);
      }
      moduleInstance.manifest = parsedManifest.data; // Use validated manifest

      const moduleContext: UnifiedModuleContext = this.createModuleContext();

      logger.info(`ModuleManager: Initializing module '${moduleInstance.manifest.name}' (type: ${moduleInstance.manifest.type}, v${moduleInstance.manifest.version})...`);
      const MODULE_LOAD_TIMEOUT = moduleInstance.manifest.timeout || 5000;
      await Promise.race([
        moduleInstance.onLoad(moduleContext),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Module '${moduleInstance.manifest.name}' onLoad timed out after ${MODULE_LOAD_TIMEOUT}ms`)), MODULE_LOAD_TIMEOUT)
        ),
      ]);

      // Store module by its manifest ID, not fullPath, to avoid duplicates based on internal files
      this.loadedModules.set(moduleInstance.manifest.id, { moduleInstance, fullPath: moduleDirPath });
      logger.info(`ModuleManager: Module '${moduleInstance.manifest.name}' loaded successfully from ${moduleDirPath}.`);
      this.emit('moduleLoaded', moduleInstance, moduleDirPath); // Emit event
    } catch (error) {
      logger.error(`ModuleManager: Failed to load module from '${moduleDirPath}': ${error instanceof Error ? error.message : String(error)}`, { error });
      const currentModuleInfo = Array.from(this.loadedModules.values()).find(m => m.fullPath === moduleDirPath);
      if (currentModuleInfo?.moduleInstance.onError) {
        await currentModuleInfo.moduleInstance.onError(error instanceof Error ? error : new Error(String(error)), {
            ...this.createModuleContext(),
          });
      }
    } finally {
      this.loadingModules.delete(moduleDirPath);
    }
  }

  public async unloadModuleFromDirectory(moduleDirPath: string): Promise<void> {
    // Find the module by its directory path
    const moduleInfo = Array.from(this.loadedModules.values()).find(m => m.fullPath === moduleDirPath);
    if (!moduleInfo) {
      logger.debug(`ModuleManager: No module loaded from directory ${moduleDirPath}. Skipping unload.`);
      return;
    }
    const { moduleInstance } = moduleInfo;

    try {
      logger.info(`ModuleManager: Unloading module '${moduleInstance.manifest.name}'...`);
      if (moduleInstance.onUnload) {
        const MODULE_UNLOAD_TIMEOUT = moduleInstance.manifest.timeout || 3000;
        await Promise.race([
          moduleInstance.onUnload(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Module '${moduleInstance.manifest.name}' onUnload timed out after ${MODULE_UNLOAD_TIMEOUT}ms`)), MODULE_UNLOAD_TIMEOUT)
          ),
        ]);
      }
      // If it's a tool, call its deregister function from McpServer
      if (moduleInstance.manifest.type === 'tool') {
        const registeredTool = this.deregisterFunctions.get(moduleInstance.manifest.id);
        if (registeredTool) {
          registeredTool.remove();
          this.deregisterFunctions.delete(moduleInstance.manifest.id);
          logger.info(`ModuleManager: Tool '${moduleInstance.manifest.name}' deregistered from McpServer.`);
        }
      }
      this.loadedModules.delete(moduleInstance.manifest.id); // Delete by ID
      logger.info(`ModuleManager: Module '${moduleInstance.manifest.name}' unloaded successfully.`);
      this.emit('moduleUnloaded', moduleInstance, moduleDirPath); // Emit event
    } catch (error) {
      logger.error(`ModuleManager: Failed to unload module '${moduleInstance.manifest.name}': ${error instanceof Error ? error.message : String(error)}`, { error });
      if (moduleInstance.onError) {
        await moduleInstance.onError(error instanceof Error ? error : new Error(String(error)), {
            ...this.createModuleContext(),
          });
      }
    }
  }

  public async reloadModuleFromDirectory(moduleDirPath: string): Promise<void> {
    logger.info(`ModuleManager: Reloading module from ${moduleDirPath}...`);
    if (this.loadingModules.has(moduleDirPath)) {
      logger.warn(`ModuleManager: Module at ${moduleDirPath} is currently being loaded/reloaded. Skipping redundant reload request.`);
      return;
    }
    await this.unloadModuleFromDirectory(moduleDirPath);
    await this.loadModuleFromDirectory(moduleDirPath);
  }

  private async unloadAllModules(): Promise<void> {
    logger.info('ModuleManager: Unloading all active modules...');
    const modulesToUnload = Array.from(this.loadedModules.values()).map(m => m.fullPath).reverse();
    for (const fullPath of modulesToUnload) {
      await this.unloadModuleFromDirectory(fullPath);
    }
    logger.info('ModuleManager: All modules unloaded.');
  }

  public getLoadedModule(idOrName: string): IUnifiedModule | undefined {
    // Try by ID first
    const moduleInfo = this.loadedModules.get(idOrName);
    if (moduleInfo) {
        return moduleInfo.moduleInstance;
    }
    // Then try by name
    for (const modInfo of this.loadedModules.values()) {
      if (modInfo.moduleInstance.manifest.name === idOrName) {
        return modInfo.moduleInstance;
      }
    }
    return undefined;
  }

  public getModuleFullPath(id: string): string | undefined {
    const moduleInfo = this.loadedModules.get(id);
    return moduleInfo ? moduleInfo.fullPath : undefined;
  }

  public getAllLoadedModules(): Map<string, { moduleInstance: IUnifiedModule; fullPath: string }> {
    return this.loadedModules;
  }

  public listLoadedModules(): UnifiedModuleManifest[] {
    return Array.from(this.loadedModules.values()).map(moduleInfo => moduleInfo.moduleInstance.manifest);
  }

  // --- Public methods for specific module types (e.g., for existing loaders to adapt) ---

  // For tools to register their execute functions with appropriate wrappers
  public registerToolExecution(
    toolId: string,
    executeFn: (args: any) => Promise<any>,
    name: string,
    description: string = '',
    inputSchema: any = {},
    moduleId?: string,
    skipTimeout: boolean = false
  ): () => void {
    const associatedModuleId = moduleId ?? toolId;
    const formatToolOutput = (result: any) => {
      if (!result) return '';
      const content = result.content;
      if (!content) return '';
      if (Array.isArray(content)) {
        return content
          .map((entry) =>
            typeof entry?.text === 'string' ? entry.text : JSON.stringify(entry ?? '')
          )
          .filter(Boolean)
          .join(' | ');
      }
      if (typeof content === 'object' && typeof content.text === 'string') {
        return content.text;
      }
      return typeof content === 'string' ? content : '';
    };

    const logToolInvocation = (label: string, args: any, result?: any) => {
      logger.info(`Tool ${toolId} ${label}`, {
        toolId,
        label,
        args,
        output: formatToolOutput(result),
        structuredContent: result?.structuredContent,
      });
    };

    const permissionAndCachedAndMonitoredExecute = async (args: any) => {
      const startTime = hrtime.bigint();
      let success = false;
      let isCached = false;
      let result: any;
      const toolModule = this.getLoadedModule(associatedModuleId); // Get the toolModule here to access its manifest
     
      try {
        if (!this.permissionManager.check(toolId)) {
          throw new SecurityError(`Permission denied to execute tool: ${toolId}`); 
        }

        // Only cache if caching is enabled and tool inputs are defined in its manifest
          if (this.config.cache?.enabled && toolModule?.manifest.inputs) {
            const cacheKey = toolId;
            const cachedResult = this.toolCacheManager.get(cacheKey, args);
            if (cachedResult) {
              logger.debug(`Returning cached result for tool: ${toolId}`);
              isCached = true;
              result = cachedResult;
              logToolInvocation('cache hit', args, cachedResult);
            }
          }

        if (!isCached) {
          if (skipTimeout) {
            result = await executeFn(args);
          } else {
            const TOOL_EXECUTION_TIMEOUT = toolModule?.manifest.timeout || 30000;
            result = await Promise.race([
              executeFn(args),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Tool '${toolId}' execution timed out after ${TOOL_EXECUTION_TIMEOUT}ms`)), TOOL_EXECUTION_TIMEOUT)
              ),
            ]);
          }
          success = true;
          logToolInvocation('executed', args, result);
          if (this.config.cache?.enabled && toolModule?.manifest.inputs) {
            const cacheKey = toolId;
            this.toolCacheManager.set(cacheKey, args, result);
          }
        } else {
            success = true;
        }
      } catch (error) {
        success = false;
        logger.error(`Tool ${toolId} failed`, {
          toolId,
          args,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        const endTime = hrtime.bigint();
        const durationNs = endTime - startTime;
        const durationMs = Number(durationNs / 1_000_000n);
        
        this.monitoringManager.reportToolExecution(toolId, durationMs, success, isCached);
      }
      return result;
    };
    
    const registeredTool = this.server.registerTool(toolId, {
        title: name,
        description: description,
        inputSchema: inputSchema,
    }, permissionAndCachedAndMonitoredExecute);

    const deregisterFn = () => {
      registeredTool.remove();
      this.deregisterFunctions.delete(toolId);
    };

    this.deregisterFunctions.set(toolId, registeredTool);
    logger.info(`ModuleManager: Tool '${toolId}' execution wrapper registered with McpServer.`);
    return deregisterFn;
  }

}
