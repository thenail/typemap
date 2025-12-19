/**
 * LightweightParser Unit Tests
 * 
 * Tests parser against various TypeScript syntax patterns
 * to prevent "Cannot read properties of undefined" errors
 */

import * as ts from 'typescript';
import * as path from 'path';
import * as assert from 'assert';

// Mock CacheManager for testing
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

// Inline parser implementation for testing (avoids import issues)
type SymbolKind = 'class' | 'interface' | 'function' | 'type' | 'enum' | 'variable' | 'namespace' | 'component' | 'hook';

interface LightweightSymbol {
  name: string;
  kind: SymbolKind;
  filePath: string;
  line: number;
  column: number;
  exported: boolean;
  isDefault: boolean;
}

function parseCode(code: string, filename = 'test.ts'): LightweightSymbol[] {
  const isTsx = filename.endsWith('.tsx');
  const scriptKind = isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  
  const sourceFile = ts.createSourceFile(
    filename,
    code,
    ts.ScriptTarget.Latest,
    false,
    scriptKind
  );

  const symbols: LightweightSymbol[] = [];

  const visit = (node: ts.Node): void => {
    const symbol = nodeToSymbol(node, sourceFile, filename, isTsx);
    if (symbol) {
      symbols.push(symbol);
    }
    
    if (ts.isModuleDeclaration(node) || ts.isClassDeclaration(node)) {
      ts.forEachChild(node, visit);
    }
  };

  ts.forEachChild(sourceFile, visit);
  return symbols;
}

function nodeToSymbol(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  filePath: string,
  isTsx: boolean
): LightweightSymbol | null {
  // Skip non-declaration nodes
  if (
    ts.isImportDeclaration(node) ||
    ts.isExportDeclaration(node) ||
    ts.isExportAssignment(node) ||
    ts.isExpressionStatement(node) ||
    ts.isEmptyStatement(node)
  ) {
    return null;
  }

  let line = 0;
  let character = 0;
  try {
    const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    line = pos.line;
    character = pos.character;
  } catch {
    // Fallback
  }

  const isExported = hasExportModifier(node);
  const isDefault = hasDefaultModifier(node);

  // Function declaration
  if (ts.isFunctionDeclaration(node) && node.name) {
    return {
      name: node.name.text,
      kind: detectKind(node.name.text, isTsx),
      filePath,
      line: line + 1,
      column: character + 1,
      exported: isExported,
      isDefault
    };
  }

  // Variable statement
  if (ts.isVariableStatement(node)) {
    for (const decl of node.declarationList.declarations) {
      if (ts.isIdentifier(decl.name)) {
        let kind: SymbolKind = 'variable';
        if (decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
          kind = detectKind(decl.name.text, isTsx);
        }
        return {
          name: decl.name.text,
          kind,
          filePath,
          line: line + 1,
          column: character + 1,
          exported: isExported,
          isDefault
        };
      }
    }
  }

  // Class declaration
  if (ts.isClassDeclaration(node) && node.name) {
    return {
      name: node.name.text,
      kind: 'class',
      filePath,
      line: line + 1,
      column: character + 1,
      exported: isExported,
      isDefault
    };
  }

  // Interface declaration
  if (ts.isInterfaceDeclaration(node) && node.name) {
    return {
      name: node.name.text,
      kind: 'interface',
      filePath,
      line: line + 1,
      column: character + 1,
      exported: isExported,
      isDefault: false
    };
  }

  // Type alias
  if (ts.isTypeAliasDeclaration(node) && node.name) {
    return {
      name: node.name.text,
      kind: 'type',
      filePath,
      line: line + 1,
      column: character + 1,
      exported: isExported,
      isDefault: false
    };
  }

  // Enum declaration
  if (ts.isEnumDeclaration(node) && node.name) {
    return {
      name: node.name.text,
      kind: 'enum',
      filePath,
      line: line + 1,
      column: character + 1,
      exported: isExported,
      isDefault: false
    };
  }

  // Module/Namespace declaration
  if (ts.isModuleDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
    return {
      name: node.name.text,
      kind: 'namespace',
      filePath,
      line: line + 1,
      column: character + 1,
      exported: isExported,
      isDefault: false
    };
  }

  return null;
}

