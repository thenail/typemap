/**
 * Standalone Performance Benchmark for TypeMap Analysis
 * 
 * This benchmark measures the core analysis performance without VS Code dependencies.
 * Run with: npx ts-node --project src/test/benchmark/tsconfig.json src/test/benchmark/standaloneBenchmark.ts ./testdata
 */

import * as path from 'path';
import * as fs from 'fs';
import * as ts from 'typescript';

// ============================================================================
// Types (standalone copies to avoid VS Code dependencies)
// ============================================================================

interface SymbolInfo {
    name: string;
    kind: 'class' | 'interface' | 'function' | 'variable' | 'type' | 'enum' | 'namespace' | 'method' | 'property';
    line: number;
    column: number;
    isExported: boolean;
    isAsync?: boolean;
    modifiers?: string[];
}

interface ImportInfo {
    modulePath: string;
    namedImports: string[];
    defaultImport?: string;
    namespaceImport?: string;
}

interface ExportInfo {
    name: string;
    isDefault: boolean;
    isReExport: boolean;
    fromModule?: string;
}

interface FileSymbols {
    filePath: string;
    symbols: SymbolInfo[];
    imports: ImportInfo[];
    exports: ExportInfo[];
    parseTime: number;
}

interface MindmapNode {
    id: string;
    label: string;
    type: 'root' | 'folder' | 'file' | 'symbol';
    symbolKind?: string;
    children: MindmapNode[];
    metadata?: Record<string, unknown>;
}

interface BenchmarkResult {
    name: string;
    duration: number;
    filesAnalyzed?: number;
    symbolsFound?: number;
    nodesCreated?: number;
}

// ============================================================================
// Standalone File Discovery (Node.js fs-based)
// ============================================================================

function discoverTypeScriptFiles(rootPath: string): string[] {
    const files: string[] = [];
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];
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
                if (extensions.includes(ext)) {
                    files.push(fullPath);
                }
            }
        }
    }

    walkDir(rootPath);
    return files;
}

// ============================================================================
// Standalone Lightweight Parser (TypeScript compiler API)
// ============================================================================

function parseFile(filePath: string): FileSymbols {
    const startTime = performance.now();
    const content = fs.readFileSync(filePath, 'utf-8');

    const isJsx = filePath.endsWith('.tsx') || filePath.endsWith('.jsx');
    const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true,
        isJsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );

    const symbols: SymbolInfo[] = [];
    const imports: ImportInfo[] = [];
    const exports: ExportInfo[] = [];

    function visit(node: ts.Node): void {
        // Extract imports
        if (ts.isImportDeclaration(node)) {
            const moduleSpecifier = node.moduleSpecifier;
            if (ts.isStringLiteral(moduleSpecifier)) {
                const importInfo: ImportInfo = {
                    modulePath: moduleSpecifier.text,
                    namedImports: [],
                };

                const importClause = node.importClause;
                if (importClause) {
                    if (importClause.name) {
                        importInfo.defaultImport = importClause.name.text;
                    }
                    if (importClause.namedBindings) {
                        if (ts.isNamespaceImport(importClause.namedBindings)) {
                            importInfo.namespaceImport = importClause.namedBindings.name.text;
                        } else if (ts.isNamedImports(importClause.namedBindings)) {
                            importInfo.namedImports = importClause.namedBindings.elements.map(
                                (el) => el.name.text
                            );
                        }
                    }
                }
                imports.push(importInfo);
            }
        }

        // Extract exports
        if (ts.isExportDeclaration(node)) {
            if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
                exports.push({
                    name: '*',
                    isDefault: false,
                    isReExport: true,
                    fromModule: node.moduleSpecifier.text,
                });
            }
        }

        // Extract symbols
        const hasExportModifier = (n: ts.Node): boolean => {
            const modifiers = ts.canHaveModifiers(n) ? ts.getModifiers(n) : undefined;
            return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
        };

        const getPosition = (n: ts.Node) => {
            const { line, character } = sourceFile.getLineAndCharacterOfPosition(n.getStart());
            return { line: line + 1, column: character + 1 };
        };

        if (ts.isClassDeclaration(node) && node.name) {
            const pos = getPosition(node);
            symbols.push({
                name: node.name.text,
                kind: 'class',
                line: pos.line,
                column: pos.column,
                isExported: hasExportModifier(node),
            });
        }

        if (ts.isInterfaceDeclaration(node) && node.name) {
            const pos = getPosition(node);
            symbols.push({
                name: node.name.text,
                kind: 'interface',
                line: pos.line,
                column: pos.column,
                isExported: hasExportModifier(node),
            });
        }

        if (ts.isFunctionDeclaration(node) && node.name) {
            const pos = getPosition(node);
            const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
            const isAsync = modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
            symbols.push({
                name: node.name.text,
                kind: 'function',
                line: pos.line,
                column: pos.column,
                isExported: hasExportModifier(node),
                isAsync,
            });
        }

        if (ts.isTypeAliasDeclaration(node)) {
            const pos = getPosition(node);
            symbols.push({
                name: node.name.text,
                kind: 'type',
                line: pos.line,
                column: pos.column,
                isExported: hasExportModifier(node),
            });
        }

        if (ts.isEnumDeclaration(node)) {
            const pos = getPosition(node);
            symbols.push({
                name: node.name.text,
                kind: 'enum',
                line: pos.line,
                column: pos.column,
                isExported: hasExportModifier(node),
            });
        }

        if (ts.isVariableStatement(node)) {
            const isExported = hasExportModifier(node);
            for (const decl of node.declarationList.declarations) {
                if (ts.isIdentifier(decl.name)) {
                    const pos = getPosition(decl);
                    symbols.push({
                        name: decl.name.text,
                        kind: 'variable',
                        line: pos.line,
                        column: pos.column,
                        isExported,
                    });
                }
            }
        }

        ts.forEachChild(node, visit);
    }

    visit(sourceFile);

    return {
        filePath,
        symbols,
        imports,
        exports,
        parseTime: performance.now() - startTime,
    };
}

