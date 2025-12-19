/**
 * Analyze Command
 * Handles codebase analysis operations
 */

import * as vscode from 'vscode';
import { TypeMapConfig, AnalysisResult, AnalysisError, MindmapGraph, PerformanceMetrics, GitAnalysisResult } from '../types';
import { FileDiscovery } from '../analysis/fileDiscovery';
import { LightweightParser } from '../analysis/lightweightParser';
import { GraphBuilder } from '../graph/graphBuilder';
import { CacheManager } from '../cache/cacheManager';
import { getGitIntegration } from '../git';

export interface AnalyzeOptions {
  incremental?: boolean;
  rootPath?: string;
  includeGitStatus?: boolean;  // Whether to include git change information
}

export class AnalyzeCommand {
  private context: vscode.ExtensionContext;
  private config: TypeMapConfig;
  private cacheManager: CacheManager;
  private currentGraph: MindmapGraph | null = null;

  constructor(context: vscode.ExtensionContext, config: TypeMapConfig) {
    this.context = context;
    this.config = config;
    this.cacheManager = new CacheManager(context, config.performance.cacheSize);
  }

  /**
   * Execute full workspace analysis
   */
  async execute(options: AnalyzeOptions = {}): Promise<AnalysisResult | null> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage('TypeMap: No workspace folder open');
      return null;
    }

    const rootPath = options.rootPath || workspaceFolders[0].uri.fsPath;

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'TypeMap: Analyzing codebase',
        cancellable: true
      },
      async (progress, token) => {
        const startTime = performance.now();
        const errors: AnalysisError[] = [];
        const warnings: string[] = [];

        try {
          // Phase 1: File Discovery
          progress.report({ message: 'Discovering files...', increment: 0 });
          
          const discovery = new FileDiscovery({
            rootPath,
            include: this.config.analysis.include,
            exclude: this.config.analysis.exclude,
            maxDepth: 50,
            maxFiles: this.config.analysis.maxFiles,
            useGitignore: true
          });

          const discoveryResult = await discovery.discover();
          
          if (token.isCancellationRequested) {
            return null;
          }

          if (discoveryResult.files.length === 0) {
            vscode.window.showWarningMessage('TypeMap: No TypeScript/TSX files found');
            return null;
          }

          // Phase 2: Lightweight Parsing
          progress.report({ 
            message: `Parsing ${discoveryResult.files.length} files...`, 
            increment: 20 
          });

          const parser = new LightweightParser(this.cacheManager);
          const parseStartTime = performance.now();
          
          const symbols = await parser.parseFiles(
            discoveryResult.files,
            (completed: number, total: number) => {
              const percent = Math.round((completed / total) * 60);
              progress.report({ 
                message: `Parsing files (${completed}/${total})...`,
                increment: percent - 20
              });
            },
            token
          );

          if (token.isCancellationRequested) {
            return null;
          }

          const parseEndTime = performance.now();

          // Phase 3: Build Graph
          progress.report({ message: 'Building mindmap graph...', increment: 80 });

          const graphBuilder = new GraphBuilder(rootPath);
          const graphStartTime = performance.now();
          
          this.currentGraph = graphBuilder.build(symbols, discoveryResult.files);
          
          const graphEndTime = performance.now();

          // Phase 4: Git Integration (optional but enabled by default)
          let gitChanges: GitAnalysisResult | undefined;
          
          if (options.includeGitStatus !== false) {
            progress.report({ message: 'Checking git status...', increment: 90 });
            
            const gitIntegration = getGitIntegration();
            await gitIntegration.initialize();
            gitChanges = await gitIntegration.getChanges(rootPath);
            
            // Apply git status to graph nodes
            if (gitChanges.hasUncommittedChanges) {
              graphBuilder.applyGitStatus(this.currentGraph, gitChanges);
            }
          }

          progress.report({ message: 'Complete!', increment: 100 });

          const endTime = performance.now();

          const performanceMetrics: PerformanceMetrics = {
            discoveryTimeMs: Math.round(discoveryResult.discoveryTimeMs),
            parseTimeMs: Math.round(parseEndTime - parseStartTime),
            graphBuildTimeMs: Math.round(graphEndTime - graphStartTime),
            totalTimeMs: Math.round(endTime - startTime),
            filesAnalyzed: discoveryResult.files.length,
            cacheHits: parser.getCacheStats().hits,
            cacheMisses: parser.getCacheStats().misses
          };

          // Store result in workspace state
          await this.context.workspaceState.update('typemap.lastAnalysis', {
            timestamp: Date.now(),
            rootPath,
            fileCount: discoveryResult.files.length
          });

          return {
            graph: this.currentGraph,
            errors,
            warnings,
            performance: performanceMetrics,
            gitChanges
          };

        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          vscode.window.showErrorMessage(`TypeMap: Analysis failed - ${message}`);
          errors.push({ filePath: rootPath, message });
          return null;
        }
      }
    );
  }

  /**
   * Execute analysis for a single file
   */
  async executeForFile(filePath: string): Promise<void> {
    const parser = new LightweightParser(this.cacheManager);
    
    try {
      const symbols = await parser.parseFile(filePath);
      
      // Show quick summary
      const symbolCounts: Record<string, number> = {};
      for (const s of symbols) {
        symbolCounts[s.kind] = (symbolCounts[s.kind] || 0) + 1;
      }

      const summary = Object.keys(symbolCounts)
        .map(kind => `${symbolCounts[kind]} ${kind}${symbolCounts[kind] > 1 ? 's' : ''}`)
        .join(', ');

      vscode.window.showInformationMessage(
        `TypeMap: Found ${symbols.length} symbols (${summary})`
      );

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`TypeMap: Failed to analyze file - ${message}`);
    }
  }

  /**
   * Get the current analysis graph
   */
  getCurrentGraph(): MindmapGraph | null {
    return this.currentGraph;
  }

  /**
   * Clear all cached data
   */
  async clearCache(): Promise<void> {
    await this.cacheManager.clear();
    this.currentGraph = null;
    await this.context.workspaceState.update('typemap.lastAnalysis', undefined);
  }
}
