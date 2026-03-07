import { ConfigManager } from './config/index.js'; // Our own ConfigManager
import { InfectedConfig } from './config/index.js'; // Corrected import path for InfectedConfig
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import express from 'express';
import logger from './core/logger.js';
import { SecurityError } from './utils/shell-errors.js'; // Import SecurityError
import { randomBytes } from 'node:crypto'; // Import for random token generation
import { hrtime } from 'node:process'; // Import hrtime for performance monitoring


// Import all manager classes
import { ProcessManager } from './core/process-manager.js';
import { TerminalManager } from './core/terminal-manager.js';
import { FileManager } from './core/file-manager.js';
import { MonitoringManager } from './core/monitoring-manager.js'; // Import MonitoringManager
import { SecurityManager } from './security/manager.js';
import { CommandHistoryManager } from './core/enhanced-history-manager.js';
import { McpShellConfigManager } from './core/shell-config-manager.js'; // The mcp-shell-server's config manager
import { ManagerInstances } from './types/index.js'; // Import ManagerInstances

import { ServiceContainer } from './core/service-container.js';
import { createStdioTransport } from './transports/stdio.js';
import { httpStreamTransportFactory } from './transports/http.js';
import { SSETransportFactory } from './transports/sse.js';
import { authenticationMiddleware, authorizationMiddleware, setAuthConfig } from './auth/index.js';
import { ModuleManager } from './core/module-system/module-manager.js';
import { ToolLoader } from './core/tool-loader.js';
import { PluginLoader } from './core/plugin-loader.js';
import { ToolCacheManager } from './core/tool-cache-manager.js';
import { generateRandomTokens } from './auth/random-token-generator.js';

export class InfectedServer {
  private server: McpServer;
  private configManager: ConfigManager;
  private config!: InfectedConfig; // Initialized in start()
  private transport: ReturnType<typeof createStdioTransport> | undefined;
  private container!: ServiceContainer; // Initialized in start()
  // Add manager properties
  private processManager!: ProcessManager;
  private terminalManager!: TerminalManager;
  private fileManager!: FileManager;
  private monitoringManager!: MonitoringManager;
  private toolCacheManager!: ToolCacheManager;
  private moduleManager!: ModuleManager; // Add ModuleManager property
  private toolLoader!: ToolLoader; // Add ToolLoader property
  private pluginLoader!: PluginLoader; // Add PluginLoader property
  private app!: express.Application; // Declare the Express app property



  constructor() {
    this.configManager = new ConfigManager();
    this.server = new McpServer({
      name: "infected",
      version: "1.0.0",
      title: "Infected MCP Server",
      description: "A unified MCP server for modular operations and agent interactions."
    }, {
      instructions: "This server provides tools and plugins for various operations. Interact to discover capabilities.",
      capabilities: {
        tools: {
          listChanged: true
        },
        resources: {
          listChanged: true
        },
      }
    });
  }

  private async _loadConfiguration(): Promise<void> {
    this.config = await this.configManager.loadConfig();
    this.container = new ServiceContainer(this.server, this.config);
    setAuthConfig(this.config); // Initialize auth middleware with config
  }

  private _initializeManagers(): void {
    // Instantiate the ServiceContainer, which handles internal instantiation of all managers
    this.container = new ServiceContainer(this.server, this.config);
    const managers = this.container.getAllManagers();

    this.processManager = managers.processManager;
    this.terminalManager = managers.terminalManager;
    this.fileManager = managers.fileManager;
    this.monitoringManager = managers.monitoringManager;
    this.toolCacheManager = managers.toolCacheManager;
    this.moduleManager = managers.moduleManager;
    this.toolLoader = managers.toolLoader;
    this.pluginLoader = managers.pluginLoader;
  }

