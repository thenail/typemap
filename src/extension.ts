/**
 * TypeMap - VS Code Extension Entry Point
 * Visualize TypeScript/TSX codebases as interactive mindmaps
 */

import * as vscode from 'vscode';
import { AnalyzeCommand, ShowMindmapCommand, ExportCommand, FindImplementationsCommand, VisualizationDemoCommand } from './commands';
import { IncrementalUpdateManager } from './analysis';
import { CacheManager } from './cache';
import { TypeMapConfig, DEFAULT_CONFIG } from './types';
import { COMMANDS, CONTEXT_KEYS, FILE_PATTERNS, EXTENSION_NAME } from './constants';
import { logger } from './utils';
import { ReportsTreeProvider, GraphTreeProvider } from './views';
import { MindmapPanel } from './webview';

// Global state
let analysisState: {
  hasAnalysis: boolean;
  lastAnalysisTime?: number;
  incrementalManager?: IncrementalUpdateManager;
  graphTreeProvider?: GraphTreeProvider;
} = {
  hasAnalysis: false
};

/**
 * Load extension configuration from VS Code settings
 */
function getConfiguration(): TypeMapConfig {
  const config = vscode.workspace.getConfiguration('typemap');
  
  return {
    analysis: {
      include: config.get<string[]>('analysis.include', DEFAULT_CONFIG.analysis.include),
      exclude: config.get<string[]>('analysis.exclude', DEFAULT_CONFIG.analysis.exclude),
      maxFiles: config.get<number>('analysis.maxFiles', DEFAULT_CONFIG.analysis.maxFiles),
      maxDepth: config.get<number>('analysis.maxDepth', DEFAULT_CONFIG.analysis.maxDepth)
    },
    visualization: {
      layout: config.get<'radial' | 'tree' | 'force-directed' | 'cluster'>('visualization.layout', DEFAULT_CONFIG.visualization.layout),
      theme: config.get<'auto' | 'light' | 'dark'>('visualization.theme', DEFAULT_CONFIG.visualization.theme)
    },
    performance: {
      workerCount: config.get<number>('performance.workerCount', DEFAULT_CONFIG.performance.workerCount),
      cacheSize: config.get<number>('performance.cacheSize', DEFAULT_CONFIG.performance.cacheSize)
    }
  };
}

/**
 * Update the context for conditional command visibility
 */
function updateContext(hasAnalysis: boolean): void {
  analysisState.hasAnalysis = hasAnalysis;
  vscode.commands.executeCommand('setContext', CONTEXT_KEYS.HAS_ANALYSIS, hasAnalysis);
}

/**
 * Extension activation - called when extension is first activated
 */
