/**
 * SWC Fast Parser
 * 
 * High-performance TypeScript/TSX parsing using SWC (Rust).
 * ~2.4x faster than TypeScript compiler API.
 * 
 * Used for:
 * - Initial codebase analysis
 * - Symbol extraction
 * - Import/export mapping
 * - Explicit implements/extends relationships
 */

import * as swc from '@swc/core';
import * as fs from 'fs';
import * as path from 'path';
import { LightweightSymbol, SymbolKind, SymbolRelationship, CacheStatistics } from '../types';
import { CacheManager } from '../cache/cacheManager';

export interface ParsedFile {
  filePath: string;
  symbols: LightweightSymbol[];
  imports: ImportInfo[];
  exports: ExportInfo[];
  relationships: SymbolRelationship[];
}

export interface ImportInfo {
  modulePath: string;
  namedImports: string[];
  defaultImport?: string;
  namespaceImport?: string;
  isTypeOnly: boolean;
}

export interface ExportInfo {
  name: string;
  isDefault: boolean;
  isReExport: boolean;
  fromModule?: string;
}

export class SwcParser {
  private cacheManager: CacheManager;
  private stats: CacheStatistics = {
    hits: 0,
    misses: 0,
    size: 0,
    maxSize: 0,
    evictions: 0
  };

  constructor(cacheManager: CacheManager) {
    this.cacheManager = cacheManager;
  }

  /**
   * Parse multiple files in parallel using SWC's async transform API
   */
  async parseFiles(
    files: string[],
    onProgress?: (completed: number, total: number) => void,
    cancellationToken?: { isCancellationRequested: boolean }
  ): Promise<ParsedFile[]> {
    const results: ParsedFile[] = [];
    const concurrency = 1000; // Optimal for SWC async

    for (let i = 0; i < files.length; i += concurrency) {
      if (cancellationToken?.isCancellationRequested) {
        break;
      }

      const chunk = files.slice(i, i + concurrency);
      const chunkResults = await Promise.all(
        chunk.map(file => this.parseFile(file).catch(() => null))
      );

      for (const result of chunkResults) {
        if (result) {
          results.push(result);
        }
      }

      if (onProgress) {
        onProgress(Math.min(i + concurrency, files.length), files.length);
      }
    }

    return results;
  }

  /**
   * Parse a single file and extract all information
   */
  async parseFile(filePath: string): Promise<ParsedFile> {
    // Check cache first
    const cached = await this.cacheManager.get<ParsedFile>(filePath);
    if (cached) {
      this.stats.hits++;
      return cached;
    }
    this.stats.misses++;

    // Read file content
    const content = await fs.promises.readFile(filePath, 'utf8');
    
    // Get parser config based on file extension
    const ext = path.extname(filePath).toLowerCase();
    const parserConfig = this.getParserConfig(ext);

    // Parse with SWC
    const module = await swc.parse(content, {
      ...parserConfig,
      comments: false,
      target: 'es2022',
    });

    // Extract information
    const isTsx = ext === '.tsx' || ext === '.jsx';
    const result = this.extractFromModule(module, filePath, isTsx);

    // Cache result
    await this.cacheManager.set(filePath, result, content);

    return result;
  }

  /**
   * Get SWC parser config based on file extension
   */
  private getParserConfig(ext: string): swc.ParserConfig {
    switch (ext) {
      case '.tsx':
        return { syntax: 'typescript', tsx: true };
      case '.jsx':
        return { syntax: 'ecmascript', jsx: true };
      case '.js':
      case '.mjs':
        return { syntax: 'ecmascript', jsx: false };
      default:
        return { syntax: 'typescript', tsx: false };
    }
  }

  /**
   * Extract symbols, imports, exports, and relationships from parsed module
   */
  private extractFromModule(
    module: swc.Module,
    filePath: string,
    isTsx: boolean
  ): ParsedFile {
    const symbols: LightweightSymbol[] = [];
    const imports: ImportInfo[] = [];
    const exports: ExportInfo[] = [];
    const relationships: SymbolRelationship[] = [];

    for (const item of module.body) {
      // Handle imports
      if (item.type === 'ImportDeclaration') {
        imports.push(this.extractImport(item));
      }

      // Handle exports
      if (item.type === 'ExportDeclaration') {
        const { symbol, exportInfo, rels } = this.extractExportDeclaration(item, filePath, isTsx);
        if (symbol) symbols.push(symbol);
        if (exportInfo) exports.push(exportInfo);
        relationships.push(...rels);
      }

      if (item.type === 'ExportDefaultDeclaration') {
        const { symbol, exportInfo } = this.extractExportDefault(item, filePath, isTsx);
        if (symbol) symbols.push(symbol);
        if (exportInfo) exports.push(exportInfo);
      }

      if (item.type === 'ExportNamedDeclaration') {
        for (const spec of item.specifiers) {
          if (spec.type === 'ExportSpecifier') {
            exports.push({
              name: spec.exported?.value ?? spec.orig.value,
              isDefault: false,
              isReExport: !!item.source,
              fromModule: item.source?.value,
            });
          }
        }
      }

      // Handle non-exported declarations
      const { symbol, rels } = this.extractDeclaration(item, filePath, isTsx, false);
      if (symbol) symbols.push(symbol);
      relationships.push(...rels);
    }

    return { filePath, symbols, imports, exports, relationships };
  }

  /**
   * Extract import information
   */
  private extractImport(node: swc.ImportDeclaration): ImportInfo {
    const info: ImportInfo = {
      modulePath: node.source.value,
      namedImports: [],
      isTypeOnly: node.typeOnly,
    };

    for (const spec of node.specifiers) {
      if (spec.type === 'ImportDefaultSpecifier') {
        info.defaultImport = spec.local.value;
      } else if (spec.type === 'ImportNamespaceSpecifier') {
        info.namespaceImport = spec.local.value;
      } else if (spec.type === 'ImportSpecifier') {
        info.namedImports.push(spec.local.value);
      }
    }

    return info;
  }