  private async _configureSecurity(): Promise<void> {
    const { permissionManager, commandHistoryManager, securityManager, mcpShellConfigManager, toolCacheManager, toolLoader, monitoringManager } = this.container.getAllManagers();



    securityManager.initializeEnhancedEvaluator(commandHistoryManager, this.server);

    await mcpShellConfigManager.loadConfig();
    logger.info('MCP Shell Server Configuration loaded.');

    const advancedAuth = this.config.auth?.randomAuthTokenAdvanced;
    if (advancedAuth?.enabled) {
      const tokens = generateRandomTokens({
        count: advancedAuth.tokenCount,
        lengthBytes: advancedAuth.tokenLength,
        prefix: advancedAuth.prefix,
        includeTimestamp: advancedAuth.includeTimestamp,
      });
      this.config.auth.apiKey = tokens;
      this.config.auth.enabled = true;
      logger.warn('----------------------------------------------------');
      logger.warn('  ADVANCED RANDOM AUTH TOKENS GENERATED:');
      tokens.forEach((token, index) => {
        logger.warn('  TOKEN %d: %s', index + 1, token);
      });
      logger.warn('  TOKENS ARE VALID FOR THIS SESSION ONLY.');
      logger.warn('----------------------------------------------------');
    } else if (this.config.auth?.randomAuthTokenEnabled) {
      const generatedKey = randomBytes(32).toString('hex');
      this.config.auth.apiKey = [generatedKey];
      this.config.auth.enabled = true;
      logger.warn('----------------------------------------------------');
      logger.warn('  RANDOM AUTH TOKEN GENERATED: %s', generatedKey);
      logger.warn('  THIS TOKEN IS VALID FOR THIS SESSION ONLY.');
      logger.warn('----------------------------------------------------');
    }

    securityManager.setConfig(mcpShellConfigManager.getEnhancedSecurityConfig(), this.config.llmSecurity);

    // moduleManager.setConfig(this.config); // Set moduleManager config here if needed, but it's done in _initializeManagers
    toolCacheManager.setConfig(this.config.cache);
    permissionManager.setConfig(this.config);
  }

  private async _setupBackgroundProcessCallbacks(): Promise<void> {
    const { processManager } = this.container.getAllManagers();
    processManager.setBackgroundProcessCallbacks({
      onComplete: async (executionId, executionInfo) => {
        logger.info(`Background process ${executionId} completed.`);
        await this.server.server.notification({ method: 'notifications/message', params: { level: 'info', data: `Process ${executionId} completed.` } });
      },
      onError: async (executionId, executionInfo, error) => {
        logger.error(`Background process ${executionId} failed: ${error}`);
        await this.server.server.notification({ method: 'notifications/message', params: { level: 'error', data: `Process ${executionId} failed: ${error}` } });
      },
      onTimeout: async (executionId, executionInfo) => {
        logger.warn(`Background process ${executionId} timed out.`);
        await this.server.server.notification({ method: 'notifications/message', params: { level: 'warn', data: `Process ${executionId} timed out.` } });
      },
      onOutputData: async (executionId, data, isStderr) => {
        await this.server.server.notification({
          method: 'notifications/progress',
          params: {
            execution_id: executionId,
            type: isStderr ? 'stderr' : 'stdout',
            data: data,
          },
        });
      },
    });
  }



  private _logConfigurationSummary(): void {
    logger.info('----------------------------------------------------');
    logger.info('  Server Configuration Summary:');
    logger.info(`  Transport: ${this.config.transport}`);
    logger.info(`  Port: ${this.config.port}`);
    logger.info(`  Hot-Reload Enabled: ${this.config.hotReload}`);
    logger.info(`  Modules Loaded: ${this.config.modules.join(', ')}`);
    logger.info(`  Tools Directory: ${this.config.toolsDir}`);
    logger.info(`  Cache Enabled: ${this.config.cache?.enabled}`);
    logger.info(`  Auth Enabled: ${this.config.auth?.enabled}`);
    if (this.config.auth?.enabled) {
        if (this.config.auth.randomAuthTokenEnabled) {
            logger.info('  Auth Method: Randomly Generated Token (displayed above)');
        } else {
            logger.info(`  Auth Method: Static API Key(s) (configured: ${Array.isArray(this.config.auth.apiKey) ? this.config.auth.apiKey.length : (this.config.auth.apiKey ? 1 : 0)} key(s))`);
        }
    }
    logger.info(`  Permissions Default Policy: ${this.config.permissions?.defaultPolicy}`);
    logger.info(`  LLM Security Enabled: ${this.config.llmSecurity?.enabled}`);
    logger.info('----------------------------------------------------');
  }

