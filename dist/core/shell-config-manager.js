import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import { ShellServerConfigSchema, DEFAULT_ENHANCED_SECURITY_CONFIG, DEFAULT_BASIC_SAFETY_RULES, } from '../types/shell-server/enhanced-security.js'; // Adapted import
import { getCurrentTimestamp } from '../utils/shell-helpers.js'; // Adapted import
import logger from './logger.js'; // Use our central logger
/**
 * Configuration Manager for MCP Shell Server Enhanced Security
 * Handles loading, saving, and validating configuration files
 */
export class McpShellConfigManager {
    constructor(configPath) {
        // Default config file path: $HOME/.mcp-shell-server/config.json
        this.configPath = configPath || this.getDefaultConfigPath();
        this.config = this.getDefaultConfig();
    }
    /**
     * Get default configuration file path
     */
    getDefaultConfigPath() {
        const homeDir = process.env['HOME'] || process.env['USERPROFILE'] || '.';
        const configDir = path.join(homeDir, '.mcp-shell-server');
        return path.join(configDir, 'config.json');
    }
    /**
     * Get default configuration
     */
    getDefaultConfig() {
        return {
            server: {
                name: 'MCP Shell Server',
                version: '2.2.0',
            },
            enhanced_security: { ...DEFAULT_ENHANCED_SECURITY_CONFIG },
            basic_safety_rules: [...DEFAULT_BASIC_SAFETY_RULES],
        };
    }
    /**
     * Load configuration from file
     */
    async loadConfig() {
        try {
            // Check if config file exists
            await fs.access(this.configPath);
            // Read file content
            const configData = await fs.readFile(this.configPath, 'utf-8');
            const rawConfig = JSON.parse(configData);
            // Validate with Zod schema
            const validatedConfig = ShellServerConfigSchema.parse(rawConfig);
            this.config = validatedConfig;
            return this.config;
        }
        catch (error) {
            if (error instanceof z.ZodError) {
                logger.error(`Configuration validation failed: ${error.message}`, { details: error.errors });
                throw new Error(`Configuration validation failed: ${error.message}`);
            }
            // Return default config if file doesn't exist
            if (error.code === 'ENOENT') {
                logger.warn(`Configuration file not found at ${this.configPath}, using defaults`);
                await this.saveConfig(); // Create default config file
                return this.config;
            }
            logger.error(`Failed to load configuration: ${error instanceof Error ? error.message : String(error)}`);
            throw new Error(`Failed to load configuration: ${error}`);
        }
    }
    /**
     * Save configuration to file
     */
    async saveConfig(config) {
        const configToSave = config || this.config;
        try {
            // Validate with Zod schema
            const validatedConfig = ShellServerConfigSchema.parse(configToSave);
            // Create directory if it doesn't exist
            const configDir = path.dirname(this.configPath);
            await fs.mkdir(configDir, { recursive: true });
            // Save to file (formatted JSON)
            const configJson = JSON.stringify(validatedConfig, null, 2);
            await fs.writeFile(this.configPath, configJson, 'utf-8');
            this.config = validatedConfig;
        }
        catch (error) {
            if (error instanceof z.ZodError) {
                logger.error(`Configuration validation failed: ${error.message}`, { details: error.errors });
                throw new Error(`Configuration validation failed: ${error.message}`);
            }
            logger.error(`Failed to save configuration: ${error instanceof Error ? error.message : String(error)}`);
            throw new Error(`Failed to save configuration: ${error}`);
        }
    }
    /**
     * Get current configuration
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Get enhanced security configuration
     */
    getEnhancedSecurityConfig() {
        return { ...(this.config.enhanced_security || DEFAULT_ENHANCED_SECURITY_CONFIG) };
    }
    /**
     * Update enhanced security configuration
     */
    async updateEnhancedSecurityConfig(updates, saveToFile = true) {
        const currentConfig = this.getEnhancedSecurityConfig();
        const newConfig = {
            ...currentConfig,
            ...updates,
            safety_level_thresholds: {
                ...currentConfig.safety_level_thresholds,
                ...updates.safety_level_thresholds,
            },
        };
        this.config.enhanced_security = newConfig;
        if (saveToFile) {
            await this.saveConfig();
        }
        return newConfig;
    }
    /**
     * Get basic safety rules
     */
    getBasicSafetyRules() {
        return [...(this.config.basic_safety_rules || DEFAULT_BASIC_SAFETY_RULES)];
    }
    /**
     * Update basic safety rules
     */
    async updateBasicSafetyRules(rules, saveToFile = true) {
        this.config.basic_safety_rules = [...rules];
        if (saveToFile) {
            await this.saveConfig();
        }
    }
    /**
     * Get configuration file path
     */
    getConfigPath() {
        return this.configPath;
    }
    /**
     * Check if configuration file exists
     */
    async configExists() {
        try {
            await fs.access(this.configPath);
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Reset configuration to defaults
     */
    async resetToDefaults(saveToFile = true) {
        this.config = this.getDefaultConfig();
        if (saveToFile) {
            await this.saveConfig();
        }
        return this.config;
    }
    /**
     * Create backup of current configuration
     */
    async createBackup() {
        const timestamp = getCurrentTimestamp().replace(/[:.]/g, '-');
        const backupPath = `${this.configPath}.backup.${timestamp}`;
        try {
            await fs.copyFile(this.configPath, backupPath);
            return backupPath;
        }
        catch (error) {
            logger.error(`Failed to create backup: ${error instanceof Error ? error.message : String(error)}`);
            throw new Error(`Failed to create backup: ${error}`);
        }
    }
    /**
     * Get configuration file statistics
     */
    async getConfigStats() {
        try {
            const stats = await fs.stat(this.configPath);
            return {
                exists: true,
                size: stats.size,
                lastModified: stats.mtime,
                path: this.configPath,
            };
        }
        catch (error) {
            logger.error(`Failed to get config stats: ${error instanceof Error ? error.message : String(error)}`);
            return {
                exists: false,
                size: 0,
                lastModified: null,
                path: this.configPath,
            };
        }
    }
    /**
     * Validate configuration object
     */
    validateConfig(config) {
        return ShellServerConfigSchema.parse(config);
    }
}
// Singleton instance (optional)
let globalMcpShellConfigManager = null; // Renamed global instance
/**
 * Get global configuration manager instance
 */
export function getGlobalMcpShellConfigManager(configPath) {
    if (!globalMcpShellConfigManager) {
        globalMcpShellConfigManager = new McpShellConfigManager(configPath);
    }
    return globalMcpShellConfigManager;
}
