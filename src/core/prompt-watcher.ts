import chokidar from 'chokidar';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import logger from './logger.js';

export class PromptWatcher extends EventEmitter {
  private watcher: chokidar.FSWatcher;
  private promptsDir: string;

  constructor(promptsDir: string) {
    super();
    this.promptsDir = path.resolve(process.cwd(), promptsDir);
    this.watcher = chokidar.watch(this.promptsDir, {
      ignored: /(^|[\/\\])\..*/, // ignore dotfiles and dot directories
      persistent: true,
      ignoreInitial: true, // Don't emit add events on startup
      depth: 1, // Only watch direct children of promptsDir
    });

    this.setupListeners();
    logger.info(`PromptWatcher: Monitoring directory: ${this.promptsDir}`);
  }

  private setupListeners() {
    this.watcher
      .on('addDir', path => logger.debug(`PromptWatcher: Directory ${path} has been added`))
      .on('unlinkDir', path => logger.debug(`PromptWatcher: Directory ${path} has been removed`))
      .on('add', path => this.emit('promptAdded', path))
      .on('change', path => this.emit('promptChanged', path))
      .on('unlink', path => this.emit('promptRemoved', path))
      .on('error', error => logger.error(`PromptWatcher: Watcher error: ${error}`));
  }

  public async start(): Promise<void> {
    // Force initial scan without emitting events, then start watching
    await this.watcher.close();
    this.watcher = chokidar.watch(this.promptsDir, {
      ignored: /(^|[\/\\])\..*/, // ignore dotfiles and dot directories
      persistent: true,
      ignoreInitial: false, // Emit add events on startup
      depth: 1, // Only watch direct children of promptsDir
    });
    this.setupListeners();
    logger.info('PromptWatcher: Initial scan complete and watching started.');
  }

  public async close(): Promise<void> {
    await this.watcher.close();
    logger.info('PromptWatcher: Watcher closed.');
  }
}
