/**
 * Benchmark for our IncrementalParser vs full re-parse
 * 
 * Run with: npx ts-node src/test/benchmark/incrementalParserBenchmark.ts
 */

import { IncrementalParser, createEditInfo } from '../../analysis/incrementalParser';

// ============================================================================
// Test File Generation
// ============================================================================

function generateTestFile(numFunctions: number): string {
  const lines: string[] = [
    '/**',
    ' * Auto-generated test file',
    ' */',
    '',
    'import { Something } from "./something";',
    '',
  ];

  for (let i = 0; i < numFunctions; i++) {
    lines.push(`export interface Interface${i} {`);
    lines.push(`  property${i}: string;`);
    lines.push(`  method${i}(): void;`);
    lines.push(`}`);
    lines.push('');
    lines.push(`export class Class${i} implements Interface${i} {`);
    lines.push(`  property${i} = "value${i}";`);
    lines.push('');
    lines.push(`  method${i}(): void {`);
    lines.push(`    console.log("Method ${i}");`);
    lines.push(`  }`);
    lines.push('');
    lines.push(`  helperMethod${i}(): number {`);
    lines.push(`    return ${i};`);
    lines.push(`  }`);
    lines.push(`}`);
    lines.push('');
    lines.push(`export function function${i}(arg: Interface${i}): string {`);
    lines.push(`  arg.method${i}();`);
    lines.push(`  return arg.property${i};`);
    lines.push(`}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================================
// Edit Scenarios
// ============================================================================

interface EditScenario {
  name: string;
  apply: (content: string) => { newContent: string; editInfo: ReturnType<typeof createEditInfo> };
}

function findLineWithText(content: string, text: string): number {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(text)) {
      return i + 1; // 1-indexed
    }
  }
  return Math.floor(lines.length / 2);
}

const scenarios: EditScenario[] = [
  {
    name: 'Add comment inside function body',
    apply: (content) => {
      const lines = content.split('\n');
      // Find a line inside a method body
      const targetLine = findLineWithText(content, 'console.log("Method 0")');
      lines.splice(targetLine, 0, '    // This is a new comment');
      return {
        newContent: lines.join('\n'),
        editInfo: createEditInfo(lines.length - 1, lines.length, targetLine, targetLine)
      };
    }
  },
  {
    name: 'Modify code inside function body',
    apply: (content) => {
      const lines = content.split('\n');
      const targetLine = findLineWithText(content, 'console.log("Method 0")');
      lines[targetLine - 1] = '    console.log("Modified output");';
      return {
        newContent: lines.join('\n'),
        editInfo: createEditInfo(lines.length, lines.length, targetLine, targetLine)
      };
    }
  },
  {
    name: 'Add blank lines between symbols',
    apply: (content) => {
      const lines = content.split('\n');
      // Find a line between two declarations
      const targetLine = findLineWithText(content, 'export interface Interface1');
      lines.splice(targetLine - 1, 0, '', '// Separator comment', '');
      return {
        newContent: lines.join('\n'),
        editInfo: createEditInfo(lines.length - 3, lines.length, targetLine - 1, targetLine - 1)
      };
    }
  },
  {
    name: 'Add new function (structural change)',
    apply: (content) => {
      const newFunction = `
export function brandNewFunction(): void {
  console.log("I am new!");
}
`;
      const oldLineCount = content.split('\n').length;
      const newContent = content + newFunction;
      const newLineCount = newContent.split('\n').length;
      return {
        newContent,
        editInfo: createEditInfo(oldLineCount, newLineCount, oldLineCount, oldLineCount)
      };
    }
  },
  {
    name: 'Rename a class (structural change)',
    apply: (content) => {
      const lines = content.split('\n');
      const targetLine = findLineWithText(content, 'export class Class0');
      lines[targetLine - 1] = lines[targetLine - 1].replace('Class0', 'RenamedClass');
      return {
        newContent: lines.join('\n'),
        editInfo: createEditInfo(lines.length, lines.length, targetLine, targetLine)
      };
    }
  }
];

// ============================================================================
// Benchmark Runner
// ============================================================================

async function runBenchmark(): Promise<void> {
  console.log('======================================================================');
  console.log('IncrementalParser Benchmark');
  console.log('Comparing incremental vs full re-parse strategies');
  console.log('======================================================================\n');

  const fileSizes = [10, 50, 100];
  const iterations = 20;

  for (const numFunctions of fileSizes) {
    const content = generateTestFile(numFunctions);
    const lineCount = content.split('\n').length;
    
    console.log(`\n--- File with ${numFunctions} functions (${lineCount} lines) ---\n`);

    const parser = new IncrementalParser();
    const filePath = 'test.ts';

    // Initial parse to populate cache
    const initialResult = parser.parseIncremental(filePath, content);
    console.log(`Initial parse: ${initialResult.timeMs.toFixed(2)}ms (${initialResult.symbols.length} symbols)\n`);

    for (const scenario of scenarios) {
      const { newContent, editInfo } = scenario.apply(content);
      
      // Clear cache for fair comparison
      parser.clearCache();
      
      // First: populate cache with original
      parser.parseIncremental(filePath, content);

      // Benchmark: incremental parse with edit info
      const incrementalTimes: number[] = [];
      let lastStrategy = '';
      
      for (let i = 0; i < iterations; i++) {
        // Reset to cached state
        parser.clearCache();
        parser.parseIncremental(filePath, content);
        
        const result = parser.parseIncremental(filePath, newContent, editInfo);
        incrementalTimes.push(result.timeMs);
        lastStrategy = result.parseStrategy;
      }

      // Benchmark: full re-parse (no edit info)
      const fullTimes: number[] = [];
      
      for (let i = 0; i < iterations; i++) {
        parser.clearCache();
        parser.parseIncremental(filePath, content);
        
        const result = parser.parseIncremental(filePath, newContent); // No edit info
        fullTimes.push(result.timeMs);
      }

      // Calculate medians
      incrementalTimes.sort((a, b) => a - b);
      fullTimes.sort((a, b) => a - b);
      
      const incrementalMedian = incrementalTimes[Math.floor(iterations / 2)];
      const fullMedian = fullTimes[Math.floor(iterations / 2)];
      const speedup = fullMedian / incrementalMedian;

      console.log(`${scenario.name}:`);
      console.log(`  Strategy used: ${lastStrategy}`);
      console.log(`  Incremental:   ${incrementalMedian.toFixed(2)}ms`);
      console.log(`  Full re-parse: ${fullMedian.toFixed(2)}ms`);
      console.log(`  Speedup:       ${speedup.toFixed(1)}x ${speedup > 1 ? 'faster' : 'slower'}`);
      console.log('');
    }
  }

  console.log('======================================================================');
  console.log('Analysis');
  console.log('======================================================================');
  console.log(`
Key insights:
1. Edits INSIDE function bodies can skip re-parsing entirely (just adjust line numbers)
2. Edits BETWEEN symbols (whitespace/comments) can use quick declaration count
3. Structural changes (new/renamed declarations) still require full re-parse

This approach gives us:
- Near-instant updates for most edits (typing inside functions)
- Quick updates for non-structural changes
- Full parse only when structure actually changes
`);
}

// Run the benchmark
runBenchmark().catch(console.error);