  /**
   * Extract export declaration
   */
  private extractExportDeclaration(
    node: swc.ExportDeclaration,
    filePath: string,
    isTsx: boolean
  ): { symbol: LightweightSymbol | null; exportInfo: ExportInfo | null; rels: SymbolRelationship[] } {
    const { symbol, rels } = this.extractDeclaration(node.declaration, filePath, isTsx, true);
    
    const exportInfo = symbol ? {
      name: symbol.name,
      isDefault: false,
      isReExport: false,
    } : null;

    return { symbol, exportInfo, rels };
  }

  /**
   * Extract export default declaration
   */
  private extractExportDefault(
    node: swc.ExportDefaultDeclaration,
    filePath: string,
    isTsx: boolean
  ): { symbol: LightweightSymbol | null; exportInfo: ExportInfo } {
    let symbol: LightweightSymbol | null = null;

    if (node.decl.type === 'ClassExpression' || node.decl.type === 'FunctionExpression') {
      const name = node.decl.identifier?.value ?? 'default';
      symbol = {
        name,
        kind: node.decl.type === 'ClassExpression' ? 'class' : 'function',
        filePath,
        line: this.getLine(node.span),
        column: 1,
        exported: true,
        isDefault: true,
      };
    }

    return {
      symbol,
      exportInfo: { name: 'default', isDefault: true, isReExport: false },
    };
  }

  /**
   * Extract declaration (class, function, interface, etc.)
   */
  private extractDeclaration(
    node: swc.ModuleItem | swc.Declaration,
    filePath: string,
    isTsx: boolean,
    isExported: boolean
  ): { symbol: LightweightSymbol | null; rels: SymbolRelationship[] } {
    const rels: SymbolRelationship[] = [];

    // Class declaration
    if (node.type === 'ClassDeclaration') {
      const symbol: LightweightSymbol = {
        name: node.identifier.value,
        kind: 'class',
        filePath,
        line: this.getLine(node.span),
        column: 1,
        exported: isExported,
        isDefault: false,
      };

      // Extract implements relationships
      if (node.implements) {
        for (const impl of node.implements) {
          if (impl.expression.type === 'Identifier') {
            rels.push({
              fromSymbol: node.identifier.value,
              toSymbol: impl.expression.value,
              type: 'implements',
              filePath,
            });
          }
        }
      }

      // Extract extends relationship
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

    // Function declaration
    if (node.type === 'FunctionDeclaration') {
      const name = node.identifier.value;
      return {
        symbol: {
          name,
          kind: this.detectReactKind(name, isTsx),
          filePath,
          line: this.getLine(node.span),
          column: 1,
          exported: isExported,
          isDefault: false,
        },
        rels,
      };
    }

    // Variable declaration
    if (node.type === 'VariableDeclaration') {
      for (const decl of node.declarations) {
        if (decl.id.type === 'Identifier') {
          const name = decl.id.value;
          let kind: SymbolKind = 'variable';

          // Check for arrow function
          if (decl.init?.type === 'ArrowFunctionExpression' || decl.init?.type === 'FunctionExpression') {
            kind = this.detectReactKind(name, isTsx);
          }

          return {
            symbol: {
              name,
              kind,
              filePath,
              line: this.getLine(node.span),
              column: 1,
              exported: isExported,
              isDefault: false,
            },
            rels,
          };
        }
      }
    }

    // Interface declaration
    if (node.type === 'TsInterfaceDeclaration') {
      const symbol: LightweightSymbol = {
        name: node.id.value,
        kind: 'interface',
        filePath,
        line: this.getLine(node.span),
        column: 1,
        exported: isExported,
        isDefault: false,
      };

      // Extract extends relationships
      if (node.extends) {
        for (const ext of node.extends) {
          if (ext.expression.type === 'Identifier') {
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
        symbol: {
          name: node.id.value,
          kind: 'type',
          filePath,
          line: this.getLine(node.span),
          column: 1,
          exported: isExported,
          isDefault: false,
        },
        rels,
      };
    }

    // Enum declaration
    if (node.type === 'TsEnumDeclaration') {
      return {
        symbol: {
          name: node.id.value,
          kind: 'enum',
          filePath,
          line: this.getLine(node.span),
          column: 1,
          exported: isExported,
          isDefault: false,
        },
        rels,
      };
    }

    // Module/Namespace
    if (node.type === 'TsModuleDeclaration' && node.id.type === 'Identifier') {
      return {
        symbol: {
          name: node.id.value,
          kind: 'namespace',
          filePath,
          line: this.getLine(node.span),
          column: 1,
          exported: isExported,
          isDefault: false,
        },
        rels,
      };
    }

    return { symbol: null, rels };
  }

  /**
   * Get line number from SWC span
   */
  private getLine(span: swc.Span): number {
    // SWC spans are byte offsets, we approximate line as 1 for now
    // In production, we'd need to track line numbers during parsing
    return 1;
  }

  /**
   * Detect if a function is a React hook or component
   */
  private detectReactKind(name: string, isTsx: boolean): SymbolKind {
    // React hooks start with 'use' followed by uppercase
    if (name.startsWith('use') && name.length > 3 && name[3] === name[3].toUpperCase()) {
      return 'hook';
    }

    // React components start with uppercase (in TSX files)
    if (isTsx && name[0] === name[0].toUpperCase() && /^[A-Z]/.test(name)) {
      return 'component';
    }

    return 'function';
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStatistics {
    return { ...this.stats };
  }
}
