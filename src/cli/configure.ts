import chalk from 'chalk';
import inquirer from 'inquirer';
import { ConfigManager } from '../config/index.js';
import { InfectedConfigSchema, InfectedConfig } from '../config/schema.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ZodObject, ZodString, ZodArray, ZodBoolean, ZodEnum, ZodNumber, z } from 'zod';
import logger from '../core/logger.js';

export async function configureCLI() {
  logger.info(chalk.blue('----------------------------------------------------'));
  logger.info(chalk.blue('  Infected MCP Server Configuration (Interactive CLI) '));
  logger.info(chalk.blue('----------------------------------------------------'));
  logger.info(chalk.gray('  This wizard helps you set up or modify your server configuration.'));
  logger.info(chalk.gray('  Defaults are designed for agent autonomy and easy local development.'));
  logger.info(chalk.gray('----------------------------------------------------\n'));

  const configManager = new ConfigManager();
  let currentConfig: InfectedConfig = await configManager.loadConfig();
  let newConfig: Partial<InfectedConfig> = { ...currentConfig };

  // --- General Server Settings ---
  logger.info(chalk.magenta.bold('\n--- ⚙️ General Server Settings ---'));
  const generalAnswers = await inquirer.prompt([
    {
      type: 'list',
      name: 'transport',
      message: 'Select the primary communication transport:',
      choices: [
        { name: 'STDIO (Standard I/O - best for local CLI/agent)', value: 'stdio' },
        { name: 'HTTP (REST API - for web clients or remote access)', value: 'http' },
        { name: 'SSE (Server-Sent Events - for real-time web clients)', value: 'sse' },
      ],
      default: newConfig.transport,
    },
    {
      type: 'input',
      name: 'port',
      message: 'Enter the port for HTTP/SSE transports:',
      default: newConfig.port?.toString() || '3000',
      validate: (value: string) => {
        const port = parseInt(value);
        if (isNaN(port) || port <= 0 || port > 65535) {
          return chalk.red('Please enter a valid port number (1-65535).');
        }
        return true;
      },
      filter: (value: string) => parseInt(value),
      when: (answers: any) => answers.transport === 'http' || answers.transport === 'sse',
    },
    {
      type: 'confirm',
      name: 'hotReload',
      message: 'Enable hot-reloading for tools and modules (recommended for development)?',
      default: newConfig.hotReload,
      suffix: chalk.gray(' (Tools and modules will reload automatically on file changes)')
    }
  ]);
  Object.assign(newConfig, generalAnswers);

  // --- Module Selection ---
  logger.info(chalk.magenta.bold('\n--- 🧩 Module Management ---'));
  const moduleAnswers = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'modules',
      message: 'Select core modules to enable:',
      choices: [
        { name: 'Shell Module (execute system commands)', value: 'shell' },
        { name: 'Filesystem Module (read/write/list files)', value: 'filesystem' },
        { name: 'Memory Module (knowledge graph/memory storage)', value: 'memory' },
        { name: 'Sequential Thinking Module (step-by-step reasoning)', value: 'sequentialthinking' },
        { name: 'Fetch Module (make HTTP requests)', value: 'fetch' },
      ],
      default: newConfig.modules,
    }
  ]);
  newConfig.modules = moduleAnswers.modules;

  // --- Plugin Management ---
  logger.info(chalk.magenta.bold('\n--- 🔌 Plugin Management ---'));
  logger.info(chalk.gray('  Plugins extend server functionality and can be added manually.'));
  const pluginAnswers = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'configurePlugins',
      message: 'Do you want to manage plugins now?',
      default: newConfig.plugins && newConfig.plugins.length > 0,
    },
    {
      type: 'input',
      name: 'pluginList',
      message: 'Enter comma-separated plugin paths/names (e.g., ./plugins/my-plugin, another-plugin):',
      default: newConfig.plugins ? newConfig.plugins.map(p => p.name).join(', ') : '',
      when: (answers: any) => answers.configurePlugins,
      filter: (value: string) => value.split(',').map(s => s.trim()).filter(s => s.length > 0).map(name => ({ name, config: {} })),
      suffix: chalk.gray(' (Plugin configurations will need to be added manually to infected.config.json)')
    }
  ]);
  if (pluginAnswers.configurePlugins) {
    newConfig.plugins = pluginAnswers.pluginList;
  } else {
    newConfig.plugins = []; // Clear plugins if user chose not to configure
  }

  // --- Tool Discovery Settings ---
  logger.info(chalk.magenta.bold('\n--- 🛠️ Tool Discovery Settings ---'));
  const toolsDirAnswers = await inquirer.prompt([
    {
      type: 'input',
      name: 'toolsDir',
      message: 'Enter the directory for auto-discovered external tools (relative to CWD):',
      default: newConfig.toolsDir || './tools',
      validate: (value: string) => {
        if (!value.trim()) return chalk.red('Tool directory cannot be empty.');
        return true;
      },
      suffix: chalk.gray(' (e.g., ./tools, relative paths are resolved from server CWD)')
    }
  ]);
  newConfig.toolsDir = toolsDirAnswers.toolsDir;

  // --- Authentication Settings ---
  logger.info(chalk.magenta.bold('\n--- 🔑 Authentication Settings ---'));
  logger.info(chalk.gray('  Controls access to HTTP/SSE transports. STDIO is always local.'));
  const authAnswers = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'authEnabled',
      message: 'Enable API Key authentication for HTTP/SSE transports?',
      default: newConfig.auth?.enabled,
      suffix: chalk.gray(' (Recommended for production/remote access)')
    },
    {
      type: 'confirm',
      name: 'randomAuthTokenEnabled',
      message: 'Generate a random API key at each server startup (overrides static keys)?',
      default: newConfig.auth?.randomAuthTokenEnabled,
      when: (answers: any) => answers.authEnabled,
      suffix: chalk.gray(' (Useful for temporary sessions; disable for persistent API keys)')
    },
    {
      type: 'input',
      name: 'apiKey',
      message: 'Enter API Key(s) (comma-separated, min 8 chars each):',
      default: Array.isArray(newConfig.auth?.apiKey) ? newConfig.auth?.apiKey.join(', ') : (newConfig.auth?.apiKey || ''),
      when: (answers: any) => answers.authEnabled && !answers.randomAuthTokenEnabled,
      validate: (value: string) => {
        const keys = value.split(',').map(s => s.trim()).filter(s => s.length > 0);
        if (keys.length === 0) return chalk.red('Please provide at least one API key.');
        if (keys.some(key => key.length < 8)) return chalk.red('Each API key must be at least 8 characters long.');
        return true;
      },
      filter: (value: string) => value.split(',').map(s => s.trim()).filter(s => s.length > 0)
    }
  ]);
  const defaultAdvanced = newConfig.auth?.randomAuthTokenAdvanced ?? {
    enabled: false,
    tokenCount: 1,
    tokenLength: 32,
    includeTimestamp: false,
  };

  newConfig.auth = {
    enabled: authAnswers.authEnabled,
    randomAuthTokenEnabled: authAnswers.randomAuthTokenEnabled,
    apiKey: authAnswers.apiKey || [], // Store as array
    randomAuthTokenAdvanced: defaultAdvanced,
  };

  // --- Permissions Settings ---
  logger.info(chalk.magenta.bold('\n--- 🔒 Permissions Settings ---'));
  logger.info(chalk.gray('  Control which tools can be executed. Default is ALLOW ALL for agents.'));
  const permissionsAnswers = await inquirer.prompt([
    {
      type: 'list',
      name: 'defaultPolicy',
      message: 'Select the default policy for tool execution:',
      choices: [
        { name: 'Allow all tools (default for agents)', value: 'allow' },
        { name: 'Deny all tools by default (require explicit allowlist)', value: 'deny' },
      ],
      default: newConfig.permissions?.defaultPolicy,
      suffix: chalk.gray(' (Agent autonomy usually benefits from "allow" default)')
    },
    {
      type: 'input',
      name: 'toolAllowlist',
      message: 'Enter comma-separated tool names to ALLOW (overrides default policy if "deny"):',
      default: newConfig.permissions?.toolAllowlist?.join(', ') || '',
      filter: (value: string) => value.split(',').map(s => s.trim()).filter(s => s.length > 0),
      when: (answers: any) => answers.defaultPolicy === 'deny' // Only relevant if default is deny
    },
    {
      type: 'input',
      name: 'toolBlocklist',
      message: 'Enter comma-separated tool names to BLOCK (always blocked, even if allowed by default):',
      default: newConfig.permissions?.toolBlocklist?.join(', ') || '',
      filter: (value: string) => value.split(',').map(s => s.trim()).filter(s => s.length > 0),
      suffix: chalk.gray(' (e.g., rm_rf, dangerous_tool)')
    }
  ]);
  newConfig.permissions = {
    defaultPolicy: permissionsAnswers.defaultPolicy,
    toolAllowlist: permissionsAnswers.toolAllowlist,
    toolBlocklist: permissionsAnswers.toolBlocklist
  };

  // --- Caching Settings ---
  logger.info(chalk.magenta.bold('\n--- 🚀 Caching Settings ---'));
  const cacheAnswers = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'cacheEnabled',
      message: 'Enable tool caching to improve performance?',
      default: newConfig.cache?.enabled,
      suffix: chalk.gray(' (Recommended for production, reduces redundant tool calls)')
    },
    {
      type: 'input',
      name: 'cacheDefaultTTL',
      message: 'Default cache entry time-to-live in milliseconds (min 1000ms):',
      default: newConfig.cache?.defaultTTL?.toString() || '300000',
      when: (answers: any) => answers.cacheEnabled,
      validate: (value: string) => {
        const ttl = parseInt(value);
        if (isNaN(ttl) || ttl < 1000) return chalk.red('Please enter a minimum of 1000ms.');
        return true;
      },
      filter: (value: string) => parseInt(value),
      suffix: chalk.gray(' (e.g., 300000 for 5 minutes)')
    },
    {
      type: 'input',
      name: 'cacheMaxSize',
      message: 'Maximum number of cache entries:',
      default: newConfig.cache?.maxSize?.toString() || '1000',
      when: (answers: any) => answers.cacheEnabled,
      validate: (value: string) => {
        const size = parseInt(value);
        if (isNaN(size) || size < 1) return chalk.red('Please enter a positive number.');
        return true;
      },
      filter: (value: string) => parseInt(value)
    }
  ]);
  newConfig.cache = {
    enabled: cacheAnswers.cacheEnabled,
    defaultTTL: cacheAnswers.cacheDefaultTTL,
    maxSize: cacheAnswers.cacheMaxSize
  };

  // --- LLM Security Settings ---
  logger.info(chalk.magenta.bold('\n--- 🤖 LLM Security Settings (for Shell Module) ---'));
  logger.info(chalk.gray('  Uses an LLM to evaluate shell commands for safety. Disabled by default for agent autonomy.'));
  const llmSecurityAnswers = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'llmSecurityEnabled',
      message: 'Enable LLM-based security evaluation for shell commands?',
      default: newConfig.llmSecurity?.enabled,
      suffix: chalk.gray(' (Recommended for human oversight; may limit agent autonomy)')
    },
    {
      type: 'input',
      name: 'llmSecurityProvider',
      message: 'LLM provider (e.g., openai, gemini):',
      default: newConfig.llmSecurity?.provider || '',
      when: (answers: any) => answers.llmSecurityEnabled,
      validate: (value: string) => value.trim() ? true : chalk.red('Provider is required if LLM security is enabled.'),
    },
    {
      type: 'input',
      name: 'llmSecurityModel',
      message: 'Specific LLM model to use (e.g., gpt-4-turbo, gemini-pro):',
      default: newConfig.llmSecurity?.model || '',
      when: (answers: any) => answers.llmSecurityEnabled,
      validate: (value: string) => value.trim() ? true : chalk.red('Model is required if LLM security is enabled.'),
    },
    {
      type: 'input',
      name: 'llmSecurityApiKey',
      message: 'API key for the LLM provider:',
      default: newConfig.llmSecurity?.apiKey || '',
      when: (answers: any) => answers.llmSecurityEnabled,
      validate: (value: string) => value.trim() ? true : chalk.red('API Key is required if LLM security is enabled.'),
      suffix: chalk.gray(' (Keep this secure; use environment variables if possible)')
    },
    {
      type: 'confirm',
      name: 'llmSecurityElicitationEnabled',
      message: 'Enable interactive elicitation by LLM for potentially unsafe commands?',
      default: newConfig.llmSecurity?.elicitationEnabled,
      when: (answers: any) => answers.llmSecurityEnabled,
      suffix: chalk.gray(' (LLM will ask for user intent for risky commands)')
    },
    {
      type: 'confirm',
      name: 'llmSecuritySkipSafeCommands',
      message: 'Optimize: Skip LLM checks for commands pre-identified as safe patterns?',
      default: newConfig.llmSecurity?.skipSafeCommands,
      when: (answers: any) => answers.llmSecurityEnabled,
      suffix: chalk.gray(' (Reduces LLM API calls for common safe commands)')
    }
  ]);
  newConfig.llmSecurity = {
    enabled: llmSecurityAnswers.llmSecurityEnabled,
    provider: llmSecurityAnswers.llmSecurityProvider,
    model: llmSecurityAnswers.llmSecurityModel,
    apiKey: llmSecurityAnswers.llmSecurityApiKey,
    elicitationEnabled: llmSecurityAnswers.llmSecurityElicitationEnabled,
    skipSafeCommands: llmSecurityAnswers.llmSecuritySkipSafeCommands
  };

  try {
    const validatedConfig = InfectedConfigSchema.parse(newConfig);

    // Filter plugins to only include those that have a 'name' (i.e., were selected/entered)
    if (validatedConfig.plugins && Array.isArray(validatedConfig.plugins)) {
      validatedConfig.plugins = validatedConfig.plugins.filter(p => p.name.trim().length > 0);
    }

    const configFilePath = path.resolve(process.cwd(), 'infected.config.json');
    await fs.writeFile(configFilePath, JSON.stringify(validatedConfig, null, 2), 'utf-8');

    logger.info(chalk.green('\nConfiguration saved successfully to infected.config.json!'));
    logger.info(chalk.cyan('You can now start the server with: ') + chalk.white('npm run dev'));
  } catch (error) {
    logger.error(chalk.red('\nError saving configuration:'));
    if (error instanceof z.ZodError) {
        error.errors.forEach(err => logger.error(chalk.red(`- ${err.path.join('.')}: ${err.message}`)));
    } else if (error instanceof Error) {
        logger.error(chalk.red(error.message));
    } else {
        logger.error(chalk.red(String(error)));
    }
    logger.error(chalk.red('Please ensure your configuration is valid.'));
  }
}
