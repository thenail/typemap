/**
 * Single-Pass Metrics Collector
 * 
 * Collects all code metrics in a single AST traversal for optimal performance.
 * This consolidates multiple ts.forEachChild traversals into one efficient pass.
 */

import * as ts from 'typescript';

/**
 * All metrics collected from a single node traversal
 */
export interface NodeMetrics {
  // Complexity metrics
  cyclomaticComplexity: number;
  cognitiveComplexity: number;
  maxNestingDepth: number;
  
  // Control flow metrics
  returnCount: number;
  throwCount: number;
  
  // Async complexity metrics
  callbackDepth: number;
  promiseChainLength: number;
  
  // Structure metrics (for classes)
  methodCount: number;
  fieldCount: number;
  staticMethodCount: number;
  staticFieldCount: number;
  privateMethodCount: number;
  publicMethodCount: number;
  asyncMethodCount: number;
}

/**
 * File-level metrics collected from source file traversal
 */
export interface FileMetrics {
  importCount: number;
  todoCount: number;
  anyTypeCount: number;
  commentLineCount: number;
}

/**
 * State tracked during AST traversal
 */
interface TraversalState {
  // Complexity counters
  cyclomaticComplexity: number;
  cognitiveComplexity: number;
  
  // Nesting tracking
  currentNestingDepth: number;
  maxNestingDepth: number;
  cognitiveNestingLevel: number;
  
  // Control flow counters
  returnCount: number;
  throwCount: number;
  
  // Callback tracking
  currentCallbackDepth: number;
  maxCallbackDepth: number;
  
  // Promise chain tracking
  maxPromiseChainLength: number;
  
  // Track if we're inside a nested function (to not count nested returns/throws)
  insideNestedFunction: boolean;
}

/**
 * Single-pass metrics collector that gathers all metrics in one AST traversal
 */
export class MetricsCollector {
  /**
   * Collect all metrics for a function/method body in a single pass
   */
  collectNodeMetrics(node: ts.Node): NodeMetrics {
    const state: TraversalState = {
      cyclomaticComplexity: 1, // Base complexity
      cognitiveComplexity: 0,
      currentNestingDepth: 0,
      maxNestingDepth: 0,
      cognitiveNestingLevel: 0,
      returnCount: 0,
      throwCount: 0,
      currentCallbackDepth: 0,
      maxCallbackDepth: 0,
      maxPromiseChainLength: 0,
      insideNestedFunction: false
    };

    this.visitNode(node, state, false);
    
    // Also scan for promise chains
    const promiseChainLength = this.findMaxPromiseChainLength(node);

    return {
      cyclomaticComplexity: state.cyclomaticComplexity,
      cognitiveComplexity: state.cognitiveComplexity,
      maxNestingDepth: state.maxNestingDepth,
      returnCount: state.returnCount,
      throwCount: state.throwCount,
      callbackDepth: state.maxCallbackDepth,
      promiseChainLength: Math.max(state.maxPromiseChainLength, promiseChainLength),
      // These are not collected for function nodes
      methodCount: 0,
      fieldCount: 0,
      staticMethodCount: 0,
      staticFieldCount: 0,
      privateMethodCount: 0,
      publicMethodCount: 0,
      asyncMethodCount: 0
    };
  }

  /**
   * Collect all metrics for a class declaration in a single pass
   */
  collectClassMetrics(node: ts.ClassDeclaration): NodeMetrics {
    let methodCount = 0;
    let fieldCount = 0;
    let staticMethodCount = 0;
    let staticFieldCount = 0;
    let privateMethodCount = 0;
    let publicMethodCount = 0;
    let asyncMethodCount = 0;
    let totalComplexity = 1; // Base complexity for the class
    let totalCognitiveComplexity = 0;
    let maxNestingDepth = 0;
    let totalReturnCount = 0;
    let totalThrowCount = 0;
    let maxCallbackDepth = 0;
    let maxPromiseChainLength = 0;

    for (const member of node.members || []) {
      const modifiers = ts.canHaveModifiers(member) ? ts.getModifiers(member) : undefined;
      const isStatic = modifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword) || false;
      const isPrivate = modifiers?.some(m => m.kind === ts.SyntaxKind.PrivateKeyword) || false;
      const isAsync = modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) || false;

