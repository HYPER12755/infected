import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InfectedConfig } from '../config/index.js';
import logger from './logger.js';
import { ManagerInstances } from '../types/index.js';
import { IUnifiedModule, IUnifiedSkill, isUnifiedSkill, UnifiedModuleManifest } from './module-system/module-types.js';
import { ModuleManager } from './module-system/module-manager.js';

export class SkillLoader {
  private server: McpServer;
  private config: InfectedConfig;
  private managers: ManagerInstances;
  private moduleManager: ModuleManager;
  private readonly onModuleLoaded = this.handleModuleLoaded.bind(this);
  private readonly onModuleUnloaded = this.handleModuleUnloaded.bind(this);

  constructor(server: McpServer, config: InfectedConfig, managers: ManagerInstances, moduleManager: ModuleManager) {
    this.server = server;
    this.config = config;
    this.managers = managers;
    this.moduleManager = moduleManager;
  }

  public async start(): Promise<void> {
    logger.info('SkillLoader: Starting. Registering for module events from ModuleManager.');
    this.moduleManager.on('moduleLoaded', this.onModuleLoaded);
    this.moduleManager.on('moduleUnloaded', this.onModuleUnloaded);

    // Initialize any skills that might have been loaded before this SkillLoader started
    for (const { moduleInstance, fullPath } of this.moduleManager.getAllLoadedModules().values()) {
        await this.handleModuleLoaded(moduleInstance, fullPath);
    }
  }

  public async stop(): Promise<void> {
    logger.info('SkillLoader: Stopping. Unloading all active skills.');
    this.moduleManager.off('moduleLoaded', this.onModuleLoaded);
    this.moduleManager.off('moduleUnloaded', this.onModuleUnloaded);

    // For any skills still active, call their onUnload explicitly.
    for (const { moduleInstance } of this.moduleManager.getAllLoadedModules().values()) {
        if (isUnifiedSkill(moduleInstance) && moduleInstance.onUnload) {
            try {
                await moduleInstance.onUnload();
                logger.debug(`SkillLoader: Skill '${moduleInstance.manifest.name}' onUnload called during stop.`);
            } catch (error) {
                logger.error(`SkillLoader: Error calling onUnload for skill '${moduleInstance.manifest.name}': ${error}`);
            }
        }
    }
  }

  private async handleModuleLoaded(module: IUnifiedModule, fullPath: string): Promise<void> {
    if (isUnifiedSkill(module)) {
      logger.info(`SkillLoader: Skill '${module.manifest.name}' is active.`);
    }
  }

  private async handleModuleUnloaded(module: IUnifiedModule, fullPath: string): Promise<void> {
    if (isUnifiedSkill(module)) {
      logger.info(`SkillLoader: ModuleManager unloaded a skill: ${module.manifest.name}. Shutting down skill.`);
      try {
        if (module.onUnload) {
          await module.onUnload();
        }
        logger.info(`SkillLoader: Skill '${module.manifest.name}' shut down.`);
      } catch (error) {
        logger.error(`SkillLoader: Error shutting down skill '${module.manifest.name}': ${error}`);
        if (module.onError) {
            await module.onError(error instanceof Error ? error : new Error(String(error)), this.moduleManager.createModuleContext());
        }
      }
    }
  }

  public getSkill(skillIdOrName: string): IUnifiedSkill | undefined {
    const module = this.moduleManager.getLoadedModule(skillIdOrName);
    if (module && isUnifiedSkill(module)) {
      return module;
    }
    return undefined;
  }

  public listSkills(): Array<UnifiedModuleManifest> {
    return this.moduleManager.listLoadedModules()
      .filter(module => module.type === 'skill')
      .map(module => module); // Return the full manifest for skills
  }
}
