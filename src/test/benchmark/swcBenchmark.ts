/**
 * SWC (WebAssembly) Performance Benchmark for TypeMap Analysis
 * 
 * Compares TypeScript Compiler API vs SWC (Rust/WASM) parsing performance.
 * Run with: npx ts-node --project src/test/benchmark/tsconfig.json src/test/benchmark/swcBenchmark.ts ./testdata
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
    kind: string;
    line: number;
    isExported: boolean;
}

interface ParseResult {
    filePath: string;
    symbols: SymbolInfo[];
    parseTime: number;
}

interface BenchmarkMetrics {
    name: string;
    fileCount: number;
    totalSymbols: number;
    discoveryTime: number;
    parseTime: number;
    avgParseTimePerFile: number;
    filesPerSecond: number;
}

// ============================================================================
// File Discovery (shared)
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
// TypeScript Compiler API Parser
// ============================================================================

function parseWithTypeScript(filePath: string, content: string): ParseResult {
    const startTime = performance.now();

    const isJsx = filePath.endsWith('.tsx') || filePath.endsWith('.jsx');
    const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true,
        isJsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );

    const symbols: SymbolInfo[] = [];

    function visit(node: ts.Node): void {
        const hasExportModifier = (n: ts.Node): boolean => {
            const modifiers = ts.canHaveModifiers(n) ? ts.getModifiers(n) : undefined;
            return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
        };

        const getLine = (n: ts.Node) => {
            return sourceFile.getLineAndCharacterOfPosition(n.getStart()).line + 1;
        };

        if (ts.isClassDeclaration(node) && node.name) {
            symbols.push({
                name: node.name.text,
                kind: 'class',
                line: getLine(node),
                isExported: hasExportModifier(node),
            });
        }

        if (ts.isInterfaceDeclaration(node) && node.name) {
            symbols.push({
                name: node.name.text,
                kind: 'interface',
                line: getLine(node),
                isExported: hasExportModifier(node),
            });
        }

        if (ts.isFunctionDeclaration(node) && node.name) {
            symbols.push({
                name: node.name.text,
                kind: 'function',
                line: getLine(node),
                isExported: hasExportModifier(node),
            });
        }

        if (ts.isTypeAliasDeclaration(node)) {
            symbols.push({
                name: node.name.text,
                kind: 'type',
                line: getLine(node),
                isExported: hasExportModifier(node),
            });
        }

        if (ts.isEnumDeclaration(node)) {
            symbols.push({
                name: node.name.text,
                kind: 'enum',
                line: getLine(node),
                isExported: hasExportModifier(node),
            });
        }

        if (ts.isVariableStatement(node)) {
            const isExported = hasExportModifier(node);
            for (const decl of node.declarationList.declarations) {
                if (ts.isIdentifier(decl.name)) {
                    symbols.push({
                        name: decl.name.text,
                        kind: 'variable',
                        line: getLine(decl),
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
        parseTime: performance.now() - startTime,
    };
}

// ============================================================================
// SWC (Rust/WASM) Parser
// ============================================================================

function parseWithSWC(filePath: string, content: string): ParseResult {
    const startTime = performance.now();

    const ext = path.extname(filePath).toLowerCase();
    const syntax: swc.ParserConfig = ext === '.tsx' || ext === '.jsx'
        ? { syntax: 'typescript', tsx: true }
        : ext === '.js'
        ? { syntax: 'ecmascript' }
        : { syntax: 'typescript', tsx: false };

    const module = swc.parseSync(content, {
        ...syntax,
        target: 'es2022',
        comments: false,
    });

    const symbols: SymbolInfo[] = [];

    // Extract symbols from SWC AST
    function extractSymbols(body: swc.ModuleItem[]): void {
        for (const item of body) {
            // Handle export declarations
            let isExported = false;
            let declaration: swc.Declaration | undefined;

            if (item.type === 'ExportDeclaration') {
                isExported = true;
                declaration = item.declaration;
            } else if (item.type === 'ExportDefaultDeclaration') {
                isExported = true;
                if (item.decl.type === 'ClassExpression' || item.decl.type === 'FunctionExpression') {
                    symbols.push({
                        name: item.decl.identifier?.value || 'default',
                        kind: item.decl.type === 'ClassExpression' ? 'class' : 'function',
                        line: item.span.start,
                        isExported: true,
                    });
                }
                continue;
            } else {
                declaration = item as swc.Declaration;
            }

            if (!declaration) continue;

            switch (declaration.type) {
                case 'ClassDeclaration':
                    symbols.push({
                        name: declaration.identifier.value,
                        kind: 'class',
                        line: declaration.span.start,
                        isExported,
                    });
                    break;

                case 'FunctionDeclaration':
                    symbols.push({
                        name: declaration.identifier.value,
                        kind: 'function',
                        line: declaration.span.start,
                        isExported,
                    });
                    break;

                case 'VariableDeclaration':
                    for (const decl of declaration.declarations) {
                        if (decl.id.type === 'Identifier') {
                            symbols.push({
                                name: decl.id.value,
                                kind: 'variable',
                                line: decl.span.start,
                                isExported,
                            });
                        }
                    }
                    break;

                case 'TsInterfaceDeclaration':
                    symbols.push({
                        name: declaration.id.value,
                        kind: 'interface',
                        line: declaration.span.start,
                        isExported,
                    });
                    break;

                case 'TsTypeAliasDeclaration':
                    symbols.push({
                        name: declaration.id.value,
                        kind: 'type',
                        line: declaration.span.start,
                        isExported,
                    });
                    break;

                case 'TsEnumDeclaration':
                    symbols.push({
                        name: declaration.id.value,
                        kind: 'enum',
                        line: declaration.span.start,
                        isExported,
                    });
                    break;
            }
        }
    }

    extractSymbols(module.body);

    return {
        filePath,
        symbols,
        parseTime: performance.now() - startTime,
    };
}

// ============================================================================
// Benchmark Runner
// ============================================================================

async function runParserBenchmark(
    name: string,
    files: string[],
    fileContents: Map<string, string>,
    parser: (filePath: string, content: string) => ParseResult
): Promise<BenchmarkMetrics> {
    const parseStart = performance.now();
    let totalSymbols = 0;
    let parseErrors = 0;

    for (const file of files) {
        try {
            const content = fileContents.get(file)!;
            const result = parser(file, content);
            totalSymbols += result.symbols.length;
        } catch (err) {
            parseErrors++;
        }
    }

    const parseTime = performance.now() - parseStart;

    return {
        name,
        fileCount: files.length,
        totalSymbols,
        discoveryTime: 0,
        parseTime,
        avgParseTimePerFile: parseTime / files.length,
        filesPerSecond: (files.length / parseTime) * 1000,
    };
}

async function main(): Promise<void> {
    const testPath = process.argv[2] || './testdata';
    const absolutePath = path.resolve(testPath);

    console.log('\n' + '='.repeat(70));
    console.log('TypeMap Parser Comparison Benchmark');
    console.log('TypeScript Compiler API vs SWC (Rust/WASM)');
    console.log('='.repeat(70));
    console.log(`Target: ${absolutePath}`);
    console.log('');

    // Phase 1: File Discovery
    console.log('Phase 1: Discovering files...');
    const discoveryStart = performance.now();
    const files = discoverTypeScriptFiles(absolutePath);
    const discoveryTime = performance.now() - discoveryStart;
    console.log(`  Found ${files.length} files in ${discoveryTime.toFixed(2)}ms`);

    if (files.length === 0) {
        console.log('\nNo TypeScript files found!');
        return;
    }

    // Phase 2: Pre-load all file contents (fair comparison)
    console.log('\nPhase 2: Pre-loading file contents...');
    const loadStart = performance.now();
    const fileContents = new Map<string, string>();
    for (const file of files) {
        try {
            fileContents.set(file, fs.readFileSync(file, 'utf-8'));
        } catch {
            // Skip unreadable files
        }
    }
    const loadTime = performance.now() - loadStart;
    console.log(`  Loaded ${fileContents.size} files in ${loadTime.toFixed(2)}ms`);

    const validFiles = Array.from(fileContents.keys());

    // Warm up both parsers
    console.log('\nPhase 3: Warming up parsers...');
    const warmupFile = validFiles[0];
    const warmupContent = fileContents.get(warmupFile)!;
    for (let i = 0; i < 10; i++) {
        parseWithTypeScript(warmupFile, warmupContent);
        parseWithSWC(warmupFile, warmupContent);
    }
    console.log('  Done');

    // Run benchmarks (3 iterations each)
    console.log('\nPhase 4: Running benchmarks (3 iterations each)...\n');

    const tsResults: BenchmarkMetrics[] = [];
    const swcResults: BenchmarkMetrics[] = [];

    for (let i = 1; i <= 3; i++) {
        console.log(`  Iteration ${i}:`);

        // TypeScript
        const tsResult = await runParserBenchmark('TypeScript', validFiles, fileContents, parseWithTypeScript);
        tsResults.push(tsResult);
        console.log(`    TypeScript: ${tsResult.parseTime.toFixed(2)}ms (${tsResult.totalSymbols} symbols)`);

        // SWC
        const swcResult = await runParserBenchmark('SWC', validFiles, fileContents, parseWithSWC);
        swcResults.push(swcResult);
        console.log(`    SWC:        ${swcResult.parseTime.toFixed(2)}ms (${swcResult.totalSymbols} symbols)`);
    }

    // Calculate averages
    const avgTS = {
        parseTime: tsResults.reduce((a, b) => a + b.parseTime, 0) / tsResults.length,
        symbols: tsResults[0].totalSymbols,
        filesPerSec: tsResults.reduce((a, b) => a + b.filesPerSecond, 0) / tsResults.length,
    };

    const avgSWC = {
        parseTime: swcResults.reduce((a, b) => a + b.parseTime, 0) / swcResults.length,
        symbols: swcResults[0].totalSymbols,
        filesPerSec: swcResults.reduce((a, b) => a + b.filesPerSecond, 0) / swcResults.length,
    };

    const speedup = avgTS.parseTime / avgSWC.parseTime;

    // Print Results
    console.log('\n' + '='.repeat(70));
    console.log('BENCHMARK RESULTS (averages of 3 runs)');
    console.log('='.repeat(70));
    console.log('');
    console.log('┌─────────────────────┬───────────────────┬───────────────────┐');
    console.log('│ Metric              │ TypeScript API    │ SWC (Rust/WASM)   │');
    console.log('├─────────────────────┼───────────────────┼───────────────────┤');
    console.log(`│ Parse Time          │ ${avgTS.parseTime.toFixed(2).padStart(12)}ms │ ${avgSWC.parseTime.toFixed(2).padStart(12)}ms │`);
    console.log(`│ Avg per File        │ ${(avgTS.parseTime / validFiles.length).toFixed(3).padStart(12)}ms │ ${(avgSWC.parseTime / validFiles.length).toFixed(3).padStart(12)}ms │`);
    console.log(`│ Files/Second        │ ${avgTS.filesPerSec.toFixed(0).padStart(12)}   │ ${avgSWC.filesPerSec.toFixed(0).padStart(12)}   │`);
    console.log(`│ Symbols Found       │ ${avgTS.symbols.toString().padStart(12)}   │ ${avgSWC.symbols.toString().padStart(12)}   │`);
    console.log('└─────────────────────┴───────────────────┴───────────────────┘');
    console.log('');
    console.log(`🚀 SWC is ${speedup.toFixed(2)}x faster than TypeScript Compiler API`);
    console.log('');

    // Total time comparison
    const tsTotalTime = discoveryTime + loadTime + avgTS.parseTime;
    const swcTotalTime = discoveryTime + loadTime + avgSWC.parseTime;

    console.log('Projected Total Analysis Time:');
    console.log(`  TypeScript API: ${tsTotalTime.toFixed(0)}ms`);
    console.log(`  SWC (WASM):     ${swcTotalTime.toFixed(0)}ms`);
    console.log(`  Time Saved:     ${(tsTotalTime - swcTotalTime).toFixed(0)}ms (${((1 - swcTotalTime / tsTotalTime) * 100).toFixed(1)}%)`);
    console.log('');
    console.log('='.repeat(70));
}

main().catch(console.error);
