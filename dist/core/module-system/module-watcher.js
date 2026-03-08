import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import chokidar from 'chokidar';
import logger from '../logger.js';
import { getWorkspaceRoot } from '../../config/index.js';
export class ModuleWatcher extends EventEmitter {
    constructor(directoriesToWatch, options) {
        super();
        this.watcher = null;
        this.ready = false;
        this.knownFiles = new Map(); // dirPath -> Set<fullPath>
        const baseDir = options?.baseDir ?? getWorkspaceRoot();
        const rawDirs = Array.isArray(directoriesToWatch) ? directoriesToWatch : [directoriesToWatch];
        this.directoriesToWatch = rawDirs.map((dirPath) => path.isAbsolute(dirPath) ? dirPath : path.resolve(baseDir, dirPath));
        this.options = {
            debounceTime: options?.debounceTime ?? 300,
            baseDir: baseDir,
        };
    }
    async start() {
        logger.info(`Starting module watcher for directories: ${this.directoriesToWatch.join(', ')}`);
        const validDirs = [];
        for (const dirPath of this.directoriesToWatch) {
            try {
                await fs.promises.access(dirPath, fs.constants.R_OK);
                validDirs.push(dirPath);
                this.knownFiles.set(dirPath, new Set());
            }
            catch (error) {
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
        this.watcher.on('add', (filePath) => handle('add', filePath));
        this.watcher.on('change', (filePath) => handle('change', filePath));
        this.watcher.on('unlink', (filePath) => handle('unlink', filePath));
        this.watcher.on('addDir', (filePath) => handle('addDir', filePath));
        this.watcher.on('unlinkDir', (filePath) => handle('unlinkDir', filePath));
        this.watcher.on('error', (error) => {
            logger.error(`ModuleWatcher: Chokidar watcher error: ${error instanceof Error ? error.message : String(error)}`);
        });
    }
    updateKnownFiles(root, filePath, event) {
        const entry = this.knownFiles.get(root) ?? new Set();
        if (!this.knownFiles.has(root)) {
            this.knownFiles.set(root, entry);
        }
        if (!event) {
            return;
        }
        if (event === 'moduleRemoved') {
            entry.delete(filePath);
        }
        else {
            entry.add(filePath);
        }
    }
    handleChokidarEvent(chokidarEvent, filePath) {
        const rootWatchDir = this.directoriesToWatch.find((dir) => filePath === dir || filePath.startsWith(dir + path.sep));
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
    mapEvent(event) {
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
    async close() {
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
