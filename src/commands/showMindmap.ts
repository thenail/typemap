/**
 * Show Mindmap Command
 * Opens the mindmap visualization webview
 */

import * as vscode from 'vscode';
import { TypeMapConfig, MindmapGraph, ExtensionMessage, WebviewMessage, SerializedGraph } from '../types';

export class ShowMindmapCommand {
  private context: vscode.ExtensionContext;
  private config: TypeMapConfig;
  private panel: vscode.WebviewPanel | null = null;
  private currentGraph: MindmapGraph | null = null;

  constructor(context: vscode.ExtensionContext, config: TypeMapConfig) {
    this.context = context;
    this.config = config;
  }

  /**
   * Execute the show mindmap command
   */
  async execute(graph?: MindmapGraph): Promise<void> {
    if (graph) {
      this.currentGraph = graph;
    }

    if (this.panel) {
      // If panel exists, reveal it
      this.panel.reveal(vscode.ViewColumn.One);
    } else {
      // Create new panel
      this.panel = vscode.window.createWebviewPanel(
        'typemapMindmap',
        'TypeMap Mindmap',
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            vscode.Uri.joinPath(this.context.extensionUri, 'media'),
            vscode.Uri.joinPath(this.context.extensionUri, 'dist')
          ]
        }
      );

      // Set HTML content
      this.panel.webview.html = this.getWebviewContent();

      // Handle messages from webview
      this.panel.webview.onDidReceiveMessage(
        message => this.handleWebviewMessage(message),
        undefined,
        this.context.subscriptions
      );

      // Handle panel disposal
      this.panel.onDidDispose(
        () => {
          this.panel = null;
        },
        undefined,
        this.context.subscriptions
      );

