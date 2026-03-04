import { InfectedConfig, InfectedConfigSchema } from './schema.js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultInstallRoot = path.resolve(moduleDir, '../..');
const defaultWorkspaceRoot = process.cwd();

export function getInstallRoot(): string {
  return process.env['INFECTED_INSTALL_ROOT'] || defaultInstallRoot;
}

export function getWorkspaceRoot(): string {
  return process.env['INFECTED_WORKSPACE_ROOT'] || defaultWorkspaceRoot;
}

function normalizeTransportValue(value: unknown): unknown {
  if (value === 'http-streams') {
    return 'http';
  }
  return value;
}

export class ConfigManager {
  private config: InfectedConfig;

  constructor() {
    this.config = InfectedConfigSchema.parse({}); // Start with defaults
  }

  async loadConfig(): Promise<InfectedConfig> {
    const installRoot = getInstallRoot();
    const workspaceRoot = getWorkspaceRoot();

    // Expose canonical runtime roots to all components.
    process.env['INFECTED_INSTALL_ROOT'] = installRoot;
    process.env['INFECTED_WORKSPACE_ROOT'] = workspaceRoot;

    // 1. Load from .env file
    dotenv.config({ path: path.resolve(installRoot, '.env') });
    
    // 2. Load from infected.config.json
    const configFilePath = path.resolve(installRoot, 'infected.config.json');
    let fileConfig: Partial<InfectedConfig> = {};
    if (fs.existsSync(configFilePath)) {
      try {
        const configFileContent = await fs.promises.readFile(configFilePath, 'utf-8');
        fileConfig = JSON.parse(configFileContent);
        if (typeof fileConfig === 'object' && fileConfig !== null && 'transport' in fileConfig) {
          (fileConfig as any).transport = normalizeTransportValue((fileConfig as any).transport);
        }
      } catch (error) {
        console.warn(`Could not read or parse infected.config.json: ${error}`);
      }
    }

    // 3. Merge configurations (env vars have highest precedence after CLI, then file, then defaults)
    // For simplicity, directly merge environment variables that match schema keys.
    // A more robust solution might involve a dedicated CLI arg parser.
    const envConfig: Partial<InfectedConfig> = {};
    if (process.env.TRANSPORT) envConfig.transport = normalizeTransportValue(process.env.TRANSPORT) as any;
    if (process.env.MODULES) envConfig.modules = process.env.MODULES.split(',');
    if (process.env.PORT) envConfig.port = parseInt(process.env.PORT);
    if (process.env.HOT_RELOAD) envConfig.hotReload = process.env.HOT_RELOAD === 'true';
    if (process.env.TOOLS_DIR) envConfig.toolsDir = process.env.TOOLS_DIR;
    if (process.env.PROMPTS_DIR) envConfig.promptsDir = process.env.PROMPTS_DIR;
    if (process.env.PLUGINS_DIR) envConfig.pluginsDir = process.env.PLUGINS_DIR;
    // Handle nested module configs
    if (process.env.SHELL_ALLOWLIST) {
        envConfig.shell = { allowlist: process.env.SHELL_ALLOWLIST.split(',') };
    }
    if (process.env.MEMORY_FILE_PATH) {
        envConfig.memory = { filePath: process.env.MEMORY_FILE_PATH };
    }
    if (process.env.FETCH_DOMAIN_WHITELIST) {
        envConfig.fetch = { domainWhitelist: process.env.FETCH_DOMAIN_WHITELIST.split(',') };
    }


    this.config = InfectedConfigSchema.parse({
      ...this.config, // Default values
      ...fileConfig,
      ...envConfig,
      // CLI arguments would be merged here, for now they are handled in index.ts directly for --configure
    });

    return this.config;
  }

  getConfig(): InfectedConfig {
    return this.config;
  }
}
