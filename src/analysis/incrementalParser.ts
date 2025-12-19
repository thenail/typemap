/**
 * Incremental Parser
 * 
 * A lightweight incremental parsing strategy that avoids full re-parsing
 * by tracking symbol boundaries and only updating affected symbols.
 * 
 * Key insight: We only care about TOP-LEVEL declarations (class, interface, 
 * function, type, enum). Changes inside function bodies don't affect our graph.
 * 
 * Strategy:
 * 1. Cache symbol positions (start line, end line) with content hash
 * 2. On edit, determine which line range changed
 * 3. If edit is inside a symbol body (not declaration line), skip re-parse
 * 4. If edit affects declaration lines, do targeted re-extraction
 */

import * as crypto from 'crypto';

export interface CachedSymbol {
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  declarationLine: number;  // The line with the actual declaration (class Foo {)
  contentHash: string;      // Hash of just this symbol's content
}

export interface FileCache {
  filePath: string;
  contentHash: string;
  lineCount: number;
  symbols: CachedSymbol[];
  lineIndex: Map<number, CachedSymbol>;  // Quick lookup: line -> symbol containing it
}

export interface EditInfo {
  startLine: number;
  endLine: number;
  linesDelta: number;  // positive = lines added, negative = lines removed
}

export interface IncrementalParseResult {
  symbols: CachedSymbol[];
  parseStrategy: 'full' | 'partial' | 'skip';
  affectedSymbols: string[];
  timeMs: number;
}

export class IncrementalParser {
  private fileCache: Map<string, FileCache> = new Map();

  /**
   * Parse a file incrementally, reusing cached results where possible
   */
  parseIncremental(
    filePath: string,
    newContent: string,
    editInfo?: EditInfo
  ): IncrementalParseResult {
    const start = performance.now();
    const newHash = this.quickHash(newContent);
    const cached = this.fileCache.get(filePath);

    // Case 1: No cache - full parse
    if (!cached) {
      const symbols = this.fullParse(filePath, newContent);
      this.cacheFile(filePath, newContent, symbols);
      return {
        symbols,
        parseStrategy: 'full',
        affectedSymbols: symbols.map(s => s.name),
        timeMs: performance.now() - start
      };
    }

    // Case 2: Content unchanged - skip
    if (cached.contentHash === newHash) {
      return {
        symbols: cached.symbols,
        parseStrategy: 'skip',
        affectedSymbols: [],
        timeMs: performance.now() - start
      };
    }

    // Case 3: Have edit info - try partial parse
    if (editInfo) {
      const partialResult = this.tryPartialParse(filePath, newContent, cached, editInfo);
      if (partialResult) {
        return {
          ...partialResult,
          timeMs: performance.now() - start
        };
      }
    }

    // Case 4: Fallback to full parse
    const symbols = this.fullParse(filePath, newContent);
    this.cacheFile(filePath, newContent, symbols);
    return {
      symbols,
      parseStrategy: 'full',
      affectedSymbols: symbols.map(s => s.name),
      timeMs: performance.now() - start
    };
  }

  /**
   * Try to do a partial parse by checking if edit affects declarations
   */
  private tryPartialParse(
    filePath: string,
    newContent: string,
    cached: FileCache,
    editInfo: EditInfo
  ): Omit<IncrementalParseResult, 'timeMs'> | null {
    const lines = newContent.split('\n');
    const affectedSymbols: string[] = [];

    // Check if edit touches any declaration lines
    const editStart = editInfo.startLine;
    const editEnd = editInfo.endLine;

    // Find symbols whose declaration lines are affected
    const affectedDeclarations = cached.symbols.filter(sym => {
      // Declaration line is within edit range
      return sym.declarationLine >= editStart && sym.declarationLine <= editEnd;
    });

    // If any declarations affected, need full re-parse
    // (because adding/removing/modifying declarations changes the whole structure)
    if (affectedDeclarations.length > 0) {
      return null; // Fallback to full parse
    }

    // Check if edit is entirely within a symbol body
    const containingSymbol = cached.symbols.find(sym => 
      editStart > sym.declarationLine && editEnd <= sym.endLine
    );

    if (containingSymbol) {
      // Edit is inside a function/class body - no structural change
      // Just update line numbers for symbols after the edit
      const updatedSymbols = this.adjustLineNumbers(cached.symbols, editInfo);
      this.cacheFile(filePath, newContent, updatedSymbols);
      
      return {
        symbols: updatedSymbols,
        parseStrategy: 'skip',
        affectedSymbols: [] // No actual symbol changes
      };
    }

    // Edit is between symbols or at file boundaries
    // Quick check: did the number of top-level declarations change?
    const quickCount = this.quickDeclarationCount(newContent);
    const cachedCount = cached.symbols.length;

    if (quickCount === cachedCount) {
      // Same number of declarations - likely just whitespace/comments between symbols
      const updatedSymbols = this.adjustLineNumbers(cached.symbols, editInfo);
      this.cacheFile(filePath, newContent, updatedSymbols);
      
      return {
        symbols: updatedSymbols,
        parseStrategy: 'partial',
        affectedSymbols: []
      };
    }

    // Declaration count changed - need full re-parse
    return null;
  }