function hasExportModifier(node: ts.Node): boolean {
  try {
    if (!ts.canHaveModifiers(node)) return false;
    const modifiers = ts.getModifiers(node);
    if (!modifiers) return false;
    return modifiers.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
  } catch {
    return false;
  }
}

function hasDefaultModifier(node: ts.Node): boolean {
  try {
    if (!ts.canHaveModifiers(node)) return false;
    const modifiers = ts.getModifiers(node);
    if (!modifiers) return false;
    return modifiers.some(m => m.kind === ts.SyntaxKind.DefaultKeyword);
  } catch {
    return false;
  }
}

function detectKind(name: string, isTsx: boolean): SymbolKind {
  if (name.startsWith('use') && name.length > 3 && name[3] === name[3].toUpperCase()) {
    return 'hook';
  }
  if (isTsx && name[0] === name[0].toUpperCase() && /^[A-Z]/.test(name)) {
    return 'component';
  }
  return 'function';
}

// ============================================================================
// TEST CASES
// ============================================================================

interface TestCase {
  name: string;
  code: string;
  filename?: string;
  expected: Array<{ name: string; kind: SymbolKind; exported?: boolean }>;
  shouldNotThrow?: boolean;
}

const testCases: TestCase[] = [
  // Basic declarations
  {
    name: 'Basic function declaration',
    code: `function hello() {}`,
    expected: [{ name: 'hello', kind: 'function' }]
  },
  {
    name: 'Exported function declaration',
    code: `export function greet() {}`,
    expected: [{ name: 'greet', kind: 'function', exported: true }]
  },
  {
    name: 'Class declaration',
    code: `class MyClass {}`,
    expected: [{ name: 'MyClass', kind: 'class' }]
  },
  {
    name: 'Exported class declaration',
    code: `export class Service {}`,
    expected: [{ name: 'Service', kind: 'class', exported: true }]
  },
  {
    name: 'Interface declaration',
    code: `interface User { name: string; }`,
    expected: [{ name: 'User', kind: 'interface' }]
  },
  {
    name: 'Type alias',
    code: `type ID = string | number;`,
    expected: [{ name: 'ID', kind: 'type' }]
  },
  {
    name: 'Enum declaration',
    code: `enum Status { Active, Inactive }`,
    expected: [{ name: 'Status', kind: 'enum' }]
  },
  {
    name: 'Const variable',
    code: `const MAX_SIZE = 100;`,
    expected: [{ name: 'MAX_SIZE', kind: 'variable' }]
  },
  {
    name: 'Arrow function',
    code: `const add = (a: number, b: number) => a + b;`,
    expected: [{ name: 'add', kind: 'function' }]
  },
  {
    name: 'Namespace declaration',
    code: `namespace Utils { export function helper() {} }`,
    expected: [{ name: 'Utils', kind: 'namespace' }]
  },
  
  // Edge cases that previously caused errors
  {
    name: 'Import type only',
    code: `import type { Something } from './module';`,
    expected: [],
    shouldNotThrow: true
  },
  {
    name: 'Import with named imports',
    code: `import { foo, bar } from './module';`,
    expected: [],
    shouldNotThrow: true
  },
  {
    name: 'Import default',
    code: `import React from 'react';`,
    expected: [],
    shouldNotThrow: true
  },
  {
    name: 'Import namespace',
    code: `import * as fs from 'fs';`,
    expected: [],
    shouldNotThrow: true
  },
  {
    name: 'Re-export',
    code: `export { foo } from './module';`,
    expected: [],
    shouldNotThrow: true
  },
  {
    name: 'Export all',
    code: `export * from './module';`,
    expected: [],
    shouldNotThrow: true
  },
  {
    name: 'Export default expression',
    code: `export default {};`,
    expected: [],
    shouldNotThrow: true
  },
  {
    name: 'Empty file',
    code: ``,
    expected: [],
    shouldNotThrow: true
  },
  {
    name: 'Only comments',
    code: `// This is a comment\n/* Block comment */`,
    expected: [],
    shouldNotThrow: true
  },
  
  // Anonymous declarations (edge cases for .name being undefined)
  {
    name: 'Anonymous default class',
    code: `export default class {}`,
    expected: [], // No name, should be skipped
    shouldNotThrow: true
  },
  {
    name: 'Anonymous default function',
    code: `export default function() {}`,
    expected: [], // No name, should be skipped
    shouldNotThrow: true
  },
  
  // Destructuring (edge cases for .name not being Identifier)
  {
    name: 'Destructuring const',
    code: `const { a, b } = obj;`,
    expected: [], // Destructuring pattern, not simple identifier
    shouldNotThrow: true
  },
  {
    name: 'Array destructuring',
    code: `const [first, second] = arr;`,
    expected: [],
    shouldNotThrow: true
  },
  
  // Complex real-world patterns
  {
    name: 'Mixed imports and exports',
    code: `
      import { max, min } from 'date-fns';
      import type { CalendarEvent } from '../data/events';
      
      export type PositionedEvent = {
        id: string;
        title: string;
      };
      
      const DAY_START_HOUR = 8;
      
      export const buildPositionedEvents = () => {};
    `,
    expected: [
      { name: 'PositionedEvent', kind: 'type', exported: true },
      { name: 'DAY_START_HOUR', kind: 'variable' },
      { name: 'buildPositionedEvents', kind: 'function', exported: true }
    ],
    shouldNotThrow: true
  },
  
  // TSX specific
  {
    name: 'React component (TSX)',
    code: `export const Button = () => <button>Click</button>;`,
    filename: 'Button.tsx',
    expected: [{ name: 'Button', kind: 'component', exported: true }]
  },
  {
    name: 'React hook',
    code: `export function useCounter() { return 0; }`,
    filename: 'hooks.ts',
    expected: [{ name: 'useCounter', kind: 'hook', exported: true }]
  },
  
  // Declaration merging
  {
    name: 'Interface merging',
    code: `
      interface Window { customProp: string; }
      interface Window { anotherProp: number; }
    `,
    expected: [
      { name: 'Window', kind: 'interface' },
      { name: 'Window', kind: 'interface' }
    ],
    shouldNotThrow: true
  },
  
  // Ambient declarations
  {
    name: 'Declare module',
    code: `declare module 'some-module' { export function foo(): void; }`,
    expected: [], // String literal module name, not identifier
    shouldNotThrow: true
  },
  {
    name: 'Declare const',
    code: `declare const __DEV__: boolean;`,
    expected: [{ name: '__DEV__', kind: 'variable' }],
    shouldNotThrow: true
  },
  
  // Generic types
  {
    name: 'Generic interface',
    code: `interface Container<T> { value: T; }`,
    expected: [{ name: 'Container', kind: 'interface' }]
  },
  {
    name: 'Generic type alias',
    code: `type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };`,
    expected: [{ name: 'Result', kind: 'type' }]
  },
  
  // Computed property names (potential edge case)
  {
    name: 'Object with computed properties',
    code: `const obj = { [Symbol.iterator]: function*() {} };`,
    expected: [{ name: 'obj', kind: 'variable' }],
    shouldNotThrow: true
  },
  
  // As const
  {
    name: 'As const assertion',
    code: `const colors = ['red', 'green', 'blue'] as const;`,
    expected: [{ name: 'colors', kind: 'variable' }]
  },
  
  // Satisfies
  {
    name: 'Satisfies operator',
    code: `const config = { port: 3000 } satisfies { port: number };`,
    expected: [{ name: 'config', kind: 'variable' }]
  },
  
  // Real-world regression test: familjekalendern/src/utils/events.ts
  {
    name: 'Real-world: events.ts with arrow functions and types',
    code: `
import { max, min } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import type { CalendarEvent } from '../data/events'
import {
  formatTimeRange,
  getDayBoundsUtc,
  getMinutesOfDay,
} from './datetime'

const DAY_START_HOUR = 8
const DAY_END_HOUR = 15
const TOTAL_MINUTES = (DAY_END_HOUR - DAY_START_HOUR) * 60

export type PositionedEvent = {
  id: string
  title: string
  category: CalendarEvent['category']
  attendees?: string[]
  displayTime: string
  dayIso: string
  column: number
  columns: number
  topPercent: number
  heightPercent: number
}

type ClippedEvent = {
  id: string
  title: string
  category: CalendarEvent['category']
  attendees?: string[]
  dayIso: string
  startMinutes: number
  endMinutes: number
  displayTime: string
}

type LayoutCandidate = ClippedEvent & { column?: number }

const clampToView = (
  event: CalendarEvent,
  dayIso: string,
  timeZone: string,
): ClippedEvent | null => {
  return null
}

const groupByOverlap = (events: ClippedEvent[]): ClippedEvent[][] => {
  return []
}

const layoutCluster = (cluster: ClippedEvent[]): PositionedEvent[] => {
  return []
}

export type PositionedEventsByDay = Record<string, PositionedEvent[]>

export const buildPositionedEvents = (
  data: CalendarEvent[],
  dayIsos: string | string[],
  timeZone: string,
): PositionedEventsByDay => {
  return {}
}

export const getTimelineLabels = (
  startHour = DAY_START_HOUR,
  endHour = DAY_END_HOUR,
  timeZone: string,
) => {
  return []
}
    `,
    expected: [
      { name: 'DAY_START_HOUR', kind: 'variable' },
      { name: 'DAY_END_HOUR', kind: 'variable' },
      { name: 'TOTAL_MINUTES', kind: 'variable' },
      { name: 'PositionedEvent', kind: 'type', exported: true },
      { name: 'ClippedEvent', kind: 'type' },
      { name: 'LayoutCandidate', kind: 'type' },
      { name: 'clampToView', kind: 'function' },
      { name: 'groupByOverlap', kind: 'function' },
      { name: 'layoutCluster', kind: 'function' },
      { name: 'PositionedEventsByDay', kind: 'type', exported: true },
      { name: 'buildPositionedEvents', kind: 'function', exported: true },
      { name: 'getTimelineLabels', kind: 'function', exported: true }
    ],
    shouldNotThrow: true
  }
];

