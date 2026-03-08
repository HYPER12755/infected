import chokidar from 'chokidar';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import logger from './logger.js';
export class PluginWatcher extends EventEmitter {
    constructor(pluginsDir) {
        super();
        this.pluginsDir = path.resolve(process.cwd(), pluginsDir);
        this.watcher = chokidar.watch(this.pluginsDir, {
            ignored: /(^|[\/\\])\..*/, // ignore dotfiles and dot directories
            persistent: true,
            ignoreInitial: true, // Don't emit add events on startup
            depth: 1, // Only watch direct children of pluginsDir
        });
        this.setupListeners();
        logger.info(`PluginWatcher: Monitoring directory: ${this.pluginsDir}`);
    }
    setupListeners() {
        this.watcher
            .on('addDir', (dirPath) => logger.debug(`PluginWatcher: Directory ${dirPath} has been added`))
            .on('unlinkDir', (dirPath) => logger.debug(`PluginWatcher: Directory ${dirPath} has been removed`))
            .on('add', (filePath) => this.emit('pluginAdded', filePath))
            .on('change', (filePath) => this.emit('pluginChanged', filePath))
            .on('unlink', (filePath) => this.emit('pluginRemoved', filePath))
            .on('error', (error) => {
            if (error instanceof Error) {
                logger.error(`PluginWatcher: Watcher error: ${error.message}`);
            }
            else {
                logger.error(`PluginWatcher: Watcher error: ${String(error)}`);
            }
        });
    }
    async start() {
        // Force initial scan without emitting events, then start watching
        await this.watcher.close();
        this.watcher = chokidar.watch(this.pluginsDir, {
            ignored: /(^|[\/\\])\..*/, // ignore dotfiles and dot directories
            persistent: true,
            ignoreInitial: false, // Emit add events on startup
            depth: 1, // Only watch direct children of pluginsDir
        });
        this.setupListeners();
        logger.info('PluginWatcher: Initial scan complete and watching started.');
    }
    async close() {
        await this.watcher.close();
        logger.info('PluginWatcher: Watcher closed.');
    }
}
