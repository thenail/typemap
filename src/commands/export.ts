/**
 * Export Command
 * Handles exporting mindmap data to various formats
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { MindmapGraph, SerializedGraph } from '../types';

export class ExportCommand {
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /**
   * Execute export command
   */
  async execute(format: 'svg' | 'json'): Promise<void> {
    // Get current graph from workspace state or analyze command
    const lastAnalysis = this.context.workspaceState.get<any>('typemap.lastAnalysis');
    
    if (!lastAnalysis) {
      vscode.window.showWarningMessage('TypeMap: No analysis data to export. Run analysis first.');
      return;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('TypeMap: No workspace folder open');
      return;
    }

    const defaultFileName = `typemap-export-${Date.now()}.${format}`;
    const defaultUri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, defaultFileName));

    const saveUri = await vscode.window.showSaveDialog({
      defaultUri,
      filters: format === 'json' 
        ? { 'JSON': ['json'] }
        : { 'SVG': ['svg'] }
    });

    if (!saveUri) {
      return; // User cancelled
    }

    try {
      if (format === 'json') {
        await this.exportJSON(saveUri);
      } else {
        await this.exportSVG(saveUri);
      }
      
      vscode.window.showInformationMessage(`TypeMap: Exported to ${saveUri.fsPath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`TypeMap: Export failed - ${message}`);
    }
  }

  /**
   * Export graph data as JSON
   */
  private async exportJSON(uri: vscode.Uri): Promise<void> {
    const graphData = this.context.workspaceState.get<any>('typemap.graphData');
    
    if (!graphData) {
      // Create placeholder structure
      const placeholder = {
        exportedAt: new Date().toISOString(),
        version: '1.0',
        nodes: [],
        edges: [],
        statistics: {
          totalNodes: 0,
          totalEdges: 0,
          totalFiles: 0,
          totalSymbols: 0
        }
      };
      
      const content = JSON.stringify(placeholder, null, 2);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
      return;
    }

    const exportData = {
      exportedAt: new Date().toISOString(),
      version: '1.0',
      ...graphData
    };

    const content = JSON.stringify(exportData, null, 2);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
  }

  /**
   * Export visualization as SVG
   */
  private async exportSVG(uri: vscode.Uri): Promise<void> {
    // For now, create a placeholder SVG
    // In a full implementation, this would render the actual graph
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <style>
    .node { fill: #f0f0f0; stroke: #cccccc; stroke-width: 1; }
    .node-label { font-family: sans-serif; font-size: 12px; text-anchor: middle; }
    .edge { stroke: #999999; stroke-width: 1; fill: none; }
  </style>
  
  <rect width="100%" height="100%" fill="#ffffff"/>
  
  <g transform="translate(400, 300)">
    <!-- Root node -->
    <g class="node-group" transform="translate(0, 0)">
      <rect class="node" x="-50" y="-15" width="100" height="30" rx="5"/>
      <text class="node-label" y="5">TypeMap</text>
    </g>
    
    <!-- Placeholder message -->
    <text x="0" y="60" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#666666">
      Run analysis to generate mindmap
    </text>
  </g>
</svg>`;

    await vscode.workspace.fs.writeFile(uri, Buffer.from(svg, 'utf8'));
  }
}
