/**
 * Performance Benchmark for TypeMap Analysis
 * 
 * Run with: npx ts-node src/test/benchmark/runBenchmark.ts
 * Or: npm run benchmark
 */

import * as path from 'path';
import { FileDiscovery } from '../../analysis/fileDiscovery';
import { LightweightParser } from '../../analysis/lightweightParser';
import { TypeAnalyzer } from '../../analysis/typeAnalyzer';
import { GraphBuilder } from '../../graph/graphBuilder';
import { CacheManager } from '../../cache/cacheManager';
import { Profiler } from '../../utils/profiler';

// Mock VS Code extension context for standalone testing
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

interface BenchmarkResult {
  name: string;
  duration: number;
  filesAnalyzed?: number;
  symbolsFound?: number;
  nodesCreated?: number;
  cacheHits?: number;
  cacheMisses?: number;
}

async function runBenchmark(testDataPath: string): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];
  const profiler = new Profiler();

  console.log('\n' + '='.repeat(60));
  console.log('TypeMap Performance Benchmark');
  console.log('='.repeat(60));
  console.log(`Test data path: ${testDataPath}`);
  console.log('');

  // Phase 1: File Discovery
  console.log('Phase 1: File Discovery...');
  profiler.start('fileDiscovery');

  const discovery = new FileDiscovery({
    rootPath: testDataPath,
    include: ['**/*.ts', '**/*.tsx'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/*.d.ts',
      '**/*.spec.ts',
      '**/*.test.ts',
    ],
    maxDepth: 50,
    maxFiles: 50000,
    useGitignore: true,
  });

  const discoveryResult = await discovery.discover();
  const discoveryTime = profiler.end('fileDiscovery');

  results.push({
    name: 'File Discovery',
    duration: discoveryTime,
    filesAnalyzed: discoveryResult.files.length,
  });

  console.log(`  Found ${discoveryResult.files.length} files in ${discoveryTime.toFixed(2)}ms`);

  if (discoveryResult.files.length === 0) {
    console.log('\n⚠️  No TypeScript files found in test data path.');
    console.log('   Make sure to add some .ts/.tsx files to:', testDataPath);
    return results;
  }

  // Phase 2: Lightweight Parsing (Cold Cache)
  console.log('\nPhase 2: Lightweight Parsing (Cold Cache)...');
  const cacheManager = new CacheManager(mockContext, 100);
  await cacheManager.clear();

  const parser = new LightweightParser(cacheManager);
  profiler.start('parsingCold');

  const symbols = await parser.parseFiles(discoveryResult.files);
  const parsingColdTime = profiler.end('parsingCold');
  const coldStats = parser.getCacheStats();

  results.push({
    name: 'Parsing (Cold Cache)',
    duration: parsingColdTime,
    filesAnalyzed: discoveryResult.files.length,
    symbolsFound: symbols.length,
    cacheHits: coldStats.hits,
    cacheMisses: coldStats.misses,
  });

  console.log(`  Parsed ${symbols.length} symbols in ${parsingColdTime.toFixed(2)}ms`);
  console.log(`  Cache: ${coldStats.hits} hits, ${coldStats.misses} misses`);

  // Phase 3: Lightweight Parsing (Warm Cache)
  console.log('\nPhase 3: Lightweight Parsing (Warm Cache)...');
  const parser2 = new LightweightParser(cacheManager);
  profiler.start('parsingWarm');

  const symbols2 = await parser2.parseFiles(discoveryResult.files);
  const parsingWarmTime = profiler.end('parsingWarm');
  const warmStats = parser2.getCacheStats();

  results.push({
    name: 'Parsing (Warm Cache)',
    duration: parsingWarmTime,
    filesAnalyzed: discoveryResult.files.length,
    symbolsFound: symbols2.length,
    cacheHits: warmStats.hits,
    cacheMisses: warmStats.misses,
  });

  console.log(`  Parsed ${symbols2.length} symbols in ${parsingWarmTime.toFixed(2)}ms`);
  console.log(`  Cache: ${warmStats.hits} hits, ${warmStats.misses} misses`);

  // Phase 4: Graph Building
  console.log('\nPhase 4: Graph Building...');
  profiler.start('graphBuilding');

  const graphBuilder = new GraphBuilder(testDataPath);
  const graph = graphBuilder.build(symbols, discoveryResult.files);
  const graphBuildTime = profiler.end('graphBuilding');

  results.push({
    name: 'Graph Building',
    duration: graphBuildTime,
    nodesCreated: graph.nodes.size,
  });

  console.log(`  Created ${graph.nodes.size} nodes, ${graph.edges.length} edges in ${graphBuildTime.toFixed(2)}ms`);

  // Phase 5: Full Pipeline
  console.log('\nPhase 5: Full Pipeline (Discovery → Parse → Graph)...');
  await cacheManager.clear();
  const parser3 = new LightweightParser(cacheManager);

  profiler.start('fullPipeline');
  const files = (await discovery.discover()).files;
  const syms = await parser3.parseFiles(files);
  const g = graphBuilder.build(syms, files);
  const fullPipelineTime = profiler.end('fullPipeline');

  results.push({
    name: 'Full Pipeline',
    duration: fullPipelineTime,
    filesAnalyzed: files.length,
    symbolsFound: syms.length,
    nodesCreated: g.nodes.size,
  });

  console.log(`  Complete analysis in ${fullPipelineTime.toFixed(2)}ms`);

  // Phase 6: TypeAnalyzer Initialization
  console.log('\nPhase 6: TypeAnalyzer Initialization...');
  profiler.start('typeAnalyzerInit');
  
  const typeAnalyzer = new TypeAnalyzer();
  await typeAnalyzer.initialize(testDataPath, discoveryResult.files);
  const typeAnalyzerInitTime = profiler.end('typeAnalyzerInit');

  results.push({
    name: 'TypeAnalyzer Init',
    duration: typeAnalyzerInitTime,
    filesAnalyzed: discoveryResult.files.length,
  });

  console.log(`  Initialized TypeAnalyzer in ${typeAnalyzerInitTime.toFixed(2)}ms`);

  // Phase 7: Find Implementations (if we have interfaces)
  // Find some interfaces in the parsed symbols to test with
  const interfaces = symbols.filter(s => s.kind === 'interface');
  const classes = symbols.filter(s => s.kind === 'class');
  
  if (interfaces.length > 0) {
    console.log(`\nPhase 7: Find Implementations (testing ${Math.min(5, interfaces.length)} interfaces)...`);
    
    // Test up to 5 interfaces
    const testInterfaces = interfaces.slice(0, 5);
    let totalImplementations = 0;
    
    profiler.start('findImplementations');
    
    for (const iface of testInterfaces) {
      try {
        const implementations = await typeAnalyzer.findImplementations(iface.name, iface.filePath);
        totalImplementations += implementations.length;
        console.log(`    ${iface.name}: ${implementations.length} implementations`);
      } catch (e) {
        console.log(`    ${iface.name}: error - ${e}`);
      }
    }
    
    const findImplTime = profiler.end('findImplementations');
    
    results.push({
      name: 'Find Implementations',
      duration: findImplTime,
      symbolsFound: totalImplementations,
    });
    
    console.log(`  Found ${totalImplementations} total implementations in ${findImplTime.toFixed(2)}ms`);
    console.log(`  Avg time per interface: ${(findImplTime / testInterfaces.length).toFixed(2)}ms`);
  } else {
    console.log('\nPhase 7: Find Implementations (skipped - no interfaces found)');
  }

  // Phase 8: Type Hierarchy Analysis (if we have classes)
  if (classes.length > 0) {
    console.log(`\nPhase 8: Type Hierarchy Analysis (testing ${Math.min(5, classes.length)} classes)...`);
    
    const testClasses = classes.slice(0, 5);
    
    profiler.start('typeHierarchy');
    
    for (const cls of testClasses) {
      try {
        const hierarchy = await typeAnalyzer.getTypeHierarchy(cls.name, cls.filePath);
        const implCount = hierarchy?.implementedBy?.length || 0;
        const extCount = hierarchy?.extendedBy?.length || 0;
        console.log(`    ${cls.name}: ${implCount} implementers, ${extCount} extenders`);
      } catch (e) {
        console.log(`    ${cls.name}: error - ${e}`);
      }
    }
    
    const hierarchyTime = profiler.end('typeHierarchy');
    
    results.push({
      name: 'Type Hierarchy',
      duration: hierarchyTime,
    });
    
    console.log(`  Type hierarchy analysis in ${hierarchyTime.toFixed(2)}ms`);
    console.log(`  Avg time per class: ${(hierarchyTime / testClasses.length).toFixed(2)}ms`);
  } else {
    console.log('\nPhase 8: Type Hierarchy Analysis (skipped - no classes found)');
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('Summary');
  console.log('='.repeat(60));
  
  const totalTime = results.reduce((sum, r) => sum + r.duration, 0);
  console.log(`Total benchmark time: ${totalTime.toFixed(2)}ms`);
  console.log(`Files analyzed: ${discoveryResult.files.length}`);
  console.log(`Symbols found: ${symbols.length}`);
  console.log(`Graph nodes: ${graph.nodes.size}`);
  console.log(`Graph edges: ${graph.edges.length}`);

  // Performance metrics
  console.log('\nPerformance Metrics:');
  console.log(`  Files/sec (cold): ${((discoveryResult.files.length / parsingColdTime) * 1000).toFixed(0)}`);
  console.log(`  Files/sec (warm): ${((discoveryResult.files.length / parsingWarmTime) * 1000).toFixed(0)}`);
  console.log(`  Symbols/sec: ${((symbols.length / parsingColdTime) * 1000).toFixed(0)}`);
  console.log(`  Cache speedup: ${(parsingColdTime / parsingWarmTime).toFixed(2)}x`);
  console.log(`  TypeAnalyzer init: ${typeAnalyzerInitTime.toFixed(2)}ms`);

  // Symbol breakdown
  console.log('\nSymbol Breakdown:');
  const symbolCounts: Record<string, number> = {};
  for (const sym of symbols) {
    symbolCounts[sym.kind] = (symbolCounts[sym.kind] || 0) + 1;
  }
  for (const [kind, count] of Object.entries(symbolCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${kind}: ${count}`);
  }

  // Node type breakdown
  console.log('\nNode Type Breakdown:');
  for (const [type, count] of Object.entries(graph.statistics.byType).sort((a, b) => b[1] - a[1])) {
    if (count > 0) {
      console.log(`  ${type}: ${count}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  
  return results;
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
