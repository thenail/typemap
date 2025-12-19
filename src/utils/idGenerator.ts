/**
 * ID Generator Utilities
 * 
 * Shared utilities for generating consistent IDs for graph nodes.
 * Used by both GraphBuilder and IncrementalUpdateManager.
 */

import * as path from 'path';
import { LightweightSymbol } from '../types';

/**
 * Convert a file path to a unique node ID
 * @param filePath - Absolute file path
 * @param rootPath - Project root path for making relative paths
 * @returns Unique ID in format "path:relative/path/to/file"
 */
export function pathToId(filePath: string, rootPath: string): string {
  const relativePath = path.relative(rootPath, filePath);
  return `path:${relativePath.replace(/[\\\/]/g, '/')}`;
}

/**
 * Convert a symbol to a unique node ID
 * @param symbol - The lightweight symbol
 * @param rootPath - Project root path for making relative paths
 * @returns Unique ID in format "symbol:relative/path:name:line"
 */
export function symbolToId(symbol: LightweightSymbol, rootPath: string): string {
  const relativePath = path.relative(rootPath, symbol.filePath);
  return `symbol:${relativePath.replace(/[\\\/]/g, '/')}:${symbol.name}:${symbol.line}`;
}
