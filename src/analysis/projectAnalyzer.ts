/**
 * Project Analyzer
 * 
 * Analyzes project-level metrics:
 * - Test File Ratio: Test files vs source files
 * - Unused Exports (Dead Code): Exports not imported anywhere
 * - Code Duplication: Similar code blocks (hash-based detection)
 * 
 * These metrics help identify:
 * - Test coverage gaps
 * - Potential dead code for cleanup
 * - Copy-paste code that could be refactored
 */

import * as path from 'path';
import * as crypto from 'crypto';
import { ParsedFile, ImportInfo, ExportInfo } from './swcParser';
import { LightweightSymbol } from '../types';

/**
 * Information about an unused export
 */
export interface UnusedExport {
  filePath: string;
  exportName: string;
  isDefault: boolean;
  line?: number;
}

/**
 * Information about a duplicated code block
 */
export interface CodeDuplication {
  hash: string;
  occurrences: Array<{
    filePath: string;
    symbolName: string;
    line: number;
    linesOfCode: number;
  }>;
  totalOccurrences: number;
}

/**
 * Test file statistics
 */
export interface TestFileStats {
  testFiles: number;
  sourceFiles: number;
  totalFiles: number;
  testFileRatio: number;  // 0-1, percentage of test files
  testFilePatterns: string[];  // Patterns used to identify test files
}

/**
 * Complete project analysis result
 */
export interface ProjectAnalysisResult {
  testStats: TestFileStats;
  unusedExports: UnusedExport[];
  totalUnusedExports: number;
  duplications: CodeDuplication[];
  totalDuplications: number;
  duplicatedLines: number;  // Estimate of lines in duplicated code
}

/**
 * Test file patterns (configurable)
 */
const DEFAULT_TEST_PATTERNS = [
  /\.test\.[jt]sx?$/i,
  /\.spec\.[jt]sx?$/i,
  /__tests__\//i,
  /\/test\//i,
  /\/tests\//i,
];

/**
 * Project-level analyzer
 */
export class ProjectAnalyzer {
  private rootPath: string;
  private testPatterns: RegExp[];

  constructor(rootPath: string, testPatterns?: RegExp[]) {
    this.rootPath = rootPath;
    this.testPatterns = testPatterns || DEFAULT_TEST_PATTERNS;
  }

  /**
   * Run full project analysis
   */
  analyze(parsedFiles: ParsedFile[]): ProjectAnalysisResult {
    // Calculate test file ratio
    const testStats = this.analyzeTestFiles(parsedFiles);
    
    // Find unused exports
    const unusedExports = this.findUnusedExports(parsedFiles);
    
    // Detect code duplication
    const duplications = this.detectDuplication(parsedFiles);
    
    return {
      testStats,
      unusedExports,
      totalUnusedExports: unusedExports.length,
      duplications,
      totalDuplications: duplications.length,
      duplicatedLines: duplications.reduce(
        (sum, d) => sum + d.occurrences.reduce((s, o) => s + o.linesOfCode, 0) * (d.totalOccurrences - 1),
        0
      )
    };
  }

  /**
   * Analyze test file ratio
   */
  private analyzeTestFiles(parsedFiles: ParsedFile[]): TestFileStats {
    let testFiles = 0;
    let sourceFiles = 0;

    for (const file of parsedFiles) {
      if (this.isTestFile(file.filePath)) {
        testFiles++;
      } else {
        sourceFiles++;
      }
    }

    const totalFiles = parsedFiles.length;
    const testFileRatio = totalFiles > 0 ? testFiles / totalFiles : 0;

    return {
      testFiles,
      sourceFiles,
      totalFiles,
      testFileRatio,
      testFilePatterns: this.testPatterns.map(p => p.source)
    };
  }

  /**
   * Check if a file is a test file
   */
  private isTestFile(filePath: string): boolean {
    const normalizedPath = filePath.replace(/\\/g, '/');
    return this.testPatterns.some(pattern => pattern.test(normalizedPath));
  }

  /**
   * Find exports that are not imported anywhere in the project
   */
  private findUnusedExports(parsedFiles: ParsedFile[]): UnusedExport[] {
    // Build a map of all imports
    const importedSymbols = new Map<string, Set<string>>();
    const filePathMap = new Map<string, string>();

    // Normalize file paths and build lookup
    for (const file of parsedFiles) {
      const normalized = this.normalizePath(file.filePath);
      filePathMap.set(normalized, file.filePath);
    }

    // Collect all imports
    for (const file of parsedFiles) {
      for (const imp of file.imports) {
        const resolvedPath = this.resolveImportPath(file.filePath, imp.modulePath);
        if (!resolvedPath) continue;

        if (!importedSymbols.has(resolvedPath)) {
          importedSymbols.set(resolvedPath, new Set());
        }

        const imports = importedSymbols.get(resolvedPath)!;

        // Track what's imported
        if (imp.defaultImport) {
          imports.add('__default__');
        }
        if (imp.namespaceImport) {
          imports.add('__namespace__');
        }
        for (const named of imp.namedImports) {
          imports.add(named);
        }
      }
    }

    // Find unused exports
    const unusedExports: UnusedExport[] = [];

    for (const file of parsedFiles) {
      // Skip test files
      if (this.isTestFile(file.filePath)) continue;

      const normalized = this.normalizePath(file.filePath);
      const fileImports = importedSymbols.get(normalized) || new Set();

      for (const exp of file.exports) {
        // Skip re-exports
        if (exp.isReExport) continue;

        const isUsed = exp.isDefault 
          ? fileImports.has('__default__') || fileImports.has('__namespace__')
          : fileImports.has(exp.name) || fileImports.has('__namespace__');

        if (!isUsed) {
          // Find the symbol for line info
          const symbol = file.symbols.find(s => s.name === exp.name && s.exported);
          
          unusedExports.push({
            filePath: file.filePath,
            exportName: exp.name,
            isDefault: exp.isDefault,
            line: symbol?.line
          });
        }
      }
    }

    return unusedExports;
  }

