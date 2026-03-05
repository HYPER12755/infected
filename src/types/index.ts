import type { Tool as McpTool } from '@modelcontextprotocol/sdk/spec.types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { InfectedConfig } from '../config/index.js'; // Our own InfectedConfig from our config module.
export type { InfectedConfig };

// Import actual manager classes
import type { ProcessManager } from '../core/process-manager.js';
import type { TerminalManager } from '../core/terminal-manager.js';
import type { FileManager } from '../core/file-manager.js';
import type { MonitoringManager } from '../core/monitoring-manager.js';
import type { SecurityManager } from '../security/manager.js';
import type { CommandHistoryManager } from '../core/enhanced-history-manager.js';
import type { McpShellConfigManager } from '../core/shell-config-manager.js'; // Renamed mcp-shell-server's config manager
import type { ToolCacheManager } from '../core/tool-cache-manager.js'; // Add this import
import type { PermissionManager } from '../core/permission-manager.js'; // Add this import
import type { ModuleManager } from '../core/module-system/module-manager.js'; // Add this import
import type { ToolLoader } from '../core/tool-loader.js';
import type { PluginLoader } from '../core/plugin-loader.js';
import type { IUnifiedModule, IUnifiedTool, IUnifiedPlugin, UnifiedModuleContext, UnifiedModuleManifest } from '../core/module-system/module-types.js';

// Re-export specific mcp-shell-server types for convenience if needed, 
// otherwise, modules should import directly from 'types/mcp-shell-server'
export type {
  ExecutionMode,
  ExecutionStatus,
  ProcessSignal,
  EnvironmentVariables,
  OutputTruncationReason,
  OutputStatus,
  GuidanceInfo,
  ExecutionInfo,
  ExecutionProcessInfo,
  ShellType,
  TerminalInfo,
  // FileManager as McpFileManagerType, // Avoid conflict if our FileManager is used
  MonitorInfo,
  SystemStats,
  ErrorInfo,
  SecurityRestrictions,
  SecurityMode,
  ElicitationResult,
} from './shell-server/index.js'; // Renamed directory

export type { IUnifiedModule, IUnifiedTool, IUnifiedPlugin, UnifiedModuleContext, UnifiedModuleManifest };


export type Tool = McpTool;

export interface Module {
  name: string;
  register(server: McpServer, config: InfectedConfig, managers: ManagerInstances): Promise<void> | void;
  shutdown?(): Promise<void> | void;
}

// Define an interface for the collection of manager instances
export interface ManagerInstances {
  processManager: ProcessManager;
  terminalManager: TerminalManager;
  fileManager: FileManager;
  monitoringManager: MonitoringManager;
  securityManager: SecurityManager;
  commandHistoryManager: CommandHistoryManager;
  mcpShellConfigManager: McpShellConfigManager;
  toolCacheManager: ToolCacheManager; 
  permissionManager: PermissionManager; // Add this line
  moduleManager: ModuleManager;
  toolLoader: ToolLoader;
  pluginLoader: PluginLoader;
}


