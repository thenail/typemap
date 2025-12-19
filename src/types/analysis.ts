/**
 * Analysis Type Definitions
 */

import { MindmapGraph } from './graph';
import { GitAnalysisResult } from './git';

export interface FileDiscoveryConfig {
  rootPath: string;
  include: string[];
  exclude: string[];
  maxDepth: number;
  maxFiles: number;
  useGitignore: boolean;
}

export interface FileDiscoveryResult {
  files: string[];
  totalSize: number;
  discoveryTimeMs: number;
}

export interface AnalysisConfig {
  rootPath: string;
  include: string[];
  exclude: string[];
  maxFiles: number;
  maxDepth: number;
  workerCount: number;
}

export interface AnalysisResult {
  graph: MindmapGraph;
  errors: AnalysisError[];
  warnings: string[];
  performance: PerformanceMetrics;
  gitChanges?: GitAnalysisResult;  // Git integration results
}

export interface AnalysisError {
  filePath: string;
  message: string;
  line?: number;
  column?: number;
}

export interface PerformanceMetrics {
  discoveryTimeMs: number;
  parseTimeMs: number;
  graphBuildTimeMs: number;
  totalTimeMs: number;
  filesAnalyzed: number;
  cacheHits: number;
  cacheMisses: number;
}

export interface WorkerTask {
  id: string;
  type: 'lightweight' | 'deep';
  files: string[];
  priority: number;
}

export interface WorkerResult {
  taskId: string;
  symbols: import('./symbols').LightweightSymbol[];
  errors: AnalysisError[];
  timeMs: number;
}
