import { InfectedConfig } from '../config/index.js'; // Assuming access to overall config for cache settings
import { createHash } from 'node:crypto';
import logger from './logger.js'; // Use our central logger

interface CacheEntry {
  value: any;
  timestamp: number;
  ttl: number; // Time-to-live in milliseconds
}

export class ToolCacheManager {
  private cache = new Map<string, CacheEntry>();
  private defaultConfig: {
    enabled: boolean;
    defaultTTL: number; // in milliseconds
    maxSize: number; // max number of entries
  } = {
    enabled: true,
    defaultTTL: 5 * 60 * 1000, // 5 minutes
    maxSize: 1000,
  };
  
  // Metrics counters
  private _totalCacheRequests = 0;
  private _cacheHits = 0;
  private _cacheMisses = 0;

  private cleanupInterval: NodeJS.Timeout | undefined;

  constructor(config?: InfectedConfig['cache']) {
    if (config) {
      this.defaultConfig = {
        ...this.defaultConfig,
        ...config,
      };
    }
    // Moved startCleanupInterval() call to be explicit or on-demand from MonitoringManager
    logger.info(`ToolCacheManager initialized. Enabled: ${this.defaultConfig.enabled}, Default TTL: ${this.defaultConfig.defaultTTL / 1000}s, Max Size: ${this.defaultConfig.maxSize}`);
  }

  public setConfig(config?: InfectedConfig['cache']): void {
    if (config) {
        this.defaultConfig = { ...this.defaultConfig, ...config };
    }
    // Optionally restart cleanup interval if config changes
  }

  private tryGetCacheKey(toolName: string, args: any): string | null {
    try {
      const serialized = this.stableSerialize(args, new WeakSet<object>());
      const hash = createHash('sha256').update(serialized).digest('hex');
      return `${toolName}:${hash}`;
    } catch (error) {
      logger.warn(`ToolCacheManager: Failed to serialize args for tool '${toolName}'. Skipping caching.`, { error });
      return null;
    }
  }

  private stableSerialize(value: unknown, seen: WeakSet<object>): string {
    if (value === null) {
      return 'null';
    }
    if (value === undefined) {
      return 'undefined';
    }
    if (typeof value === 'string') {
      return JSON.stringify(value);
    }
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return String(value);
    }
    if (typeof value === 'symbol') {
      return value.toString();
    }
    if (typeof value === 'function') {
      return '[Function]';
    }
    if (value instanceof Date) {
      return `Date(${value.toISOString()})`;
    }
    if (value instanceof RegExp) {
      return `RegExp(${value.toString()})`;
    }
    if (Array.isArray(value)) {
      return `Array([${value.map((item) => this.stableSerialize(item, seen)).join(',')}])`;
    }
    if (value instanceof Map) {
      if (seen.has(value)) {
        return '"[Circular]"';
      }
      seen.add(value);
      const entries = Array.from(value.entries()).map(([key, val]) => `${this.stableSerialize(key, seen)}:${this.stableSerialize(val, seen)}`);
      seen.delete(value);
      return `Map({${entries.sort().join(',')}})`;
    }
    if (value instanceof Set) {
      if (seen.has(value)) {
        return '"[Circular]"';
      }
      seen.add(value);
      const entries = Array.from(value.values()).map((entry) => this.stableSerialize(entry, seen));
      seen.delete(value);
      return `Set(${[...entries].sort().join(',')})`;
    }
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if (seen.has(obj)) {
        return '"[Circular]"';
      }
      seen.add(obj);
      const keys = Object.keys(obj).sort();
      const entries = keys.map((key) => `${JSON.stringify(key)}:${this.stableSerialize(obj[key], seen)}`);
      seen.delete(obj);
      return `{${entries.join(',')}}`;
    }
    return JSON.stringify(value);
  }

  get<T>(toolName: string, args: any): T | undefined {
    if (!this.defaultConfig.enabled) {
      return undefined;
    }

    this._totalCacheRequests++; // Increment total requests

    const key = this.tryGetCacheKey(toolName, args);
    if (!key) {
      return undefined;
    }
    const entry = this.cache.get(key);

    if (entry) {
      if (Date.now() < entry.timestamp + entry.ttl) {
        logger.debug(`Cache hit for ${toolName}.`);
        this._cacheHits++; // Increment hits
        return entry.value as T;
      } else {
        logger.debug(`Cache expired for ${toolName}.`);
        this.cache.delete(key); // Invalidate expired entry
        this._cacheMisses++; // Expired is also a miss
      }
    } else {
        this._cacheMisses++; // Not found is a miss
    }
    logger.debug(`Cache miss for ${toolName}.`);
    return undefined;
  }

  set(toolName: string, args: any, value: any, ttl?: number): void {
    if (!this.defaultConfig.enabled) {
      return;
    }

    const key = this.tryGetCacheKey(toolName, args);
    if (!key) {
      logger.debug(`ToolCacheManager: Cannot cache tool '${toolName}' because arguments could not be serialized.`);
      return;
    }
    const entryTTL = ttl !== undefined ? ttl : this.defaultConfig.defaultTTL;

    if (this.cache.size >= this.defaultConfig.maxSize) {
      this.pruneCache(); // Make space if cache is full
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      ttl: entryTTL,
    });
    logger.debug(`Cache set for ${toolName}. Current cache size: ${this.cache.size}`);
  }

  invalidate(toolName: string, args?: any): void {
    if (!this.defaultConfig.enabled) {
      return;
    }

    if (args) {
      const key = this.tryGetCacheKey(toolName, args);
      if (!key) {
        logger.debug(`ToolCacheManager: Cannot invalidate cache for '${toolName}' because arguments could not be serialized.`);
        return;
      }
      this.cache.delete(key);
      logger.debug(`Cache invalidated for specific entry of ${toolName}.`);
    } else {
      for (const key of this.cache.keys()) {
        if (key.startsWith(`${toolName}:`)) {
          this.cache.delete(key);
        }
      }
      logger.debug(`Cache invalidated for all entries of ${toolName}.`);
    }
  }

  clear(): void {
    logger.info('Clearing entire tool cache.');
    this.cache.clear();
    this._totalCacheRequests = 0;
    this._cacheHits = 0;
    this._cacheMisses = 0;
  }

  private pruneCache(): void {
    logger.debug('Pruning cache...');
    const now = Date.now();
    let oldestKey: string | undefined;
    let oldestTimestamp = now;

    for (const [key, entry] of this.cache.entries()) {
      if (now >= entry.timestamp + entry.ttl) {
        this.cache.delete(key);
      } else if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
        oldestKey = key;
      }
    }

    if (this.cache.size >= this.defaultConfig.maxSize && oldestKey) {
      this.cache.delete(oldestKey);
      logger.debug(`Removed oldest entry from cache: ${oldestKey}.`);
    }
    logger.debug(`Cache pruned. Current size: ${this.cache.size}`);
  }

  // NEW: Public method to get cache statistics
  public getStats() {
    return {
      enabled: this.defaultConfig.enabled,
      totalRequests: this._totalCacheRequests,
      hits: this._cacheHits,
      misses: this._cacheMisses,
      size: this.cache.size,
      maxSize: this.defaultConfig.maxSize
    };
  }

  // Removed startCleanupInterval() from constructor; it will be managed externally (e.g., from MonitoringManager)
  stopCleanupInterval(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }
}
