import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InfectedConfig } from '../../config/index.js';
import logger from '../logger.js';
import { z } from 'zod';
import { Tool as McpTool } from '@modelcontextprotocol/sdk';

// Forward declarations for ManagerInstances and ModuleManager to avoid circular dependencies
import type { ManagerInstances } from '../../types/index.js';
import type { ModuleManager } from './module-manager.js'; // This will be the new manager

/**
 * Defines the types of modules supported by the unified system.
 */
export const ModuleTypeSchema = z.enum(['tool', 'plugin', 'skill']);
export type ModuleType = z.infer<typeof ModuleTypeSchema>;

/**
 * Base context provided to all unified module lifecycle methods.
 */
export interface UnifiedModuleContext {
  server: McpServer;
  config: InfectedConfig;
  managers: ManagerInstances; // All manager instances
  logger: typeof logger;
  moduleManager: ModuleManager; // The new module manager itself
  // Add other common context properties as needed
}

/**
 * Unified schema for module manifests (module.json or exported metadata).
 * This combines and extends metadata from existing Tool, Plugin, and Skill definitions.
 */
export const UnifiedModuleManifestSchema = z.object({
  id: z.string().min(1, 'Module ID cannot be empty'),
  name: z.string().min(1, 'Module name cannot be empty'),
  version: z.string().min(1, 'Module version cannot be empty'),
  type: ModuleTypeSchema,
  entry: z.string().min(1, 'Module entry file cannot be empty'), // Path to the main module file
  
  description: z.string().optional(),
  timeout: z.number().int().positive().optional(), // General timeout for lifecycle/execution
  
  // Tool/Skill specific
  inputs: z.record(z.any()).optional().describe('Input schema for the module, compatible with ZodRawShapeCompat.'),
  outputs: z.record(z.any()).optional(), // Zod schema for outputs
  
  // Skill specific
  capabilities: z.array(z.string()).optional(),
  requiresTools: z.array(z.string()).optional(),
  steps: z.array(z.string()).optional(),
  
  // Plugin specific
  provides: z.array(z.string()).optional(), // What the plugin provides (e.g., "tools", "prompts")
  dependencies: z.array(z.string()).optional(), // Other modules this plugin depends on
});

export type UnifiedModuleManifest = z.infer<typeof UnifiedModuleManifestSchema>;

/**
 * Base interface for all unified modules.
 * These are the common lifecycle methods expected from any module.
 */
export interface IUnifiedModule {
  // Metadata property, either provided by manifest or defined within the module itself
  manifest: UnifiedModuleManifest;

  // Common lifecycle methods
  onLoad(context: UnifiedModuleContext): Promise<void>;
  onUnload?(): Promise<void>;
  onError?(error: Error, context: UnifiedModuleContext): Promise<void>;
}

/**
 * Interface for Unified Tools.
 * Extends IUnifiedModule and includes the execute method.
 */
export interface IUnifiedTool extends IUnifiedModule {
  execute(args: any, context: UnifiedModuleContext): Promise<any>;
}

/**
 * Interface for Unified Plugins.
 * Plugins often have their own initialization logic that might differ from a simple `onLoad`
 * if they are meant to register multiple things with the server.
 */
export interface IUnifiedPlugin extends IUnifiedModule {
  // If `onLoad` is sufficient, this might not need additional methods.
  // We'll keep it separate for now in case plugins need specific methods like `registerExtension`
}

/**
 * Interface for Unified Skills.
 * Extends IUnifiedModule and includes the execute method.
 */
export interface IUnifiedSkill extends IUnifiedModule {
  execute(input: any, context: UnifiedModuleContext): Promise<any>;
}

// Type guard to check if a module is a tool
export function isUnifiedTool(module: IUnifiedModule | undefined | null): module is IUnifiedTool {
  return module && module.manifest && module.manifest.type === 'tool' && typeof (module as IUnifiedTool).execute === 'function';
}

// Type guard to check if a module is a skill
export function isUnifiedSkill(module: IUnifiedModule | undefined | null): module is IUnifiedSkill {
  return module && module.manifest && module.manifest.type === 'skill' && typeof (module as IUnifiedSkill).execute === 'function';
}

// Type guard to check if a module is a plugin
export function isUnifiedPlugin(module: IUnifiedModule | undefined | null): module is IUnifiedPlugin {
  return module && module.manifest && module.manifest.type === 'plugin';
}
