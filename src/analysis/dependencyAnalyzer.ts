/**
 * Dependency Analyzer
 * 
 * Analyzes cross-file dependencies to compute:
 * - Afferent Coupling (Ca): incoming dependencies (who depends on me)
 * - Efferent Coupling (Ce): outgoing dependencies (who do I depend on)
 * - Circular Dependencies: import cycles between files
 * 
 * These metrics help identify:
 * - Highly coupled modules that may need refactoring
 * - Unstable modules with many outgoing dependencies
 * - Potential architectural issues from circular dependencies
 */

import * as path from 'path';
import { ParsedFile, ImportInfo } from './swcParser';

/**
 * Coupling metrics for a single file
 */
export interface FileCouplingMetrics {
  filePath: string;
  afferentCoupling: number;  // Incoming dependencies (Ca)
  efferentCoupling: number;  // Outgoing dependencies (Ce)
  instability: number;       // Ce / (Ca + Ce) - 0 = stable, 1 = unstable
  dependsOn: string[];       // Files this file imports from
  dependedOnBy: string[];    // Files that import from this file
}

/**
 * A circular dependency cycle
 */
export interface CircularDependency {
  cycle: string[];           // File paths forming the cycle
  length: number;            // Number of files in cycle
}

/**
 * Complete dependency analysis result
 */
export interface DependencyAnalysisResult {
  fileMetrics: Map<string, FileCouplingMetrics>;
  circularDependencies: CircularDependency[];
  totalCircularDependencies: number;
}

/**
 * Analyzes dependencies between files
 */
export class DependencyAnalyzer {
  private rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  /**
   * Analyze all dependencies from parsed files
   */
  analyze(parsedFiles: ParsedFile[]): DependencyAnalysisResult {
    // Build dependency graph
    const dependencyGraph = this.buildDependencyGraph(parsedFiles);
    
    // Calculate coupling metrics
    const fileMetrics = this.calculateCouplingMetrics(dependencyGraph, parsedFiles);
    
    // Detect circular dependencies
    const circularDependencies = this.detectCircularDependencies(dependencyGraph);
    
    return {
      fileMetrics,
      circularDependencies,
      totalCircularDependencies: circularDependencies.length
    };
  }

  /**
   * Build a dependency graph from parsed files
   * Returns Map<filePath, Set<dependencyFilePath>>
   */
  private buildDependencyGraph(parsedFiles: ParsedFile[]): Map<string, Set<string>> {
    const graph = new Map<string, Set<string>>();
    const fileSet = new Set(parsedFiles.map(f => this.normalizePath(f.filePath)));

    for (const file of parsedFiles) {
      const normalizedPath = this.normalizePath(file.filePath);
      const dependencies = new Set<string>();

      for (const imp of file.imports) {
        const resolvedPath = this.resolveImportPath(file.filePath, imp.modulePath);
        if (resolvedPath && fileSet.has(resolvedPath)) {
          dependencies.add(resolvedPath);
        }
      }

      graph.set(normalizedPath, dependencies);
    }

    return graph;
  }

  /**
   * Calculate coupling metrics for each file
   */
  private calculateCouplingMetrics(
    dependencyGraph: Map<string, Set<string>>,
    parsedFiles: ParsedFile[]
  ): Map<string, FileCouplingMetrics> {
    const metrics = new Map<string, FileCouplingMetrics>();

    // Initialize metrics for all files
    for (const file of parsedFiles) {
      const normalizedPath = this.normalizePath(file.filePath);
      metrics.set(normalizedPath, {
        filePath: file.filePath,
        afferentCoupling: 0,
        efferentCoupling: 0,
        instability: 0,
        dependsOn: [],
        dependedOnBy: []
      });
    }

    // Calculate efferent coupling (outgoing) and build reverse map
    for (const [filePath, dependencies] of dependencyGraph) {
      const fileMetrics = metrics.get(filePath);
      if (fileMetrics) {
        fileMetrics.efferentCoupling = dependencies.size;
        fileMetrics.dependsOn = Array.from(dependencies);

        // Update afferent coupling for dependencies
        for (const dep of dependencies) {
          const depMetrics = metrics.get(dep);
          if (depMetrics) {
            depMetrics.afferentCoupling++;
            depMetrics.dependedOnBy.push(filePath);
          }
        }
      }
    }

    // Calculate instability
    for (const [, fileMetrics] of metrics) {
      const total = fileMetrics.afferentCoupling + fileMetrics.efferentCoupling;
      fileMetrics.instability = total > 0 ? fileMetrics.efferentCoupling / total : 0;
    }

    return metrics;
  }

