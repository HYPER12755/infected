import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InfectedConfig } from '../config/index.js';
import logger from './logger.js';
import { IUnifiedModule, isUnifiedTool } from './module-system/module-types.js';
import { ModuleManager } from './module-system/module-manager.js';

import { EventEmitter } from 'node:events'; // Import EventEmitter

export class ToolLoader extends EventEmitter {
  private server: McpServer;
  private config: InfectedConfig;
  private moduleManager: ModuleManager;
  private deregisterFunctions: Map<string, () => void> = new Map(); // fullPath -> deregisterFn
  private readonly onModuleLoaded = this.handleModuleLoaded.bind(this);
  private readonly onModuleUnloaded = this.handleModuleUnloaded.bind(this);

  constructor(server: McpServer, config: InfectedConfig, moduleManager: ModuleManager) {
    super(); // Call the EventEmitter constructor
    this.server = server;
    this.config = config;
    this.moduleManager = moduleManager;
  }

  public async start(): Promise<void> {
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

  public async stop(): Promise<void> {
    logger.info('ToolLoader: Stopping. Deregistering all tools.');
    this.moduleManager.off('moduleLoaded', this.onModuleLoaded);
    this.moduleManager.off('moduleUnloaded', this.onModuleUnloaded);

    for (const deregisterFn of this.deregisterFunctions.values()) {
        deregisterFn();
    }
    this.deregisterFunctions.clear();
  }

  private handleModuleLoaded(module: IUnifiedModule, fullPath: string): void {
    if (isUnifiedTool(module)) {
      logger.info(`ToolLoader: ModuleManager loaded a tool: ${module.manifest.name}. Registering with McpServer.`);
      
      const deregisterFn = this.moduleManager.registerToolExecution(
        module.manifest.id, // Use module ID as the key for registration
        async (args) => module.execute(args, this.moduleManager.createModuleContext()),
        module.manifest.name,
        module.manifest.description,
        module.manifest.inputs,
        module.manifest.id
      );
      this.deregisterFunctions.set(module.manifest.id, deregisterFn);
    }
  }

  private handleModuleUnloaded(module: IUnifiedModule, fullPath: string): void {
    if (isUnifiedTool(module)) {
      logger.info(`ToolLoader: ModuleManager unloaded a tool: ${module.manifest.name}. Deregistering from McpServer.`);
      const deregisterFn = this.deregisterFunctions.get(module.manifest.id);
      if (deregisterFn) {
        deregisterFn();
        this.deregisterFunctions.delete(module.manifest.id);
      }
    }
  }

  public listTools(): Array<{ id: string; name: string; description?: string; parameters?: any }> {
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