      // Handle theme changes
      this.context.subscriptions.push(
        vscode.window.onDidChangeActiveColorTheme(theme => {
          this.sendMessage({
            type: 'themeChanged',
            theme: theme.kind === vscode.ColorThemeKind.Dark ? 'dark' : 'light'
          });
        })
      );
    }

    // Send graph data once webview is ready
    if (this.currentGraph) {
      // Wait for webview to signal ready
      // The init message will be sent in handleWebviewMessage
    }
  }

  /**
   * Update the visualization with new graph data
   */
  updateGraph(graph: MindmapGraph): void {
    this.currentGraph = graph;
    
    if (this.panel) {
      this.sendMessage({
        type: 'init',
        data: this.serializeGraph(graph)
      });
    }
  }

  /**
   * Highlight specific nodes in the visualization
   */
  highlightNodes(nodeIds: string[]): void {
    if (this.panel) {
      this.sendMessage({
        type: 'highlight',
        nodeIds
      });
    }
  }

  /**
   * Show progress in the visualization
   */
  showProgress(percent: number, message: string): void {
    if (this.panel) {
      this.sendMessage({
        type: 'progress',
        percent,
        message
      });
    }
  }

  /**
   * Handle messages from the webview
   */
  private async handleWebviewMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        // Webview is ready, send initial data
        if (this.currentGraph) {
          this.sendMessage({
            type: 'init',
            data: this.serializeGraph(this.currentGraph)
          });
        }
        break;

      case 'nodeClick':
        await this.handleNodeClick(message.nodeId);
        break;

      case 'nodeExpand':
        await this.handleNodeExpand(message.nodeId);
        break;

      case 'nodeCollapse':
        this.handleNodeCollapse(message.nodeId);
        break;

      case 'search':
        this.handleSearch(message.query);
        break;

      case 'export':
        await this.handleExport(message.format);
        break;

      case 'layoutChange':
        this.handleLayoutChange(message.layout);
        break;
    }
  }

  /**
   * Handle node click - navigate to file
   */
  private async handleNodeClick(nodeId: string): Promise<void> {
    if (!this.currentGraph) return;

    const node = this.currentGraph.nodes.get(nodeId);
    if (!node || !node.filePath) return;

    try {
      const document = await vscode.workspace.openTextDocument(node.filePath);
      const editor = await vscode.window.showTextDocument(document, {
        preview: true,
        viewColumn: vscode.ViewColumn.Beside
      });

      // Navigate to specific line if available
      if (node.line !== undefined) {
        const position = new vscode.Position(node.line - 1, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
          new vscode.Range(position, position),
          vscode.TextEditorRevealType.InCenter
        );
      }
    } catch (error) {
      console.error('Failed to open file:', error);
    }
  }

  /**
   * Handle node expand - trigger deep analysis if needed
   */
  private async handleNodeExpand(nodeId: string): Promise<void> {
    if (!this.currentGraph) return;

    const node = this.currentGraph.nodes.get(nodeId);
    if (!node) return;

    // Update node state
    node.collapsed = false;

    // TODO: Trigger deep analysis if needed
    // For now, just send update
    this.sendMessage({
      type: 'update',
      data: {
        nodes: [[nodeId, node]]
      }
    });
  }

  /**
   * Handle node collapse
   */
  private handleNodeCollapse(nodeId: string): void {
    if (!this.currentGraph) return;

    const node = this.currentGraph.nodes.get(nodeId);
    if (!node) return;

    node.collapsed = true;

    this.sendMessage({
      type: 'update',
      data: {
        nodes: [[nodeId, node]]
      }
    });
  }

  /**
   * Handle search query
   */
  private handleSearch(query: string): void {
    if (!this.currentGraph || !query) {
      this.highlightNodes([]);
      return;
    }

    const lowerQuery = query.toLowerCase();
    const matchingIds: string[] = [];

    for (const [id, node] of this.currentGraph.nodes) {
      if (node.label.toLowerCase().includes(lowerQuery)) {
        matchingIds.push(id);
      }
    }

    this.highlightNodes(matchingIds);
  }

  /**
   * Handle export request
   */
  private async handleExport(format: 'svg' | 'png' | 'json'): Promise<void> {
    await vscode.commands.executeCommand(
      format === 'json' ? 'typemap.exportJSON' : 'typemap.exportSVG'
    );
  }

  /**
   * Handle layout algorithm change
   */
  private handleLayoutChange(layout: string): void {
    // Update config
    this.config.visualization.layout = layout as any;
    
    // Re-send graph with new layout
    if (this.currentGraph) {
      this.sendMessage({
        type: 'init',
        data: this.serializeGraph(this.currentGraph)
      });
    }
  }

  /**
   * Send message to webview
   */
  private sendMessage(message: ExtensionMessage): void {
    if (this.panel) {
      this.panel.webview.postMessage(message);
    }
  }

  /**
   * Serialize graph for transfer to webview
   */
  private serializeGraph(graph: MindmapGraph): SerializedGraph {
    return {
      nodes: Array.from(graph.nodes.entries()),
      edges: graph.edges,
      rootId: graph.rootId,
      statistics: graph.statistics
    };
  }

  /**
   * Generate webview HTML content
   */
  private getWebviewContent(): string {
    const nonce = this.getNonce();
    const theme = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark 
      ? 'dark' 
      : 'light';

    return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>TypeMap Mindmap</title>
  <style>
    :root {
      --bg-color: #ffffff;
      --text-color: #333333;
      --node-bg: #f0f0f0;
      --node-border: #cccccc;
      --edge-color: #999999;
      --highlight-color: #007acc;
    }

    [data-theme="dark"] {
      --bg-color: #1e1e1e;
      --text-color: #cccccc;
      --node-bg: #2d2d2d;
      --node-border: #404040;
      --edge-color: #666666;
      --highlight-color: #007acc;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      background-color: var(--bg-color);
      color: var(--text-color);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    #app {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px;
      background: var(--node-bg);
      border-bottom: 1px solid var(--node-border);
    }

    .toolbar input {
      flex: 1;
      max-width: 300px;
      padding: 6px 10px;
      border: 1px solid var(--node-border);
      border-radius: 4px;
      background: var(--bg-color);
      color: var(--text-color);
    }

    .toolbar select, .toolbar button {
      padding: 6px 12px;
      border: 1px solid var(--node-border);
      border-radius: 4px;
      background: var(--bg-color);
      color: var(--text-color);
      cursor: pointer;
    }

    .toolbar button:hover {
      background: var(--highlight-color);
      color: white;
    }

    #canvas-container {
      flex: 1;
      position: relative;
      overflow: hidden;
    }

    #mindmap-canvas {
      position: absolute;
      top: 0;
      left: 0;
    }

    .loading {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
    }

    .loading-spinner {
      width: 40px;
      height: 40px;
      border: 3px solid var(--node-border);
      border-top-color: var(--highlight-color);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .stats {
      font-size: 12px;
      color: var(--edge-color);
    }
  </style>
</head>
<body>
  <div id="app">
    <div class="toolbar">
      <input type="text" id="search" placeholder="Search nodes..." />
      <select id="layout">
        <option value="radial">Radial</option>
        <option value="tree">Tree</option>
        <option value="force-directed">Force Directed</option>
        <option value="cluster">Cluster</option>
      </select>
      <button id="export-svg">Export SVG</button>
      <button id="export-json">Export JSON</button>
      <span class="stats" id="stats"></span>
    </div>
    <div id="canvas-container">
      <canvas id="mindmap-canvas"></canvas>
      <div class="loading" id="loading">
        <div class="loading-spinner"></div>
        <p>Loading mindmap...</p>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();
      
      // Elements
      const canvas = document.getElementById('mindmap-canvas');
      const ctx = canvas.getContext('2d');
      const container = document.getElementById('canvas-container');
      const loading = document.getElementById('loading');
      const searchInput = document.getElementById('search');
      const layoutSelect = document.getElementById('layout');
      const statsEl = document.getElementById('stats');
      
      // State
      let graph = null;
      let viewport = { x: 0, y: 0, scale: 1 };
      let highlightedNodes = new Set();
      let isDragging = false;
      let lastMousePos = { x: 0, y: 0 };

      // Resize canvas
      function resizeCanvas() {
        const rect = container.getBoundingClientRect();
        canvas.width = rect.width * window.devicePixelRatio;
        canvas.height = rect.height * window.devicePixelRatio;
        canvas.style.width = rect.width + 'px';
        canvas.style.height = rect.height + 'px';
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        render();
      }

      // Render the mindmap
      function render() {
        if (!graph) return;

        const width = canvas.width / window.devicePixelRatio;
        const height = canvas.height / window.devicePixelRatio;

        ctx.clearRect(0, 0, width, height);
        ctx.save();
        ctx.translate(viewport.x + width / 2, viewport.y + height / 2);
        ctx.scale(viewport.scale, viewport.scale);

        // Render edges first
        ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--edge-color');
        ctx.lineWidth = 1;
        
        for (const edge of graph.edges) {
          const source = graph.nodePositions.get(edge.source);
          const target = graph.nodePositions.get(edge.target);
          if (source && target) {
            ctx.beginPath();
            ctx.moveTo(source.x, source.y);
            ctx.lineTo(target.x, target.y);
            ctx.stroke();
          }
        }

        // Render nodes
        for (const [id, node] of graph.nodes) {
          const pos = graph.nodePositions.get(id);
          if (!pos) continue;

          const isHighlighted = highlightedNodes.has(id);
          
          // Node background
          ctx.fillStyle = isHighlighted 
            ? getComputedStyle(document.body).getPropertyValue('--highlight-color')
            : getComputedStyle(document.body).getPropertyValue('--node-bg');
          
          const nodeWidth = Math.max(80, node.label.length * 7);
          const nodeHeight = 30;
          
          ctx.beginPath();
          ctx.roundRect(pos.x - nodeWidth / 2, pos.y - nodeHeight / 2, nodeWidth, nodeHeight, 5);
          ctx.fill();
          
          // Node border
          ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--node-border');
          ctx.stroke();
          
          // Node label
          ctx.fillStyle = isHighlighted 
            ? '#ffffff'
            : getComputedStyle(document.body).getPropertyValue('--text-color');
          ctx.font = '12px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(node.label, pos.x, pos.y, nodeWidth - 10);
        }

        ctx.restore();
      }

      // Simple radial layout
      function computeLayout(nodes, rootId) {
        const positions = new Map();
        const visited = new Set();
        
        function layoutNode(id, angle, radius, angleSpan) {
          if (visited.has(id)) return;
          visited.add(id);
          
          const node = nodes.get(id);
          if (!node) return;
          
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;
          positions.set(id, { x, y });
          
          const children = node.children.filter(c => !visited.has(c));
          if (children.length === 0) return;
          
          const childAngleSpan = angleSpan / children.length;
          const startAngle = angle - angleSpan / 2 + childAngleSpan / 2;
          
          children.forEach((childId, i) => {
            const childAngle = startAngle + i * childAngleSpan;
            layoutNode(childId, childAngle, radius + 100, childAngleSpan);
          });
        }
        
        positions.set(rootId, { x: 0, y: 0 });
        const rootNode = nodes.get(rootId);
        if (rootNode && rootNode.children.length > 0) {
          const angleSpan = (2 * Math.PI) / rootNode.children.length;
          rootNode.children.forEach((childId, i) => {
            layoutNode(childId, i * angleSpan, 100, angleSpan);
          });
        }
        
        return positions;
      }

      // Handle messages from extension
      window.addEventListener('message', event => {
        const message = event.data;
        
        switch (message.type) {
          case 'init':
            graph = {
              nodes: new Map(message.data.nodes),
              edges: message.data.edges,
              rootId: message.data.rootId,
              statistics: message.data.statistics,
              nodePositions: null
            };
            graph.nodePositions = computeLayout(graph.nodes, graph.rootId);
            loading.style.display = 'none';
            
            // Update stats
            statsEl.textContent = 
              \`\${graph.statistics.totalFiles} files | \${graph.statistics.totalSymbols} symbols | \${graph.statistics.analysisTimeMs}ms\`;
            
            render();
            break;
            
          case 'update':
            if (graph && message.data.nodes) {
              for (const [id, node] of message.data.nodes) {
                graph.nodes.set(id, node);
              }
              graph.nodePositions = computeLayout(graph.nodes, graph.rootId);
              render();
            }
            break;
            
          case 'highlight':
            highlightedNodes = new Set(message.nodeIds);
            render();
            break;
            
          case 'themeChanged':
            document.documentElement.setAttribute('data-theme', message.theme);
            render();
            break;
            
          case 'progress':
            loading.querySelector('p').textContent = message.message;
            break;
        }
      });

      // Mouse interactions
      canvas.addEventListener('mousedown', e => {
        isDragging = true;
        lastMousePos = { x: e.clientX, y: e.clientY };
      });

      canvas.addEventListener('mousemove', e => {
        if (isDragging) {
          viewport.x += e.clientX - lastMousePos.x;
          viewport.y += e.clientY - lastMousePos.y;
          lastMousePos = { x: e.clientX, y: e.clientY };
          render();
        }
      });

      canvas.addEventListener('mouseup', () => {
        isDragging = false;
      });

      canvas.addEventListener('wheel', e => {
        e.preventDefault();
        const scaleFactor = e.deltaY > 0 ? 0.9 : 1.1;
        viewport.scale *= scaleFactor;
        viewport.scale = Math.max(0.1, Math.min(3, viewport.scale));
        render();
      });

      canvas.addEventListener('dblclick', e => {
        if (!graph) return;
        
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left - rect.width / 2 - viewport.x) / viewport.scale;
        const y = (e.clientY - rect.top - rect.height / 2 - viewport.y) / viewport.scale;
        
        // Find clicked node
        for (const [id, node] of graph.nodes) {
          const pos = graph.nodePositions.get(id);
          if (!pos) continue;
          
          const nodeWidth = Math.max(80, node.label.length * 7);
          const nodeHeight = 30;
          
          if (x >= pos.x - nodeWidth / 2 && x <= pos.x + nodeWidth / 2 &&
              y >= pos.y - nodeHeight / 2 && y <= pos.y + nodeHeight / 2) {
            vscode.postMessage({ type: 'nodeClick', nodeId: id });
            break;
          }
        }
      });

      // UI interactions
      searchInput.addEventListener('input', e => {
        vscode.postMessage({ type: 'search', query: e.target.value });
      });

      layoutSelect.addEventListener('change', e => {
        vscode.postMessage({ type: 'layoutChange', layout: e.target.value });
      });

      document.getElementById('export-svg').addEventListener('click', () => {
        vscode.postMessage({ type: 'export', format: 'svg' });
      });

      document.getElementById('export-json').addEventListener('click', () => {
        vscode.postMessage({ type: 'export', format: 'json' });
      });

      // Initialize
      window.addEventListener('resize', resizeCanvas);
      resizeCanvas();
      
      // Signal ready
      vscode.postMessage({ type: 'ready' });
    })();
  </script>
</body>
</html>`;
  }

  /**
   * Generate a random nonce for CSP
   */
  private getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
