/**
 * Mindmap Webview Panel
 * 
 * Creates and manages a VS Code webview panel that displays
 * the codebase visualization using D3.js
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { MindmapGraph, MindmapNode } from '../types';

export class MindmapPanel {
  public static currentPanel: MindmapPanel | undefined;
  private static readonly viewType = 'typemapMindmap';

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    // Set up message handling from webview
    this.panel.webview.onDidReceiveMessage(
      message => this.handleMessage(message),
      null,
      this.disposables
    );

    // Handle panel disposal
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  /**
   * Create or show the mindmap panel
   */
  public static createOrShow(extensionUri: vscode.Uri, graph?: MindmapGraph): MindmapPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If panel exists, reveal it
    if (MindmapPanel.currentPanel) {
      MindmapPanel.currentPanel.panel.reveal(column);
      if (graph) {
        MindmapPanel.currentPanel.updateGraph(graph);
      }
      return MindmapPanel.currentPanel;
    }

    // Create new panel
    const panel = vscode.window.createWebviewPanel(
      MindmapPanel.viewType,
      'TypeMap: Codebase Mindmap',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'media'),
          vscode.Uri.joinPath(extensionUri, 'node_modules')
        ]
      }
    );

    MindmapPanel.currentPanel = new MindmapPanel(panel, extensionUri);
    
    // Set initial HTML content
    panel.webview.html = MindmapPanel.currentPanel.getHtmlContent();

    // Send initial graph data if provided
    if (graph) {
      // Wait for webview to signal it's ready, then send data
      MindmapPanel.currentPanel.pendingGraph = graph;
    }

    return MindmapPanel.currentPanel;
  }

  private pendingGraph: MindmapGraph | null = null;

  /**
   * Called when webview signals it's ready
   */
  private onWebviewReady(): void {
    if (this.pendingGraph) {
      this.updateGraph(this.pendingGraph);
      this.pendingGraph = null;
    }
  }

  /**
   * Update the visualization with new graph data
   */
  public updateGraph(graph: MindmapGraph): void {
    // Convert graph to hierarchical format for D3
    const hierarchyData = this.convertToHierarchy(graph);
    
    this.panel.webview.postMessage({
      type: 'updateGraph',
      data: hierarchyData,
      statistics: graph.statistics
    });
  }

  /**
   * Convert flat graph to D3 hierarchical format
   */
  private convertToHierarchy(graph: MindmapGraph): any {
    // Find root node (or create one)
    const rootNode = Array.from(graph.nodes.values()).find(n => n.type === 'root');
    
    if (!rootNode) {
      // Create a virtual root from folders
      return this.buildHierarchyFromNodes(graph);
    }

    return this.buildHierarchyFromRoot(graph, rootNode);
  }

  /**
   * Build hierarchy starting from root node
   */
  private buildHierarchyFromRoot(graph: MindmapGraph, root: MindmapNode): any {
    const buildNode = (node: MindmapNode): any => {
      const children = node.children
        .map(childId => graph.nodes.get(childId))
        .filter((child): child is MindmapNode => child !== undefined)
        .map(child => buildNode(child));

      // Calculate size: sum of children sizes, or use linesOfCode, or 1 for leaf nodes
      const size = children.length > 0 
        ? children.reduce((sum, c) => sum + (c.size || 1), 0)
        : (node.metadata?.linesOfCode || 1);

      return {
        id: node.id,
        name: node.label,
        type: node.type,
        filePath: node.filePath,
        line: node.line,
        gitStatus: node.metadata?.gitStatus,
        // Metrics
        linesOfCode: node.metadata?.linesOfCode,
        complexity: node.metadata?.complexity,
        cognitiveComplexity: node.metadata?.cognitiveComplexity,
        methodCount: node.metadata?.methodCount,
        fieldCount: node.metadata?.fieldCount,
        parameterCount: node.metadata?.parameterCount,
        maxNestingDepth: node.metadata?.maxNestingDepth,
        inheritanceDepth: node.metadata?.inheritanceDepth,
        staticMethodCount: node.metadata?.staticMethodCount,
        staticFieldCount: node.metadata?.staticFieldCount,
        privateMethodCount: node.metadata?.privateMethodCount,
        publicMethodCount: node.metadata?.publicMethodCount,
        asyncMethodCount: node.metadata?.asyncMethodCount,
        todoCount: node.metadata?.todoCount,
        anyTypeCount: node.metadata?.anyTypeCount,
        returnCount: node.metadata?.returnCount,
        throwCount: node.metadata?.throwCount,
        hasJsDoc: node.metadata?.hasJsDoc,
        constructorParamCount: node.metadata?.constructorParamCount,
        implementsCount: node.metadata?.implementsCount,
        children: children.length > 0 ? children : undefined,
        value: children.length || 1,
        size: size
      };
    };

    return buildNode(root);
  }

  /**
   * Build hierarchy from flat nodes (when no root exists)
   */
  private buildHierarchyFromNodes(graph: MindmapGraph): any {
    // Group by file
    const fileGroups = new Map<string, MindmapNode[]>();
    
    for (const node of graph.nodes.values()) {
      if (node.type !== 'file' && node.type !== 'folder' && node.filePath) {
        const existing = fileGroups.get(node.filePath) || [];
        existing.push(node);
        fileGroups.set(node.filePath, existing);
      }
    }

    // Build nested folder hierarchy
    const root: any = {
      name: 'Project',
      type: 'root',
      children: [],
      size: 0
    };

    // Helper to get or create nested folder path
    const getOrCreateFolder = (pathParts: string[]): any => {
      let current = root;
      for (let i = 0; i < pathParts.length; i++) {
        const part = pathParts[i];
        let folder = current.children.find((c: any) => c.type === 'folder' && c.name === part);
        if (!folder) {
          folder = {
            id: pathParts.slice(0, i + 1).join('/'),
            name: part,
            type: 'folder',
            children: [],
            size: 0
          };
          current.children.push(folder);
        }
        current = folder;
      }
      return current;
    };

    // Add files to their folders
    for (const [filePath, symbols] of fileGroups) {
      const parts = filePath.split(/[/\\]/);
      const fileName = parts.pop() || filePath;
      const folderParts = parts.filter(p => p && p !== '');
      
      const folder = folderParts.length > 0 ? getOrCreateFolder(folderParts) : root;
      
      const fileChildren = symbols.map(s => ({
        id: s.id,
        name: s.label,
        type: s.type,
        filePath: s.filePath,
        line: s.line,
        gitStatus: s.metadata?.gitStatus,
        value: 1,
        size: 1
      }));
      
      folder.children.push({
        name: fileName,
        type: 'file',
        filePath,
        children: fileChildren,
        size: fileChildren.length || 1
      });
    }

    // Recursively calculate sizes (sum of all descendants)
    const calculateSize = (node: any): number => {
      if (!node.children || node.children.length === 0) {
        node.size = 1;
        return 1;
      }
      
      let totalSize = 0;
      for (const child of node.children) {
        totalSize += calculateSize(child);
      }
      node.size = totalSize;
      return totalSize;
    };

    calculateSize(root);
    return root;
  }

  /**
   * Handle messages from webview
   */
  private handleMessage(message: any): void {
    switch (message.type) {
      case 'navigateToFile':
        this.navigateToFile(message.filePath, message.line);
        break;
      case 'revealInExplorer':
        this.revealFolderInExplorer(message.folderPath);
        break;
      case 'nodeClicked':
        break;
      case 'ready':
        this.onWebviewReady();
        break;
    }
  }

  /**
   * Navigate to a file in the editor
   */
  private async navigateToFile(filePath: string, line?: number): Promise<void> {
    try {
      const uri = vscode.Uri.file(filePath);
      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.One,
        preserveFocus: false
      });

      if (line && line > 0) {
        const position = new vscode.Position(line - 1, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Could not open file: ${filePath}`);
    }
  }

  /**
   * Reveal a folder in the file explorer
   */
  private async revealFolderInExplorer(folderPath: string): Promise<void> {
    try {
      // Try to construct full path if it's relative
      let fullPath = folderPath;
      if (!path.isAbsolute(folderPath) && vscode.workspace.workspaceFolders?.[0]) {
        fullPath = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, folderPath);
      }
      
      const uri = vscode.Uri.file(fullPath);
      
      // Reveal the folder in the explorer and expand it
      await vscode.commands.executeCommand('revealInExplorer', uri);
    } catch (error) {
      // Fallback: just focus the explorer
      vscode.commands.executeCommand('workbench.view.explorer');
    }
  }

  /**
   * Generate HTML content for the webview
   */
  private getHtmlContent(): string {
    const nonce = this.getNonce();
    
    // Get URIs for external resources
    const styleUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'mindmap.css')
    );
    const d3Uri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'd3-minimal.js')
    );
    const appUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'mindmap-app.js')
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource} 'unsafe-inline'; script-src ${this.panel.webview.cspSource} 'nonce-${nonce}' 'unsafe-eval'; img-src data:;">
  <title>TypeMap Mindmap</title>
  <link rel="stylesheet" href="${styleUri}">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
      background: var(--vscode-editor-background, #1e1e1e);
      color: var(--vscode-editor-foreground, #d4d4d4);
      overflow: hidden;
      width: 100vw;
      height: 100vh;
    }

    #container {
      width: 100%;
      height: 100%;
      position: relative;
    }

    #mindmap {
      width: 100%;
      height: 100%;
    }

    #controls {
      position: absolute;
      top: 10px;
      left: 10px;
      z-index: 100;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    button {
      padding: 6px 12px;
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #fff);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }

    button:hover {
      background: var(--vscode-button-hoverBackground, #1177bb);
    }

    button.active {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
    }

    #info {
      position: absolute;
      bottom: 10px;
      left: 10px;
      background: var(--vscode-editor-background, #1e1e1e);
      border: 1px solid var(--vscode-panel-border, #454545);
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 12px;
      max-width: 300px;
    }

    #tooltip {
      position: absolute;
      background: var(--vscode-editorWidget-background, #252526);
      border: 1px solid var(--vscode-editorWidget-border, #454545);
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 12px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s;
      z-index: 1000;
      max-width: 300px;
    }

    #tooltip.visible {
      opacity: 1;
    }

    .tooltip-title {
      font-weight: bold;
      margin-bottom: 4px;
    }

    .tooltip-type {
      color: var(--vscode-descriptionForeground, #808080);
      font-size: 11px;
    }

    .tooltip-metrics {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px solid var(--vscode-editorWidget-border, #454545);
      font-size: 10px;
    }

    .tooltip-metrics span {
      background: var(--vscode-badge-background, #3c3c3c);
      padding: 2px 6px;
      border-radius: 3px;
      color: var(--vscode-badge-foreground, #cccccc);
    }

    /* Node colors by type */
    .node-root { fill: #6c71c4; }
    .node-folder { fill: #b58900; }
    .node-file { fill: #268bd2; }
    .node-class { fill: #2aa198; }
    .node-interface { fill: #859900; }
    .node-function { fill: #cb4b16; }
    .node-type { fill: #d33682; }
    .node-enum { fill: #6c71c4; }
    .node-variable { fill: #93a1a1; }
    .node-component { fill: #2aa198; }
    .node-hook { fill: #859900; }

    /* Git status colors */
    .git-modified { stroke: #e2c08d; stroke-width: 3px; }
    .git-added { stroke: #89d185; stroke-width: 3px; }
    .git-deleted { stroke: #c74e39; stroke-width: 3px; }
    .git-untracked { stroke: #73c991; stroke-width: 3px; }

    .link {
      fill: none;
      stroke: var(--vscode-editorLineNumber-foreground, #5a5a5a);
      stroke-width: 1.5px;
    }

    .node text {
      fill: var(--vscode-editor-foreground, #d4d4d4);
      font-size: 11px;
      pointer-events: none;
    }

    .node circle {
      cursor: pointer;
      transition: r 0.2s;
    }

    .node {
      cursor: pointer;
      pointer-events: all;
    }

    .node circle:hover {
      r: 8;
    }

    #loading {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 16px;
      color: var(--vscode-descriptionForeground, #808080);
    }
  </style>
</head>
<body>
  <div id="container">
    <div id="controls">
      <button id="btn-radial" class="active">Radial Tree</button>
      <button id="btn-tree">Dendrogram</button>
      <button id="btn-force">Force Layout</button>
      <button id="btn-sunburst">Sunburst</button>
      <button id="btn-zoom-in">+</button>
      <button id="btn-zoom-out">-</button>
      <button id="btn-reset">Reset View</button>
    </div>
    <div id="mindmap"></div>
    <div id="tooltip"></div>
    <div id="info">
      <div>Nodes: <span id="node-count">0</span></div>
      <div id="stats-info"></div>
      <div>Click a node to navigate to code</div>
    </div>
    <div id="loading">Waiting for analysis data...</div>
  </div>

  <script nonce="${nonce}" src="${d3Uri}"></script>
  <script nonce="${nonce}" src="${appUri}"></script>
</body>
</html>`;
  }

  // Note: D3.js is now loaded from external file media/d3-minimal.js
  // The getD3Script() method has been removed as it's no longer needed.

  /**
   * Generate a nonce for script security
   */
  private getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  /**
   * Dispose panel resources
   */
  public dispose(): void {
    MindmapPanel.currentPanel = undefined;

    this.panel.dispose();

    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