      if (ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member)) {
        methodCount++;
        
        // Collect metrics for this method in a single pass
        const methodMetrics = this.collectNodeMetrics(member);
        totalComplexity += methodMetrics.cyclomaticComplexity;
        totalCognitiveComplexity += methodMetrics.cognitiveComplexity;
        maxNestingDepth = Math.max(maxNestingDepth, methodMetrics.maxNestingDepth);
        totalReturnCount += methodMetrics.returnCount;
        totalThrowCount += methodMetrics.throwCount;
        maxCallbackDepth = Math.max(maxCallbackDepth, methodMetrics.callbackDepth);
        maxPromiseChainLength = Math.max(maxPromiseChainLength, methodMetrics.promiseChainLength);

        if (isStatic) staticMethodCount++;
        if (isPrivate) privateMethodCount++;
        else publicMethodCount++;
        if (isAsync) asyncMethodCount++;
      } else if (ts.isPropertyDeclaration(member)) {
        fieldCount++;
        if (isStatic) staticFieldCount++;
      } else if (ts.isGetAccessor(member) || ts.isSetAccessor(member)) {
        methodCount++;
        
        // Collect metrics for accessor
        const accessorMetrics = this.collectNodeMetrics(member);
        totalComplexity += accessorMetrics.cyclomaticComplexity;
        totalCognitiveComplexity += accessorMetrics.cognitiveComplexity;
        totalReturnCount += accessorMetrics.returnCount;
        maxCallbackDepth = Math.max(maxCallbackDepth, accessorMetrics.callbackDepth);
        maxPromiseChainLength = Math.max(maxPromiseChainLength, accessorMetrics.promiseChainLength);

        if (isStatic) staticMethodCount++;
        if (isPrivate) privateMethodCount++;
        else publicMethodCount++;
      }
    }

    return {
      cyclomaticComplexity: totalComplexity,
      cognitiveComplexity: totalCognitiveComplexity,
      maxNestingDepth,
      returnCount: totalReturnCount,
      throwCount: totalThrowCount,
      callbackDepth: maxCallbackDepth,
      promiseChainLength: maxPromiseChainLength,
      methodCount,
      fieldCount,
      staticMethodCount,
      staticFieldCount,
      privateMethodCount,
      publicMethodCount,
      asyncMethodCount
    };
  }

  /**
   * Collect file-level metrics in a single pass
   */
  collectFileMetrics(sourceFile: ts.SourceFile): FileMetrics {
    let importCount = 0;
    let anyTypeCount = 0;

    const visit = (node: ts.Node): void => {
      // Count imports
      if (ts.isImportDeclaration(node)) {
        importCount++;
      }

      // Count 'any' type usage
      if (ts.isTypeReferenceNode(node)) {
        if (ts.isIdentifier(node.typeName) && node.typeName.text === 'any') {
          anyTypeCount++;
        }
      }
      if (node.kind === ts.SyntaxKind.AnyKeyword) {
        anyTypeCount++;
      }

      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);

    // Count TODOs using regex (more efficient than AST for comments)
    const todoCount = this.countTodoComments(sourceFile);
    
    // Count comment lines
    const commentLineCount = this.countCommentLines(sourceFile);

    return {
      importCount,
      todoCount,
      anyTypeCount,
      commentLineCount
    };
  }

  /**
   * Single-pass visitor that collects complexity, nesting, and control flow metrics
   */
  private visitNode(node: ts.Node, state: TraversalState, isTopLevel: boolean): void {
    // Track callback depth: function passed as argument to a call
    const isCallbackFunction = this.isCallbackFunction(node);
    if (isCallbackFunction) {
      state.currentCallbackDepth++;
      state.maxCallbackDepth = Math.max(state.maxCallbackDepth, state.currentCallbackDepth);
    }

    // Track if we're entering a nested function
    const isNestedFunction = !isTopLevel && (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node)
    );

    if (isNestedFunction && !isCallbackFunction) {
      // For nested functions (not callbacks), don't count their returns/throws in parent's counts
      const savedInsideNested = state.insideNestedFunction;
      state.insideNestedFunction = true;
      
      // But do increase cognitive nesting
      state.cognitiveNestingLevel++;
      
      ts.forEachChild(node, child => this.visitNode(child, state, false));
      
      state.insideNestedFunction = savedInsideNested;
      state.cognitiveNestingLevel--;
      return;
    }

    // Track nesting depth for structural constructs
    let increasedNesting = false;
    let increasedCognitiveNesting = false;

    // === Cyclomatic Complexity ===
    switch (node.kind) {
      case ts.SyntaxKind.IfStatement:
      case ts.SyntaxKind.ForStatement:
      case ts.SyntaxKind.ForInStatement:
      case ts.SyntaxKind.ForOfStatement:
      case ts.SyntaxKind.WhileStatement:
      case ts.SyntaxKind.DoStatement:
      case ts.SyntaxKind.CaseClause:
      case ts.SyntaxKind.CatchClause:
      case ts.SyntaxKind.ConditionalExpression:
        state.cyclomaticComplexity++;
        break;
      case ts.SyntaxKind.BinaryExpression:
        const binary = node as ts.BinaryExpression;
        if (binary.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
            binary.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
            binary.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
          state.cyclomaticComplexity++;
        }
        break;
    }

    // === Cognitive Complexity ===
    switch (node.kind) {
      case ts.SyntaxKind.IfStatement:
        // Don't add nesting penalty for 'else if' chains
        const parent = node.parent;
        if (parent && ts.isIfStatement(parent) && parent.elseStatement === node) {
          state.cognitiveComplexity += 1; // Just 1 for else-if
        } else {
          state.cognitiveComplexity += 1 + state.cognitiveNestingLevel;
        }
        increasedCognitiveNesting = true;
        break;

      case ts.SyntaxKind.ForStatement:
      case ts.SyntaxKind.ForInStatement:
      case ts.SyntaxKind.ForOfStatement:
      case ts.SyntaxKind.WhileStatement:
      case ts.SyntaxKind.DoStatement:
      case ts.SyntaxKind.CatchClause:
      case ts.SyntaxKind.SwitchStatement:
        state.cognitiveComplexity += 1 + state.cognitiveNestingLevel;
        increasedCognitiveNesting = true;
        break;

      case ts.SyntaxKind.ConditionalExpression:
        state.cognitiveComplexity += 1 + state.cognitiveNestingLevel;
        break;

      case ts.SyntaxKind.BinaryExpression:
        const binaryExpr = node as ts.BinaryExpression;
        if (binaryExpr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
            binaryExpr.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
            binaryExpr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
          // Only count sequences of different operators
          const parentBinary = node.parent;
          if (!parentBinary || !ts.isBinaryExpression(parentBinary) ||
              parentBinary.operatorToken.kind !== binaryExpr.operatorToken.kind) {
            state.cognitiveComplexity += 1;
          }
        }
        break;
    }

    // === Nesting Depth ===
    if (ts.isIfStatement(node) ||
        ts.isForStatement(node) ||
        ts.isForInStatement(node) ||
        ts.isForOfStatement(node) ||
        ts.isWhileStatement(node) ||
        ts.isDoStatement(node) ||
        ts.isTryStatement(node) ||
        ts.isSwitchStatement(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node)) {
      state.currentNestingDepth++;
      state.maxNestingDepth = Math.max(state.maxNestingDepth, state.currentNestingDepth);
      increasedNesting = true;
    }

    // === Control Flow Metrics ===
    if (!state.insideNestedFunction) {
      if (ts.isReturnStatement(node)) {
        state.returnCount++;
      }
      if (ts.isThrowStatement(node)) {
        state.throwCount++;
      }
    }

    // Increase cognitive nesting before visiting children
    if (increasedCognitiveNesting) {
      state.cognitiveNestingLevel++;
    }

    // Visit children
    ts.forEachChild(node, child => this.visitNode(child, state, false));

    // Restore state after visiting children
    if (increasedNesting) {
      state.currentNestingDepth--;
    }
    if (increasedCognitiveNesting) {
      state.cognitiveNestingLevel--;
    }
    if (isCallbackFunction) {
      state.currentCallbackDepth--;
    }
  }

  /**
   * Check if a node is a callback function (function passed as argument)
   */
  private isCallbackFunction(node: ts.Node): boolean {
    if (!ts.isFunctionExpression(node) && !ts.isArrowFunction(node)) {
      return false;
    }
    
    const parent = node.parent;
    if (!parent) return false;
    
    // Direct argument to a call
    if (ts.isCallExpression(parent)) {
      return parent.arguments.includes(node as ts.Expression);
    }
    
    // Argument via property access (e.g., arr.forEach(() => {}))
    if (ts.isCallExpression(parent.parent)) {
      return parent.parent.arguments.includes(parent as ts.Expression);
    }
    
    return false;
  }

  /**
   * Find the maximum promise chain length in a node
   * Looks for patterns like: promise.then().catch().finally()
   */
  private findMaxPromiseChainLength(node: ts.Node): number {
    let maxLength = 0;
    
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const chainLength = this.measurePromiseChain(n);
        maxLength = Math.max(maxLength, chainLength);
      }
      ts.forEachChild(n, visit);
    };
    
    ts.forEachChild(node, visit);
    return maxLength;
  }

  /**
   * Measure the length of a promise chain starting from a call expression
   */
  private measurePromiseChain(node: ts.CallExpression): number {
    const promiseMethods = new Set(['then', 'catch', 'finally']);
    let length = 0;
    let current: ts.Node = node;
    
    while (ts.isCallExpression(current)) {
      const expr = current.expression;
      if (ts.isPropertyAccessExpression(expr)) {
        const methodName = expr.name.text;
        if (promiseMethods.has(methodName)) {
          length++;
          current = expr.expression;
        } else {
          break;
        }
      } else {
        break;
      }
    }
    
    return length;
  }

  /**
   * Count TODO/FIXME/HACK/XXX comments using regex (more efficient for comments)
   */
  private countTodoComments(sourceFile: ts.SourceFile): number {
    const text = sourceFile.getFullText();
    const todoPattern = /\/\/\s*(TODO|FIXME|HACK|XXX|BUG|UNDONE)[\s:]/gi;
    const blockTodoPattern = /\/\*[\s\S]*?(TODO|FIXME|HACK|XXX|BUG|UNDONE)[\s\S]*?\*\//gi;

    const lineMatches = text.match(todoPattern) || [];
    const blockMatches = text.match(blockTodoPattern) || [];

    return lineMatches.length + blockMatches.length;
  }

  /**
   * Count comment lines using TypeScript scanner
   */
  private countCommentLines(sourceFile: ts.SourceFile): number {
    const fullText = sourceFile.getFullText();
    let commentLines = 0;

    const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, fullText);

    while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) {
      const kind = scanner.getToken();
      if (kind === ts.SyntaxKind.SingleLineCommentTrivia) {
        commentLines++;
      } else if (kind === ts.SyntaxKind.MultiLineCommentTrivia) {
        const commentText = scanner.getTokenText();
        commentLines += commentText.split('\n').length;
      }
    }

    return commentLines;
  }
}

// Singleton instance for reuse
let metricsCollectorInstance: MetricsCollector | null = null;

/**
 * Get the metrics collector singleton
 */
export function getMetricsCollector(): MetricsCollector {
  if (!metricsCollectorInstance) {
    metricsCollectorInstance = new MetricsCollector();
  }
  return metricsCollectorInstance;
}
