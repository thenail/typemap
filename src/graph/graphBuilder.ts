/**
 * Graph Builder
 * Constructs the mindmap graph structure from parsed symbols
 */

import * as path from 'path';
import { 
  LightweightSymbol, 
  MindmapGraph, 
  MindmapNode, 
  Edge, 
  NodeType, 
  GitAnalysisResult,
  GitChangeStatus
} from '../types';
import { pathToId, symbolToId } from '../utils';
import { StatisticsCalculator } from './statisticsCalculator';
import { createDefaultMetadata, createMetadataFromSymbol, NodeMetadataBuilder } from './nodeMetadataBuilder';
import { ParsedFile, DependencyAnalyzer, DependencyAnalysisResult, ProjectAnalyzer } from '../analysis';

export class GraphBuilder {
  private rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  /**
   * Build mindmap graph from symbols and file list
   */
  build(symbols: LightweightSymbol[], files: string[]): MindmapGraph {
    const nodes = new Map<string, MindmapNode>();
    const edges: Edge[] = [];
    
    // Create root node
    const rootId = 'root';
    const rootName = path.basename(this.rootPath);
    nodes.set(rootId, this.createNode(rootId, rootName, 'root'));

    // Group files by folder
    const folderMap = this.groupByFolder(files);

    // Create folder nodes
    for (const [folderPath, folderFiles] of folderMap) {
      const folderId = pathToId(folderPath, this.rootPath);
      const folderName = path.basename(folderPath) || rootName;
      
      if (folderPath !== this.rootPath) {
        nodes.set(folderId, this.createNode(folderId, folderName, 'folder'));
        
        // Connect to parent folder or root
        const parentPath = path.dirname(folderPath);
        const parentId = parentPath === this.rootPath ? rootId : pathToId(parentPath, this.rootPath);
        
        if (nodes.has(parentId)) {
          const parentNode = nodes.get(parentId)!;
          if (!parentNode.children.includes(folderId)) {
            parentNode.children.push(folderId);
          }
        } else {
          // Connect directly to root if parent doesn't exist
          const rootNode = nodes.get(rootId)!;
          if (!rootNode.children.includes(folderId)) {
            rootNode.children.push(folderId);
          }
        }

        edges.push({
          source: parentPath === this.rootPath ? rootId : pathToId(parentPath, this.rootPath),
          target: folderId,
          type: 'contains'
        });
      }

      // Create file nodes for this folder
      for (const filePath of folderFiles) {
        const fileId = pathToId(filePath, this.rootPath);
        const fileName = path.basename(filePath);
        
        const fileNode = this.createNode(fileId, fileName, 'file', filePath);
        nodes.set(fileId, fileNode);

        // Connect file to folder
        const containerNode = folderPath === this.rootPath 
          ? nodes.get(rootId)! 
          : nodes.get(folderId)!;
        
        if (!containerNode.children.includes(fileId)) {
          containerNode.children.push(fileId);
        }

        edges.push({
          source: folderPath === this.rootPath ? rootId : folderId,
          target: fileId,
          type: 'contains'
        });
      }
    }

    // Group symbols by file
    const symbolsByFile = this.groupSymbolsByFile(symbols);

    // Create symbol nodes
    for (const [filePath, fileSymbols] of symbolsByFile) {
      const fileId = pathToId(filePath, this.rootPath);
      const fileNode = nodes.get(fileId);
      
      if (!fileNode) continue;

      // Update file metadata
      fileNode.metadata.exportCount = fileSymbols.filter(s => s.exported).length;
      fileNode.metadata.linesOfCode = fileSymbols.reduce((sum, s) => sum + (s.linesOfCode || 0), 0);
      fileNode.metadata.complexity = fileSymbols.reduce((sum, s) => sum + (s.complexity || 1), 0);

      // Create symbol nodes
      for (const symbol of fileSymbols) {
        const symbolId = symbolToId(symbol, this.rootPath);
        const symbolNode: MindmapNode = {
          id: symbolId,
          label: symbol.name,
          type: symbol.kind as NodeType,
          filePath,
          line: symbol.line,
          children: [],
          parent: undefined,
          collapsed: false,
          metadata: createMetadataFromSymbol(symbol)
        };
        
        nodes.set(symbolId, symbolNode);
        fileNode.children.push(symbolId);

        edges.push({
          source: fileId,
          target: symbolId,
          type: 'contains'
        });
      }
    }

    // Calculate statistics
    const statistics = StatisticsCalculator.calculate(nodes, edges, files, symbols);

    return {
      nodes,
      edges,
      rootId,
      statistics
    };
  }