// ============================================================================
// Standalone Graph Builder
// ============================================================================

function buildGraph(rootPath: string, allSymbols: FileSymbols[]): { root: MindmapNode; totalNodes: number } {
    const rootName = path.basename(rootPath);
    const root: MindmapNode = {
        id: 'root',
        label: rootName,
        type: 'root',
        children: [],
    };

    let totalNodes = 1;
    const folderMap = new Map<string, MindmapNode>();

    for (const fileSymbols of allSymbols) {
        const relativePath = path.relative(rootPath, fileSymbols.filePath);
        const parts = relativePath.split(path.sep);

        let currentParent = root;
        let currentPath = '';

        // Build folder hierarchy
        for (let i = 0; i < parts.length - 1; i++) {
            currentPath = currentPath ? path.join(currentPath, parts[i]) : parts[i];

            if (!folderMap.has(currentPath)) {
                const folderNode: MindmapNode = {
                    id: `folder-${currentPath}`,
                    label: parts[i],
                    type: 'folder',
                    children: [],
                };
                currentParent.children.push(folderNode);
                folderMap.set(currentPath, folderNode);
                totalNodes++;
            }
            currentParent = folderMap.get(currentPath)!;
        }

        // Create file node
        const fileName = parts[parts.length - 1];
        const fileNode: MindmapNode = {
            id: `file-${relativePath}`,
            label: fileName,
            type: 'file',
            children: [],
            metadata: {
                symbols: fileSymbols.symbols.length,
                imports: fileSymbols.imports.length,
            },
        };
        currentParent.children.push(fileNode);
        totalNodes++;

        // Add symbol nodes
        for (const symbol of fileSymbols.symbols) {
            const symbolNode: MindmapNode = {
                id: `symbol-${relativePath}-${symbol.name}-${symbol.line}`,
                label: symbol.name,
                type: 'symbol',
                symbolKind: symbol.kind,
                children: [],
                metadata: {
                    line: symbol.line,
                    isExported: symbol.isExported,
                },
            };
            fileNode.children.push(symbolNode);
            totalNodes++;
        }
    }

    return { root, totalNodes };
}

// ============================================================================
// Benchmark Runner
// ============================================================================

interface PerformanceMetrics {
    fileCount: number;
    totalSymbols: number;
    totalNodes: number;
    discoveryTime: number;
    parseTime: number;
    graphBuildTime: number;
    totalTime: number;
    avgParseTimePerFile: number;
    filesPerSecond: number;
    symbolsPerSecond: number;
}

