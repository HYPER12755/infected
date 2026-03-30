import { ConfigManager } from './config/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import express from 'express';
import os from 'node:os';
import logger from './core/logger.js';
import { randomBytes } from 'node:crypto';
import { ServiceContainer } from './core/service-container.js';
import { httpStreamTransportFactory } from './transports/http.js';
import { SSETransportFactory } from './transports/sse.js';
import { websocketTransportFactory } from './transports/websocket.js';
import { authenticationMiddleware, authorizationMiddleware, setAuthConfig } from './auth/index.js';
import { generateRandomTokens } from './auth/random-token-generator.js';
import { streamingRouter } from './transports/streaming.js';
const startTime = Date.now();
export class InfectedServer {
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
                tools: { listChanged: true },
                resources: { listChanged: true },
            }
        });
        logger.info('InfectedServer instance created', {
            version: '1.0.0',
            platform: process.platform,
            arch: process.arch,
            nodeVersion: process.version,
            cpus: os.cpus().length,
            totalMemory: `${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB`
        });
    }
    async _loadConfiguration() {
        logger.info('Loading configuration...');
        const configLoadStart = Date.now();
        this.config = await this.configManager.loadConfig();
        const configLoadTime = Date.now() - configLoadStart;
        logger.info(`Configuration loaded in ${configLoadTime}ms`, {
            transport: this.config.transport,
            port: this.config.port,
            modules: this.config.modules.length,
            hotReload: this.config.hotReload
        });
        setAuthConfig(this.config);
    }
    _initializeManagers() {
        logger.info('Initializing service container and managers...');
        const managerInitStart = Date.now();
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
        const managerInitTime = Date.now() - managerInitStart;
        logger.info(`Managers initialized in ${managerInitTime}ms`);
    }
    async _configureSecurity() {
        logger.info('Configuring security...');
        const securityStart = Date.now();
        const { permissionManager, commandHistoryManager, securityManager, mcpShellConfigManager, toolCacheManager } = this.container.getAllManagers();
        securityManager.initializeEnhancedEvaluator(commandHistoryManager, this.server);
        logger.debug('Enhanced evaluator initialized');
        await mcpShellConfigManager.loadConfig();
        logger.info('Shell security configuration loaded');
        const advancedAuth = this.config.auth?.randomAuthTokenAdvanced;
        if (advancedAuth?.enabled) {
            logger.info('Generating advanced random auth tokens...');
            const tokens = generateRandomTokens({
                count: advancedAuth.tokenCount,
                lengthBytes: advancedAuth.tokenLength,
                prefix: advancedAuth.prefix,
                includeTimestamp: advancedAuth.includeTimestamp,
            });
            this.config.auth.apiKey = tokens;
            this.config.auth.enabled = true;
            logger.warn('==================================================');
            logger.warn('  ADVANCED RANDOM AUTH TOKENS GENERATED:');
            tokens.forEach((token, index) => {
                logger.warn('  TOKEN %d: %s', index + 1, token);
            });
            logger.warn('  TOKENS ARE VALID FOR THIS SESSION ONLY.');
            logger.warn('==================================================');
        }
        else if (this.config.auth?.randomAuthTokenEnabled) {
            logger.info('Generating random auth token...');
            const generatedKey = randomBytes(32).toString('hex');
            this.config.auth.apiKey = [generatedKey];
            this.config.auth.enabled = true;
            logger.warn('==================================================');
            logger.warn('  RANDOM AUTH TOKEN GENERATED: %s', generatedKey);
            logger.warn('  THIS TOKEN IS VALID FOR THIS SESSION ONLY.');
            logger.warn('==================================================');
        }
        else if (this.config.auth?.enabled && this.config.auth.apiKey) {
            const keyCount = Array.isArray(this.config.auth.apiKey) ? this.config.auth.apiKey.length : 1;
            logger.info(`Authentication enabled with ${keyCount} API key(s) configured`);
        }
        securityManager.setConfig(mcpShellConfigManager.getEnhancedSecurityConfig(), this.config.llmSecurity);
        logger.debug('Security manager configured');
        toolCacheManager.setConfig(this.config.cache);
        permissionManager.setConfig(this.config);
        const securityTime = Date.now() - securityStart;
        logger.info(`Security configured in ${securityTime}ms`);
    }
    async _setupBackgroundProcessCallbacks() {
        logger.info('Setting up background process callbacks...');
        const { processManager } = this.container.getAllManagers();
        processManager.setBackgroundProcessCallbacks({
            onComplete: async (executionId, executionInfo) => {
                logger.info(`Background process completed`, { executionId, exitCode: executionInfo.exit_code });
                await this.server.server.notification({ method: 'notifications/message', params: { level: 'info', data: `Process ${executionId} completed.` } });
            },
            onError: async (executionId, executionInfo, error) => {
                logger.error(`Background process failed`, { executionId, error: String(error) });
                await this.server.server.notification({ method: 'notifications/message', params: { level: 'error', data: `Process ${executionId} failed: ${error}` } });
            },
            onTimeout: async (executionId, executionInfo) => {
                logger.warn(`Background process timed out`, { executionId });
                await this.server.server.notification({ method: 'notifications/message', params: { level: 'warn', data: `Process ${executionId} timed out.` } });
            },
            onOutputData: async (executionId, data, isStderr) => {
                await this.server.server.notification({
                    method: 'notifications/progress',
                    params: { execution_id: executionId, type: isStderr ? 'stderr' : 'stdout', data },
                });
            },
        });
        logger.debug('Background process callbacks registered');
    }
    _logConfigurationSummary() {
        const uptime = process.uptime();
        const totalTime = Date.now() - startTime;
        logger.info('==================================================');
        logger.info('  SERVER CONFIGURATION SUMMARY');
        logger.info('==================================================');
        logger.info(`  Server:        Infected MCP Server v1.0.0`);
        logger.info(`  Platform:     ${process.platform} ${process.arch}`);
        logger.info(`  Node.js:      ${process.version}`);
        logger.info(`  Transport:    ${this.config.transport}`);
        logger.info(`  Port:         ${this.config.port}`);
        logger.info(`  Hot-Reload:   ${this.config.hotReload ? 'Enabled' : 'Disabled'}`);
        logger.info(`  Auth:         ${this.config.auth?.enabled ? 'Enabled' : 'Disabled'}`);
        logger.info(`  Cache:        ${this.config.cache?.enabled ? 'Enabled' : 'Disabled'}`);
        logger.info(`  Permissions:   ${this.config.permissions?.defaultPolicy || 'default'}`);
        logger.info('--------------------------------------------------');
        logger.info(`  Modules:      ${this.config.modules.join(', ')}`);
        logger.info(`  Tools Dir:    ${this.config.toolsDir}`);
        logger.info(`  Plugins Dir:  ${this.config.pluginsDir}`);
        logger.info('--------------------------------------------------');
        logger.info(`  Startup Time: ${totalTime}ms`);
        logger.info(`  Server Uptime: ${Math.floor(uptime)}s`);
        logger.info('==================================================');
    }
    _logSecurityWarnings() {
        const warnings = [];
        if (!this.config.auth?.enabled) {
            warnings.push('Authentication is DISABLED - server is exposed to unauthorized access');
        }
        if (this.config.permissions?.defaultPolicy === 'allow') {
            warnings.push('Default permission policy is "allow" - all tools are allowed by default');
        }
        if (this.config.shell?.allowlist?.length === 0) {
            warnings.push('Shell allowlist is EMPTY - all shell commands are allowed');
        }
        if (this.config.fetch?.domainWhitelist?.length === 0) {
            warnings.push('Fetch domain whitelist is EMPTY - all domains are allowed');
        }
        if (this.config.fetch?.blockLocalNetwork === false) {
            warnings.push('Local network access for fetch is ENABLED - may expose internal resources');
        }
        if (!this.config.llmSecurity?.enabled) {
            warnings.push('LLM-based security evaluation is DISABLED - malicious commands may not be detected');
        }
        if (warnings.length > 0) {
            logger.warn('==================================================');
            logger.warn('  SECURITY WARNINGS');
            logger.warn('==================================================');
            warnings.forEach((warning, i) => {
                logger.warn(`  ${i + 1}. ${warning}`);
            });
            logger.warn('==================================================');
        }
        else {
            logger.info('No security warnings - configuration looks good');
        }
    }
    async start() {
        const startupStart = Date.now();
        try {
            logger.info('==================================================');
            logger.info('  STARTING INFECTED MCP SERVER');
            logger.info('==================================================');
            const step1Start = Date.now();
            await this._loadConfiguration();
            logger.info(`[1/7] Configuration loaded (${Date.now() - step1Start}ms)`);
            const step2Start = Date.now();
            this._initializeManagers();
            logger.info(`[2/7] Managers initialized (${Date.now() - step2Start}ms)`);
            const step3Start = Date.now();
            await this._configureSecurity();
            logger.info(`[3/7] Security configured (${Date.now() - step3Start}ms)`);
            const step4Start = Date.now();
            await this._setupBackgroundProcessCallbacks();
            logger.info(`[4/7] Background callbacks setup (${Date.now() - step4Start}ms)`);
            const step5Start = Date.now();
            await this.moduleManager.start();
            const moduleCount = this.moduleManager.listLoadedModules().length;
            logger.info(`[5/7] Modules loaded: ${moduleCount} modules (${Date.now() - step5Start}ms)`);
            const step6Start = Date.now();
            await this.toolLoader.start();
            const toolCount = this.toolLoader.listTools().length;
            logger.info(`[6/7] Tools loaded: ${toolCount} tools (${Date.now() - step6Start}ms)`);
            const step7Start = Date.now();
            await this.pluginLoader.start();
            const pluginCount = this.pluginLoader.listPlugins().length;
            logger.info(`[7/7] Plugins loaded: ${pluginCount} plugins (${Date.now() - step7Start}ms)`);
            this._logConfigurationSummary();
            this._logSecurityWarnings();
            await this._initializeTransport();
            const totalStartup = Date.now() - startupStart;
            logger.info('==================================================');
            logger.info(`  SERVER STARTUP COMPLETE in ${totalStartup}ms`);
            logger.info('==================================================');
        }
        catch (error) {
            logger.error('Failed to start server:', error);
            process.exit(1);
        }
    }
    async _initializeTransport() {
        logger.info(`Initializing ${this.config.transport} transport...`);
        this.app = express();
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));
        this.app.use((req, res, next) => {
            logger.debug('Incoming request', { method: req.method, path: req.path, ip: req.ip });
            next();
        });
        this.app.use(authenticationMiddleware);
        logger.debug('Authentication middleware applied');
        this.app.use(authorizationMiddleware);
        logger.debug('Authorization middleware applied');
        this.app.get('/health', (req, res) => {
            res.status(200).json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
        });
        this.app.get('/messages', (req, res) => {
            res.status(200).json({ messages: [] });
        });
        const { streaming, transportPorts } = this.config;
        const httpPort = transportPorts?.httpPort ?? this.config.port;
        const ssePort = transportPorts?.ssePort ?? this.config.port;
        const wsPort = transportPorts?.wsPort ?? (this.config.port + 1);
        // Mount all available transports simultaneously
        // HTTP Stream transport (primary) - MCP standard protocol
        logger.info('Creating HTTP stream transport...', { port: httpPort });
        const { httpStreamRouter } = httpStreamTransportFactory(this.server);
        this.app.use(httpStreamRouter);
        logger.debug('HTTP stream router mounted');
        // SSE transport - for real-time streaming events
        logger.info('Creating SSE transport...', { port: ssePort });
        const { sseRouter } = SSETransportFactory(this.server);
        this.app.use(sseRouter);
        logger.debug('SSE router mounted');
        // Streaming router - for process output streaming
        logger.info('Mounting streaming router for process output...');
        this.app.use('/streaming', streamingRouter(this.processManager, streaming));
        logger.debug('Streaming router mounted');
        // WebSocket transport - separate server for WebSocket connections
        logger.info('Creating WebSocket transport...', { port: wsPort });
        const { router: wsRouter, initializeWebSocket } = websocketTransportFactory(this.server);
        this.app.use(wsRouter);
        logger.debug('WebSocket router mounted');
        // Start main HTTP server for HTTP Stream, SSE, and streaming endpoints
        this.app.listen(httpPort, () => {
            logger.info(`Server listening on port ${httpPort} with transports: http (MCP), sse (events), streaming (process output)`, {
                transport: 'multi',
                port: httpPort,
                host: '0.0.0.0',
                ssePort,
                streamingPath: '/streaming'
            });
        }).on('error', (err) => {
            logger.error(`Server failed to start: ${err.message}`, { port: httpPort, error: err.code });
            process.exit(1);
        });
        // Initialize WebSocket server on separate port
        await initializeWebSocket(wsPort);
        logger.info(`WebSocket server listening on port ${wsPort}`, {
            transport: 'websocket',
            port: wsPort
        });
    }
    async cleanup() {
        logger.info('Cleaning up server...');
        logger.debug('Cleaning up process manager...');
        this.processManager.cleanup();
        logger.debug('Cleaning up terminal manager...');
        this.terminalManager.cleanup();
        logger.debug('Cleaning up file manager...');
        await this.fileManager.cleanup();
        logger.debug('Cleaning up monitoring manager...');
        this.monitoringManager.cleanup();
        const { moduleManager, pluginLoader, toolLoader } = this.container.getAllManagers();
        logger.debug('Stopping module manager...');
        await moduleManager.stop();
        logger.debug('Stopping tool loader...');
        await toolLoader.stop();
        logger.debug('Stopping plugin loader...');
        await pluginLoader.stop();
        logger.debug('Stopping tool cache cleanup...');
        this.toolCacheManager.stopCleanupInterval();
        logger.info('Server cleanup complete');
    }
}
