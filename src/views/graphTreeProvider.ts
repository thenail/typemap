/**
 * Graph Tree View Provider
 * 
 * Shows graph options and analysis status in the TypeMap sidebar
 */

import * as vscode from 'vscode';

export interface GraphItem {
  id: string;
  label: string;
  description?: string;
  icon: string;
  collapsible?: boolean;
  children?: GraphItem[];
  command?: string;
}

export class GraphTreeProvider implements vscode.TreeDataProvider<GraphItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<GraphItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private hasAnalysis = false;
  private stats: { files: number; symbols: number; lastAnalysis?: Date } = { 
    files: 0, 
    symbols: 0 
  };

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  setAnalysisState(hasAnalysis: boolean, stats?: { files: number; symbols: number }): void {
    this.hasAnalysis = hasAnalysis;
    if (stats) {
      this.stats = { ...stats, lastAnalysis: new Date() };
    }
    this.refresh();
  }

  getTreeItem(element: GraphItem): vscode.TreeItem {
    const collapsibleState = element.collapsible 
      ? vscode.TreeItemCollapsibleState.Expanded 
      : vscode.TreeItemCollapsibleState.None;
    
    const item = new vscode.TreeItem(element.label, collapsibleState);
    item.description = element.description;
    item.iconPath = new vscode.ThemeIcon(element.icon);
    item.contextValue = element.id;
    
    if (element.command) {
      item.command = {
        command: element.command,
        title: element.label,
        arguments: []
      };
    }
    
    return item;
  }

  getChildren(element?: GraphItem): GraphItem[] {
    if (element) {
      return element.children || [];
    }

    // Root items
    const items: GraphItem[] = [];

    if (!this.hasAnalysis) {
      items.push({
        id: 'no-analysis',
        label: 'No analysis yet',
        description: 'Click to analyze',
        icon: 'info',
        command: 'typemap.analyze'
      });
    } else {
      items.push({
        id: 'stats',
        label: 'Analysis Stats',
        icon: 'pulse',
        collapsible: true,
        children: [
          {
            id: 'stat-files',
            label: `${this.stats.files} files`,
            icon: 'file-code'
          },
          {
            id: 'stat-symbols',
            label: `${this.stats.symbols} symbols`,
            icon: 'symbol-class'
          },
          {
            id: 'stat-time',
            label: this.stats.lastAnalysis 
              ? `Last: ${this.stats.lastAnalysis.toLocaleTimeString()}`
              : 'Never analyzed',
            icon: 'clock'
          }
        ]
      });

      items.push({
        id: 'actions',
        label: 'Actions',
        icon: 'tools',
        collapsible: true,
        children: [
          {
            id: 'action-refresh',
            label: 'Refresh Analysis',
            icon: 'refresh',
            command: 'typemap.refresh'
          },
          {
            id: 'action-clear',
            label: 'Clear Cache',
            icon: 'trash',
            command: 'typemap.clearCache'
          }
        ]
      });
    }

    items.push({
      id: 'layouts',
      label: 'Layout Options',
      icon: 'layout',
      collapsible: true,
      children: [
        {
          id: 'layout-radial',
          label: 'Radial Tree',
          description: 'Mindmap style',
          icon: 'circle-outline'
        },
        {
          id: 'layout-tree',
          label: 'Dendrogram',
          description: 'Vertical tree',
          icon: 'list-tree'
        },
        {
          id: 'layout-force',
          label: 'Force Layout',
          description: 'Interactive physics',
          icon: 'compass'
        }
      ]
    });

    return items;
  }
}
