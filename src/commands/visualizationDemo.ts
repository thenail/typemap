/**
 * Visualization Demo Command
 * 
 * POC for testing D3.js visualization with sample data
 * Run with: TypeMap: Show Demo Visualization
 */

import * as vscode from 'vscode';
import { MindmapPanel } from '../webview';
import { MindmapGraph, MindmapNode, Edge } from '../types';

export class VisualizationDemoCommand {
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /**
   * Execute the demo visualization command
   */
  async execute(): Promise<void> {
    // Generate sample data that mimics a real codebase structure
    const sampleGraph = this.generateSampleGraph();
    
    // Create/show the mindmap panel with the sample data
    MindmapPanel.createOrShow(this.context.extensionUri, sampleGraph);
    
    vscode.window.showInformationMessage(
      'TypeMap: Demo visualization loaded. Try the different layout options!'
    );
  }

  /**
   * Generate sample graph data for demo
   */
  private generateSampleGraph(): MindmapGraph {
    const nodes = new Map<string, MindmapNode>();
    const edges: Edge[] = [];

    // Create root
    const root: MindmapNode = {
      id: 'root',
      label: 'my-project',
      type: 'root',
      children: ['src', 'tests', 'docs'],
      collapsed: false,
      metadata: {
        linesOfCode: 0,
        complexity: 0,
        exportCount: 0,
        importCount: 0,
        isEntryPoint: true
      }
    };
    nodes.set('root', root);

    // Create src folder
    const srcFolder: MindmapNode = {
      id: 'src',
      label: 'src',
      type: 'folder',
      children: ['components', 'utils', 'services', 'types'],
      parent: 'root',
      collapsed: false,
      metadata: { linesOfCode: 0, complexity: 0, exportCount: 0, importCount: 0, isEntryPoint: false }
    };
    nodes.set('src', srcFolder);
    edges.push({ source: 'root', target: 'src', type: 'contains' });

    // Components folder
    const componentsFolder: MindmapNode = {
      id: 'components',
      label: 'components',
      type: 'folder',
      children: ['Button', 'Modal', 'Form', 'Header', 'Footer'],
      parent: 'src',
      collapsed: false,
      metadata: { linesOfCode: 0, complexity: 0, exportCount: 0, importCount: 0, isEntryPoint: false }
    };
    nodes.set('components', componentsFolder);
    edges.push({ source: 'src', target: 'components', type: 'contains' });

    // Add component files
    const componentNames = ['Button', 'Modal', 'Form', 'Header', 'Footer'];
    componentNames.forEach(name => {
      const fileNode: MindmapNode = {
        id: name,
        label: `${name}.tsx`,
        type: 'file',
        filePath: `src/components/${name}.tsx`,
        children: [`${name}-component`, `${name}-props`],
        parent: 'components',
        collapsed: false,
        metadata: { 
          linesOfCode: Math.floor(Math.random() * 200) + 50, 
          complexity: Math.floor(Math.random() * 10) + 1, 
          exportCount: 2, 
          importCount: 3, 
          isEntryPoint: false,
          gitStatus: Math.random() > 0.7 ? 'modified' : undefined
        }
      };
      nodes.set(name, fileNode);
      edges.push({ source: 'components', target: name, type: 'contains' });

      // Add component symbol
      const componentNode: MindmapNode = {
        id: `${name}-component`,
        label: name,
        type: 'component',
        filePath: `src/components/${name}.tsx`,
        line: 10,
        children: [],
        parent: name,
        collapsed: false,
        metadata: { linesOfCode: 0, complexity: 0, exportCount: 1, importCount: 0, isEntryPoint: false }
      };
      nodes.set(`${name}-component`, componentNode);
      edges.push({ source: name, target: `${name}-component`, type: 'contains' });

      // Add props interface
      const propsNode: MindmapNode = {
        id: `${name}-props`,
        label: `${name}Props`,
        type: 'interface',
        filePath: `src/components/${name}.tsx`,
        line: 3,
        children: [],
        parent: name,
        collapsed: false,
        metadata: { linesOfCode: 0, complexity: 0, exportCount: 1, importCount: 0, isEntryPoint: false }
      };
      nodes.set(`${name}-props`, propsNode);
      edges.push({ source: name, target: `${name}-props`, type: 'contains' });
    });

    // Utils folder
    const utilsFolder: MindmapNode = {
      id: 'utils',
      label: 'utils',
      type: 'folder',
      children: ['helpers', 'validators', 'formatters'],
      parent: 'src',
      collapsed: false,
      metadata: { linesOfCode: 0, complexity: 0, exportCount: 0, importCount: 0, isEntryPoint: false }
    };
    nodes.set('utils', utilsFolder);
    edges.push({ source: 'src', target: 'utils', type: 'contains' });

    // Add utility files
    ['helpers', 'validators', 'formatters'].forEach(name => {
      const fileNode: MindmapNode = {
        id: name,
        label: `${name}.ts`,
        type: 'file',
        filePath: `src/utils/${name}.ts`,
        children: [`${name}-fn1`, `${name}-fn2`, `${name}-fn3`],
        parent: 'utils',
        collapsed: false,
        metadata: { 
          linesOfCode: Math.floor(Math.random() * 100) + 20, 
          complexity: Math.floor(Math.random() * 5) + 1, 
          exportCount: 3, 
          importCount: 1, 
          isEntryPoint: false,
          gitStatus: Math.random() > 0.8 ? 'added' : undefined
        }
      };
      nodes.set(name, fileNode);
      edges.push({ source: 'utils', target: name, type: 'contains' });

      // Add functions
      for (let i = 1; i <= 3; i++) {
        const fnNode: MindmapNode = {
          id: `${name}-fn${i}`,
          label: `${name}${i}`,
          type: 'function',
          filePath: `src/utils/${name}.ts`,
          line: i * 20,
          children: [],
          parent: name,
          collapsed: false,
          metadata: { linesOfCode: 0, complexity: 0, exportCount: 1, importCount: 0, isEntryPoint: false }
        };
        nodes.set(`${name}-fn${i}`, fnNode);
        edges.push({ source: name, target: `${name}-fn${i}`, type: 'contains' });
      }
    });

    // Services folder
    const servicesFolder: MindmapNode = {
      id: 'services',
      label: 'services',
      type: 'folder',
      children: ['api', 'auth', 'storage'],
      parent: 'src',
      collapsed: false,
      metadata: { linesOfCode: 0, complexity: 0, exportCount: 0, importCount: 0, isEntryPoint: false }
    };
    nodes.set('services', servicesFolder);
    edges.push({ source: 'src', target: 'services', type: 'contains' });

    // Add service files
    ['api', 'auth', 'storage'].forEach(name => {
      const fileNode: MindmapNode = {
        id: name,
        label: `${name}Service.ts`,
        type: 'file',
        filePath: `src/services/${name}Service.ts`,
        children: [`${name}-class`, `${name}-interface`],
        parent: 'services',
        collapsed: false,
        metadata: { 
          linesOfCode: Math.floor(Math.random() * 300) + 100, 
          complexity: Math.floor(Math.random() * 15) + 5, 
          exportCount: 2, 
          importCount: 4, 
          isEntryPoint: false 
        }
      };
      nodes.set(name, fileNode);
      edges.push({ source: 'services', target: name, type: 'contains' });

      // Add class
      const classNode: MindmapNode = {
        id: `${name}-class`,
        label: `${name.charAt(0).toUpperCase() + name.slice(1)}Service`,
        type: 'class',
        filePath: `src/services/${name}Service.ts`,
        line: 15,
        children: [],
        parent: name,
        collapsed: false,
        metadata: { linesOfCode: 0, complexity: 0, exportCount: 1, importCount: 0, isEntryPoint: false }
      };
      nodes.set(`${name}-class`, classNode);
      edges.push({ source: name, target: `${name}-class`, type: 'contains' });

      // Add interface
      const interfaceNode: MindmapNode = {
        id: `${name}-interface`,
        label: `I${name.charAt(0).toUpperCase() + name.slice(1)}Service`,
        type: 'interface',
        filePath: `src/services/${name}Service.ts`,
        line: 5,
        children: [],
        parent: name,
        collapsed: false,
        metadata: { linesOfCode: 0, complexity: 0, exportCount: 1, importCount: 0, isEntryPoint: false }
      };
      nodes.set(`${name}-interface`, interfaceNode);
      edges.push({ source: name, target: `${name}-interface`, type: 'contains' });
    });

    // Types folder
    const typesFolder: MindmapNode = {
      id: 'types',
      label: 'types',
      type: 'folder',
      children: ['index-types'],
      parent: 'src',
      collapsed: false,
      metadata: { linesOfCode: 0, complexity: 0, exportCount: 0, importCount: 0, isEntryPoint: false }
    };
    nodes.set('types', typesFolder);
    edges.push({ source: 'src', target: 'types', type: 'contains' });

    // Add types file
    const typesFile: MindmapNode = {
      id: 'index-types',
      label: 'index.ts',
      type: 'file',
      filePath: 'src/types/index.ts',
      children: ['User', 'Product', 'Order', 'Config'],
      parent: 'types',
      collapsed: false,
      metadata: { linesOfCode: 150, complexity: 1, exportCount: 10, importCount: 0, isEntryPoint: false }
    };
    nodes.set('index-types', typesFile);
    edges.push({ source: 'types', target: 'index-types', type: 'contains' });

    // Add type definitions
    ['User', 'Product', 'Order', 'Config'].forEach(name => {
      const typeNode: MindmapNode = {
        id: name,
        label: name,
        type: 'type',
        filePath: 'src/types/index.ts',
        line: ['User', 'Product', 'Order', 'Config'].indexOf(name) * 30 + 5,
        children: [],
        parent: 'index-types',
        collapsed: false,
        metadata: { linesOfCode: 0, complexity: 0, exportCount: 1, importCount: 0, isEntryPoint: false }
      };
      nodes.set(name, typeNode);
      edges.push({ source: 'index-types', target: name, type: 'contains' });
    });

    // Tests folder
    const testsFolder: MindmapNode = {
      id: 'tests',
      label: 'tests',
      type: 'folder',
      children: ['unit', 'integration'],
      parent: 'root',
      collapsed: false,
      metadata: { linesOfCode: 0, complexity: 0, exportCount: 0, importCount: 0, isEntryPoint: false }
    };
    nodes.set('tests', testsFolder);
    edges.push({ source: 'root', target: 'tests', type: 'contains' });

    // Docs folder
    const docsFolder: MindmapNode = {
      id: 'docs',
      label: 'docs',
      type: 'folder',
      children: [],
      parent: 'root',
      collapsed: false,
      metadata: { linesOfCode: 0, complexity: 0, exportCount: 0, importCount: 0, isEntryPoint: false }
    };
    nodes.set('docs', docsFolder);
    edges.push({ source: 'root', target: 'docs', type: 'contains' });

    return {
      nodes,
      edges,
      rootId: 'root',
      statistics: {
        totalNodes: nodes.size,
        totalEdges: edges.length,
        totalFiles: 11,
        totalSymbols: nodes.size - 7, // Subtract folders
        analysisTimeMs: 0,
        byType: {
          root: 1,
          folder: 6,
          file: 11,
          namespace: 0,
          class: 3,
          interface: 8,
          function: 9,
          type: 4,
          enum: 0,
          variable: 0,
          component: 5,
          hook: 0
        }
      }
    };
  }
}