async function runBenchmark(testPath: string): Promise<PerformanceMetrics> {
    const absolutePath = path.resolve(testPath);

    console.log('\n' + '='.repeat(60));
    console.log('TypeMap Performance Benchmark (Standalone)');
    console.log('='.repeat(60));
    console.log(`Target: ${absolutePath}`);
    console.log('');

    const totalStart = performance.now();

    // Phase 1: File Discovery
    console.log('Phase 1: File Discovery...');
    const discoveryStart = performance.now();
    const files = discoverTypeScriptFiles(absolutePath);
    const discoveryTime = performance.now() - discoveryStart;
    console.log(`  Found ${files.length} files in ${discoveryTime.toFixed(2)}ms`);

    if (files.length === 0) {
        console.log('\nNo TypeScript files found!');
        return {
            fileCount: 0,
            totalSymbols: 0,
            totalNodes: 0,
            discoveryTime,
            parseTime: 0,
            graphBuildTime: 0,
            totalTime: discoveryTime,
            avgParseTimePerFile: 0,
            filesPerSecond: 0,
            symbolsPerSecond: 0,
        };
    }

    // Phase 2: Parse All Files
    console.log('\nPhase 2: Parsing Files...');
    const parseStart = performance.now();
    const allSymbols: FileSymbols[] = [];
    let totalSymbols = 0;
    let parseErrors = 0;

    for (const file of files) {
        try {
            const result = parseFile(file);
            allSymbols.push(result);
            totalSymbols += result.symbols.length;
        } catch (err) {
            parseErrors++;
        }
    }
    const parseTime = performance.now() - parseStart;
    console.log(`  Parsed ${allSymbols.length} files in ${parseTime.toFixed(2)}ms`);
    console.log(`  Found ${totalSymbols} symbols`);
    if (parseErrors > 0) {
        console.log(`  Parse errors: ${parseErrors}`);
    }

    // Phase 3: Build Graph
    console.log('\nPhase 3: Building Graph...');
    const graphStart = performance.now();
    const { totalNodes } = buildGraph(absolutePath, allSymbols);
    const graphBuildTime = performance.now() - graphStart;
    console.log(`  Created ${totalNodes} nodes in ${graphBuildTime.toFixed(2)}ms`);

    const totalTime = performance.now() - totalStart;

    // Calculate metrics
    const metrics: PerformanceMetrics = {
        fileCount: files.length,
        totalSymbols,
        totalNodes,
        discoveryTime,
        parseTime,
        graphBuildTime,
        totalTime,
        avgParseTimePerFile: parseTime / files.length,
        filesPerSecond: (files.length / totalTime) * 1000,
        symbolsPerSecond: (totalSymbols / totalTime) * 1000,
    };

    // Print Summary
    console.log('\n' + '='.repeat(60));
    console.log('BENCHMARK RESULTS');
    console.log('='.repeat(60));
    console.log('');
    console.log('Timing Breakdown:');
    console.log(`  File Discovery:    ${discoveryTime.toFixed(2)}ms (${((discoveryTime / totalTime) * 100).toFixed(1)}%)`);
    console.log(`  File Parsing:      ${parseTime.toFixed(2)}ms (${((parseTime / totalTime) * 100).toFixed(1)}%)`);
    console.log(`  Graph Building:    ${graphBuildTime.toFixed(2)}ms (${((graphBuildTime / totalTime) * 100).toFixed(1)}%)`);
    console.log(`  ─────────────────────────────`);
    console.log(`  Total Time:        ${totalTime.toFixed(2)}ms`);
    console.log('');
    console.log('Statistics:');
    console.log(`  Files Analyzed:    ${files.length}`);
    console.log(`  Symbols Found:     ${totalSymbols}`);
    console.log(`  Graph Nodes:       ${totalNodes}`);
    console.log('');
    console.log('Performance:');
    console.log(`  Avg Parse Time:    ${metrics.avgParseTimePerFile.toFixed(3)}ms/file`);
    console.log(`  Throughput:        ${metrics.filesPerSecond.toFixed(1)} files/sec`);
    console.log(`  Symbol Rate:       ${metrics.symbolsPerSecond.toFixed(1)} symbols/sec`);
    console.log('');

    // Performance assessment against targets
    console.log('Target Assessment:');
    if (files.length < 100) {
        const target = 500;
        const passed = totalTime < target;
        console.log(`  <100 files target: ${target}ms - ${passed ? '✓ PASS' : '✗ FAIL'} (${totalTime.toFixed(0)}ms)`);
    } else if (files.length < 1000) {
        const target = 2000;
        const passed = totalTime < target;
        console.log(`  100-1000 files target: ${target}ms - ${passed ? '✓ PASS' : '✗ FAIL'} (${totalTime.toFixed(0)}ms)`);
    } else {
        const target = 5000;
        const passed = totalTime < target;
        console.log(`  1000+ files target: ${target}ms - ${passed ? '✓ PASS' : '✗ FAIL'} (${totalTime.toFixed(0)}ms)`);
    }

    console.log('\n' + '='.repeat(60));

    return metrics;
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
    const testPath = process.argv[2] || './testdata';

    if (!fs.existsSync(testPath)) {
        console.error(`Error: Path does not exist: ${testPath}`);
        process.exit(1);
    }

    try {
        await runBenchmark(testPath);
    } catch (error) {
        console.error('Benchmark failed:', error);
        process.exit(1);
    }
}

main();
