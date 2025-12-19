/**
 * Cache Type Definitions
 */

export interface CacheEntry<T = unknown> {
  key: string;
  hash: string;
  timestamp: number;
  data: T;
  dependencies: string[];
}

export interface CacheStatistics {
  hits: number;
  misses: number;
  size: number;
  maxSize: number;
  evictions: number;
}
