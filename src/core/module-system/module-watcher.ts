import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import logger from '../logger.js';
import { getWorkspaceRoot } from '../../config/index.js';

interface WatcherOptions {
  debounceTime?: number; // Milliseconds to debounce events
  baseDir?: string;
}

export class ModuleWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private directoriesToWatch: string[];
  private options: Required<WatcherOptions>;
  private ready = false;
  private knownFiles: Map<string, Set<string>> = new Map(); // dirPath -> Set<fullPath>

  constructor(directoriesToWatch: string | string[], options?: WatcherOptions) {
    super();
    const baseDir = options?.baseDir ?? getWorkspaceRoot();
    const rawDirs = Array.isArray(directoriesToWatch) ? directoriesToWatch : [directoriesToWatch];
    this.directoriesToWatch = rawDirs.map((dirPath) =>
      path.isAbsolute(dirPath) ? dirPath : path.resolve(baseDir, dirPath)
    );
    this.options = {
      debounceTime: options?.debounceTime ?? 300,
      baseDir: baseDir,
    };
  }

  public async start(): Promise<void> {
    logger.info(`Starting module watcher for directories: ${this.directoriesToWatch.join(', ')}`);
    const validDirs: string[] = [];
    for (const dirPath of this.directoriesToWatch) {
      try {
        await fs.promises.access(dirPath, fs.constants.R_OK);
        validDirs.push(dirPath);
        this.knownFiles.set(dirPath, new Set<string>());
      } catch (error) {
        logger.warn(`ModuleWatcher: Directory '${dirPath}' not found or inaccessible. Skipping watch.`, { error });
      }
    }

    if (validDirs.length === 0) {
      logger.warn('ModuleWatcher: No valid directories to watch. Initialization skipped.');
      return;
    }

    this.watcher = chokidar.watch(validDirs, {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: this.options.debounceTime,
        pollInterval: 100,
      },
      depth: undefined,
    });

    this.watcher.on('ready', () => {
      this.ready = true;
      logger.info('ModuleWatcher: Initial scan complete. Ready for changes.');
    });

    const handle = this.handleChokidarEvent.bind(this);
    this.watcher.on('add', (filePath: string) => handle('add', filePath));
    this.watcher.on('change', (filePath: string) => handle('change', filePath));
    this.watcher.on('unlink', (filePath: string) => handle('unlink', filePath));
    this.watcher.on('addDir', (filePath: string) => handle('addDir', filePath));
    this.watcher.on('unlinkDir', (filePath: string) => handle('unlinkDir', filePath));

    this.watcher.on('error', (error) => {
      logger.error(`ModuleWatcher: Chokidar watcher error: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  private updateKnownFiles(root: string, filePath: string, event: 'moduleAdded' | 'moduleChanged' | 'moduleRemoved' | null): void {
    const entry = this.knownFiles.get(root) ?? new Set<string>();
    if (!this.knownFiles.has(root)) {
      this.knownFiles.set(root, entry);
    }
    if (!event) {
      return;
    }
    if (event === 'moduleRemoved') {
      entry.delete(filePath);
    } else {
      entry.add(filePath);
    }
  }

  private handleChokidarEvent(chokidarEvent: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir', filePath: string): void {
    const rootWatchDir = this.directoriesToWatch.find((dir) =>
      filePath === dir || filePath.startsWith(dir + path.sep)
    );
    if (!rootWatchDir) {
      logger.debug(`ModuleWatcher: Event for file outside configured roots: ${filePath}`);
      return;
    }

    const moduleEvent = this.mapEvent(chokidarEvent);
    this.updateKnownFiles(rootWatchDir, filePath, moduleEvent);

    if (!this.ready) {
      return; // Suppress events until initial scan is complete
    }

    if (moduleEvent) {
      logger.debug(`ModuleWatcher: Emitting ${moduleEvent} for ${filePath}`);
      this.emit(moduleEvent, filePath);
    }
  }

  private mapEvent(event: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'): 'moduleAdded' | 'moduleChanged' | 'moduleRemoved' | null {
    switch (event) {
      case 'add':
      case 'addDir':
        return 'moduleAdded';
      case 'change':
        return 'moduleChanged';
      case 'unlink':
      case 'unlinkDir':
        return 'moduleRemoved';
      default:
        return null;
    }
  }

  public async close(): Promise<void> {
    logger.info('Closing module watchers...');
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this.knownFiles.clear();
    this.ready = false;
    logger.info('Module watchers closed.');
  }
}
