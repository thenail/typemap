/**
 * Cache Manager
 * Multi-layer caching for analysis results
 * 
 * L1: In-memory LRU cache (hot data)
 * L2: Workspace storage (warm data, persistent)
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { CacheEntry, CacheStatistics } from '../types';

export class CacheManager {
  private context: vscode.ExtensionContext;
  private maxSizeMB: number;
  
  // L1: In-memory LRU cache
  private l1Cache: Map<string, CacheEntry> = new Map();
  private l1Order: string[] = []; // For LRU eviction
  private l1SizeBytes: number = 0;
  
  private stats: CacheStatistics = {
    hits: 0,
    misses: 0,
    size: 0,
    maxSize: 0,
    evictions: 0
  };

  constructor(context: vscode.ExtensionContext, maxSizeMB: number = 100) {
    this.context = context;
    this.maxSizeMB = maxSizeMB;
    this.stats.maxSize = maxSizeMB * 1024 * 1024;
  }

  /**
   * Get cached data for a file
   */
  async get<T>(filePath: string): Promise<T | null> {
    const hash = await this.getFileHash(filePath);
    if (!hash) return null;

    const key = this.getCacheKey(filePath);

    // Check L1 cache first
    const l1Entry = this.l1Cache.get(key);
    if (l1Entry && l1Entry.hash === hash) {
      // Move to end (most recently used)
      this.touchL1(key);
      this.stats.hits++;
      return l1Entry.data as T;
    }

    // Check L2 cache (workspace storage)
    const l2Data = this.context.workspaceState.get<CacheEntry>(key);
    if (l2Data && l2Data.hash === hash) {
      // Promote to L1
      await this.setL1(key, l2Data);
      this.stats.hits++;
      return l2Data.data as T;
    }

    this.stats.misses++;
    return null;
  }

  /**
   * Store data in cache
   */
  async set<T>(filePath: string, data: T, content: string): Promise<void> {
    const hash = this.computeHash(content);
    const key = this.getCacheKey(filePath);

    const entry: CacheEntry<T> = {
      key,
      hash,
      timestamp: Date.now(),
      data,
      dependencies: []
    };

    // Store in L1
    await this.setL1(key, entry);

    // Store in L2 (workspace storage)
    await this.context.workspaceState.update(key, entry);
  }

  /**
   * Clear all cache
   */
  async clear(): Promise<void> {
    // Clear L1
    this.l1Cache.clear();
    this.l1Order = [];
    this.l1SizeBytes = 0;

    // Clear L2 - we need to iterate through workspace state keys
    // For now, just reset stats
    this.stats = {
      hits: 0,
      misses: 0,
      size: 0,
      maxSize: this.maxSizeMB * 1024 * 1024,
      evictions: 0
    };
  }

  /**
   * Invalidate cache for specific files
   */
  async invalidate(filePaths: string[]): Promise<void> {
    for (const filePath of filePaths) {
      const key = this.getCacheKey(filePath);
      
      // Remove from L1
      if (this.l1Cache.has(key)) {
        this.l1Cache.delete(key);
        this.l1Order = this.l1Order.filter(k => k !== key);
      }

      // Remove from L2
      await this.context.workspaceState.update(key, undefined);
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStatistics {
    return { 
      ...this.stats,
      size: this.l1SizeBytes
    };
  }

  /**
   * Set entry in L1 cache with LRU eviction
   */
  private async setL1<T>(key: string, entry: CacheEntry<T>): Promise<void> {
    const entrySize = this.estimateSize(entry);
    const maxBytes = this.maxSizeMB * 1024 * 1024;

    // Evict if necessary
    while (this.l1SizeBytes + entrySize > maxBytes && this.l1Order.length > 0) {
      const oldestKey = this.l1Order.shift()!;
      const oldEntry = this.l1Cache.get(oldestKey);
      if (oldEntry) {
        this.l1SizeBytes -= this.estimateSize(oldEntry);
        this.l1Cache.delete(oldestKey);
        this.stats.evictions++;
      }
    }

    // Add new entry
    this.l1Cache.set(key, entry as CacheEntry);
    this.l1Order.push(key);
    this.l1SizeBytes += entrySize;
    this.stats.size = this.l1SizeBytes;
  }

  /**
   * Touch L1 entry (mark as recently used)
   */
  private touchL1(key: string): void {
    const index = this.l1Order.indexOf(key);
    if (index > -1) {
      this.l1Order.splice(index, 1);
      this.l1Order.push(key);
    }
  }

  /**
   * Get file hash for cache validation
   */
  private async getFileHash(filePath: string): Promise<string | null> {
    try {
      const uri = vscode.Uri.file(filePath);
      const content = await vscode.workspace.fs.readFile(uri);
      return this.computeHash(Buffer.from(content).toString('utf8'));
    } catch {
      return null;
    }
  }

  /**
   * Compute hash of content (using SHA-256 for simplicity, xxhash would be faster)
   */
  private computeHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  /**
   * Generate cache key from file path
   */
  private getCacheKey(filePath: string): string {
    return `typemap.cache.${this.computeHash(filePath)}`;
  }

  /**
   * Estimate size of cache entry in bytes
   */
  private estimateSize(entry: CacheEntry): number {
    // Rough estimate: JSON stringify length * 2 (for UTF-16)
    try {
      return JSON.stringify(entry).length * 2;
    } catch {
      return 1024; // Default estimate
    }
  }
}