  /**
   * Build mindmap graph with dependency analysis (coupling metrics, circular dependencies)
   * Use this when you have ParsedFile[] from SwcParser for richer metrics
   */
  buildWithDependencies(parsedFiles: ParsedFile[]): MindmapGraph {
    // Extract symbols and file paths
    const symbols: LightweightSymbol[] = [];
    const files: string[] = [];
    
    for (const pf of parsedFiles) {
      files.push(pf.filePath);
      symbols.push(...pf.symbols);
    }

    // Build the basic graph first
    const graph = this.build(symbols, files);

    // Run dependency analysis
    const dependencyAnalyzer = new DependencyAnalyzer(this.rootPath);
    const dependencyResult = dependencyAnalyzer.analyze(parsedFiles);

    // Run project-level analysis
    const projectAnalyzer = new ProjectAnalyzer(this.rootPath);
    const projectResult = projectAnalyzer.analyze(parsedFiles);

    // Enrich file nodes with coupling metrics
    this.enrichWithCouplingMetrics(graph.nodes, dependencyResult);

    // Add import edges to the graph
    this.addImportEdges(graph, parsedFiles, dependencyResult);

    // Update statistics with dependency info
    graph.statistics.circularDependencies = dependencyResult.totalCircularDependencies;

    // Update statistics with project-level metrics
    graph.statistics.testFileRatio = projectResult.testStats.testFileRatio;
    graph.statistics.testFileCount = projectResult.testStats.testFiles;
    graph.statistics.sourceFileCount = projectResult.testStats.sourceFiles;
    graph.statistics.unusedExportCount = projectResult.totalUnusedExports;
    graph.statistics.duplicatedCodePatterns = projectResult.totalDuplications;
    graph.statistics.duplicatedLinesEstimate = projectResult.duplicatedLines;

    return graph;
  }

  /**
   * Enrich file nodes with coupling metrics from dependency analysis
   */
  private enrichWithCouplingMetrics(
    nodes: Map<string, MindmapNode>,
    dependencyResult: DependencyAnalysisResult
  ): void {
    for (const [, fileMetrics] of dependencyResult.fileMetrics) {
      const fileId = pathToId(fileMetrics.filePath, this.rootPath);
      const node = nodes.get(fileId);
      
      if (node && node.type === 'file') {
        // Update metadata with coupling metrics
        node.metadata.afferentCoupling = fileMetrics.afferentCoupling;
        node.metadata.efferentCoupling = fileMetrics.efferentCoupling;
        node.metadata.instability = fileMetrics.instability;
        
        // Count circular dependencies involving this file
        const normalizedPath = path.normalize(fileMetrics.filePath).toLowerCase().replace(/\\/g, '/');
        const cycleCount = dependencyResult.circularDependencies.filter(
          cycle => cycle.cycle.some(f => f === normalizedPath)
        ).length;
        node.metadata.circularDependencyCount = cycleCount;
      }
    }
  }

  /**
   * Add import edges to the graph
   */
  private addImportEdges(
    graph: MindmapGraph,
    parsedFiles: ParsedFile[],
    dependencyResult: DependencyAnalysisResult
  ): void {
    for (const [normalizedPath, metrics] of dependencyResult.fileMetrics) {
      const sourceId = pathToId(metrics.filePath, this.rootPath);
      
      for (const depPath of metrics.dependsOn) {
        // Find the actual file path from parsed files
        const depFile = parsedFiles.find(
          pf => path.normalize(pf.filePath).toLowerCase().replace(/\\/g, '/') === depPath
        );
        
        if (depFile) {
          const targetId = pathToId(depFile.filePath, this.rootPath);
          
          // Add import edge if both nodes exist
          if (graph.nodes.has(sourceId) && graph.nodes.has(targetId)) {
            graph.edges.push({
              source: sourceId,
              target: targetId,
              type: 'imports'
            });
          }
        }
      }
    }
  }

  /**
   * Create a mindmap node
   */
  private createNode(
    id: string, 
    label: string, 
    type: NodeType, 
    filePath?: string,
    line?: number
  ): MindmapNode {
    return {
      id,
      label,
      type,
      filePath,
      line,
      children: [],
      parent: undefined,
      collapsed: type === 'file', // Collapse file contents by default
      metadata: createDefaultMetadata()
    };
  }

