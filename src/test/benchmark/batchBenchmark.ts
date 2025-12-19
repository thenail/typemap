/**
 * Batch Processing Approaches Benchmark
 * 
 * Tests different strategies to reduce N-API overhead:
 * 1. Sequential parseSync (baseline)
 * 2. Parallel parseAsync with Promise.all
 * 3. Worker threads with batched work
 * 4. Custom Rust N-API extension (concept)
 */

import * as path from 'path';
import * as fs from 'fs';
import * as swc from '@swc/core';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

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

function getSyntax(filePath: string): swc.ParserConfig {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.tsx') {
        return { syntax: 'typescript', tsx: true };
    } else if (ext === '.jsx' || ext === '.js') {
        return { syntax: 'ecmascript', jsx: true };
    } else {
        return { syntax: 'typescript', tsx: false };
    }
}

// ============================================================================
// Approach 1: Sequential parseSync (baseline)
// ============================================================================

async function benchmarkSequentialSync(
    files: string[],
    contents: Map<string, string>
): Promise<{ time: number; parsed: number }> {
    const start = performance.now();
    let parsed = 0;

    for (const file of files) {
        try {
            swc.parseSync(contents.get(file)!, {
                ...getSyntax(file),
                target: 'es2022',
                comments: false,
            });
            parsed++;
        } catch { /* skip */ }
    }

    return { time: performance.now() - start, parsed };
}

// ============================================================================
// Approach 2: Parallel parseAsync with Promise.all
// ============================================================================

async function benchmarkParallelAsync(
    files: string[],
    contents: Map<string, string>,
    concurrency: number = 50
): Promise<{ time: number; parsed: number }> {
    const start = performance.now();
    let parsed = 0;

    // Process in chunks to avoid overwhelming the system
    for (let i = 0; i < files.length; i += concurrency) {
        const chunk = files.slice(i, i + concurrency);
        const promises = chunk.map(async (file) => {
            try {
                await swc.parse(contents.get(file)!, {
                    ...getSyntax(file),
                    target: 'es2022',
                    comments: false,
                });
                return true;
            } catch {
                return false;
            }
        });

        const results = await Promise.all(promises);
        parsed += results.filter(Boolean).length;
    }

    return { time: performance.now() - start, parsed };
}

// ============================================================================
// Approach 3: Worker Threads
// ============================================================================

interface WorkerTask {
    files: string[];
    contents: { [key: string]: string };
}

interface WorkerResult {
    parsed: number;
    time: number;
}

// Worker code (runs in separate thread)
if (!isMainThread && parentPort) {
    const { files, contents } = workerData as WorkerTask;
    const start = performance.now();
    let parsed = 0;

    for (const file of files) {
        try {
            const ext = path.extname(file).toLowerCase();
            let syntax: swc.ParserConfig;
            if (ext === '.tsx') {
                syntax = { syntax: 'typescript', tsx: true };
            } else if (ext === '.jsx' || ext === '.js') {
                syntax = { syntax: 'ecmascript', jsx: true };
            } else {
                syntax = { syntax: 'typescript', tsx: false };
            }

            swc.parseSync(contents[file], {
                ...syntax,
                target: 'es2022',
                comments: false,
            });
            parsed++;
        } catch { /* skip */ }
    }

    parentPort.postMessage({ parsed, time: performance.now() - start } as WorkerResult);
}

async function benchmarkWorkerThreads(
    files: string[],
    contents: Map<string, string>,
    numWorkers: number = 4
): Promise<{ time: number; parsed: number }> {
    const start = performance.now();

    // Split files among workers
    const chunkSize = Math.ceil(files.length / numWorkers);
    const chunks: string[][] = [];
    for (let i = 0; i < files.length; i += chunkSize) {
        chunks.push(files.slice(i, i + chunkSize));
    }

    // Convert contents to plain object for worker transfer
    const contentsObj: { [key: string]: string } = {};
    for (const [k, v] of contents) {
        contentsObj[k] = v;
    }

    // Spawn workers
    const workerPromises = chunks.map((chunk) => {
        return new Promise<WorkerResult>((resolve, reject) => {
            const worker = new Worker(__filename, {
                workerData: { files: chunk, contents: contentsObj } as WorkerTask,
            });
            worker.on('message', resolve);
            worker.on('error', reject);
            worker.on('exit', (code) => {
                if (code !== 0) {
                    reject(new Error(`Worker exited with code ${code}`));
                }
            });
        });
    });

    const results = await Promise.all(workerPromises);
    const totalParsed = results.reduce((a, b) => a + b.parsed, 0);

    return { time: performance.now() - start, parsed: totalParsed };
}

// ============================================================================
// Approach 4: Transform API (bundles parse + transform, might be more efficient)
// ============================================================================

