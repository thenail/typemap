/**
 * File Discovery
 * Fast file enumeration for TypeScript/TSX codebases
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { FileDiscoveryConfig, FileDiscoveryResult } from '../types';

export class FileDiscovery {
  private config: FileDiscoveryConfig;

  constructor(config: FileDiscoveryConfig) {
    this.config = config;
  }

  /**
   * Discover all TypeScript/TSX files in the workspace
   * Uses VS Code's native file search for maximum speed
   */
  async discover(): Promise<FileDiscoveryResult> {
    const startTime = performance.now();
    const files: string[] = [];

    try {
      // Use VS Code's built-in file search (fastest option)
      // It leverages the workspace indexer
      for (const pattern of this.config.include) {
        const excludePattern = this.buildExcludePattern();
        
        const uris = await vscode.workspace.findFiles(
          new vscode.RelativePattern(this.config.rootPath, pattern),
          excludePattern,
          this.config.maxFiles
        );

        for (const uri of uris) {
          if (files.length >= this.config.maxFiles) {
            break;
          }
          files.push(uri.fsPath);
        }
      }

      // Remove duplicates (in case patterns overlap)
      const uniqueFiles = [...new Set(files)];

      const endTime = performance.now();

      return {
        files: uniqueFiles.slice(0, this.config.maxFiles),
        totalSize: 0, // Size calculation is expensive, skip for speed
        discoveryTimeMs: endTime - startTime
      };

    } catch (error) {
      console.error('File discovery error:', error);
      throw error;
    }
  }

  /**
   * Build exclude pattern from config
   */
  private buildExcludePattern(): string {
    // Combine all exclude patterns into a single glob
    // VS Code's findFiles accepts a single exclude pattern
    if (this.config.exclude.length === 0) {
      return '';
    }

    // Create a pattern that matches any of the excludes
    return `{${this.config.exclude.join(',')}}`;
  }

  /**
   * Get files changed since last analysis
   * Used for incremental updates
   */
  async getChangedFiles(since: number): Promise<string[]> {
    // For incremental analysis, we track file changes
    // This is a simplified version - full implementation would use file watchers
    const allFiles = await this.discover();
    
    const changedFiles: string[] = [];
    
    for (const filePath of allFiles.files) {
      try {
        const uri = vscode.Uri.file(filePath);
        const stat = await vscode.workspace.fs.stat(uri);
        
        if (stat.mtime > since) {
          changedFiles.push(filePath);
        }
      } catch {
        // File might have been deleted
      }
    }

    return changedFiles;
  }

  /**
   * Check if a file matches the include/exclude patterns
   */
  matchesPatterns(filePath: string): boolean {
    const relativePath = path.relative(this.config.rootPath, filePath);
    
    // Check excludes first
    for (const pattern of this.config.exclude) {
      if (this.matchGlob(relativePath, pattern)) {
        return false;
      }
    }

    // Check includes
    for (const pattern of this.config.include) {
      if (this.matchGlob(relativePath, pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Simple glob matching
   */
  private matchGlob(filePath: string, pattern: string): boolean {
    // Convert glob to regex
    const regexPattern = pattern
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.')
      .replace(/{{GLOBSTAR}}/g, '.*')
      .replace(/\//g, '[\\\\/]');

    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(filePath);
  }
}
