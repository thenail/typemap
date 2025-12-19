/**
 * Optimized SWC Benchmark - Tests raw parsing speed
 * 
 * This test focuses on raw AST generation time, excluding symbol extraction
 * to measure the true parsing speed difference.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as ts from 'typescript';
import * as swc from '@swc/core';

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
// Raw Parsing Tests (AST generation only)
// ============================================================================

function parseWithTypeScriptRaw(filePath: string, content: string): void {
    const isJsx = filePath.endsWith('.tsx') || filePath.endsWith('.jsx');
    ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        false, // No parent pointers - faster
        isJsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
}

function parseWithSWCRaw(filePath: string, content: string): void {
    const ext = path.extname(filePath).toLowerCase();
    
    let syntax: swc.ParserConfig;
    if (ext === '.tsx') {
        syntax = { syntax: 'typescript', tsx: true };
    } else if (ext === '.jsx') {
        syntax = { syntax: 'ecmascript', jsx: true };
    } else if (ext === '.js') {
        // Try JSX first for .js files since they might contain JSX
        syntax = { syntax: 'ecmascript', jsx: true };
    } else {
        syntax = { syntax: 'typescript', tsx: false };
    }

    swc.parseSync(content, {
        ...syntax,
        target: 'es2022',
        comments: false,
    });
}

// ============================================================================
// Benchmark
// ============================================================================

async function main(): Promise<void> {
    const testPath = process.argv[2] || './testdata';
    const absolutePath = path.resolve(testPath);

    console.log('\n' + '='.repeat(70));
    console.log('RAW PARSING SPEED COMPARISON');
    console.log('(AST generation only, no symbol extraction)');
    console.log('='.repeat(70));
    console.log(`Target: ${absolutePath}\n`);

    // Discover and load files
    const files = discoverTypeScriptFiles(absolutePath);
    console.log(`Found ${files.length} files\n`);

    const fileContents = new Map<string, string>();
    for (const file of files) {
        try {
            fileContents.set(file, fs.readFileSync(file, 'utf-8'));
        } catch { /* skip */ }
    }

    const validFiles = Array.from(fileContents.keys());
    const totalBytes = Array.from(fileContents.values()).reduce((a, b) => a + b.length, 0);
    console.log(`Total source size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB\n`);

    // Warmup
    console.log('Warming up...');
    const warmupFile = validFiles[0];
    const warmupContent = fileContents.get(warmupFile)!;
    for (let i = 0; i < 50; i++) {
        parseWithTypeScriptRaw(warmupFile, warmupContent);
        parseWithSWCRaw(warmupFile, warmupContent);
    }

    // Run multiple iterations
    const iterations = 5;
    const tsResults: number[] = [];
    const swcResults: number[] = [];

    console.log(`\nRunning ${iterations} iterations...\n`);

    for (let i = 1; i <= iterations; i++) {
        // TypeScript
        const tsStart = performance.now();
        for (const file of validFiles) {
            parseWithTypeScriptRaw(file, fileContents.get(file)!);
        }
        const tsTime = performance.now() - tsStart;
        tsResults.push(tsTime);

        // SWC
        const swcStart = performance.now();
        for (const file of validFiles) {
            parseWithSWCRaw(file, fileContents.get(file)!);
        }
        const swcTime = performance.now() - swcStart;
        swcResults.push(swcTime);

        console.log(`  Run ${i}: TS=${tsTime.toFixed(0)}ms, SWC=${swcTime.toFixed(0)}ms`);
    }

    // Calculate statistics
    const tsAvg = tsResults.reduce((a, b) => a + b, 0) / iterations;
    const swcAvg = swcResults.reduce((a, b) => a + b, 0) / iterations;
    const tsMin = Math.min(...tsResults);
    const swcMin = Math.min(...swcResults);

    const speedupAvg = tsAvg / swcAvg;
    const speedupBest = tsMin / swcMin;

    console.log('\n' + '='.repeat(70));
    console.log('RESULTS');
    console.log('='.repeat(70));
    console.log('');
    console.log('┌──────────────────┬───────────────┬───────────────┐');
    console.log('│                  │ TypeScript    │ SWC           │');
    console.log('├──────────────────┼───────────────┼───────────────┤');
    console.log(`│ Average          │ ${tsAvg.toFixed(0).padStart(8)}ms   │ ${swcAvg.toFixed(0).padStart(8)}ms   │`);
    console.log(`│ Best             │ ${tsMin.toFixed(0).padStart(8)}ms   │ ${swcMin.toFixed(0).padStart(8)}ms   │`);
    console.log(`│ Per File (avg)   │ ${(tsAvg / validFiles.length).toFixed(3).padStart(8)}ms   │ ${(swcAvg / validFiles.length).toFixed(3).padStart(8)}ms   │`);
    console.log(`│ Files/sec (avg)  │ ${((validFiles.length / tsAvg) * 1000).toFixed(0).padStart(8)}      │ ${((validFiles.length / swcAvg) * 1000).toFixed(0).padStart(8)}      │`);
    console.log(`│ MB/sec (avg)     │ ${((totalBytes / 1024 / 1024) / (tsAvg / 1000)).toFixed(1).padStart(8)}      │ ${((totalBytes / 1024 / 1024) / (swcAvg / 1000)).toFixed(1).padStart(8)}      │`);
    console.log('└──────────────────┴───────────────┴───────────────┘');
    console.log('');

    if (speedupAvg > 1) {
        console.log(`🚀 SWC is ${speedupAvg.toFixed(2)}x faster (average)`);
        console.log(`🚀 SWC is ${speedupBest.toFixed(2)}x faster (best run)`);
    } else {
        console.log(`📊 TypeScript is ${(1/speedupAvg).toFixed(2)}x faster (average)`);
        console.log(`📊 TypeScript is ${(1/speedupBest).toFixed(2)}x faster (best run)`);
    }

    console.log('\n' + '='.repeat(70));
    console.log('NOTE: SWC uses native Rust binaries through Node.js N-API bindings,');
    console.log('not WebAssembly in this test. True WASM would be ~2-3x slower than');
    console.log('native, but still usable in browser environments.');
    console.log('='.repeat(70));
}

main().catch(console.error);
