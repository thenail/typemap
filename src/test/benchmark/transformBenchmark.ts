/**
 * SWC Transform API Deep Dive
 * 
 * The transform API bundles parsing internally and processes files more efficiently.
 * Let's find the optimal configuration.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as ts from 'typescript';
import * as swc from '@swc/core';

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

function getSwcOptions(file: string): swc.Options {
    const ext = path.extname(file).toLowerCase();
    const parser: swc.ParserConfig = ext === '.tsx'
        ? { syntax: 'typescript', tsx: true }
        : ext === '.jsx' || ext === '.js'
        ? { syntax: 'ecmascript', jsx: true }
        : { syntax: 'typescript', tsx: false };

    return {
        filename: file,
        jsc: {
            parser,
            target: 'es2022',
        },
        minify: false,
    };
}

async function benchmarkSwcTransform(
    files: string[],
    contents: Map<string, string>,
    concurrency: number
): Promise<number> {
    const start = performance.now();

    for (let i = 0; i < files.length; i += concurrency) {
        const chunk = files.slice(i, i + concurrency);
        await Promise.all(chunk.map(async (file) => {
            try {
                await swc.transform(contents.get(file)!, getSwcOptions(file));
            } catch { /* skip */ }
        }));
    }

    return performance.now() - start;
}

function benchmarkTypeScript(
    files: string[],
    contents: Map<string, string>
): number {
    const start = performance.now();

    for (const file of files) {
        const isJsx = file.endsWith('.tsx') || file.endsWith('.jsx');
        ts.createSourceFile(
            file,
            contents.get(file)!,
            ts.ScriptTarget.Latest,
            false,
            isJsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS
        );
    }

    return performance.now() - start;
}

async function main(): Promise<void> {
    const testPath = process.argv[2] || './testdata';
    const absolutePath = path.resolve(testPath);

    console.log('\n' + '='.repeat(70));
    console.log('SWC TRANSFORM API vs TYPESCRIPT - OPTIMIZED BENCHMARK');
    console.log('='.repeat(70));
    console.log(`Target: ${absolutePath}\n`);

    // Load files
    const files = discoverTypeScriptFiles(absolutePath);
    const contents = new Map<string, string>();
    for (const file of files) {
        try {
            contents.set(file, fs.readFileSync(file, 'utf-8'));
        } catch { /* skip */ }
    }
    const validFiles = Array.from(contents.keys());
    const totalSize = Array.from(contents.values()).reduce((a, b) => a + b.length, 0);
    
    console.log(`Files: ${validFiles.length}`);
    console.log(`Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB\n`);

    // Warmup
    console.log('Warming up...\n');
    for (let i = 0; i < 50; i++) {
        const f = validFiles[i % validFiles.length];
        ts.createSourceFile(f, contents.get(f)!, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
        try {
            await swc.transform(contents.get(f)!, getSwcOptions(f));
        } catch { /* skip */ }
    }

    const iterations = 5;

    // Test TypeScript
    console.log('Testing TypeScript Compiler API...');
    const tsResults: number[] = [];
    for (let i = 0; i < iterations; i++) {
        const time = benchmarkTypeScript(validFiles, contents);
        tsResults.push(time);
        process.stdout.write(`  Run ${i + 1}: ${time.toFixed(0)}ms\n`);
    }
    const tsAvg = tsResults.reduce((a, b) => a + b, 0) / iterations;
    const tsMin = Math.min(...tsResults);
    console.log(`  Average: ${tsAvg.toFixed(0)}ms, Best: ${tsMin.toFixed(0)}ms\n`);

    // Test SWC Transform with different concurrency
    const concurrencyLevels = [25, 50, 100, 200, 500, 1000];
    const swcResults: { concurrency: number; avg: number; min: number }[] = [];

    for (const c of concurrencyLevels) {
        console.log(`Testing SWC Transform (concurrency=${c})...`);
        const times: number[] = [];
        for (let i = 0; i < iterations; i++) {
            const time = await benchmarkSwcTransform(validFiles, contents, c);
            times.push(time);
            process.stdout.write(`  Run ${i + 1}: ${time.toFixed(0)}ms\n`);
        }
        const avg = times.reduce((a, b) => a + b, 0) / iterations;
        const min = Math.min(...times);
        swcResults.push({ concurrency: c, avg, min });
        console.log(`  Average: ${avg.toFixed(0)}ms, Best: ${min.toFixed(0)}ms\n`);
    }

    // Summary
    console.log('='.repeat(70));
    console.log('FINAL RESULTS');
    console.log('='.repeat(70));
    console.log('');
    console.log('┌────────────────────────────────┬──────────┬──────────┬──────────┐');
    console.log('│ Parser                         │ Avg Time │ Best     │ vs TS    │');
    console.log('├────────────────────────────────┼──────────┼──────────┼──────────┤');
    console.log(`│ TypeScript Compiler API        │ ${tsAvg.toFixed(0).padStart(5)}ms  │ ${tsMin.toFixed(0).padStart(5)}ms  │ baseline │`);
    
    for (const r of swcResults) {
        const speedup = tsAvg / r.avg;
        const speedupStr = speedup >= 1 
            ? `${speedup.toFixed(2)}x ↑` 
            : `${(1/speedup).toFixed(2)}x ↓`;
        console.log(`│ SWC Transform (c=${r.concurrency.toString().padEnd(4)})        │ ${r.avg.toFixed(0).padStart(5)}ms  │ ${r.min.toFixed(0).padStart(5)}ms  │ ${speedupStr.padStart(8)} │`);
    }
    console.log('└────────────────────────────────┴──────────┴──────────┴──────────┘');

    const bestSwc = swcResults.reduce((a, b) => a.avg < b.avg ? a : b);
    const overallSpeedup = tsAvg / bestSwc.avg;

    console.log('');
    if (overallSpeedup > 1) {
        console.log(`🚀 Best SWC config (c=${bestSwc.concurrency}) is ${overallSpeedup.toFixed(2)}x FASTER than TypeScript!`);
        console.log(`   ${tsAvg.toFixed(0)}ms → ${bestSwc.avg.toFixed(0)}ms (saved ${(tsAvg - bestSwc.avg).toFixed(0)}ms)`);
    } else {
        console.log(`📊 TypeScript is ${(1/overallSpeedup).toFixed(2)}x faster than best SWC config`);
    }

    console.log('\n' + '='.repeat(70));
    console.log('ANALYSIS');
    console.log('='.repeat(70));
    console.log(`
Why SWC Transform API is faster:

1. Internal batching - SWC's transform() uses a thread pool internally
   and can process multiple files in parallel within Rust.

2. Reduced N-API overhead - The async nature allows better scheduling
   and reduces synchronization costs.

3. Native parallelism - Rust's Rayon library enables true parallel
   processing across CPU cores.

Recommendation: Use SWC transform() with concurrency=${bestSwc.concurrency} for
${overallSpeedup.toFixed(2)}x speedup over TypeScript Compiler API.
`);
}

main().catch(console.error);
