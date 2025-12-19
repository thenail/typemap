/**
 * Statistics Calculator
 * 
 * Shared utility for calculating graph statistics.
 * Supports both full calculation and incremental updates.
 */

import { 
  MindmapNode, 
  MindmapGraph, 
  Edge, 
  NodeType, 
  GraphStatistics,
  LightweightSymbol 
} from '../types';

/**
 * Options for statistics calculation
 */
export interface StatisticsOptions {
  /** If true, only update node/edge counts and byType (faster) */
  incrementalMode?: boolean;
  /** Analysis time to record */
  analysisTimeMs?: number;
}

/**
 * Creates an empty byType record with all node types initialized to 0
 */
function createEmptyByType(): Record<NodeType, number> {
  return {
    root: 0,
    folder: 0,
    file: 0,
    namespace: 0,
    class: 0,
    interface: 0,
    function: 0,
    type: 0,
    enum: 0,
    variable: 0,
    component: 0,
    hook: 0
  };
}

/**
 * Statistics Calculator
 * 
 * Calculates comprehensive statistics for a mindmap graph.
 * Can operate in full mode (with symbols) or incremental mode (nodes only).
 */
export class StatisticsCalculator {
  /**
   * Calculate full statistics from nodes, edges, files, and symbols
   */
  static calculate(
    nodes: Map<string, MindmapNode>,
    edges: Edge[],
    files: string[],
    symbols: LightweightSymbol[],
    options: StatisticsOptions = {}
  ): GraphStatistics {
    const byType = createEmptyByType();

    // Count nodes by type
    for (const node of nodes.values()) {
      byType[node.type]++;
    }

    // Basic stats
    const stats: GraphStatistics = {
      totalNodes: nodes.size,
      totalEdges: edges.length,
      totalFiles: files.length,
      totalSymbols: symbols.length,
      analysisTimeMs: options.analysisTimeMs || 0,
      byType
    };

    // If incremental mode, skip the detailed symbol analysis
    if (options.incrementalMode) {
      return stats;
    }

    // Calculate extended statistics from symbols
    return this.calculateExtendedStats(stats, symbols, files.length);
  }

  /**
   * Calculate statistics from an existing graph (for incremental updates)
   * This is a lighter-weight calculation that only updates counts
   */
  static calculateFromGraph(
    graph: MindmapGraph,
    options: StatisticsOptions = {}
  ): GraphStatistics {
    const byType = createEmptyByType();

    // Count nodes by type
    for (const node of graph.nodes.values()) {
      if (node.type in byType) {
        byType[node.type as NodeType]++;
      }
    }

    // Update existing statistics object
    const stats = graph.statistics;
    stats.totalNodes = graph.nodes.size;
    stats.totalEdges = graph.edges.length;
    stats.byType = byType;

    if (options.analysisTimeMs !== undefined) {
      stats.analysisTimeMs = options.analysisTimeMs;
    }

    return stats;
  }

  /**
   * Update statistics in place on an existing graph
   * This is the fastest option for incremental updates
   */
  static updateInPlace(graph: MindmapGraph): void {
    const stats = graph.statistics;
    stats.totalNodes = graph.nodes.size;
    stats.totalEdges = graph.edges.length;

    // Reset and count by type
    for (const key of Object.keys(stats.byType)) {
      stats.byType[key as NodeType] = 0;
    }
    
    for (const node of graph.nodes.values()) {
      if (node.type in stats.byType) {
        stats.byType[node.type as NodeType]++;
      }
    }
  }

  /**
   * Calculate extended statistics from symbols
   */
  private static calculateExtendedStats(
    stats: GraphStatistics,
    symbols: LightweightSymbol[],
    fileCount: number
  ): GraphStatistics {
    // Lines of code and complexity
    const totalLinesOfCode = symbols.reduce((sum, s) => sum + (s.linesOfCode || 0), 0);
    const complexities = symbols.map(s => s.complexity || 1);
    const totalComplexity = complexities.reduce((sum, c) => sum + c, 0);
    const maxComplexity = Math.max(...complexities, 0);
    const averageComplexity = symbols.length > 0 ? totalComplexity / symbols.length : 0;
    
    // Count high complexity items (>10 is high, >20 is very high)
    const highComplexityCount = complexities.filter(c => c > 10 && c <= 20).length;
    const veryHighComplexityCount = complexities.filter(c => c > 20).length;
    
    // Count by symbol type
    const classSymbols = symbols.filter(s => s.kind === 'class');
    const totalClasses = classSymbols.length;
    const totalInterfaces = symbols.filter(s => s.kind === 'interface').length;
    const totalFunctions = symbols.filter(s => s.kind === 'function' || s.kind === 'hook').length;
    
    // Average methods per class
    const totalMethodsInClasses = classSymbols.reduce((sum, s) => sum + (s.methodCount || 0), 0);
    const averageMethodsPerClass = totalClasses > 0 ? totalMethodsInClasses / totalClasses : 0;
    
    // Average lines per file
    const averageLinesPerFile = fileCount > 0 ? totalLinesOfCode / fileCount : 0;

    // Cognitive complexity stats
    const cognitiveComplexities = symbols.map(s => s.cognitiveComplexity || 0).filter(c => c > 0);
    const totalCognitiveComplexity = cognitiveComplexities.reduce((sum, c) => sum + c, 0);
    const averageCognitiveComplexity = cognitiveComplexities.length > 0 
      ? totalCognitiveComplexity / cognitiveComplexities.length : 0;
    const maxCognitiveComplexity = Math.max(...cognitiveComplexities, 0);

    // Sum TODO and any type counts
    const totalTodoCount = symbols.reduce((sum, s) => sum + (s.todoCount || 0), 0);
    const totalAnyTypeCount = symbols.reduce((sum, s) => sum + (s.anyTypeCount || 0), 0);
    const totalImports = symbols.reduce((sum, s) => sum + (s.importCount || 0), 0);

    // Structure metrics
    const totalReturnStatements = symbols.reduce((sum, s) => sum + (s.returnCount || 0), 0);
    const totalThrowStatements = symbols.reduce((sum, s) => sum + (s.throwCount || 0), 0);
    
    // JSDoc coverage
    const documentableSymbols = symbols.filter(s => 
      s.kind === 'function' || s.kind === 'class' || s.kind === 'interface' || 
      s.kind === 'type' || s.kind === 'hook' || s.kind === 'component'
    );
    const documentedSymbols = documentableSymbols.filter(s => s.hasJsDoc);
    const jsDocCoverage = documentableSymbols.length > 0 
      ? (documentedSymbols.length / documentableSymbols.length) * 100 : 0;
    
    // Average constructor params (DI complexity)
    const classesWithConstructors = classSymbols.filter(s => s.constructorParamCount !== undefined);
    const totalConstructorParams = classesWithConstructors.reduce((sum, s) => sum + (s.constructorParamCount || 0), 0);
    const averageConstructorParams = classesWithConstructors.length > 0 
      ? totalConstructorParams / classesWithConstructors.length : 0;

    return {
      ...stats,
      totalLinesOfCode,
      totalComplexity,
      averageComplexity,
      maxComplexity,
      highComplexityCount,
      veryHighComplexityCount,
      totalClasses,
      totalInterfaces,
      totalFunctions,
      averageMethodsPerClass,
      averageLinesPerFile,
      totalImports,
      totalTodoCount,
      totalAnyTypeCount,
      averageCognitiveComplexity,
      maxCognitiveComplexity,
      totalReturnStatements,
      totalThrowStatements,
      jsDocCoverage,
      averageConstructorParams
    };
  }
}
