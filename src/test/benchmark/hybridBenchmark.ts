/**
 * Hybrid Architecture Benchmark
 * 
 * Tests the new hybrid approach:
 * - SwcParser for fast initial analysis
 * - TypeAnalyzer for deep type queries
 */

import * as path from 'path';
import * as fs from 'fs';
import { SwcParser } from '../../analysis/swcParser';
import { TypeAnalyzer } from '../../analysis/typeAnalyzer';
import { CacheManager } from '../../cache/cacheManager';

// Mock VS Code extension context
const mockContext = {
  workspaceState: {
    get: () => undefined,
    update: async () => {},
    keys: () => [],
  },
  globalState: {
    get: () => undefined,
    update: async () => {},
    keys: () => [],
    setKeysForSync: () => {},
  },
  subscriptions: [],
  extensionPath: __dirname,
  extensionUri: { fsPath: __dirname } as any,
  storagePath: undefined,
  globalStoragePath: __dirname,
  logPath: __dirname,
  extensionMode: 1,
  extension: {} as any,
  environmentVariableCollection: {} as any,
  secrets: {} as any,
  storageUri: undefined,
  globalStorageUri: { fsPath: __dirname } as any,
  logUri: { fsPath: __dirname } as any,
  asAbsolutePath: (p: string) => path.join(__dirname, p),
  languageModelAccessInformation: {} as any,
} as any;

// File discovery helper
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

async function main(): Promise<void> {
  const testPath = process.argv[2] || './testdata';
  const absolutePath = path.resolve(testPath);

  console.log('\n' + '═'.repeat(70));
  console.log('  HYBRID ARCHITECTURE BENCHMARK');
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

  // Initialize cache manager
  const cacheManager = new CacheManager(mockContext);

  // Test SWC Parser (Fast Path)
  console.log('─'.repeat(70));
  console.log('Phase 2: SWC Fast Parsing (Rust)');
  console.log('─'.repeat(70));

  const swcParser = new SwcParser(cacheManager);
  
  const iterations = 3;
  const swcTimes: number[] = [];

  for (let i = 1; i <= iterations; i++) {
    const start = performance.now();
    const results = await swcParser.parseFiles(files);
    const time = performance.now() - start;
    swcTimes.push(time);

    const totalSymbols = results.reduce((a, b) => a + b.symbols.length, 0);
    const totalRelationships = results.reduce((a, b) => a + b.relationships.length, 0);
    const totalImports = results.reduce((a, b) => a + b.imports.length, 0);

    console.log(`  Run ${i}: ${time.toFixed(0)}ms`);
    console.log(`    - Symbols: ${totalSymbols}`);
    console.log(`    - Relationships: ${totalRelationships}`);
    console.log(`    - Imports: ${totalImports}`);
  }

  const swcAvg = swcTimes.reduce((a, b) => a + b, 0) / iterations;
  console.log(`\n  Average: ${swcAvg.toFixed(0)}ms`);
  console.log(`  Throughput: ${((files.length / swcAvg) * 1000).toFixed(0)} files/sec\n`);

  // Test Type Analyzer (Deep Path) - on a subset
  console.log('─'.repeat(70));
  console.log('Phase 3: TypeScript Type Analyzer (Deep Queries)');
  console.log('─'.repeat(70));

  const typeAnalyzer = new TypeAnalyzer();
  
  console.log('  Initializing TypeScript Language Service...');
  const initStart = performance.now();
  await typeAnalyzer.initialize(absolutePath, files);
  const initTime = performance.now() - initStart;
  console.log(`  Initialized in ${initTime.toFixed(0)}ms\n`);

  // Find a sample interface to test
  const swcResults = await swcParser.parseFiles(files);
  const sampleInterface = swcResults
    .flatMap(r => r.symbols)
    .find(s => s.kind === 'interface');

  if (sampleInterface) {
    console.log(`  Testing "Find Implementations" for: ${sampleInterface.name}`);
    console.log(`  File: ${path.relative(absolutePath, sampleInterface.filePath)}\n`);

    const implStart = performance.now();
    const implementations = await typeAnalyzer.findImplementations(
      sampleInterface.name,
      sampleInterface.filePath
    );
    const implTime = performance.now() - implStart;

    console.log(`  Found ${implementations.length} implementations in ${implTime.toFixed(0)}ms`);
    
    for (const impl of implementations.slice(0, 5)) {
      const relPath = path.relative(absolutePath, impl.symbol.filePath);
      console.log(`    - ${impl.symbol.name} (${impl.isExplicit ? 'explicit' : 'structural'}) in ${relPath}`);
    }
    if (implementations.length > 5) {
      console.log(`    ... and ${implementations.length - 5} more`);
    }
  } else {
    console.log('  No interfaces found to test');
  }

  typeAnalyzer.dispose();

  // Summary
  console.log('\n' + '═'.repeat(70));
  console.log('  SUMMARY');
  console.log('═'.repeat(70));
  console.log('');
  console.log('┌─────────────────────────────────┬─────────────┬─────────────────────┐');
  console.log('│ Operation                       │ Time        │ Use Case            │');
  console.log('├─────────────────────────────────┼─────────────┼─────────────────────┤');
  console.log(`│ File Discovery                  │ ${discoveryTime.toFixed(0).padStart(6)}ms    │ Initial scan        │`);
  console.log(`│ SWC Parse (${files.length} files)`.padEnd(34) + `│ ${swcAvg.toFixed(0).padStart(6)}ms    │ Mindmap generation  │`);
  console.log(`│ TS Init (Language Service)      │ ${initTime.toFixed(0).padStart(6)}ms    │ One-time setup      │`);
  console.log(`│ Find Implementations            │ ${sampleInterface ? 'varies' : 'N/A'.padStart(6)}     │ On-demand query     │`);
  console.log('└─────────────────────────────────┴─────────────┴─────────────────────┘');
  console.log('');
  console.log('Hybrid Architecture Benefits:');
  console.log('  ✓ Fast initial load: SWC parses all files quickly');
  console.log('  ✓ Rich type info: TypeScript provides deep analysis on-demand');
  console.log('  ✓ Lazy loading: Type analyzer only initialized when needed');
  console.log('');
  console.log('═'.repeat(70));
}

main().catch(console.error);
