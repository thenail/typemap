/**
 * Analysis Module - Barrel Export
 * 
 * Hybrid Architecture:
 * - SwcParser: Fast parsing with Rust (~2.4x faster)
 * - TypeAnalyzer: Deep type analysis with TypeScript
 * - IncrementalParser: Smart incremental parsing (skip non-structural changes)
 * - IncrementalUpdateManager: Efficient graph updates
 * - LightweightParser: Legacy TypeScript parser (fallback)
 */

// Primary: SWC-based fast parser
export { SwcParser, ParsedFile, ImportInfo, ExportInfo } from './swcParser';

// Secondary: TypeScript type analyzer for deep queries
export { 
  TypeAnalyzer, 
  TypeAnalysisResult, 
  ImplementationInfo, 
  ReferenceInfo, 
  TypeHierarchyNode 
} from './typeAnalyzer';

// Incremental parsing (smart skip for non-structural changes)
export {
  IncrementalParser,
  CachedSymbol,
  FileCache,
  EditInfo,
  IncrementalParseResult,
  createEditInfo
} from './incrementalParser';

// Incremental updates
export { 
  IncrementalUpdateManager, 
  FileChange, 
  IncrementalUpdateResult 
} from './incrementalUpdateManager';

// File discovery
export { FileDiscovery } from './fileDiscovery';

// Legacy: TypeScript-based parser (kept for fallback)
export { LightweightParser } from './lightweightParser';

// Single-pass metrics collector
export {
  MetricsCollector,
  NodeMetrics,
  FileMetrics,
  getMetricsCollector
} from './metricsCollector';

// Cross-file dependency analysis
export {
  DependencyAnalyzer,
  FileCouplingMetrics,
  CircularDependency,
  DependencyAnalysisResult,
  createDependencyAnalyzer
} from './dependencyAnalyzer';

// Project-level analysis
export {
  ProjectAnalyzer,
  UnusedExport,
  CodeDuplication,
  TestFileStats,
  ProjectAnalysisResult,
  createProjectAnalyzer
} from './projectAnalyzer';
