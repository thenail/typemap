/**
 * TypeScript Type Analyzer
 * 
 * On-demand deep type analysis using TypeScript Language Service.
 * Used for queries that require type information:
 * - Find all implementations of an interface
 * - Find all references
 * - Type hierarchy analysis
 * - Structural type matching
 * 
 * This is slower than SWC parsing but provides accurate type information.
 */

import * as ts from 'typescript';
import * as path from 'path';
import { LightweightSymbol, SymbolRelationship } from '../types';

export interface TypeAnalysisResult {
  implementations: ImplementationInfo[];
  references: ReferenceInfo[];
  typeHierarchy: TypeHierarchyNode;
}

export interface ImplementationInfo {
  symbol: LightweightSymbol;
  isExplicit: boolean; // implements keyword vs structural
  matchedMembers: string[];
}

export interface ReferenceInfo {
  filePath: string;
  line: number;
  column: number;
  kind: 'read' | 'write' | 'call' | 'type';
}

export interface TypeHierarchyNode {
  symbol: LightweightSymbol;
  extends?: TypeHierarchyNode;
  implements: TypeHierarchyNode[];
  implementedBy: TypeHierarchyNode[];
  extendedBy: TypeHierarchyNode[];
}

export class TypeAnalyzer {
  private program: ts.Program | null = null;
  private typeChecker: ts.TypeChecker | null = null;
  private languageService: ts.LanguageService | null = null;
  private files: Map<string, string> = new Map();
  private projectRoot: string = '';

  /**
   * Initialize the type analyzer with project files
   */
  async initialize(projectRoot: string, files: string[]): Promise<void> {
    this.projectRoot = projectRoot;

    // Find tsconfig.json
    const configPath = ts.findConfigFile(projectRoot, ts.sys.fileExists, 'tsconfig.json');
    
    let compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.Latest,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
      skipLibCheck: true,
      strict: false, // Disable for faster analysis
      noEmit: true,
    };

    if (configPath) {
      const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
      if (!configFile.error) {
        const parsed = ts.parseJsonConfigFileContent(
          configFile.config,
          ts.sys,
          path.dirname(configPath)
        );
        compilerOptions = { ...compilerOptions, ...parsed.options };
      }
    }

    // Create language service host
    const serviceHost: ts.LanguageServiceHost = {
      getScriptFileNames: () => files,
      getScriptVersion: (fileName) => '1',
      getScriptSnapshot: (fileName) => {
        if (this.files.has(fileName)) {
          return ts.ScriptSnapshot.fromString(this.files.get(fileName)!);
        }
        if (ts.sys.fileExists(fileName)) {
          const content = ts.sys.readFile(fileName) || '';
          this.files.set(fileName, content);
          return ts.ScriptSnapshot.fromString(content);
        }
        return undefined;
      },
      getCurrentDirectory: () => projectRoot,
      getCompilationSettings: () => compilerOptions,
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
    };

