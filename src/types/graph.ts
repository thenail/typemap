/**
 * Graph Type Definitions
 */

import { GitChangeStatus } from './git';

export type NodeType =
  | 'root'
  | 'folder'
  | 'file'
  | 'namespace'
  | 'class'
  | 'interface'
  | 'function'
  | 'type'
  | 'enum'
  | 'variable'
  | 'component'
  | 'hook';

export interface NodeMetadata {
  linesOfCode: number;
  complexity: number;
  exportCount: number;
  importCount: number;
  isEntryPoint: boolean;
  gitStatus?: GitChangeStatus;  // Git change status for visualization
  // Additional metrics
  methodCount?: number;
  fieldCount?: number;
  parameterCount?: number;
  inheritanceDepth?: number;
  efferentCoupling?: number;  // Outgoing dependencies
  afferentCoupling?: number;  // Incoming dependencies
  // Extended metrics
  maxNestingDepth?: number;
  staticMethodCount?: number;
  staticFieldCount?: number;
  privateMethodCount?: number;
  publicMethodCount?: number;
  asyncMethodCount?: number;
  // New metrics
  todoCount?: number;
  anyTypeCount?: number;
  cognitiveComplexity?: number;
  // Structure metrics
  returnCount?: number;
  throwCount?: number;
  hasJsDoc?: boolean;
  constructorParamCount?: number;
  implementsCount?: number;
  commentDensity?: number;  // Comments per LOC ratio
  // Class-specific metrics
  isAbstract?: boolean;     // Is an abstract class
  overrideCount?: number;   // Methods overriding parent class
  // Async complexity metrics
  callbackDepth?: number;   // Max nested callback depth
  promiseChainLength?: number; // Max .then()/.catch()/.finally() chain length
  // Cross-file dependency metrics
  circularDependencyCount?: number; // Number of circular dependencies involving this file
  instability?: number;     // Ce / (Ca + Ce) - 0 = stable, 1 = unstable
}

export interface MindmapNode {
  id: string;
  label: string;
  type: NodeType;
  filePath?: string;
  line?: number;
  children: string[];
  parent?: string;
  metadata: NodeMetadata;
  collapsed: boolean;
}

export interface Edge {
  source: string;
  target: string;
  type: 'contains' | 'imports' | 'exports' | 'extends' | 'implements';
}

export interface GitStatistics {
  totalChanged: number;
  modified: number;
  added: number;
  deleted: number;
  untracked: number;
  staged: number;
  conflict: number;
}

export interface GraphStatistics {
  totalNodes: number;
  totalEdges: number;
  totalFiles: number;
  totalSymbols: number;
  analysisTimeMs: number;
  byType: Record<NodeType, number>;
  gitStats?: GitStatistics;  // Git change statistics
  // Project-level metrics
  totalLinesOfCode?: number;
  totalComplexity?: number;
  averageComplexity?: number;
  maxComplexity?: number;
  highComplexityCount?: number;  // Symbols with complexity > 10
  veryHighComplexityCount?: number;  // Symbols with complexity > 20
  totalClasses?: number;
  totalInterfaces?: number;
  totalFunctions?: number;
  averageMethodsPerClass?: number;
  averageLinesPerFile?: number;
  // New metrics
  totalImports?: number;
  totalTodoCount?: number;
  totalAnyTypeCount?: number;
  averageCognitiveComplexity?: number;
  maxCognitiveComplexity?: number;
  // Structure metrics
  totalReturnStatements?: number;
  totalThrowStatements?: number;
  jsDocCoverage?: number;  // Percentage of symbols with JSDoc
  averageConstructorParams?: number;
  // Dependency metrics
  circularDependencies?: number;  // Number of circular dependency cycles
  averageAfferentCoupling?: number;
  averageEfferentCoupling?: number;
  maxAfferentCoupling?: number;
  maxEfferentCoupling?: number;
  // Project-level metrics (Phase 5)
  testFileRatio?: number;         // Test files / total files (0-1)
  testFileCount?: number;
  sourceFileCount?: number;
  unusedExportCount?: number;     // Dead code indicator
  duplicatedCodePatterns?: number; // Number of duplicated code patterns
  duplicatedLinesEstimate?: number; // Estimated lines in duplicated code
}

export interface MindmapGraph {
  nodes: Map<string, MindmapNode>;
  edges: Edge[];
  rootId: string;
  statistics: GraphStatistics;
}

// Serialized version for JSON transfer
export interface SerializedGraph {
  nodes: Array<[string, MindmapNode]>;
  edges: Edge[];
  rootId: string;
  statistics: GraphStatistics;
}
