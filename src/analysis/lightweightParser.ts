/**
 * Lightweight Parser
 * Fast TypeScript/TSX parsing for initial analysis
 * 
 * Design principles:
 * - Use minimal AST traversal (top-level only)
 * - No type checking (skip ts.createProgram)
 * - Aggressive caching
 * - Parallel processing ready
 * - Single-pass metrics collection for optimal performance
 */

import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import { LightweightSymbol, SymbolKind, CacheStatistics } from '../types';
import { CacheManager } from '../cache/cacheManager';
import { getMetricsCollector, MetricsCollector } from './metricsCollector';

export class LightweightParser {
  private cacheManager: CacheManager;
  private metricsCollector: MetricsCollector;
  private stats: CacheStatistics = {
    hits: 0,
    misses: 0,
    size: 0,
    maxSize: 0,
    evictions: 0
  };

  constructor(cacheManager: CacheManager) {
    this.cacheManager = cacheManager;
    this.metricsCollector = getMetricsCollector();
  }

  /**
   * Parse multiple files in sequence (parallel version in workerPool)
   */
  async parseFiles(
    files: string[],
    onProgress?: (completed: number, total: number) => void,
    cancellationToken?: { isCancellationRequested: boolean }
  ): Promise<LightweightSymbol[]> {
    const allSymbols: LightweightSymbol[] = [];
    let completed = 0;

    for (const filePath of files) {
      if (cancellationToken?.isCancellationRequested) {
        break;
      }

      try {
        const symbols = await this.parseFile(filePath);
        allSymbols.push(...symbols);
      } catch (error) {
        // Log but continue
        console.error(`Failed to parse ${filePath}:`, error);
      }

      completed++;
      if (onProgress && completed % 10 === 0) {
        onProgress(completed, files.length);
      }
    }

    return allSymbols;
  }

  /**
   * Parse a single file and extract symbols
   */
  async parseFile(filePath: string): Promise<LightweightSymbol[]> {
    // Check cache first
    const cached = await this.cacheManager.get<LightweightSymbol[]>(filePath);
    if (cached) {
      this.stats.hits++;
      return cached;
    }
    this.stats.misses++;

    // Read file content
    const content = await fs.promises.readFile(filePath, 'utf8');
    
    // Determine script kind based on extension
    const isTsx = filePath.endsWith('.tsx');
    const isJsx = filePath.endsWith('.jsx');
    const scriptKind = isTsx || isJsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS;

    // Create source file (no type checking, very fast)
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true, // setParentNodes = true for better parsing
      scriptKind
    );

    // Collect file-level metrics for comment density
    const fileMetrics = this.metricsCollector.collectFileMetrics(sourceFile);
    const totalLines = sourceFile.getLineAndCharacterOfPosition(sourceFile.getEnd()).line + 1;
    const commentDensity = totalLines > 0 ? fileMetrics.commentLineCount / totalLines : 0;

    // Extract symbols
    const symbols = this.extractSymbols(sourceFile, filePath, isTsx, commentDensity);

    // Cache result
    await this.cacheManager.set(filePath, symbols, content);