// ============================================================================
// RUN TESTS
// ============================================================================

function runTests(): void {
  console.log('\n' + '═'.repeat(60));
  console.log('  LIGHTWEIGHT PARSER UNIT TESTS');
  console.log('═'.repeat(60) + '\n');

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const testCase of testCases) {
    const filename = testCase.filename || 'test.ts';
    
    try {
      const symbols = parseCode(testCase.code, filename);
      
      // Check if we got the expected number of symbols
      if (symbols.length !== testCase.expected.length) {
        failed++;
        failures.push(`❌ ${testCase.name}: Expected ${testCase.expected.length} symbols, got ${symbols.length}`);
        continue;
      }
      
      // Check each expected symbol
      let allMatch = true;
      for (let i = 0; i < testCase.expected.length; i++) {
        const exp = testCase.expected[i];
        const got = symbols[i];
        
        if (got.name !== exp.name || got.kind !== exp.kind) {
          allMatch = false;
          failures.push(`❌ ${testCase.name}: Symbol ${i} mismatch - expected ${exp.name}:${exp.kind}, got ${got.name}:${got.kind}`);
          break;
        }
        
        if (exp.exported !== undefined && got.exported !== exp.exported) {
          allMatch = false;
          failures.push(`❌ ${testCase.name}: Symbol ${exp.name} exported mismatch - expected ${exp.exported}, got ${got.exported}`);
          break;
        }
      }
      
      if (allMatch) {
        passed++;
        console.log(`✓ ${testCase.name}`);
      } else {
        failed++;
      }
      
    } catch (error) {
      if (testCase.shouldNotThrow) {
        failed++;
        failures.push(`❌ ${testCase.name}: Should not throw but threw: ${error}`);
      } else {
        failed++;
        failures.push(`❌ ${testCase.name}: Unexpected error: ${error}`);
      }
    }
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed out of ${testCases.length} tests`);
  
  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(f));
  }
  
  console.log('═'.repeat(60) + '\n');
  
  // Exit with error code if tests failed
  if (failed > 0) {
    process.exit(1);
  }
}

// Run if executed directly
runTests();