  private _logSecurityWarnings(): void {
    logger.info('----------------------------------------------------');
    if (!this.config.auth?.enabled) {
      logger.warn('SECURITY WARNING: Authentication is DISABLED. The server is exposed to unauthorized access.');
    }
    if (this.config.permissions?.defaultPolicy === 'allow') {
      logger.warn('SECURITY WARNING: Default permission policy is "allow". All tools are allowed by default. Configure toolAllowlist/toolBlocklist for stricter control.');
    }
    if (this.config.shell?.allowlist?.length === 0) {
      logger.warn('SECURITY WARNING: Shell allowlist is EMPTY. All shell commands are allowed. Restrict with "shell.allowlist".');
    }
    if (this.config.fetch?.domainWhitelist?.length === 0) {
      logger.warn('SECURITY WARNING: Fetch domain whitelist is EMPTY. All domains are allowed for fetch operations. Restrict with "fetch.domainWhitelist".');
    }
    if (this.config.fetch?.blockLocalNetwork === false) {
      logger.warn('SECURITY WARNING: Local network access for fetch is ENABLED. This may expose internal resources. Set "fetch.blockLocalNetwork" to true.');
    }
    if (!this.config.llmSecurity?.enabled) {
      logger.warn('SECURITY WARNING: LLM-based security evaluation is DISABLED. Malicious commands may not be detected.');
    }
    logger.info('----------------------------------------------------');
  }



  async start() {
    logger.info('Server starting...');
    await this._loadConfiguration();
    this._initializeManagers();
    await this._configureSecurity();
    await this._setupBackgroundProcessCallbacks();
    this._logConfigurationSummary();
    this._logSecurityWarnings();

    // Ensure all modules and tools are loaded and registered before initializing transport
    await this.moduleManager.start();
    await this.toolLoader.start();
    await this.pluginLoader.start();

    await this._initializeTransport();
  }


  private async _initializeTransport(): Promise<void> {
    logger.info(`Initializing ${this.config.transport} transport...`);
    
    // Create Express app once for HTTP/SSE transports
    this.app = express(); 
    this.app.use(express.json()); // For parsing application/json
    this.app.use(express.urlencoded({ extended: true })); // For parsing application/x-www-form-urlencoded

    this.app.use(authenticationMiddleware);
    this.app.use(authorizationMiddleware);

    // Common endpoints for HTTP/SSE
    this.app.get('/health', (req, res) => {
        res.status(200).json({ status: 'ok', uptime: process.uptime() });
    });
    this.app.get('/messages', (req, res) => {
        res.status(200).json({ messages: [] });
    });

    if (this.config.transport === 'http') {
      // Initialize MCP http transport and mount its router
      const { httpStreamRouter } = httpStreamTransportFactory(this.server);
      this.app.use(httpStreamRouter);
      
      this.app.listen(this.config.port, () => {
        logger.info(`Server listening on port ${this.config.port} with ${this.config.transport} transport.`, { component: 'server' });
      }).on('error', (err) => {
        logger.error(`Failed to start server on port ${this.config.port}: ${err.message}`, { error: err, component: 'server' });
        process.exit(1);
      });
    } else if (this.config.transport === 'sse') {
        // Initialize MCP sse transport and mount its router
        const { sseRouter } = SSETransportFactory(this.server);
        this.app.use(sseRouter);

        this.app.listen(this.config.port, () => {
            logger.info(`Server listening on port ${this.config.port} with ${this.config.transport} transport.`, { component: 'server' });
        }).on('error', (err) => {
            logger.error(`Failed to start server on port ${this.config.port}: ${err.message}`, { error: err, component: 'server' });
            process.exit(1);
        });
    } else if (this.config.transport === 'stdio') {
      // In stdio mode, there's a single long-lived transport that McpServer connects to
      this.transport = createStdioTransport();
      await this.server.connect(this.transport);
      // No app.listen for stdio as it's not HTTP-based
    } else {
      throw new Error(`Unsupported transport: ${this.config.transport}`);
    }
  }


  async cleanup(): Promise<void> {
    this.processManager.cleanup();
    this.terminalManager.cleanup();
    await this.fileManager.cleanup();
    this.monitoringManager.cleanup();
    const { moduleManager, pluginLoader, toolLoader } = this.container.getAllManagers();
    await moduleManager.stop(); // Stop module management and unload all modules
    await toolLoader.stop(); // Stop ToolLoader's listeners and deregister tools
    await pluginLoader.stop(); // Stop PluginLoader's listeners and unload plugins
    this.toolCacheManager.stopCleanupInterval(); // Stop tool cache cleanup
  }
}
