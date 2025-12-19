/**
 * Reports Tree View Provider
 * 
 * Shows available reports in the TypeMap sidebar
 */

import * as vscode from 'vscode';

export interface ReportItem {
  id: string;
  label: string;
  description?: string;
  icon: string;
  command?: string;
}

export class ReportsTreeProvider implements vscode.TreeDataProvider<ReportItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ReportItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private reports: ReportItem[] = [
    {
      id: 'codebase-mindmap',
      label: 'Codebase Mindmap',
      description: 'D3 visualization of all project files',
      icon: 'graph',
      command: 'typemap.showMindmapD3'
    },
    {
      id: 'type-hierarchy',
      label: 'Type Hierarchy',
      description: 'Class and interface relationships',
      icon: 'type-hierarchy',
      command: 'typemap.showTypeHierarchy'
    },
    {
      id: 'dependency-graph',
      label: 'Import Dependencies',
      description: 'Module import/export relationships',
      icon: 'references',
      command: 'typemap.showDependencies'
    }
  ];

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: ReportItem): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.description = element.description;
    item.iconPath = new vscode.ThemeIcon(element.icon);
    item.contextValue = 'report';
    
    if (element.command) {
      item.command = {
        command: element.command,
        title: element.label,
        arguments: []
      };
    }
    
    return item;
  }

  getChildren(element?: ReportItem): ReportItem[] {
    if (element) {
      return []; // No children for report items
    }
    return this.reports;
  }
}
