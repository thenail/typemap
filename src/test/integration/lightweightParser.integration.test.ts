/**
 * LightweightParser Integration Tests
 * 
 * Tests the ACTUAL LightweightParser class against various TypeScript patterns.
 * This catches issues that unit tests with copied code would miss.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LightweightParser } from '../../analysis/lightweightParser';
import { LightweightSymbol, SymbolKind } from '../../types';

// Mock CacheManager
class MockCacheManager {
  private cache = new Map<string, any>();
  
  async get<T>(key: string): Promise<T | null> {
    return this.cache.get(key) || null;
  }
  
  async set(key: string, value: any): Promise<void> {
    this.cache.set(key, value);
  }
  
  async clear(): Promise<void> {
    this.cache.clear();
  }
}

interface TestCase {
  name: string;
  code: string;
  filename?: string;
  expectedCount: number;
  expectedNames?: string[];
  shouldNotThrow?: boolean;
}

const testCases: TestCase[] = [
  // Basic declarations
  {
    name: 'Basic function declaration',
    code: `function hello() {}`,
    expectedCount: 1,
    expectedNames: ['hello']
  },
  {
    name: 'Exported function',
    code: `export function greet() {}`,
    expectedCount: 1,
    expectedNames: ['greet']
  },
  {
    name: 'Class declaration',
    code: `class MyClass {}`,
    expectedCount: 1,
    expectedNames: ['MyClass']
  },
  {
    name: 'Interface declaration',
    code: `interface User { name: string; }`,
    expectedCount: 1,
    expectedNames: ['User']
  },
  {
    name: 'Type alias',
    code: `type ID = string | number;`,
    expectedCount: 1,
    expectedNames: ['ID']
  },
  {
    name: 'Enum declaration',
    code: `enum Status { Active, Inactive }`,
    expectedCount: 1,
    expectedNames: ['Status']
  },
  {
    name: 'Const variable',
    code: `const MAX_SIZE = 100;`,
    expectedCount: 1,
    expectedNames: ['MAX_SIZE']
  },
  {
    name: 'Arrow function',
    code: `const add = (a: number, b: number) => a + b;`,
    expectedCount: 1,
    expectedNames: ['add']
  },
  
  // Edge cases - imports/exports should not throw
  {
    name: 'Import type only',
    code: `import type { Something } from './module';`,
    expectedCount: 0,
    shouldNotThrow: true
  },
  {
    name: 'Import with named imports',
    code: `import { foo, bar } from './module';`,
    expectedCount: 0,
    shouldNotThrow: true
  },
  {
    name: 'Re-export',
    code: `export { foo } from './module';`,
    expectedCount: 0,
    shouldNotThrow: true
  },
  {
    name: 'Export default expression',
    code: `export default {};`,
    expectedCount: 0,
    shouldNotThrow: true
  },
  {
    name: 'Empty file',
    code: ``,
    expectedCount: 0,
    shouldNotThrow: true
  },
  
  // Anonymous declarations
  {
    name: 'Anonymous default class',
    code: `export default class {}`,
    expectedCount: 0,
    shouldNotThrow: true
  },
  {
    name: 'Anonymous default function',
    code: `export default function() {}`,
    expectedCount: 0,
    shouldNotThrow: true
  },
  
  // Destructuring
  {
    name: 'Destructuring const',
    code: `const { a, b } = obj;`,
    expectedCount: 0, // Not a simple identifier
    shouldNotThrow: true
  },
  
  // Real-world: events.ts pattern
  {
    name: 'Real-world: events.ts pattern',
    code: `
import { max, min } from 'date-fns'
import type { CalendarEvent } from '../data/events'

const DAY_START_HOUR = 8
const DAY_END_HOUR = 15

export type PositionedEvent = {
  id: string
  title: string
}

type ClippedEvent = {
  id: string
}

const clampToView = (event: any): any => {
  return null
}

export const buildPositionedEvents = () => {
  return {}
}
    `,
    expectedCount: 6,
    expectedNames: ['DAY_START_HOUR', 'DAY_END_HOUR', 'PositionedEvent', 'ClippedEvent', 'clampToView', 'buildPositionedEvents'],
    shouldNotThrow: true
  },
  
  // TSX component
  {
    name: 'React component (TSX)',
    code: `export const Button = () => <button>Click</button>;`,
    filename: 'Button.tsx',
    expectedCount: 1,
    expectedNames: ['Button']
  },
  
  // Multiple declarations
  {
    name: 'Multiple functions',
    code: `
function foo() {}
function bar() {}
function baz() {}
    `,
    expectedCount: 3,
    expectedNames: ['foo', 'bar', 'baz']
  },
  
  // Declare statements
  {
    name: 'Declare module (string literal)',
    code: `declare module 'some-module' { export function foo(): void; }`,
    expectedCount: 0, // String literal module name
    shouldNotThrow: true
  },
  {
    name: 'Declare const',
    code: `declare const __DEV__: boolean;`,
    expectedCount: 1,
    expectedNames: ['__DEV__']
  },
  
  // Module augmentation (Fastify pattern)
  {
    name: 'Module augmentation',
    code: `
declare module 'fastify' {
  interface FastifyReply {
    customMethod: () => void;
  }
}
    `,
    expectedCount: 0, // String literal module
    shouldNotThrow: true
  }
];

async function runTests(): Promise<void> {
  console.log('\n' + '═'.repeat(70));
  console.log('  LIGHTWEIGHT PARSER INTEGRATION TESTS');
  console.log('  Testing the ACTUAL parser implementation');
  console.log('═'.repeat(70) + '\n');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parser-test-'));
  const cacheManager = new MockCacheManager() as any;
  const parser = new LightweightParser(cacheManager);

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const testCase of testCases) {
    const filename = testCase.filename || 'test.ts';
    const filePath = path.join(tempDir, filename);
    
    try {
      // Write test file
      fs.writeFileSync(filePath, testCase.code);
      
      // Clear cache to ensure fresh parse
      await cacheManager.clear();
      
      // Parse with actual parser
      const symbols = await parser.parseFile(filePath);
      
      // Check count
      if (symbols.length !== testCase.expectedCount) {
        failed++;
        failures.push(`❌ ${testCase.name}: Expected ${testCase.expectedCount} symbols, got ${symbols.length}`);
        if (symbols.length > 0) {
          failures.push(`   Got: ${symbols.map(s => s.name).join(', ')}`);
        }
        continue;
      }
      
      // Check names if specified
      if (testCase.expectedNames) {
        const gotNames = symbols.map(s => s.name);
        const missing = testCase.expectedNames.filter(n => !gotNames.includes(n));
        if (missing.length > 0) {
          failed++;
          failures.push(`❌ ${testCase.name}: Missing symbols: ${missing.join(', ')}`);
          failures.push(`   Got: ${gotNames.join(', ')}`);
          continue;
        }
      }
      
      passed++;
      console.log(`✓ ${testCase.name}`);
      
    } catch (error) {
      if (testCase.shouldNotThrow) {
        failed++;
        failures.push(`❌ ${testCase.name}: Should not throw but got: ${error}`);
      } else {
        failed++;
        failures.push(`❌ ${testCase.name}: Unexpected error: ${error}`);
      }
    } finally {
      // Cleanup test file
      try { fs.unlinkSync(filePath); } catch {}
    }
  }

  // Cleanup temp dir
  try { fs.rmdirSync(tempDir); } catch {}

  console.log('\n' + '─'.repeat(70));
  console.log(`Results: ${passed} passed, ${failed} failed out of ${testCases.length} tests`);
  
  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(f));
  }
  
  console.log('═'.repeat(70) + '\n');
  
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