async function benchmarkTransformAsync(
    files: string[],
    contents: Map<string, string>,
    concurrency: number = 50
): Promise<{ time: number; parsed: number }> {
    const start = performance.now();
    let parsed = 0;

    for (let i = 0; i < files.length; i += concurrency) {
        const chunk = files.slice(i, i + concurrency);
        const promises = chunk.map(async (file) => {
            try {
                const ext = path.extname(file).toLowerCase();
                await swc.transform(contents.get(file)!, {
                    filename: file,
                    jsc: {
                        parser: ext === '.tsx' 
                            ? { syntax: 'typescript', tsx: true }
                            : ext === '.jsx' || ext === '.js'
                            ? { syntax: 'ecmascript', jsx: true }
                            : { syntax: 'typescript', tsx: false },
                        target: 'es2022',
                    },
                    minify: false,
                });
                return true;
            } catch {
                return false;
            }
        });

        const results = await Promise.all(promises);
        parsed += results.filter(Boolean).length;
    }

    return { time: performance.now() - start, parsed };
}

// ============================================================================
// Main Benchmark
// ============================================================================

async function main(): Promise<void> {
    if (!isMainThread) return; // Skip if running as worker

    const testPath = process.argv[2] || './testdata';
    const absolutePath = path.resolve(testPath);

    console.log('\n' + '='.repeat(70));
    console.log('BATCH PROCESSING APPROACHES BENCHMARK');
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
    console.log(`Loaded ${validFiles.length} files\n`);

    // Warmup
    console.log('Warming up SWC...');
    for (let i = 0; i < 100; i++) {
        const f = validFiles[i % validFiles.length];
        try {
            swc.parseSync(contents.get(f)!, { syntax: 'typescript', tsx: false });
        } catch { /* skip */ }
    }
    console.log('');

    const results: { name: string; time: number; parsed: number }[] = [];

    // Test 1: Sequential Sync
    console.log('Testing: Sequential parseSync...');
    const seq = await benchmarkSequentialSync(validFiles, contents);
    results.push({ name: 'Sequential parseSync', ...seq });
    console.log(`  ${seq.time.toFixed(0)}ms (${seq.parsed} files)\n`);

    // Test 2: Parallel Async (different concurrency levels)
    for (const concurrency of [10, 50, 100, 200]) {
        console.log(`Testing: Parallel parseAsync (concurrency=${concurrency})...`);
        const par = await benchmarkParallelAsync(validFiles, contents, concurrency);
        results.push({ name: `Parallel parseAsync (c=${concurrency})`, ...par });
        console.log(`  ${par.time.toFixed(0)}ms (${par.parsed} files)\n`);
    }

    // Test 3: Worker Threads
    for (const numWorkers of [2, 4, 8]) {
        console.log(`Testing: Worker threads (${numWorkers} workers)...`);
        try {
            const wt = await benchmarkWorkerThreads(validFiles, contents, numWorkers);
            results.push({ name: `Worker threads (${numWorkers}w)`, ...wt });
            console.log(`  ${wt.time.toFixed(0)}ms (${wt.parsed} files)\n`);
        } catch (err) {
            console.log(`  Failed: ${err}\n`);
        }
    }

    // Test 4: Transform API
    console.log('Testing: Transform API (async, c=50)...');
    const trans = await benchmarkTransformAsync(validFiles, contents, 50);
    results.push({ name: 'Transform API (c=50)', ...trans });
    console.log(`  ${trans.time.toFixed(0)}ms (${trans.parsed} files)\n`);

    // Summary
    console.log('='.repeat(70));
    console.log('RESULTS SUMMARY');
    console.log('='.repeat(70));
    console.log('');

    const baseline = results[0].time;
    console.log('┌────────────────────────────────────┬──────────┬──────────┐');
    console.log('│ Approach                           │ Time     │ vs Base  │');
    console.log('├────────────────────────────────────┼──────────┼──────────┤');
    for (const r of results) {
        const ratio = baseline / r.time;
        const ratioStr = ratio >= 1 ? `${ratio.toFixed(2)}x ↑` : `${(1/ratio).toFixed(2)}x ↓`;
        console.log(`│ ${r.name.padEnd(34)} │ ${r.time.toFixed(0).padStart(5)}ms  │ ${ratioStr.padStart(8)} │`);
    }
    console.log('└────────────────────────────────────┴──────────┴──────────┘');

    const best = results.reduce((a, b) => a.time < b.time ? a : b);
    console.log(`\n🏆 Best: ${best.name} at ${best.time.toFixed(0)}ms`);

    // Compare with TypeScript baseline
    console.log('\n' + '='.repeat(70));
    console.log('Comparison with TypeScript Compiler API (~300ms for this dataset)');
    console.log('='.repeat(70));
    const tsBaseline = 300; // approximate from earlier tests
    if (best.time < tsBaseline) {
        console.log(`✅ SWC batch approach is ${(tsBaseline / best.time).toFixed(2)}x faster than TypeScript`);
    } else {
        console.log(`❌ TypeScript is still ${(best.time / tsBaseline).toFixed(2)}x faster than best SWC approach`);
    }
}

main().catch(console.error);