  /**
   * Quick count of top-level declarations using regex
   * Much faster than full AST parse
   */
  private quickDeclarationCount(content: string): number {
    // Match common top-level declaration patterns
    const patterns = [
      /^export\s+(default\s+)?(class|interface|function|type|enum|const|let|var)\s+/gm,
      /^(class|interface|function|type|enum)\s+\w+/gm,
      /^(const|let|var)\s+\w+\s*[=:]/gm,
    ];

    const seen = new Set<number>();
    
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        // Use line number to dedupe
        const lineNum = content.substring(0, match.index).split('\n').length;
        seen.add(lineNum);
      }
    }

    return seen.size;
  }

  /**
   * Adjust line numbers after an edit
   */
  private adjustLineNumbers(symbols: CachedSymbol[], editInfo: EditInfo): CachedSymbol[] {
    return symbols.map(sym => {
      if (sym.startLine > editInfo.endLine) {
        // Symbol is entirely after the edit - shift line numbers
        return {
          ...sym,
          startLine: sym.startLine + editInfo.linesDelta,
          endLine: sym.endLine + editInfo.linesDelta,
          declarationLine: sym.declarationLine + editInfo.linesDelta
        };
      } else if (sym.endLine >= editInfo.startLine) {
        // Symbol contains or overlaps the edit - adjust end line
        return {
          ...sym,
          endLine: sym.endLine + editInfo.linesDelta
        };
      }
      return sym;
    });
  }

  /**
   * Full parse using TypeScript API (our existing approach)
   */
  private fullParse(filePath: string, content: string): CachedSymbol[] {
    const ts = require('typescript');
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true
    );

    const symbols: CachedSymbol[] = [];
    const lines = content.split('\n');

    for (const statement of sourceFile.statements) {
      const symbol = this.extractSymbol(statement, sourceFile, lines);
      if (symbol) {
        symbols.push(symbol);
      }
    }

    return symbols;
  }

  /**
   * Extract a single symbol from a statement
   */
  private extractSymbol(
    statement: any,
    sourceFile: any,
    lines: string[]
  ): CachedSymbol | null {
    const ts = require('typescript');
    
    let name: string | null = null;
    let kind: string | null = null;

    if (ts.isClassDeclaration(statement) && statement.name) {
      name = statement.name.text;
      kind = 'class';
    } else if (ts.isInterfaceDeclaration(statement) && statement.name) {
      name = statement.name.text;
      kind = 'interface';
    } else if (ts.isFunctionDeclaration(statement) && statement.name) {
      name = statement.name.text;
      kind = 'function';
    } else if (ts.isTypeAliasDeclaration(statement) && statement.name) {
      name = statement.name.text;
      kind = 'type';
    } else if (ts.isEnumDeclaration(statement) && statement.name) {
      name = statement.name.text;
      kind = 'enum';
    } else if (ts.isVariableStatement(statement)) {
      // Get first variable declaration
      const decl = statement.declarationList.declarations[0];
      if (decl && ts.isIdentifier(decl.name)) {
        name = decl.name.text;
        kind = 'variable';
      }
    } else if (ts.isExportDeclaration(statement) || ts.isExportAssignment(statement)) {
      return null; // Skip pure exports
    }

    if (!name || !kind) {
      return null;
    }

    const startPos = sourceFile.getLineAndCharacterOfPosition(statement.getStart());
    const endPos = sourceFile.getLineAndCharacterOfPosition(statement.getEnd());
    
    const startLine = startPos.line + 1;
    const endLine = endPos.line + 1;
    
    // Get content for this symbol
    const symbolContent = lines.slice(startLine - 1, endLine).join('\n');

    return {
      name,
      kind,
      startLine,
      endLine,
      declarationLine: startLine, // First line is the declaration
      contentHash: this.quickHash(symbolContent)
    };
  }

  /**
   * Cache file results
   */
  private cacheFile(filePath: string, content: string, symbols: CachedSymbol[]): void {
    const lineIndex = new Map<number, CachedSymbol>();
    
    for (const sym of symbols) {
      for (let line = sym.startLine; line <= sym.endLine; line++) {
        lineIndex.set(line, sym);
      }
    }

    this.fileCache.set(filePath, {
      filePath,
      contentHash: this.quickHash(content),
      lineCount: content.split('\n').length,
      symbols,
      lineIndex
    });
  }

  /**
   * Quick hash for content comparison
   */
  private quickHash(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex').substring(0, 16);
  }

  /**
   * Clear cache for a file
   */
  clearCache(filePath?: string): void {
    if (filePath) {
      this.fileCache.delete(filePath);
    } else {
      this.fileCache.clear();
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { files: number; symbols: number } {
    let symbols = 0;
    for (const cache of this.fileCache.values()) {
      symbols += cache.symbols.length;
    }
    return { files: this.fileCache.size, symbols };
  }
}

/**
 * Detect edit info from VS Code text document change events
 */
export function createEditInfo(
  oldLineCount: number,
  newLineCount: number,
  changeStartLine: number,
  changeEndLine: number
): EditInfo {
  return {
    startLine: changeStartLine,
    endLine: changeEndLine,
    linesDelta: newLineCount - oldLineCount
  };
}