export function activate(context: vscode.ExtensionContext): void {
  logger.info(`${EXTENSION_NAME} extension is now active`);

  // Initialize configuration
  const config = getConfiguration();

  // Initialize cache manager for incremental updates
  const cacheManager = new CacheManager(context, config.performance.cacheSize);

  // Initialize tree view providers
  const reportsTreeProvider = new ReportsTreeProvider();
  const graphTreeProvider = new GraphTreeProvider();
  analysisState.graphTreeProvider = graphTreeProvider;

  // Register tree views
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('typemap.reports', reportsTreeProvider),
    vscode.window.registerTreeDataProvider('typemap.graph', graphTreeProvider)
  );

  // Initialize commands
  const analyzeCommand = new AnalyzeCommand(context, config);
  const showMindmapCommand = new ShowMindmapCommand(context, config);
  const exportCommand = new ExportCommand(context);
  const findImplementationsCommand = new FindImplementationsCommand(context, config);
  const visualizationDemoCommand = new VisualizationDemoCommand(context);

  // Register commands
  const commands = [
    // Analyze workspace
    vscode.commands.registerCommand(COMMANDS.ANALYZE, async () => {
      const result = await analyzeCommand.execute();
      if (result) {
        updateContext(true);
        analysisState.lastAnalysisTime = Date.now();
        
        // Update graph tree view with stats
        graphTreeProvider.setAnalysisState(true, {
          files: result.performance.filesAnalyzed,
          symbols: result.graph.nodes.size
        });
        
        // Initialize incremental update manager with the new graph
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (workspaceRoot) {
          analysisState.incrementalManager = new IncrementalUpdateManager(
            workspaceRoot,
            cacheManager,
            300 // debounce ms
          );
          analysisState.incrementalManager.setGraph(result.graph);
          
          // Register for update notifications
          analysisState.incrementalManager.onUpdate((updateResult) => {
            logger.info(`Incremental update: ${updateResult.updatedFiles.length} files, ` +
              `+${updateResult.addedNodes}/-${updateResult.removedNodes} nodes in ${updateResult.updateTimeMs.toFixed(0)}ms`);
            
            // Notify webview of update if open
            // TODO: Send update to webview
          });
        }
        
        // Build message with git changes info
        let message = `${EXTENSION_NAME}: Analyzed ${result.performance.filesAnalyzed} files in ${result.performance.totalTimeMs}ms`;
        
        if (result.gitChanges?.hasUncommittedChanges) {
          const changedCount = result.gitChanges.totalChangedFiles;
          message += ` (${changedCount} file${changedCount !== 1 ? 's' : ''} with uncommitted changes)`;
        }
        
        vscode.window.showInformationMessage(message);
      }
    }),

    // Analyze current file
    vscode.commands.registerCommand(COMMANDS.ANALYZE_FILE, async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage(`${EXTENSION_NAME}: No active file to analyze`);
        return;
      }
      
      const filePath = editor.document.uri.fsPath;
      if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) {
        vscode.window.showWarningMessage(`${EXTENSION_NAME}: Only TypeScript/TSX files are supported`);
        return;
      }

      await analyzeCommand.executeForFile(filePath);
    }),

    // Show mindmap visualization
    vscode.commands.registerCommand(COMMANDS.SHOW_MINDMAP, async () => {
      if (!analysisState.hasAnalysis) {
        const choice = await vscode.window.showInformationMessage(
          `${EXTENSION_NAME}: No analysis data available. Analyze workspace first?`,
          'Analyze Now',
          'Cancel'
        );
        
        if (choice === 'Analyze Now') {
          await vscode.commands.executeCommand(COMMANDS.ANALYZE);
        }
        return;
      }
      
      await showMindmapCommand.execute();
    }),

    // Refresh analysis
    vscode.commands.registerCommand(COMMANDS.REFRESH, async () => {
      const result = await analyzeCommand.execute({ incremental: true });
      if (result) {
        vscode.window.showInformationMessage(
          `${EXTENSION_NAME}: Refreshed in ${result.performance.totalTimeMs}ms`
        );
      }
    }),

    // Clear cache
    vscode.commands.registerCommand(COMMANDS.CLEAR_CACHE, async () => {
      await analyzeCommand.clearCache();
      updateContext(false);
      vscode.window.showInformationMessage(`${EXTENSION_NAME}: Cache cleared`);
    }),

    // Export as SVG
    vscode.commands.registerCommand(COMMANDS.EXPORT_SVG, async () => {
      await exportCommand.execute('svg');
    }),

    // Export as JSON
    vscode.commands.registerCommand(COMMANDS.EXPORT_JSON, async () => {
      await exportCommand.execute('json');
    }),

    // Find implementations of interface/class
    vscode.commands.registerCommand(COMMANDS.FIND_IMPLEMENTATIONS, async () => {
      await findImplementationsCommand.execute();
    }),

    // Visualization demo (POC with sample data)
    vscode.commands.registerCommand(COMMANDS.VISUALIZATION_DEMO, async () => {
      await visualizationDemoCommand.execute();
    }),

    // Show D3 Mindmap visualization (from Reports sidebar)
    vscode.commands.registerCommand(COMMANDS.SHOW_MINDMAP_D3, async () => {
      const graph = analyzeCommand.getCurrentGraph();
      if (!graph) {
        const choice = await vscode.window.showInformationMessage(
          `${EXTENSION_NAME}: No analysis data. Analyze workspace first?`,
          'Analyze Now',
          'Show Demo'
        );
        
        if (choice === 'Analyze Now') {
          const result = await analyzeCommand.execute();
          if (result) {
            MindmapPanel.createOrShow(context.extensionUri, result.graph);
          }
        } else if (choice === 'Show Demo') {
          await visualizationDemoCommand.execute();
        }
        return;
      }
      
      MindmapPanel.createOrShow(context.extensionUri, graph);
    }),

    // Placeholder commands for future reports
    vscode.commands.registerCommand(COMMANDS.SHOW_TYPE_HIERARCHY, async () => {
      vscode.window.showInformationMessage(`${EXTENSION_NAME}: Type Hierarchy view coming soon!`);
    }),

    vscode.commands.registerCommand(COMMANDS.SHOW_DEPENDENCIES, async () => {
      vscode.window.showInformationMessage(`${EXTENSION_NAME}: Dependencies view coming soon!`);
    })
  ];

  // Register all commands
  commands.forEach(cmd => context.subscriptions.push(cmd));

  // Watch for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('typemap')) {
        // Reload configuration
        Object.assign(config, getConfiguration());
        logger.info('Configuration reloaded');
      }
    })
  );

  // Watch for file changes (for incremental updates)
  const fileWatcher = vscode.workspace.createFileSystemWatcher(FILE_PATTERNS.ALL_TS);
  
  fileWatcher.onDidChange(uri => {
    if (analysisState.hasAnalysis) {
      logger.debug(`File changed: ${uri.fsPath}`);
      
      // Use incremental manager for efficient updates
      if (analysisState.incrementalManager) {
        analysisState.incrementalManager.registerChange(uri.fsPath, 'changed');
      }
      
      // Invalidate type analyzer cache on file changes
      findImplementationsCommand.invalidate();
    }
  });

  fileWatcher.onDidCreate(uri => {
    if (analysisState.hasAnalysis) {
      logger.debug(`File created: ${uri.fsPath}`);
      
      // Use incremental manager for efficient updates
      if (analysisState.incrementalManager) {
        analysisState.incrementalManager.registerChange(uri.fsPath, 'created');
      }
      
      findImplementationsCommand.invalidate();
    }
  });

  fileWatcher.onDidDelete(uri => {
    if (analysisState.hasAnalysis) {
      logger.debug(`File deleted: ${uri.fsPath}`);
      
      // Use incremental manager for efficient updates
      if (analysisState.incrementalManager) {
        analysisState.incrementalManager.registerChange(uri.fsPath, 'deleted');
      }
      
      findImplementationsCommand.invalidate();
    }
  });

  context.subscriptions.push(fileWatcher);

  // Set initial context
  updateContext(false);

  logger.info('All commands registered');

  // Auto-analyze workspace on activation if TypeScript files exist
  if (vscode.workspace.workspaceFolders?.length) {
    // Delay slightly to let VS Code finish initializing
    setTimeout(async () => {
      try {
        logger.info('Auto-analyzing workspace on activation...');
        vscode.window.withProgress({
          location: vscode.ProgressLocation.Window,
          title: `${EXTENSION_NAME}: Analyzing workspace...`,
          cancellable: false
        }, async () => {
          const result = await analyzeCommand.execute();
          if (result) {
            updateContext(true);
            analysisState.lastAnalysisTime = Date.now();
            
            // Update graph tree view with stats
            graphTreeProvider.setAnalysisState(true, {
              files: result.performance.filesAnalyzed,
              symbols: result.graph.nodes.size
            });
            
            // Initialize incremental update manager
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (workspaceRoot) {
              analysisState.incrementalManager = new IncrementalUpdateManager(
                workspaceRoot,
                cacheManager,
                300
              );
              analysisState.incrementalManager.setGraph(result.graph);
            }
            
            logger.info(`Auto-analysis complete: ${result.performance.filesAnalyzed} files, ${result.graph.nodes.size} symbols`);
          }
        });
      } catch (error) {
        logger.error('Auto-analysis failed:', error instanceof Error ? error : new Error(String(error)));
      }
    }, 1000);
  }
}

/**
 * Extension deactivation - called when extension is deactivated
 */
export function deactivate(): void {
  // Dispose incremental update manager
  if (analysisState.incrementalManager) {
    analysisState.incrementalManager.dispose();
    analysisState.incrementalManager = undefined;
  }
  
  logger.info(`${EXTENSION_NAME} extension deactivated`);
}