    return symbols;
  }

  /**
   * Get file-level metrics (imports, TODOs, any types) using single-pass collector
   */
  async getFileMetrics(filePath: string): Promise<{ importCount: number; todoCount: number; anyTypeCount: number }> {
    const content = await fs.promises.readFile(filePath, 'utf8');
    
    const isTsx = filePath.endsWith('.tsx');
    const isJsx = filePath.endsWith('.jsx');
    const scriptKind = isTsx || isJsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS;

    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      scriptKind
    );

    // Use single-pass collector for file metrics
    const fileMetrics = this.metricsCollector.collectFileMetrics(sourceFile);
    return {
      importCount: fileMetrics.importCount,
      todoCount: fileMetrics.todoCount,
      anyTypeCount: fileMetrics.anyTypeCount
    };
  }

  /**
   * Extract top-level symbols from source file
   */
  private extractSymbols(
    sourceFile: ts.SourceFile, 
    filePath: string,
    isTsx: boolean,
    commentDensity: number
  ): LightweightSymbol[] {
    const symbols: LightweightSymbol[] = [];

    const visit = (node: ts.Node, depth: number = 0): void => {
      // Only process top-level and first-level nested declarations
      if (depth > 1) return;

      const symbol = this.nodeToSymbol(node, sourceFile, filePath, isTsx, commentDensity);
      if (symbol) {
        symbols.push(symbol);
      }

      // Process children for namespaces and classes
      if (ts.isModuleDeclaration(node) || ts.isClassDeclaration(node)) {
        ts.forEachChild(node, child => visit(child, depth + 1));
      }
    };

    ts.forEachChild(sourceFile, node => visit(node, 0));

    return symbols;
  }

  /**
   * Convert AST node to LightweightSymbol
   */
  private nodeToSymbol(
    node: ts.Node, 
    sourceFile: ts.SourceFile, 
    filePath: string,
    isTsx: boolean,
    commentDensity: number
  ): LightweightSymbol | null {
    // Skip nodes that don't declare symbols
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
      // Fallback if position fails
    }
    
    const isExported = this.hasExportModifier(node);
    const isDefault = this.hasDefaultModifier(node);

    // Function declaration - use single-pass metrics collector
    if (ts.isFunctionDeclaration(node) && node.name) {
      const name = node.name.text;
      const kind = this.detectReactHookOrComponent(name, isTsx);
      const endLine = this.getEndLine(node, sourceFile);
      const loc = endLine - line;
      const parameterCount = node.parameters?.length || 0;
      const isAsync = node.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) || false;
      const hasJsDoc = this.hasJsDocComment(node);
      
      // Single-pass metrics collection for the function body
      const metrics = this.metricsCollector.collectNodeMetrics(node);
      
      return {
        name,
        kind,
        filePath,
        line: line + 1,
        endLine: endLine + 1,
        column: character + 1,
        exported: isExported,
        isDefault,
        linesOfCode: loc,
        complexity: metrics.cyclomaticComplexity,
        cognitiveComplexity: metrics.cognitiveComplexity,
        parameterCount,
        maxNestingDepth: metrics.maxNestingDepth,
        asyncMethodCount: isAsync ? 1 : 0,
        returnCount: metrics.returnCount,
        throwCount: metrics.throwCount,
        hasJsDoc,
        commentDensity,
        callbackDepth: metrics.callbackDepth,
        promiseChainLength: metrics.promiseChainLength
      };
    }

    // Variable statement (const/let/var) - use single-pass metrics for arrow functions
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          const name = decl.name.text;
          let kind: SymbolKind = 'variable';
          let complexity = 1;
          let cognitiveComplexity = 0;
          let parameterCount = 0;
          let maxNestingDepth = 0;
          let isAsync = false;
          let returnCount = 0;
          let throwCount = 0;
          let callbackDepth = 0;
          let promiseChainLength = 0;
          
          // Check if it's an arrow function component or hook
          if (decl.initializer) {
            if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
              kind = this.detectReactHookOrComponent(name, isTsx);
              parameterCount = decl.initializer.parameters?.length || 0;
              isAsync = decl.initializer.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) || false;
              
              // Single-pass metrics collection for the function
              const metrics = this.metricsCollector.collectNodeMetrics(decl.initializer);
              complexity = metrics.cyclomaticComplexity;
              cognitiveComplexity = metrics.cognitiveComplexity;
              maxNestingDepth = metrics.maxNestingDepth;
              returnCount = metrics.returnCount;
              throwCount = metrics.throwCount;
              callbackDepth = metrics.callbackDepth;
              promiseChainLength = metrics.promiseChainLength;
            }
          }
          
          const endLine = this.getEndLine(node, sourceFile);
          const loc = endLine - line;
          const hasJsDoc = this.hasJsDocComment(node);
          
          return {
            name,
            kind,
            filePath,
            line: line + 1,
            endLine: endLine + 1,
            column: character + 1,
            exported: isExported,
            isDefault,
            linesOfCode: loc,
            complexity,
            cognitiveComplexity,
            parameterCount,
            maxNestingDepth,
            asyncMethodCount: isAsync ? 1 : 0,
            returnCount,
            throwCount,
            hasJsDoc,
            commentDensity,
            callbackDepth,
            promiseChainLength
          };
        }
      }
    }

    // Class declaration - use single-pass class metrics collector
    if (ts.isClassDeclaration(node) && node.name) {
      const endLine = this.getEndLine(node, sourceFile);
      const loc = endLine - line;
      const classMetrics = this.metricsCollector.collectClassMetrics(node);
      const inheritanceDepth = this.getInheritanceDepth(node);
      const constructorParamCount = this.getConstructorParamCount(node);
      const implementsCount = this.getImplementsCount(node);
      const hasJsDoc = this.hasJsDocComment(node);
      const isAbstract = this.isAbstractClass(node);
      const overrideCount = this.getOverrideCount(node);
      
      return {
        name: node.name.text,
        kind: 'class',
        filePath,
        line: line + 1,
        endLine: endLine + 1,
        column: character + 1,
        exported: isExported,
        isDefault,
        linesOfCode: loc,
        complexity: classMetrics.cyclomaticComplexity,
        cognitiveComplexity: classMetrics.cognitiveComplexity,
        methodCount: classMetrics.methodCount,
        fieldCount: classMetrics.fieldCount,
        inheritanceDepth,
        maxNestingDepth: classMetrics.maxNestingDepth,
        staticMethodCount: classMetrics.staticMethodCount,
        staticFieldCount: classMetrics.staticFieldCount,
        privateMethodCount: classMetrics.privateMethodCount,
        publicMethodCount: classMetrics.publicMethodCount,
        asyncMethodCount: classMetrics.asyncMethodCount,
        returnCount: classMetrics.returnCount,
        throwCount: classMetrics.throwCount,
        constructorParamCount,
        implementsCount,
        hasJsDoc,
        commentDensity,
        isAbstract,
        overrideCount,
        callbackDepth: classMetrics.callbackDepth,
        promiseChainLength: classMetrics.promiseChainLength
      };
    }

    // Interface declaration
    if (ts.isInterfaceDeclaration(node) && node.name) {
      const endLine = this.getEndLine(node, sourceFile);
      const loc = endLine - line;
      const { methodCount, fieldCount } = this.analyzeInterface(node);
      const hasJsDoc = this.hasJsDocComment(node);
      
      return {
        name: node.name.text,
        kind: 'interface',
        filePath,
        line: line + 1,
        endLine: endLine + 1,
        column: character + 1,
        exported: isExported,
        isDefault: false,
        linesOfCode: loc,
        methodCount,
        fieldCount,
        hasJsDoc,
        commentDensity
      };
    }

    // Type alias
    if (ts.isTypeAliasDeclaration(node) && node.name) {
      const endLine = this.getEndLine(node, sourceFile);
      const loc = endLine - line;
      const hasJsDoc = this.hasJsDocComment(node);
      
      return {
        name: node.name.text,
        kind: 'type',
        filePath,
        line: line + 1,
        endLine: endLine + 1,
        column: character + 1,
        exported: isExported,
        isDefault: false,
        linesOfCode: loc,
        hasJsDoc,
        commentDensity
      };
    }

    // Enum declaration
    if (ts.isEnumDeclaration(node) && node.name) {
      const endLine = this.getEndLine(node, sourceFile);
      const loc = endLine - line;
      const memberCount = node.members?.length || 0;
      
      return {
        name: node.name.text,
        kind: 'enum',
        filePath,
        line: line + 1,
        endLine: endLine + 1,
        column: character + 1,
        exported: isExported,
        isDefault: false,
        linesOfCode: loc,
        fieldCount: memberCount,
        commentDensity
      };
    }

    // Module/Namespace declaration
    if (ts.isModuleDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
      const endLine = this.getEndLine(node, sourceFile);
      const loc = endLine - line;
      
      return {
        name: node.name.text,
        kind: 'namespace',
        filePath,
        line: line + 1,
        endLine: endLine + 1,
        column: character + 1,
        exported: isExported,
        isDefault: false,
        linesOfCode: loc,
        commentDensity
      };
    }

    return null;
  }

  /**
   * Get the ending line of a node
   */
  private getEndLine(node: ts.Node, sourceFile: ts.SourceFile): number {
    try {
      const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
      return end.line;
    } catch {
      return 0;
    }
  }

  /**
   * Analyze an interface to count method signatures and properties
   */
  private analyzeInterface(node: ts.InterfaceDeclaration): { methodCount: number; fieldCount: number } {
    let methodCount = 0;
    let fieldCount = 0;
    
    for (const member of node.members || []) {
      if (ts.isMethodSignature(member) || ts.isCallSignatureDeclaration(member)) {
        methodCount++;
      } else if (ts.isPropertySignature(member)) {
        fieldCount++;
      }
    }
    
    return { methodCount, fieldCount };
  }

  /**
   * Get basic inheritance depth (counts extends clauses)
   */
  private getInheritanceDepth(node: ts.ClassDeclaration): number {
    // Note: Full inheritance depth requires type resolution
    // This just checks if the class extends something
    if (node.heritageClauses) {
      for (const clause of node.heritageClauses) {
        if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
          return 1; // Has parent class
        }
      }
    }
    return 0;
  }

  /**
   * Check if node has export modifier
   */
  private hasExportModifier(node: ts.Node): boolean {
    try {
      if (!ts.canHaveModifiers(node)) return false;
      
      const modifiers = ts.getModifiers(node);
      if (!modifiers) return false;
      
      return modifiers.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
    } catch {
      return false;
    }
  }

  /**
   * Check if node has default modifier
   */
  private hasDefaultModifier(node: ts.Node): boolean {
    try {
      if (!ts.canHaveModifiers(node)) return false;
      
      const modifiers = ts.getModifiers(node);
      if (!modifiers) return false;
      
      return modifiers.some(m => m.kind === ts.SyntaxKind.DefaultKeyword);
    } catch {
      return false;
    }
  }

  /**
   * Detect if a function is a React hook or component
   */
  private detectReactHookOrComponent(name: string, isTsx: boolean): SymbolKind {
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
   * Check if a node has a JSDoc comment
   */
  hasJsDocComment(node: ts.Node): boolean {
    const jsDocTags = ts.getJSDocTags(node);
    if (jsDocTags && jsDocTags.length > 0) return true;
    
    // Also check for /** */ style comments without tags
    const sourceFile = node.getSourceFile();
    const fullText = sourceFile.getFullText();
    const nodeStart = node.getFullStart();
    const leadingComments = ts.getLeadingCommentRanges(fullText, nodeStart);
    
    if (leadingComments) {
      for (const comment of leadingComments) {
        const commentText = fullText.slice(comment.pos, comment.end);
        if (commentText.startsWith('/**')) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Get constructor parameter count for a class
   */
  getConstructorParamCount(node: ts.ClassDeclaration): number {
    for (const member of node.members || []) {
      if (ts.isConstructorDeclaration(member)) {
        return member.parameters?.length || 0;
      }
    }
    return 0;
  }

  /**
   * Count interfaces implemented by a class
   */
  getImplementsCount(node: ts.ClassDeclaration): number {
    if (!node.heritageClauses) return 0;
    
    let count = 0;
    for (const clause of node.heritageClauses) {
      if (clause.token === ts.SyntaxKind.ImplementsKeyword) {
        count += clause.types.length;
      }
    }
    return count;
  }

  /**
   * Check if a class is abstract
   */
  isAbstractClass(node: ts.ClassDeclaration): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    return modifiers?.some(m => m.kind === ts.SyntaxKind.AbstractKeyword) || false;
  }

  /**
   * Count methods with override modifier
   */
  getOverrideCount(node: ts.ClassDeclaration): number {
    let count = 0;
    for (const member of node.members || []) {
      if (ts.isMethodDeclaration(member) || ts.isPropertyDeclaration(member)) {
        const modifiers = ts.canHaveModifiers(member) ? ts.getModifiers(member) : undefined;
        if (modifiers?.some(m => m.kind === ts.SyntaxKind.OverrideKeyword)) {
          count++;
        }
      }
    }
    return count;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStatistics {
    return { ...this.stats };
  }
}
