import chokidar, { type FSWatcher } from 'chokidar';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import logger from './logger.js';

export class PluginWatcher extends EventEmitter {
  private watcher: FSWatcher;
  private pluginsDir: string;

  constructor(pluginsDir: string) {
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

  private setupListeners() {
    this.watcher
      .on('addDir', (dirPath: string) => logger.debug(`PluginWatcher: Directory ${dirPath} has been added`))
      .on('unlinkDir', (dirPath: string) => logger.debug(`PluginWatcher: Directory ${dirPath} has been removed`))
      .on('add', (filePath: string) => this.emit('pluginAdded', filePath))
      .on('change', (filePath: string) => this.emit('pluginChanged', filePath))
      .on('unlink', (filePath: string) => this.emit('pluginRemoved', filePath))
      .on('error', (error: Error) => {
        logger.error(`PluginWatcher: Watcher error: ${error.message}`);
      });
  }

  public async start(): Promise<void> {
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

  public async close(): Promise<void> {
    await this.watcher.close();
    logger.info('PluginWatcher: Watcher closed.');
  }
}
