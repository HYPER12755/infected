import * as fs from 'node:fs/promises'; // Use node:fs/promises
import * as path from 'node:path'; // Use node:path
import chalk from 'chalk';
import logger from '../core/logger.js'; // Import our central logger
export class PluginCliManager {
    constructor(configManager) {
        this.configManager = configManager;
    }
    async addPlugin(pluginName) {
        let currentConfig = await this.configManager.loadConfig();
        // Ensure plugins array contains objects {name: string, config: {}}
        const pluginObjects = currentConfig.plugins.map(p => typeof p === 'string' ? { name: p, config: {} } : p);
        if (pluginObjects.some(p => p.name === pluginName)) {
            logger.warn(chalk.yellow(`Plugin '${pluginName}' is already added.`));
            return;
        }
        pluginObjects.push({ name: pluginName, config: {} });
        currentConfig.plugins = pluginObjects; // Update the plugins array
        await this.saveConfig(currentConfig);
        logger.info(chalk.green(`Plugin '${pluginName}' added successfully.`));
    }
    async removePlugin(pluginName) {
        let currentConfig = await this.configManager.loadConfig();
        // Ensure plugins array contains objects {name: string, config: {}}
        let pluginObjects = currentConfig.plugins.map(p => typeof p === 'string' ? { name: p, config: {} } : p);
        if (!pluginObjects.some(p => p.name === pluginName)) {
            logger.warn(chalk.yellow(`Plugin '${pluginName}' is not found in the configuration.`));
            return;
        }
        pluginObjects = pluginObjects.filter(p => p.name !== pluginName);
        currentConfig.plugins = pluginObjects; // Update the plugins array
        await this.saveConfig(currentConfig);
        logger.info(chalk.green(`Plugin '${pluginName}' removed successfully.`));
    }
    async saveConfig(config) {
        const configFilePath = path.resolve(process.cwd(), 'infected.config.json');
        await fs.writeFile(configFilePath, JSON.stringify(config, null, 2), 'utf-8');
    }
}
