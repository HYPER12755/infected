import chokidar from 'chokidar';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import logger from './logger.js';

export class PluginWatcher extends EventEmitter {
  private watcher: chokidar.FSWatcher;
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
      .on('addDir', path => logger.debug(`PluginWatcher: Directory ${path} has been added`))
      .on('unlinkDir', path => logger.debug(`PluginWatcher: Directory ${path} has been removed`))
      .on('add', path => this.emit('pluginAdded', path))
      .on('change', path => this.emit('pluginChanged', path))
      .on('unlink', path => this.emit('pluginRemoved', path))
      .on('error', error => logger.error(`PluginWatcher: Watcher error: ${error}`));
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