    this.languageService = ts.createLanguageService(serviceHost);
    this.program = this.languageService.getProgram() || null;
    this.typeChecker = this.program?.getTypeChecker() || null;
  }

  /**
   * Find all implementations of an interface or class
   */
  async findImplementations(symbolName: string, filePath: string): Promise<ImplementationInfo[]> {
    if (!this.program || !this.typeChecker) {
      throw new Error('TypeAnalyzer not initialized');
    }

    const implementations: ImplementationInfo[] = [];
    const sourceFile = this.program.getSourceFile(filePath);
    
    if (!sourceFile) {
      return implementations;
    }

    // Find the target symbol
    const targetSymbol = this.findSymbolByName(sourceFile, symbolName);
    if (!targetSymbol) {
      return implementations;
    }

    const targetType = this.typeChecker.getDeclaredTypeOfSymbol(targetSymbol);
    if (!targetType) {
      return implementations;
    }

    // Get members of the target interface/class
    const targetMembers = this.getTypeMembers(targetType);

    // Search all source files for implementations
    for (const sf of this.program.getSourceFiles()) {
      if (sf.isDeclarationFile) continue;

      this.findImplementationsInFile(sf, targetSymbol, targetType, targetMembers, implementations);
    }

    return implementations;
  }

  /**
   * Find implementations in a single file
   */
  private findImplementationsInFile(
    sourceFile: ts.SourceFile,
    targetSymbol: ts.Symbol,
    targetType: ts.Type,
    targetMembers: Set<string>,
    results: ImplementationInfo[]
  ): void {
    if (!this.typeChecker) return;

    const visit = (node: ts.Node): void => {
      // Check class declarations
      if (ts.isClassDeclaration(node) && node.name) {
        const classSymbol = this.typeChecker!.getSymbolAtLocation(node.name);
        if (classSymbol) {
          // Check explicit implements
          const isExplicit = this.hasExplicitImplements(node, targetSymbol);
          
          // Check structural compatibility
          const classType = this.typeChecker!.getDeclaredTypeOfSymbol(classSymbol);
          const isStructuralMatch = this.isStructurallyCompatible(classType, targetType, targetMembers);

          if (isExplicit || isStructuralMatch) {
            const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
            results.push({
              symbol: {
                name: node.name.text,
                kind: 'class',
                filePath: sourceFile.fileName,
                line: line + 1,
                column: character + 1,
                exported: this.isExported(node),
                isDefault: this.isDefault(node),
              },
              isExplicit,
              matchedMembers: Array.from(targetMembers),
            });
          }
        }
      }

      // Check variable declarations with object literals or classes
      if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
        const varType = this.typeChecker!.getTypeAtLocation(node.initializer);
        if (this.isStructurallyCompatible(varType, targetType, targetMembers)) {
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
          results.push({
            symbol: {
              name: node.name.text,
              kind: 'variable',
              filePath: sourceFile.fileName,
              line: line + 1,
              column: character + 1,
              exported: false,
              isDefault: false,
            },
            isExplicit: false,
            matchedMembers: Array.from(targetMembers),
          });
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  /**
   * Check if a class has explicit implements clause for target
   */
  private hasExplicitImplements(node: ts.ClassDeclaration, targetSymbol: ts.Symbol): boolean {
    if (!node.heritageClauses || !this.typeChecker) return false;

    for (const clause of node.heritageClauses) {
      if (clause.token === ts.SyntaxKind.ImplementsKeyword) {
        for (const type of clause.types) {
          const symbol = this.typeChecker.getSymbolAtLocation(type.expression);
          if (symbol === targetSymbol) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Check if type is structurally compatible with target
   */
  private isStructurallyCompatible(
    type: ts.Type,
    targetType: ts.Type,
    targetMembers: Set<string>
  ): boolean {
    if (!this.typeChecker) return false;

    // Get members of the candidate type
    const typeMembers = this.getTypeMembers(type);

    // Check if all target members exist in type
    for (const member of targetMembers) {
      if (!typeMembers.has(member)) {
        return false;
      }
    }

    return targetMembers.size > 0;
  }

  /**
   * Get member names of a type
   */
  private getTypeMembers(type: ts.Type): Set<string> {
    const members = new Set<string>();
    if (!this.typeChecker) return members;

    const properties = type.getProperties();
    for (const prop of properties) {
      members.add(prop.getName());
    }

    // Also check call signatures for function types
    const callSignatures = type.getCallSignatures();
    if (callSignatures.length > 0) {
      members.add('__call');
    }

    return members;
  }

  /**
   * Find a symbol by name in a source file
   */
  private findSymbolByName(sourceFile: ts.SourceFile, name: string): ts.Symbol | undefined {
    if (!this.typeChecker) return undefined;

    let result: ts.Symbol | undefined;

    const visit = (node: ts.Node): void => {
      if (result) return;

      if (ts.isInterfaceDeclaration(node) && node.name?.text === name) {
        result = this.typeChecker!.getSymbolAtLocation(node.name);
      }
      if (ts.isClassDeclaration(node) && node.name?.text === name) {
        result = this.typeChecker!.getSymbolAtLocation(node.name);
      }
      if (ts.isTypeAliasDeclaration(node) && node.name?.text === name) {
        result = this.typeChecker!.getSymbolAtLocation(node.name);
      }

      if (!result) {
        ts.forEachChild(node, visit);
      }
    };

    visit(sourceFile);
    return result;
  }

  /**
   * Find all references to a symbol
   */
  async findReferences(symbolName: string, filePath: string, line: number): Promise<ReferenceInfo[]> {
    if (!this.languageService) {
      throw new Error('TypeAnalyzer not initialized');
    }

    const sourceFile = this.program?.getSourceFile(filePath);
    if (!sourceFile) {
      return [];
    }

    // Find position from line
    const position = sourceFile.getPositionOfLineAndCharacter(line - 1, 0);

    // Find the symbol at position
    const references = this.languageService.findReferences(filePath, position);
    if (!references) {
      return [];
    }

    const results: ReferenceInfo[] = [];

    for (const refSet of references) {
      for (const ref of refSet.references) {
        const refSourceFile = this.program?.getSourceFile(ref.fileName);
        if (refSourceFile) {
          const { line: refLine, character } = refSourceFile.getLineAndCharacterOfPosition(ref.textSpan.start);
          results.push({
            filePath: ref.fileName,
            line: refLine + 1,
            column: character + 1,
            kind: ref.isWriteAccess ? 'write' : 'read',
          });
        }
      }
    }

    return results;
  }

  /**
   * Build type hierarchy for a symbol
   */
  async getTypeHierarchy(symbolName: string, filePath: string): Promise<TypeHierarchyNode | null> {
    if (!this.program || !this.typeChecker) {
      throw new Error('TypeAnalyzer not initialized');
    }

    const sourceFile = this.program.getSourceFile(filePath);
    if (!sourceFile) {
      return null;
    }

    const targetSymbol = this.findSymbolByName(sourceFile, symbolName);
    if (!targetSymbol) {
      return null;
    }

    const decl = targetSymbol.declarations?.[0];
    if (!decl) {
      return null;
    }

    const { line, character } = sourceFile.getLineAndCharacterOfPosition(decl.getStart());

    const root: TypeHierarchyNode = {
      symbol: {
        name: symbolName,
        kind: ts.isClassDeclaration(decl) ? 'class' : 'interface',
        filePath,
        line: line + 1,
        column: character + 1,
        exported: this.isExported(decl),
        isDefault: this.isDefault(decl),
      },
      implements: [],
      implementedBy: [],
      extendedBy: [],
    };

    // Find extends and implements
    if (ts.isClassDeclaration(decl) || ts.isInterfaceDeclaration(decl)) {
      const heritageClauses = decl.heritageClauses;
      if (heritageClauses) {
        for (const clause of heritageClauses) {
          for (const type of clause.types) {
            const symbol = this.typeChecker.getSymbolAtLocation(type.expression);
            if (symbol) {
              const childNode = await this.buildHierarchyNode(symbol);
              if (childNode) {
                if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
                  root.extends = childNode;
                } else {
                  root.implements.push(childNode);
                }
              }
            }
          }
        }
      }
    }

    // Find implementedBy (classes that implement this interface)
    const implementations = await this.findImplementations(symbolName, filePath);
    for (const impl of implementations) {
      root.implementedBy.push({
        symbol: impl.symbol,
        implements: [],
        implementedBy: [],
        extendedBy: [],
      });
    }

    return root;
  }

  /**
   * Build a hierarchy node for a symbol
   */
  private async buildHierarchyNode(symbol: ts.Symbol): Promise<TypeHierarchyNode | null> {
    const decl = symbol.declarations?.[0];
    if (!decl) return null;

    const sourceFile = decl.getSourceFile();
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(decl.getStart());

    return {
      symbol: {
        name: symbol.getName(),
        kind: ts.isClassDeclaration(decl) ? 'class' : 'interface',
        filePath: sourceFile.fileName,
        line: line + 1,
        column: character + 1,
        exported: this.isExported(decl),
        isDefault: this.isDefault(decl),
      },
      implements: [],
      implementedBy: [],
      extendedBy: [],
    };
  }

  /**
   * Check if node is exported
   */
  private isExported(node: ts.Node): boolean {
    if (!ts.canHaveModifiers(node)) return false;
    const modifiers = ts.getModifiers(node);
    return modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  }

  /**
   * Check if node has default modifier
   */
  private isDefault(node: ts.Node): boolean {
    if (!ts.canHaveModifiers(node)) return false;
    const modifiers = ts.getModifiers(node);
    return modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.languageService?.dispose();
    this.languageService = null;
    this.program = null;
    this.typeChecker = null;
    this.files.clear();
  }
}