  /**
   * Detect circular dependencies using DFS
   */
  private detectCircularDependencies(
    dependencyGraph: Map<string, Set<string>>
  ): CircularDependency[] {
    const cycles: CircularDependency[] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    const dfs = (node: string): void => {
      visited.add(node);
      recursionStack.add(node);
      path.push(node);

      const dependencies = dependencyGraph.get(node) || new Set();
      for (const dep of dependencies) {
        if (!visited.has(dep)) {
          dfs(dep);
        } else if (recursionStack.has(dep)) {
          // Found a cycle
          const cycleStartIndex = path.indexOf(dep);
          if (cycleStartIndex !== -1) {
            const cycle = path.slice(cycleStartIndex);
            // Only add if we haven't seen this cycle before (normalized)
            if (!this.isCycleAlreadyFound(cycles, cycle)) {
              cycles.push({
                cycle: [...cycle],
                length: cycle.length
              });
            }
          }
        }
      }

      path.pop();
      recursionStack.delete(node);
    };

    // Run DFS from each unvisited node
    for (const node of dependencyGraph.keys()) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }

    return cycles;
  }

  /**
   * Check if a cycle is already found (cycles can be detected from different starting points)
   */
  private isCycleAlreadyFound(cycles: CircularDependency[], newCycle: string[]): boolean {
    const newCycleSet = new Set(newCycle);
    
    for (const existing of cycles) {
      if (existing.length === newCycle.length) {
        const existingSet = new Set(existing.cycle);
        let match = true;
        for (const node of newCycleSet) {
          if (!existingSet.has(node)) {
            match = false;
            break;
          }
        }
        if (match) return true;
      }
    }
    
    return false;
  }

  /**
   * Resolve an import path to an absolute file path
   */
  private resolveImportPath(fromFile: string, importPath: string): string | null {
    // Skip external modules (node_modules, etc.)
    if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
      return null;
    }

    const fromDir = path.dirname(fromFile);
    let resolved = path.resolve(fromDir, importPath);

    // Try common extensions
    const extensions = ['.ts', '.tsx', '.js', '.jsx', ''];
    for (const ext of extensions) {
      const withExt = resolved + ext;
      if (this.isKnownFile(withExt)) {
        return this.normalizePath(withExt);
      }
    }

    // Try index files
    for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
      const indexPath = path.join(resolved, `index${ext}`);
      if (this.isKnownFile(indexPath)) {
        return this.normalizePath(indexPath);
      }
    }

    return null;
  }

  /**
   * Normalize path for consistent comparison
   */
  private normalizePath(filePath: string): string {
    return path.normalize(filePath).toLowerCase().replace(/\\/g, '/');
  }

  /**
   * Simple check if a path looks like a known file
   * In production, you might want to check against the actual file list
   */
  private isKnownFile(filePath: string): boolean {
    // This will be replaced with actual file checking when integrated
    return filePath.endsWith('.ts') || 
           filePath.endsWith('.tsx') || 
           filePath.endsWith('.js') || 
           filePath.endsWith('.jsx');
  }

  /**
   * Get coupling metrics for a specific file
   */
  getCouplingForFile(
    result: DependencyAnalysisResult, 
    filePath: string
  ): FileCouplingMetrics | undefined {
    const normalized = this.normalizePath(filePath);
    return result.fileMetrics.get(normalized);
  }

  /**
   * Get all cycles involving a specific file
   */
  getCyclesForFile(
    result: DependencyAnalysisResult, 
    filePath: string
  ): CircularDependency[] {
    const normalized = this.normalizePath(filePath);
    return result.circularDependencies.filter(
      cycle => cycle.cycle.some(f => this.normalizePath(f) === normalized)
    );
  }
}

/**
 * Create a dependency analyzer instance
 */
export function createDependencyAnalyzer(rootPath: string): DependencyAnalyzer {
  return new DependencyAnalyzer(rootPath);
}