  /**
   * Detect code duplication using content hashing
   * Groups similar functions/methods by their normalized code hash
   */
  private detectDuplication(parsedFiles: ParsedFile[]): CodeDuplication[] {
    // Map hash -> occurrences
    const hashMap = new Map<string, CodeDuplication['occurrences']>();

    for (const file of parsedFiles) {
      for (const symbol of file.symbols) {
        // Only check functions, methods, and components with significant size
        if (!this.isDuplicationCandidate(symbol)) continue;

        // Create a normalized hash of the symbol's characteristics
        const hash = this.createSymbolHash(symbol);

        if (!hashMap.has(hash)) {
          hashMap.set(hash, []);
        }

        hashMap.get(hash)!.push({
          filePath: file.filePath,
          symbolName: symbol.name,
          line: symbol.line,
          linesOfCode: symbol.linesOfCode || 0
        });
      }
    }

    // Filter to only duplicated code (2+ occurrences)
    const duplications: CodeDuplication[] = [];

    for (const [hash, occurrences] of hashMap) {
      if (occurrences.length >= 2) {
        duplications.push({
          hash,
          occurrences,
          totalOccurrences: occurrences.length
        });
      }
    }

    // Sort by impact (total duplicated lines)
    duplications.sort((a, b) => {
      const aLines = a.occurrences[0].linesOfCode * (a.totalOccurrences - 1);
      const bLines = b.occurrences[0].linesOfCode * (b.totalOccurrences - 1);
      return bLines - aLines;
    });

    return duplications;
  }

  /**
   * Check if a symbol is a candidate for duplication detection
   */
  private isDuplicationCandidate(symbol: LightweightSymbol): boolean {
    // Only functions, hooks, and components
    const validKinds = ['function', 'hook', 'component'];
    if (!validKinds.includes(symbol.kind)) return false;

    // Must have meaningful size (at least 5 lines)
    if (!symbol.linesOfCode || symbol.linesOfCode < 5) return false;

    return true;
  }

  /**
   * Create a hash representing a symbol's structure
   * Uses metrics as a fingerprint - similar code will have similar metrics
   */
  private createSymbolHash(symbol: LightweightSymbol): string {
    // Create a fingerprint from structural characteristics
    const fingerprint = [
      symbol.linesOfCode || 0,
      symbol.complexity || 0,
      symbol.parameterCount || 0,
      symbol.maxNestingDepth || 0,
      symbol.returnCount || 0,
      symbol.throwCount || 0,
      symbol.callbackDepth || 0,
      symbol.promiseChainLength || 0
    ].join(':');

    // Hash the fingerprint
    return crypto.createHash('md5').update(fingerprint).digest('hex').slice(0, 12);
  }

  /**
   * Resolve an import path to an absolute file path
   */
  private resolveImportPath(fromFile: string, importPath: string): string | null {
    // Skip external modules
    if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
      return null;
    }

    const fromDir = path.dirname(fromFile);
    let resolved = path.resolve(fromDir, importPath);

    // Try common extensions
    const extensions = ['.ts', '.tsx', '.js', '.jsx', ''];
    for (const ext of extensions) {
      const withExt = resolved + ext;
      const normalized = this.normalizePath(withExt);
      return normalized;
    }

    return this.normalizePath(resolved);
  }

  /**
   * Normalize path for consistent comparison
   */
  private normalizePath(filePath: string): string {
    return path.normalize(filePath).toLowerCase().replace(/\\/g, '/');
  }

  /**
   * Get statistics summary for a project analysis
   */
  getSummary(result: ProjectAnalysisResult): string {
    const lines: string[] = [
      '=== Project Analysis Summary ===',
      '',
      '📊 Test Coverage:',
      `   Test files: ${result.testStats.testFiles}`,
      `   Source files: ${result.testStats.sourceFiles}`,
      `   Test file ratio: ${(result.testStats.testFileRatio * 100).toFixed(1)}%`,
      '',
      '🔍 Dead Code:',
      `   Unused exports: ${result.totalUnusedExports}`,
      '',
      '📋 Code Duplication:',
      `   Duplicate patterns: ${result.totalDuplications}`,
      `   Estimated duplicated lines: ${result.duplicatedLines}`,
    ];

    return lines.join('\n');
  }
}

/**
 * Create a project analyzer instance
 */
export function createProjectAnalyzer(rootPath: string): ProjectAnalyzer {
  return new ProjectAnalyzer(rootPath);
}
