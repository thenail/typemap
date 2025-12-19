/**
 * Incremental Update Manager
 * 
 * Handles efficient incremental updates to the analysis graph when files change.
 * Instead of re-analyzing the entire codebase, only updates affected portions.
 * 
 * Strategies:
 * 1. Track dependencies between files
 * 2. Use IncrementalParser to skip re-parsing when possible
 * 3. Patch graph instead of rebuilding
 * 4. Debounce rapid changes
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { pathToId, symbolToId } from '../utils';
import { StatisticsCalculator } from '../graph/statisticsCalculator';
import { createDefaultMetadata, createMetadataFromSymbol } from '../graph/nodeMetadataBuilder';
import { 
  MindmapGraph, 
  MindmapNode, 
  LightweightSymbol, 
  SymbolKind,
  Edge,
  GitAnalysisResult
} from '../types';
import { LightweightParser } from './lightweightParser';
import { IncrementalParser, createEditInfo, CachedSymbol } from './incrementalParser';
import { CacheManager } from '../cache/cacheManager';
import { getGitIntegration } from '../git';
import { logger } from '../utils';

export interface FileChange {
  filePath: string;
  type: 'created' | 'changed' | 'deleted';
  timestamp: number;
  // Optional edit info for smarter incremental parsing
  editInfo?: {
    startLine: number;
    endLine: number;
    oldLineCount: number;
    newLineCount: number;
  };
}

export interface IncrementalUpdateResult {
  updatedFiles: string[];
  addedNodes: number;
  removedNodes: number;
  updatedNodes: number;
  updateTimeMs: number;
  parseStrategy?: 'full' | 'partial' | 'skip';  // Track which strategy was used
}

export class IncrementalUpdateManager {
  private rootPath: string;
  private parser: LightweightParser;
  private incrementalParser: IncrementalParser;
  private currentGraph: MindmapGraph | null = null;
  
  // Track file content for edit detection
  private fileContentCache: Map<string, { content: string; lineCount: number }> = new Map();
  
  // Debounce handling
  private pendingChanges: Map<string, FileChange> = new Map();
  private debounceTimer: NodeJS.Timeout | null = null;
  private debounceMs: number = 300;
  
  // Dependency tracking: file -> files that import it
  private dependents: Map<string, Set<string>> = new Map();
  
  // Callbacks
  private onUpdateCallbacks: ((result: IncrementalUpdateResult) => void)[] = [];

  constructor(
    rootPath: string, 
    cacheManager: CacheManager,
    debounceMs: number = 300
  ) {
    this.rootPath = rootPath;
    this.parser = new LightweightParser(cacheManager);
    this.incrementalParser = new IncrementalParser();
    this.debounceMs = debounceMs;
  }

  /**
   * Set the current graph to update incrementally
   */
  setGraph(graph: MindmapGraph): void {
    this.currentGraph = graph;
    // Build dependency map from graph edges
    this.buildDependencyMap();
    
    // Pre-populate file content cache for incremental parsing
    this.initializeFileCache();
  }

  /**
   * Initialize file content cache for all files in the graph
   */
  private initializeFileCache(): void {
    if (!this.currentGraph) return;
    
    for (const node of this.currentGraph.nodes.values()) {
      if (node.type === 'file' && node.filePath) {
        try {
          const content = fs.readFileSync(node.filePath, 'utf-8');
          this.fileContentCache.set(node.filePath, {
            content,
            lineCount: content.split('\n').length
          });
          
          // Also initialize the incremental parser cache
          this.incrementalParser.parseIncremental(node.filePath, content);
        } catch {
          // File might not exist anymore
        }
      }
    }
    
    logger.info(`Initialized incremental parser cache for ${this.fileContentCache.size} files`);
  }

  /**
   * Get the current graph
   */
  getGraph(): MindmapGraph | null {
    return this.currentGraph;
  }

  /**
   * Register a file change (debounced)
   */
  registerChange(filePath: string, type: 'created' | 'changed' | 'deleted'): void {
    // Only process TypeScript/TSX files
    if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) {
      return;
    }

    // Skip node_modules and other excluded paths
    if (filePath.includes('node_modules') || filePath.includes('dist')) {
      return;
    }

    this.pendingChanges.set(filePath, {
      filePath,
      type,
      timestamp: Date.now()
    });

    // Debounce the update
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.processPendingChanges();
    }, this.debounceMs);
  }

  /**
   * Force immediate processing of pending changes
   */
  async flush(): Promise<IncrementalUpdateResult | null> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    return this.processPendingChanges();
  }

  /**
   * Register callback for updates
   */
  onUpdate(callback: (result: IncrementalUpdateResult) => void): vscode.Disposable {
    this.onUpdateCallbacks.push(callback);
    return new vscode.Disposable(() => {
      const index = this.onUpdateCallbacks.indexOf(callback);
      if (index >= 0) {
        this.onUpdateCallbacks.splice(index, 1);
      }
    });
  }

  /**
   * Process all pending changes
   */
  private async processPendingChanges(): Promise<IncrementalUpdateResult | null> {
    if (this.pendingChanges.size === 0 || !this.currentGraph) {
      return null;
    }

    const startTime = performance.now();
    const changes = Array.from(this.pendingChanges.values());
    this.pendingChanges.clear();

    logger.info(`Processing ${changes.length} file changes incrementally`);

    let addedNodes = 0;
    let removedNodes = 0;
    let updatedNodes = 0;
    const updatedFiles: string[] = [];
    let lastStrategy: 'full' | 'partial' | 'skip' = 'full';

    for (const change of changes) {
      try {
        switch (change.type) {
          case 'created':
            const added = await this.handleFileCreated(change.filePath);
            addedNodes += added;
            lastStrategy = 'full';
            break;
            
          case 'deleted':
            const removed = this.handleFileDeleted(change.filePath);
            removedNodes += removed;
            lastStrategy = 'full';
            break;
            
          case 'changed':
            const result = await this.handleFileChanged(change.filePath);
            addedNodes += result.added;
            removedNodes += result.removed;
            lastStrategy = result.strategy;
            if (result.strategy !== 'skip') {
              updatedNodes++;
            }
            break;
        }
        updatedFiles.push(change.filePath);
      } catch (error) {
        logger.error(`Failed to process change for ${change.filePath}:`, error as Error);
      }
    }

    // Update git status
    await this.updateGitStatus();

    // Update statistics
    this.updateStatistics();

    const result: IncrementalUpdateResult = {
      updatedFiles,
      addedNodes,
      removedNodes,
      updatedNodes,
      updateTimeMs: performance.now() - startTime,
      parseStrategy: lastStrategy
    };

    // Notify callbacks
    for (const callback of this.onUpdateCallbacks) {
      try {
        callback(result);
      } catch (e) {
        logger.error('Update callback error:', e as Error);
      }
    }

    logger.info(`Incremental update completed: +${addedNodes} -${removedNodes} nodes (strategy: ${lastStrategy}) in ${result.updateTimeMs.toFixed(0)}ms`);

    return result;
  }

  /**
   * Handle a newly created file
   */
  private async handleFileCreated(filePath: string): Promise<number> {
    if (!this.currentGraph) return 0;

    // Parse the new file
    const symbols = await this.parser.parseFile(filePath);
    
    // Add file node
    const fileId = pathToId(filePath, this.rootPath);
    const fileName = path.basename(filePath);
    
    // Compute file-level metrics from symbols
    const totalLoc = symbols.reduce((sum, s) => sum + (s.linesOfCode || 0), 0);
    const totalComplexity = symbols.reduce((sum, s) => sum + (s.complexity || 1), 0);
    
    const metadata = createDefaultMetadata();
    metadata.linesOfCode = totalLoc;
    metadata.complexity = totalComplexity;
    metadata.exportCount = symbols.filter(s => s.exported).length;
    
    const fileNode: MindmapNode = {
      id: fileId,
      label: fileName,
      type: 'file',
      filePath,
      children: [],
      collapsed: true,
      metadata
    };
    
    this.currentGraph.nodes.set(fileId, fileNode);

    // Find and connect to parent folder
    const folderPath = path.dirname(filePath);
    const folderId = pathToId(folderPath, this.rootPath);
    const folderNode = this.currentGraph.nodes.get(folderId);
    
    if (folderNode) {
      folderNode.children.push(fileId);
      this.currentGraph.edges.push({
        source: folderId,
        target: fileId,
        type: 'contains'
      });
    }

    // Add symbol nodes
    let addedCount = 1; // file node
    for (const symbol of symbols) {
      const symbolId = symbolToId(symbol, this.rootPath);
      const symbolNode: MindmapNode = {
        id: symbolId,
        label: symbol.name,
        type: symbol.kind as any,
        filePath,
        line: symbol.line,
        children: [],
        collapsed: false,
        metadata: createMetadataFromSymbol(symbol)
      };
      
      this.currentGraph.nodes.set(symbolId, symbolNode);
      fileNode.children.push(symbolId);
      this.currentGraph.edges.push({
        source: fileId,
        target: symbolId,
        type: 'contains'
      });
      addedCount++;
    }

    return addedCount;
  }

  /**
   * Handle a deleted file
   */
  private handleFileDeleted(filePath: string): number {
    if (!this.currentGraph) return 0;

    const fileId = pathToId(filePath, this.rootPath);
    const fileNode = this.currentGraph.nodes.get(fileId);
    
    if (!fileNode) return 0;

    let removedCount = 0;

    // Remove all symbol nodes for this file
    for (const childId of fileNode.children) {
      this.currentGraph.nodes.delete(childId);
      removedCount++;
    }

    // Remove file node
    this.currentGraph.nodes.delete(fileId);
    removedCount++;

    // Remove from parent's children
    const folderPath = path.dirname(filePath);
    const folderId = pathToId(folderPath, this.rootPath);
    const folderNode = this.currentGraph.nodes.get(folderId);
    
    if (folderNode) {
      const index = folderNode.children.indexOf(fileId);
      if (index >= 0) {
        folderNode.children.splice(index, 1);
      }
    }

    // Remove edges involving this file or its symbols
    this.currentGraph.edges = this.currentGraph.edges.filter(edge => {
      return edge.source !== fileId && 
             edge.target !== fileId &&
             !fileNode.children.includes(edge.source) &&
             !fileNode.children.includes(edge.target);
    });

    return removedCount;
  }

  /**
   * Handle a changed file - uses IncrementalParser for smart updates
   */
  private async handleFileChanged(filePath: string): Promise<{ added: number; removed: number; strategy: 'full' | 'partial' | 'skip' }> {
    if (!this.currentGraph) return { added: 0, removed: 0, strategy: 'skip' };

    // Read new content
    let newContent: string;
    try {
      newContent = fs.readFileSync(filePath, 'utf-8');
    } catch {
      // File might have been deleted
      return { added: 0, removed: this.handleFileDeleted(filePath), strategy: 'full' };
    }

    // Get cached content for edit detection
    const cached = this.fileContentCache.get(filePath);
    const oldLineCount = cached?.lineCount ?? 0;
    const newLineCount = newContent.split('\n').length;

    // Create edit info (approximate - we don't have exact edit position from file watcher)
    // We use a heuristic: if line count changed, assume edit at end; otherwise, assume middle
    const editInfo = createEditInfo(
      oldLineCount,
      newLineCount,
      1,  // Assume edit could be anywhere
      Math.max(oldLineCount, newLineCount)
    );

    // Use incremental parser
    const result = this.incrementalParser.parseIncremental(filePath, newContent, editInfo);
    
    // Update content cache
    this.fileContentCache.set(filePath, { content: newContent, lineCount: newLineCount });

    // If we can skip parsing entirely (edit inside function body), just return
    if (result.parseStrategy === 'skip' && result.affectedSymbols.length === 0) {
      logger.debug(`Skipped re-parsing ${path.basename(filePath)} - no structural changes`);
      return { added: 0, removed: 0, strategy: 'skip' };
    }

    // If partial parse and no affected symbols, just update line numbers
    if (result.parseStrategy === 'partial' && result.affectedSymbols.length === 0) {
      // Update line numbers for existing nodes
      const fileId = pathToId(filePath, this.rootPath);
      const fileNode = this.currentGraph.nodes.get(fileId);
      
      if (fileNode) {
        const linesDelta = newLineCount - oldLineCount;
        for (const childId of fileNode.children) {
          const childNode = this.currentGraph.nodes.get(childId);
          if (childNode && childNode.line) {
            // Find corresponding cached symbol to get updated line
            const cachedSymbol = result.symbols.find(s => 
              s.name === childNode.label && s.kind === childNode.type
            );
            if (cachedSymbol) {
              childNode.line = cachedSymbol.startLine;
            }
          }
        }
      }
      
      logger.debug(`Partial update for ${path.basename(filePath)} - adjusted line numbers`);
      return { added: 0, removed: 0, strategy: 'partial' };
    }

    // Full re-parse needed - remove old and add new
    const removed = this.handleFileDeleted(filePath);
    const added = await this.handleFileCreatedWithSymbols(filePath, result.symbols);
    
    logger.debug(`Full re-parse for ${path.basename(filePath)} - ${removed} removed, ${added} added`);
    return { added, removed, strategy: 'full' };
  }

  /**
   * Handle file created with pre-parsed symbols
   */
  private async handleFileCreatedWithSymbols(filePath: string, cachedSymbols: CachedSymbol[]): Promise<number> {
    if (!this.currentGraph) return 0;

    // Convert cached symbols to lightweight symbols
    const symbols: LightweightSymbol[] = cachedSymbols.map(cs => ({
      name: cs.name,
      kind: cs.kind as SymbolKind,
      line: cs.startLine,
      endLine: cs.endLine,
      column: 0,
      filePath,
      exported: true,  // Assume exported for now
      isDefault: false,
      linesOfCode: (cs.endLine || cs.startLine) - cs.startLine + 1,
      complexity: 1
    }));
    
    // Add file node
    const fileId = pathToId(filePath, this.rootPath);
    const fileName = path.basename(filePath);
    
    // Compute file-level metrics
    const totalLoc = symbols.reduce((sum, s) => sum + (s.linesOfCode || 0), 0);
    
    const fileMetadata = createDefaultMetadata();
    fileMetadata.linesOfCode = totalLoc;
    fileMetadata.complexity = symbols.length;
    fileMetadata.exportCount = symbols.length;
    
    const fileNode: MindmapNode = {
      id: fileId,
      label: fileName,
      type: 'file',
      filePath,
      children: [],
      collapsed: true,
      metadata: fileMetadata
    };
    
    this.currentGraph.nodes.set(fileId, fileNode);

    // Find and connect to parent folder
    const folderPath = path.dirname(filePath);
    const folderId = pathToId(folderPath, this.rootPath);
    const folderNode = this.currentGraph.nodes.get(folderId);
    
    if (folderNode) {
      folderNode.children.push(fileId);
      this.currentGraph.edges.push({
        source: folderId,
        target: fileId,
        type: 'contains'
      });
    }

    // Add symbol nodes
    let addedCount = 1; // file node
    for (const symbol of symbols) {
      const symbolId = symbolToId(symbol, this.rootPath);
      const symbolNode: MindmapNode = {
        id: symbolId,
        label: symbol.name,
        type: symbol.kind as any,
        filePath,
        line: symbol.line,
        children: [],
        collapsed: false,
        metadata: createMetadataFromSymbol(symbol)
      };
      
      this.currentGraph.nodes.set(symbolId, symbolNode);
      fileNode.children.push(symbolId);
      this.currentGraph.edges.push({
        source: fileId,
        target: symbolId,
        type: 'contains'
      });
      addedCount++;
    }

    return addedCount;
  }

  /**
   * Update git status for all nodes
   */
  private async updateGitStatus(): Promise<void> {
    if (!this.currentGraph) return;

    try {
      const gitIntegration = getGitIntegration();
      await gitIntegration.initialize();
      const gitChanges = await gitIntegration.getChanges(this.rootPath);

      // Clear old git status
      for (const node of this.currentGraph.nodes.values()) {
        if (node.metadata.gitStatus) {
          node.metadata.gitStatus = undefined;
        }
      }

      // Apply new git status
      for (const [filePath, change] of gitChanges.changes) {
        const fileId = pathToId(filePath, this.rootPath);
        const fileNode = this.currentGraph.nodes.get(fileId);
        
        if (fileNode) {
          fileNode.metadata.gitStatus = change.status;
          
          // Apply to children
          for (const childId of fileNode.children) {
            const childNode = this.currentGraph.nodes.get(childId);
            if (childNode) {
              childNode.metadata.gitStatus = change.status;
            }
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to update git status:', error as Error);
    }
  }

  /**
   * Update graph statistics
   */
  private updateStatistics(): void {
    if (!this.currentGraph) return;
    StatisticsCalculator.updateInPlace(this.currentGraph);
  }

  /**
   * Build dependency map from imports in the graph
   */
  private buildDependencyMap(): void {
    this.dependents.clear();
    // TODO: Parse imports and build dependency graph
    // For now, we just re-parse changed files without propagating
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.pendingChanges.clear();
    this.onUpdateCallbacks = [];
    this.fileContentCache.clear();
    this.incrementalParser.clearCache();
  }
}
