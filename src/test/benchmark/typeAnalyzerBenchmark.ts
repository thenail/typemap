/**
 * TypeAnalyzer Benchmark
 * 
 * Standalone benchmark for measuring TypeScript type analysis performance.
 * Compares SWC fast parsing vs TypeScript Language Service deep analysis.
 * 
 * Run with: npx ts-node --project src/test/benchmark/tsconfig.json src/test/benchmark/typeAnalyzerBenchmark.ts [path]
 */

import * as path from 'path';
import * as fs from 'fs';
import * as ts from 'typescript';
import * as swc from '@swc/core';

// ============================================================================
// Types
// ============================================================================

interface SymbolInfo {
  name: string;
  kind: 'class' | 'interface' | 'function' | 'variable' | 'type' | 'enum' | 'method' | 'property';
  filePath: string;
  line: number;
  column: number;
  isExported: boolean;
}

interface ImplementationInfo {
  symbol: SymbolInfo;
  isExplicit: boolean;
  matchedMembers: string[];
}

interface BenchmarkResult {
  name: string;
  duration: number;
  count?: number;
  details?: string;
}

// ============================================================================
// File Discovery
// ============================================================================

function discoverFiles(rootPath: string): string[] {
  const files: string[] = [];
  const extensions = ['.ts', '.tsx'];
  const ignoreDirs = ['node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage'];

  function walkDir(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!ignoreDirs.includes(entry.name) && !entry.name.startsWith('.')) {
          walkDir(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        // Skip declaration files
        if (extensions.includes(ext) && !entry.name.endsWith('.d.ts')) {
          files.push(fullPath);
        }
      }
    }
  }

  walkDir(rootPath);
  return files;
}

// ============================================================================
// SWC Parser (Fast path)
// ============================================================================

async function parseWithSwc(files: string[]): Promise<{ interfaces: SymbolInfo[], classes: SymbolInfo[], totalSymbols: number }> {
  const interfaces: SymbolInfo[] = [];
  const classes: SymbolInfo[] = [];
  let totalSymbols = 0;

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const isTsx = filePath.endsWith('.tsx');

    try {
      const module = await swc.parse(content, {
        syntax: isTsx ? 'typescript' : 'typescript',
        tsx: isTsx,
      });

      for (const item of module.body) {
        if (item.type === 'TsInterfaceDeclaration') {
          interfaces.push({
            name: item.id.value,
            kind: 'interface',
            filePath,
            line: item.span.start,
            column: 0,
            isExported: false, // Would need to check exports
          });
          totalSymbols++;
        } else if (item.type === 'ClassDeclaration' && item.identifier) {
          classes.push({
            name: item.identifier.value,
            kind: 'class',
            filePath,
            line: item.span.start,
            column: 0,
            isExported: false,
          });
          totalSymbols++;
        } else if (item.type === 'ExportDeclaration') {
          const decl = item.declaration;
          if (decl.type === 'TsInterfaceDeclaration') {
            interfaces.push({
              name: decl.id.value,
              kind: 'interface',
              filePath,
              line: decl.span.start,
              column: 0,
              isExported: true,
            });
            totalSymbols++;
          } else if (decl.type === 'ClassDeclaration' && decl.identifier) {
            classes.push({
              name: decl.identifier.value,
              kind: 'class',
              filePath,
              line: decl.span.start,
              column: 0,
              isExported: true,
            });
            totalSymbols++;
          }
        }
      }
    } catch (e) {
      // Skip files that fail to parse
    }
  }

  return { interfaces, classes, totalSymbols };
}

// ============================================================================
// TypeScript Language Service (Deep analysis)
// ============================================================================

class TypeAnalyzerBenchmark {
  private program: ts.Program | null = null;
  private typeChecker: ts.TypeChecker | null = null;
  private languageService: ts.LanguageService | null = null;
  private fileContents: Map<string, string> = new Map();

  initialize(projectRoot: string, files: string[]): void {
    // Find tsconfig.json
    const configPath = ts.findConfigFile(projectRoot, ts.sys.fileExists, 'tsconfig.json');
    
    let compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.Latest,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
      skipLibCheck: true,
      strict: false,
      noEmit: true,
    };

    if (configPath) {
      const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
      if (!configFile.error) {
        const parsed = ts.parseJsonConfigFileContent(
          configFile.config,
          ts.sys,
          path.dirname(configPath)
        );
        compilerOptions = { ...compilerOptions, ...parsed.options };
      }
    }

