/**
 * Standalone Hybrid Architecture Benchmark
 * 
 * Tests the SWC parser directly without VS Code dependencies.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as swc from '@swc/core';
import * as ts from 'typescript';
import { LightweightSymbol, SymbolKind, SymbolRelationship } from '../../types';

// ============================================================================
// Standalone SWC Parser (no VS Code dependencies)
// ============================================================================

interface ParsedFile {
  filePath: string;
  symbols: LightweightSymbol[];
  relationships: SymbolRelationship[];
  imports: { modulePath: string; namedImports: string[] }[];
}

async function parseWithSwc(files: string[], contents: Map<string, string>): Promise<ParsedFile[]> {
  const results: ParsedFile[] = [];

  await Promise.all(files.map(async (filePath) => {
    try {
      const content = contents.get(filePath)!;
      const ext = path.extname(filePath).toLowerCase();
      
      let parserConfig: swc.ParserConfig;
      if (ext === '.tsx') {
        parserConfig = { syntax: 'typescript', tsx: true };
      } else if (ext === '.jsx') {
        parserConfig = { syntax: 'ecmascript', jsx: true };
      } else if (ext === '.js' || ext === '.mjs') {
        parserConfig = { syntax: 'ecmascript', jsx: false };
      } else {
        parserConfig = { syntax: 'typescript', tsx: false };
      }

      const module = await swc.parse(content, {
        ...parserConfig,
        target: 'es2022',
        comments: false,
      });

      const isTsx = ext === '.tsx' || ext === '.jsx';
      const parsed = extractFromModule(module, filePath, isTsx);
      results.push(parsed);
    } catch {
      // Skip files with parse errors
    }
  }));

  return results;
}

function extractFromModule(module: swc.Module, filePath: string, isTsx: boolean): ParsedFile {
  const symbols: LightweightSymbol[] = [];
  const relationships: SymbolRelationship[] = [];
  const imports: { modulePath: string; namedImports: string[] }[] = [];

  for (const item of module.body) {
    // Imports
    if (item.type === 'ImportDeclaration') {
      const namedImports: string[] = [];
      for (const spec of item.specifiers) {
        if (spec.type === 'ImportSpecifier') {
          namedImports.push(spec.local.value);
        }
      }
      imports.push({ modulePath: item.source.value, namedImports });
    }

    // Export declarations
    if (item.type === 'ExportDeclaration') {
      const { symbol, rels } = extractDeclaration(item.declaration, filePath, isTsx, true);
      if (symbol) symbols.push(symbol);
      relationships.push(...rels);
    }

    // Regular declarations
    const { symbol, rels } = extractDeclaration(item, filePath, isTsx, false);
    if (symbol) symbols.push(symbol);
    relationships.push(...rels);
  }

  return { filePath, symbols, relationships, imports };
}

function extractDeclaration(
  node: any,
  filePath: string,
  isTsx: boolean,
  isExported: boolean
): { symbol: LightweightSymbol | null; rels: SymbolRelationship[] } {
  const rels: SymbolRelationship[] = [];

  // Class
  if (node.type === 'ClassDeclaration') {
    const symbol: LightweightSymbol = {
      name: node.identifier.value,
      kind: 'class',
      filePath,
      line: 1,
      column: 1,
      exported: isExported,
      isDefault: false,
    };

    // implements
    if (node.implements) {
      for (const impl of node.implements) {
        if (impl.expression?.type === 'Identifier') {
          rels.push({
            fromSymbol: node.identifier.value,
            toSymbol: impl.expression.value,
            type: 'implements',
            filePath,
          });
        }
      }
    }

    // extends
    if (node.superClass?.type === 'Identifier') {
      rels.push({
        fromSymbol: node.identifier.value,
        toSymbol: node.superClass.value,
        type: 'extends',
        filePath,
      });
    }

    return { symbol, rels };
  }

  // Function
  if (node.type === 'FunctionDeclaration') {
    const name = node.identifier.value;
    let kind: SymbolKind = 'function';
    if (name.startsWith('use') && name.length > 3 && name[3] === name[3].toUpperCase()) {
      kind = 'hook';
    } else if (isTsx && /^[A-Z]/.test(name)) {
      kind = 'component';
    }
    return {
      symbol: { name, kind, filePath, line: 1, column: 1, exported: isExported, isDefault: false },
      rels,
    };
  }

  // Variable
  if (node.type === 'VariableDeclaration') {
    for (const decl of node.declarations) {
      if (decl.id?.type === 'Identifier') {
        const name = decl.id.value;
        let kind: SymbolKind = 'variable';
        if (decl.init?.type === 'ArrowFunctionExpression' || decl.init?.type === 'FunctionExpression') {
          if (name.startsWith('use') && name.length > 3 && name[3] === name[3].toUpperCase()) {
            kind = 'hook';
          } else if (isTsx && /^[A-Z]/.test(name)) {
            kind = 'component';
          } else {
            kind = 'function';
          }
        }
        return {
          symbol: { name, kind, filePath, line: 1, column: 1, exported: isExported, isDefault: false },
          rels,
        };
      }
    }
  }

  // Interface
  if (node.type === 'TsInterfaceDeclaration') {
    const symbol: LightweightSymbol = {
      name: node.id.value,
      kind: 'interface',
      filePath,
      line: 1,
      column: 1,
      exported: isExported,
      isDefault: false,
    };

    if (node.extends) {
      for (const ext of node.extends) {
        if (ext.expression?.type === 'Identifier') {
          rels.push({
            fromSymbol: node.id.value,
            toSymbol: ext.expression.value,
            type: 'extends',
            filePath,
          });
        }
      }
    }

    return { symbol, rels };
  }

  // Type alias
  if (node.type === 'TsTypeAliasDeclaration') {
    return {
      symbol: { name: node.id.value, kind: 'type', filePath, line: 1, column: 1, exported: isExported, isDefault: false },
      rels,
    };
  }

  // Enum
  if (node.type === 'TsEnumDeclaration') {
    return {
      symbol: { name: node.id.value, kind: 'enum', filePath, line: 1, column: 1, exported: isExported, isDefault: false },
      rels,
    };
  }

  return { symbol: null, rels };
}

// ============================================================================
// File Discovery
// ============================================================================

function discoverTypeScriptFiles(rootPath: string): string[] {
  const files: string[] = [];
  const extensions = ['.ts', '.tsx', '.js', '.jsx'];
  const ignoreDirs = ['node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage'];

  function walkDir(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { return; }

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
// Main Benchmark
// ============================================================================

async function main(): Promise<void> {
  const testPath = process.argv[2] || './testdata';
  const absolutePath = path.resolve(testPath);

  console.log('\n' + '═'.repeat(70));
  console.log('  HYBRID ARCHITECTURE BENCHMARK (Standalone)');
  console.log('  SWC (Rust) + TypeScript Type Analyzer');
  console.log('═'.repeat(70));
  console.log(`\nTarget: ${absolutePath}\n`);

  // Discover files
  console.log('Phase 1: File Discovery...');
  const discoveryStart = performance.now();
  const files = discoverTypeScriptFiles(absolutePath);
  const discoveryTime = performance.now() - discoveryStart;
  console.log(`  Found ${files.length} files in ${discoveryTime.toFixed(0)}ms\n`);

  if (files.length === 0) {
    console.log('No TypeScript files found!');
    return;
  }

  // Load file contents
  console.log('Phase 2: Loading files...');
  const loadStart = performance.now();
  const contents = new Map<string, string>();
  for (const file of files) {
    try {
      contents.set(file, fs.readFileSync(file, 'utf-8'));
    } catch { /* skip */ }
  }
  const loadTime = performance.now() - loadStart;
  console.log(`  Loaded ${contents.size} files in ${loadTime.toFixed(0)}ms\n`);

  // Test SWC Parser (Fast Path)
  console.log('─'.repeat(70));
  console.log('Phase 3: SWC Fast Parsing (Rust)');
  console.log('─'.repeat(70));

  const iterations = 3;
  const swcTimes: number[] = [];
  let lastResults: ParsedFile[] = [];

  for (let i = 1; i <= iterations; i++) {
    const start = performance.now();
    lastResults = await parseWithSwc(files, contents);
    const time = performance.now() - start;
    swcTimes.push(time);

    const totalSymbols = lastResults.reduce((a, b) => a + b.symbols.length, 0);
    const totalRelationships = lastResults.reduce((a, b) => a + b.relationships.length, 0);
    const totalImports = lastResults.reduce((a, b) => a + b.imports.length, 0);

    console.log(`  Run ${i}: ${time.toFixed(0)}ms`);
    console.log(`    - Files parsed: ${lastResults.length}`);
    console.log(`    - Symbols: ${totalSymbols}`);
    console.log(`    - Relationships: ${totalRelationships}`);
    console.log(`    - Imports: ${totalImports}`);
  }

  const swcAvg = swcTimes.reduce((a, b) => a + b, 0) / iterations;
  const swcMin = Math.min(...swcTimes);
  console.log(`\n  Average: ${swcAvg.toFixed(0)}ms, Best: ${swcMin.toFixed(0)}ms`);
  console.log(`  Throughput: ${((files.length / swcAvg) * 1000).toFixed(0)} files/sec\n`);

  // Show extracted relationships
  console.log('─'.repeat(70));
  console.log('Sample Extracted Relationships (implements/extends):');
  console.log('─'.repeat(70));
  
  const allRels = lastResults.flatMap(r => r.relationships);
  const implementsRels = allRels.filter(r => r.type === 'implements');
  const extendsRels = allRels.filter(r => r.type === 'extends');

  console.log(`\n  Total implements: ${implementsRels.length}`);
  for (const rel of implementsRels.slice(0, 5)) {
    const relPath = path.relative(absolutePath, rel.filePath);
    console.log(`    ${rel.fromSymbol} implements ${rel.toSymbol} (${relPath})`);
  }

  console.log(`\n  Total extends: ${extendsRels.length}`);
  for (const rel of extendsRels.slice(0, 5)) {
    const relPath = path.relative(absolutePath, rel.filePath);
    console.log(`    ${rel.fromSymbol} extends ${rel.toSymbol} (${relPath})`);
  }

  // Symbol breakdown
  console.log('\n' + '─'.repeat(70));
  console.log('Symbol Breakdown:');
  console.log('─'.repeat(70));

  const allSymbols = lastResults.flatMap(r => r.symbols);
  const symbolCounts = new Map<string, number>();
  for (const sym of allSymbols) {
    symbolCounts.set(sym.kind, (symbolCounts.get(sym.kind) || 0) + 1);
  }

  console.log('');
  for (const [kind, count] of Array.from(symbolCounts.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${kind.padEnd(12)}: ${count}`);
  }

  // Summary
  console.log('\n' + '═'.repeat(70));
  console.log('  SUMMARY');
  console.log('═'.repeat(70));
  console.log('');
  console.log('┌─────────────────────────────────┬─────────────┐');
  console.log('│ Metric                          │ Value       │');
  console.log('├─────────────────────────────────┼─────────────┤');
  console.log(`│ Files analyzed                  │ ${lastResults.length.toString().padStart(8)}    │`);
  console.log(`│ Total symbols                   │ ${allSymbols.length.toString().padStart(8)}    │`);
  console.log(`│ Total relationships             │ ${allRels.length.toString().padStart(8)}    │`);
  console.log(`│ Parse time (avg)                │ ${swcAvg.toFixed(0).padStart(5)}ms     │`);
  console.log(`│ Parse time (best)               │ ${swcMin.toFixed(0).padStart(5)}ms     │`);
  console.log(`│ Files per second                │ ${((files.length / swcMin) * 1000).toFixed(0).padStart(8)}    │`);
  console.log('└─────────────────────────────────┴─────────────┘');
  console.log('');
  console.log('═'.repeat(70));
}

main().catch(console.error);
