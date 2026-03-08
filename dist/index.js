import 'dotenv/config';
import { InfectedServer } from './server.js';
import { ConfigManager } from './config/index.js';
import { configureCLI } from './cli/configure.js';
import { PluginCliManager } from './cli/plugin-cli.js'; // Import PluginCliManager
import logger from './core/logger.js'; // Use the logger
async function main() {
    // Parse command line arguments
    const args = process.argv.slice(2);
    if (args.includes('--configure')) {
        await configureCLI();
        return;
    }
    // Handle plugin commands
    if (args[0] === 'plugin') {
        const pluginCliManager = new PluginCliManager(new ConfigManager());
        const command = args[1];
        const pluginName = args[2];
        if (!pluginName) {
            logger.error('Please specify a plugin name.');
            return;
        }
        switch (command) {
            case 'add':
                await pluginCliManager.addPlugin(pluginName);
                break;
            case 'remove':
                await pluginCliManager.removePlugin(pluginName);
                break;
            default:
                logger.error(`Unknown plugin command: ${command}. Use 'add' or 'remove'.`);
        }
        return;
    }
    // Initialize ConfigManager
    const configManager = new ConfigManager();
    const config = await configManager.loadConfig();
    // Initialize and start the server
    const server = new InfectedServer();
    await server.start();
}
main().catch((error) => {
    logger.error('Server encountered an error:', error); // Use logger
    process.exit(1);
});