    // Create language service host
    const serviceHost: ts.LanguageServiceHost = {
      getScriptFileNames: () => files,
      getScriptVersion: () => '1',
      getScriptSnapshot: (fileName) => {
        if (this.fileContents.has(fileName)) {
          return ts.ScriptSnapshot.fromString(this.fileContents.get(fileName)!);
        }
        if (ts.sys.fileExists(fileName)) {
          const content = ts.sys.readFile(fileName) || '';
          this.fileContents.set(fileName, content);
          return ts.ScriptSnapshot.fromString(content);
        }
        return undefined;
      },
      getCurrentDirectory: () => projectRoot,
      getCompilationSettings: () => compilerOptions,
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
    };

    this.languageService = ts.createLanguageService(serviceHost);
    this.program = this.languageService.getProgram() || null;
    this.typeChecker = this.program?.getTypeChecker() || null;
  }

  findImplementations(symbolName: string, filePath: string): ImplementationInfo[] {
    if (!this.program || !this.typeChecker) {
      throw new Error('TypeAnalyzer not initialized');
    }

    const implementations: ImplementationInfo[] = [];
    const sourceFile = this.program.getSourceFile(filePath);
    
    if (!sourceFile) {
      return implementations;
    }

    // Find the target interface symbol
    const targetSymbol = this.findSymbolByName(sourceFile, symbolName);
    if (!targetSymbol) {
      return implementations;
    }

    const targetType = this.typeChecker.getDeclaredTypeOfSymbol(targetSymbol);
    if (!targetType) {
      return implementations;
    }

    // Get members of the target interface
    const targetMembers = this.getTypeMembers(targetType);

    // Search all source files
    for (const sf of this.program.getSourceFiles()) {
      if (sf.isDeclarationFile) continue;
      this.findImplementationsInFile(sf, targetSymbol, targetType, targetMembers, implementations);
    }

    return implementations;
  }

  private findSymbolByName(sourceFile: ts.SourceFile, name: string): ts.Symbol | undefined {
    let result: ts.Symbol | undefined;

    const visit = (node: ts.Node): void => {
      if (result) return;

      if (ts.isInterfaceDeclaration(node) && node.name.text === name) {
        result = this.typeChecker!.getSymbolAtLocation(node.name);
      } else if (ts.isClassDeclaration(node) && node.name?.text === name) {
        result = this.typeChecker!.getSymbolAtLocation(node.name);
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return result;
  }

  private getTypeMembers(type: ts.Type): Set<string> {
    const members = new Set<string>();
    const props = type.getProperties();
    for (const prop of props) {
      members.add(prop.getName());
    }
    return members;
  }

  private findImplementationsInFile(
    sourceFile: ts.SourceFile,
    targetSymbol: ts.Symbol,
    targetType: ts.Type,
    targetMembers: Set<string>,
    results: ImplementationInfo[]
  ): void {
    if (!this.typeChecker) return;

    const visit = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node) && node.name) {
        const classSymbol = this.typeChecker!.getSymbolAtLocation(node.name);
        if (classSymbol) {
          const isExplicit = this.hasExplicitImplements(node, targetSymbol);
          const classType = this.typeChecker!.getDeclaredTypeOfSymbol(classSymbol);
          const isStructuralMatch = this.isStructurallyCompatible(classType, targetMembers);

          if (isExplicit || isStructuralMatch) {
            const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
            results.push({
              symbol: {
                name: node.name.text,
                kind: 'class',
                filePath: sourceFile.fileName,
                line: line + 1,
                column: character + 1,
                isExported: this.isExported(node),
              },
              isExplicit,
              matchedMembers: Array.from(targetMembers),
            });
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  private hasExplicitImplements(node: ts.ClassDeclaration, targetSymbol: ts.Symbol): boolean {
    if (!node.heritageClauses) return false;
    
    for (const clause of node.heritageClauses) {
      if (clause.token === ts.SyntaxKind.ImplementsKeyword) {
        for (const typeRef of clause.types) {
          const symbol = this.typeChecker!.getSymbolAtLocation(typeRef.expression);
          if (symbol === targetSymbol) {
            return true;
          }
        }
      }
    }
    return false;
  }

  private isStructurallyCompatible(classType: ts.Type, targetMembers: Set<string>): boolean {
    if (targetMembers.size === 0) return false;
    
    const classMembers = this.getTypeMembers(classType);
    for (const member of targetMembers) {
      if (!classMembers.has(member)) {
        return false;
      }
    }
    return true;
  }

  private isExported(node: ts.ClassDeclaration): boolean {
    return node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) || false;
  }
}

// ============================================================================
// Benchmark Runner
// ============================================================================

async function runBenchmark(testDataPath: string): Promise<void> {
  const results: BenchmarkResult[] = [];

  console.log('\n' + '='.repeat(70));
  console.log('TypeAnalyzer Benchmark - SWC (Fast) vs TypeScript (Deep)');
  console.log('='.repeat(70));
  console.log(`Test data path: ${testDataPath}`);
  console.log('');

  // Phase 1: File Discovery
  console.log('Phase 1: File Discovery...');
  const startDiscovery = performance.now();
  const files = discoverFiles(testDataPath);
  const discoveryTime = performance.now() - startDiscovery;

  results.push({ name: 'File Discovery', duration: discoveryTime, count: files.length });
  console.log(`  Found ${files.length} files in ${discoveryTime.toFixed(2)}ms`);

  if (files.length === 0) {
    console.log('\n⚠️  No TypeScript files found.');
    return;
  }

  // Phase 2: SWC Fast Parsing
  console.log('\nPhase 2: SWC Fast Parsing...');
  const startSwc = performance.now();
  const swcResult = await parseWithSwc(files);
  const swcTime = performance.now() - startSwc;

  results.push({
    name: 'SWC Parsing',
    duration: swcTime,
    count: swcResult.totalSymbols,
    details: `${swcResult.interfaces.length} interfaces, ${swcResult.classes.length} classes`
  });
  console.log(`  Parsed ${swcResult.totalSymbols} symbols in ${swcTime.toFixed(2)}ms`);
  console.log(`  Found ${swcResult.interfaces.length} interfaces, ${swcResult.classes.length} classes`);

  // Phase 3: TypeScript Language Service Initialization
  console.log('\nPhase 3: TypeScript Language Service Initialization...');
  const startTsInit = performance.now();
  const typeAnalyzer = new TypeAnalyzerBenchmark();
  typeAnalyzer.initialize(testDataPath, files);
  const tsInitTime = performance.now() - startTsInit;

  results.push({ name: 'TS Language Service Init', duration: tsInitTime });
  console.log(`  Initialized in ${tsInitTime.toFixed(2)}ms`);

  // Phase 4: Find Implementations Benchmark
  if (swcResult.interfaces.length > 0) {
    console.log(`\nPhase 4: Find Implementations (${Math.min(10, swcResult.interfaces.length)} interfaces)...`);
    
    const testInterfaces = swcResult.interfaces.slice(0, 10);
    let totalImplementations = 0;
    const implResults: { name: string, count: number, time: number }[] = [];

    const startFindImpl = performance.now();
    
    for (const iface of testInterfaces) {
      const startSingle = performance.now();
      try {
        const implementations = typeAnalyzer.findImplementations(iface.name, iface.filePath);
        const singleTime = performance.now() - startSingle;
        totalImplementations += implementations.length;
        implResults.push({ name: iface.name, count: implementations.length, time: singleTime });
      } catch (e) {
        console.log(`    ${iface.name}: error`);
      }
    }
    
    const findImplTime = performance.now() - startFindImpl;

    results.push({
      name: 'Find Implementations',
      duration: findImplTime,
      count: totalImplementations,
      details: `${testInterfaces.length} interfaces searched`
    });

    console.log(`  Results:`);
    for (const r of implResults) {
      console.log(`    ${r.name}: ${r.count} implementations (${r.time.toFixed(2)}ms)`);
    }
    console.log(`  Total: ${totalImplementations} implementations in ${findImplTime.toFixed(2)}ms`);
    console.log(`  Avg per interface: ${(findImplTime / testInterfaces.length).toFixed(2)}ms`);
  } else {
    console.log('\nPhase 4: Find Implementations (skipped - no interfaces found)');
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('Summary');
  console.log('='.repeat(70));

  console.log('\nBenchmark Results:');
  for (const r of results) {
    const countStr = r.count !== undefined ? ` (${r.count})` : '';
    const detailStr = r.details ? ` - ${r.details}` : '';
    console.log(`  ${r.name}: ${r.duration.toFixed(2)}ms${countStr}${detailStr}`);
  }

  console.log('\nPerformance Comparison:');
  console.log(`  SWC Parsing: ${swcTime.toFixed(2)}ms for ${files.length} files`);
  console.log(`  TS Init: ${tsInitTime.toFixed(2)}ms`);
  console.log(`  Files/sec (SWC): ${((files.length / swcTime) * 1000).toFixed(0)}`);
  
  if (swcResult.interfaces.length > 0) {
    const findImplResult = results.find(r => r.name === 'Find Implementations');
    if (findImplResult) {
      const avgFindImpl = findImplResult.duration / Math.min(10, swcResult.interfaces.length);
      console.log(`  Avg Find Implementations: ${avgFindImpl.toFixed(2)}ms per interface`);
    }
  }

  console.log('\nRecommendation:');
  console.log('  Use SWC for initial fast parsing and mindmap generation');
  console.log('  Use TypeScript Language Service for deep type queries on demand');
  console.log('='.repeat(70));
}

// Main entry point
async function main() {
  const testDataPath = process.argv[2] || path.resolve(__dirname, '../../../testdata');
  
  try {
    await runBenchmark(testDataPath);
  } catch (error) {
    console.error('Benchmark failed:', error);
    process.exit(1);
  }
}

main();
