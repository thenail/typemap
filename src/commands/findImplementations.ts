/**
 * Find Implementations Command
 * 
 * Finds all implementations of an interface or class using
 * TypeScript Language Service for deep type analysis.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { TypeAnalyzer, ImplementationInfo } from '../analysis/typeAnalyzer';
import { FileDiscovery } from '../analysis/fileDiscovery';
import { TypeMapConfig } from '../types';

export class FindImplementationsCommand {
  private context: vscode.ExtensionContext;
  private config: TypeMapConfig;
  private typeAnalyzer: TypeAnalyzer | null = null;
  private isInitialized = false;
  private projectFiles: string[] = [];

  constructor(context: vscode.ExtensionContext, config: TypeMapConfig) {
    this.context = context;
    this.config = config;
  }

  /**
   * Execute find implementations command
   */
  async execute(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    
    if (!editor) {
      vscode.window.showErrorMessage('TypeMap: No active editor');
      return;
    }

    const document = editor.document;
    const position = editor.selection.active;
    
    // Get the word at cursor position
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) {
      vscode.window.showErrorMessage('TypeMap: No symbol at cursor position');
      return;
    }

    const symbolName = document.getText(wordRange);
    const filePath = document.uri.fsPath;

    await this.findImplementations(symbolName, filePath);
  }

  /**
   * Find implementations for a symbol by name
   */
  async findImplementations(symbolName: string, filePath: string): Promise<void> {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `TypeMap: Finding implementations of "${symbolName}"`,
        cancellable: true
      },
      async (progress, token) => {
        try {
          // Initialize analyzer if needed
          if (!this.isInitialized) {
            progress.report({ message: 'Initializing type analyzer...' });
            await this.initializeAnalyzer();
          }

          if (token.isCancellationRequested) {
            return;
          }

          if (!this.typeAnalyzer) {
            vscode.window.showErrorMessage('TypeMap: Failed to initialize type analyzer');
            return;
          }

          // Find implementations
          progress.report({ message: 'Searching for implementations...' });
          const implementations = await this.typeAnalyzer.findImplementations(symbolName, filePath);

          if (token.isCancellationRequested) {
            return;
          }

          // Show results
          await this.showResults(symbolName, implementations);

        } catch (error) {
          vscode.window.showErrorMessage(`TypeMap: Error finding implementations: ${error}`);
        }
      }
    );
  }

  /**
   * Initialize the type analyzer with project files
   */
  private async initializeAnalyzer(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    
    if (!workspaceFolders || workspaceFolders.length === 0) {
      throw new Error('No workspace folder open');
    }

    const rootPath = workspaceFolders[0].uri.fsPath;

    // Discover project files
    const discovery = new FileDiscovery({
      rootPath,
      include: this.config.analysis.include,
      exclude: this.config.analysis.exclude,
      maxDepth: 50,
      maxFiles: this.config.analysis.maxFiles,
      useGitignore: true
    });

    const result = await discovery.discover();
    this.projectFiles = result.files;

    // Initialize type analyzer
    this.typeAnalyzer = new TypeAnalyzer();
    await this.typeAnalyzer.initialize(rootPath, this.projectFiles);
    this.isInitialized = true;
  }

  /**
   * Show implementation results to user
   */
  private async showResults(symbolName: string, implementations: ImplementationInfo[]): Promise<void> {
    if (implementations.length === 0) {
      vscode.window.showInformationMessage(`TypeMap: No implementations found for "${symbolName}"`);
      return;
    }

    // Create quick pick items
    interface ImplementationItem extends vscode.QuickPickItem {
      implementation: ImplementationInfo;
    }

    const items: ImplementationItem[] = implementations.map(impl => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      const rootPath = workspaceFolders?.[0]?.uri.fsPath || '';
      const relativePath = path.relative(rootPath, impl.symbol.filePath);
      
      return {
        label: `$(symbol-class) ${impl.symbol.name}`,
        description: impl.isExplicit ? 'explicit' : 'structural',
        detail: `${relativePath}:${impl.symbol.line}`,
        implementation: impl
      };
    });

    // Show quick pick
    const selected = await vscode.window.showQuickPick(items, {
      title: `Implementations of "${symbolName}" (${implementations.length} found)`,
      placeHolder: 'Select an implementation to navigate to',
      matchOnDescription: true,
      matchOnDetail: true
    });

    if (selected) {
      // Navigate to the selected implementation
      const uri = vscode.Uri.file(selected.implementation.symbol.filePath);
      const position = new vscode.Position(
        selected.implementation.symbol.line - 1,
        selected.implementation.symbol.column - 1
      );
      
      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document);
      
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(
        new vscode.Range(position, position),
        vscode.TextEditorRevealType.InCenter
      );
    }
  }

  /**
   * Invalidate analyzer cache (call when files change)
   */
  invalidate(): void {
    if (this.typeAnalyzer) {
      this.typeAnalyzer.dispose();
      this.typeAnalyzer = null;
    }
    this.isInitialized = false;
    this.projectFiles = [];
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.invalidate();
  }
}