  /**
   * Group files by their parent folder
   */
  private groupByFolder(files: string[]): Map<string, string[]> {
    const folderMap = new Map<string, string[]>();

    // First, ensure all intermediate folders are created
    const allFolders = new Set<string>();
    
    for (const filePath of files) {
      let currentPath = path.dirname(filePath);
      
      while (currentPath.length >= this.rootPath.length) {
        allFolders.add(currentPath);
        if (currentPath === this.rootPath) break;
        currentPath = path.dirname(currentPath);
      }
    }

    // Initialize all folders
    for (const folder of allFolders) {
      if (!folderMap.has(folder)) {
        folderMap.set(folder, []);
      }
    }

    // Group files
    for (const filePath of files) {
      const folder = path.dirname(filePath);
      const existing = folderMap.get(folder) || [];
      existing.push(filePath);
      folderMap.set(folder, existing);
    }

    return folderMap;
  }

  /**
   * Group symbols by their file
   */
  private groupSymbolsByFile(symbols: LightweightSymbol[]): Map<string, LightweightSymbol[]> {
    const map = new Map<string, LightweightSymbol[]>();

    for (const symbol of symbols) {
      const existing = map.get(symbol.filePath) || [];
      existing.push(symbol);
      map.set(symbol.filePath, existing);
    }

    return map;
  }

  /**
   * Apply git change status to graph nodes
   * This enriches the graph with information about which files have been modified
   */
  applyGitStatus(graph: MindmapGraph, gitChanges: GitAnalysisResult): void {
    if (!gitChanges.hasUncommittedChanges) {
      return;
    }

    // Track folders that contain changed files
    const foldersWithChanges = new Set<string>();

    // Count changes by status
    const gitStats = {
      totalChanged: 0,
      modified: 0,
      added: 0,
      deleted: 0,
      untracked: 0,
      staged: 0,
      conflict: 0,
    };

    // Apply status to file nodes and their symbols
    for (const [filePath, change] of gitChanges.changes) {
      // Find the file node
      const fileId = pathToId(filePath, this.rootPath);
      const fileNode = graph.nodes.get(fileId);

      if (fileNode) {
        // Apply git status to file
        fileNode.metadata.gitStatus = change.status;
        gitStats.totalChanged++;

        // Count by status
        switch (change.status) {
          case 'modified': gitStats.modified++; break;
          case 'added': gitStats.added++; break;
          case 'deleted': gitStats.deleted++; break;
          case 'untracked': gitStats.untracked++; break;
          case 'staged': gitStats.staged++; break;
          case 'conflict': gitStats.conflict++; break;
        }

        // Apply same status to all symbols in the file
        for (const childId of fileNode.children) {
          const childNode = graph.nodes.get(childId);
          if (childNode) {
            childNode.metadata.gitStatus = change.status;
          }
        }

        // Track parent folders
        let currentPath = path.dirname(filePath);
        while (currentPath.length >= this.rootPath.length) {
          foldersWithChanges.add(currentPath);
          if (currentPath === this.rootPath) break;
          currentPath = path.dirname(currentPath);
        }
      }
    }

    // Mark folders that contain changes
    for (const folderPath of foldersWithChanges) {
      const folderId = folderPath === this.rootPath ? 'root' : pathToId(folderPath, this.rootPath);
      const folderNode = graph.nodes.get(folderId);
      
      if (folderNode && !folderNode.metadata.gitStatus) {
        // Use 'modified' to indicate folder contains changes
        folderNode.metadata.gitStatus = 'modified';
      }
    }

    // Add git stats to graph statistics
    graph.statistics.gitStats = gitStats;
  }

  /**
   * Get summary of git changes in the graph
   */
  getGitSummary(graph: MindmapGraph): GitStatusSummary {
    const summary: GitStatusSummary = {
      modified: [],
      added: [],
      deleted: [],
      untracked: [],
      staged: [],
      conflict: [],
      total: 0
    };

    for (const node of graph.nodes.values()) {
      if (node.type === 'file' && node.metadata.gitStatus && node.metadata.gitStatus !== 'unchanged') {
        const status = node.metadata.gitStatus;
        if (status in summary) {
          (summary[status as keyof Omit<GitStatusSummary, 'total'>] as string[]).push(node.filePath || node.label);
        }
        summary.total++;
      }
    }

    return summary;
  }
}

export interface GitStatusSummary {
  modified: string[];
  added: string[];
  deleted: string[];
  untracked: string[];
  staged: string[];
  conflict: string[];
  total: number;
}
