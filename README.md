# TypeMap

**Visualize TypeScript/TSX codebases as interactive mindmaps** 🗺️

TypeMap analyzes your TypeScript and React (TSX) projects and generates beautiful, interactive mindmap visualizations. Understand your codebase structure at a glance!

![TypeMap Demo](media/demo.gif)

## ✨ Features

- **Fast Analysis** - Lightweight parser analyzes thousands of files in seconds
- **Interactive Mindmap** - Pan, zoom, and explore your codebase visually
- **React Support** - Automatically detects React components and hooks
- **Incremental Updates** - Only re-analyzes changed files
- **Multiple Layouts** - Radial, tree, force-directed, and cluster layouts
- **Export Options** - Export as SVG or JSON for documentation

## 🚀 Quick Start

1. Open a TypeScript/TSX project in VS Code
2. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
3. Run **"TypeMap: Analyze Workspace"**
4. Run **"TypeMap: Show Mindmap"** to view the visualization

## 📋 Commands

| Command | Description |
|---------|-------------|
| `TypeMap: Analyze Workspace` | Analyze all TypeScript/TSX files |
| `TypeMap: Analyze Current File` | Analyze the active file |
| `TypeMap: Show Mindmap` | Open the mindmap visualization |
| `TypeMap: Refresh` | Re-analyze changed files |
| `TypeMap: Clear Cache` | Clear analysis cache |
| `TypeMap: Export as SVG` | Export visualization as SVG |
| `TypeMap: Export as JSON` | Export graph data as JSON |

## ⚙️ Configuration

Configure TypeMap in your VS Code settings:

```json
{
  // Files to include in analysis
  "typemap.analysis.include": ["**/*.ts", "**/*.tsx"],
  
  // Files to exclude from analysis
  "typemap.analysis.exclude": [
    "**/node_modules/**",
    "**/dist/**",
    "**/*.spec.ts",
    "**/*.test.ts"
  ],
  
  // Maximum files to analyze
  "typemap.analysis.maxFiles": 10000,
  
  // Default layout algorithm
  "typemap.visualization.layout": "radial",
  
  // Visualization theme
  "typemap.visualization.theme": "auto",
  
  // Worker threads (0 = auto)
  "typemap.performance.workerCount": 0,
  
  // Cache size in MB
  "typemap.performance.cacheSize": 100
}
```

## 🎨 Visualization

### Node Types

The mindmap uses different colors/shapes for different symbol types:

- 📁 **Folders** - Directory structure
- 📄 **Files** - TypeScript/TSX files
- 🏛️ **Classes** - Class declarations
- 📐 **Interfaces** - Interface declarations
- ⚡ **Functions** - Function declarations
- 🧩 **Components** - React components
- 🪝 **Hooks** - React hooks (use*)
- 📦 **Types** - Type aliases
- 🔢 **Enums** - Enum declarations

### Interactions

- **Pan**: Click and drag
- **Zoom**: Mouse wheel
- **Navigate**: Double-click a node to open the file
- **Search**: Use the search box to highlight nodes
- **Layout**: Switch between layout algorithms

## ⚡ Performance

TypeMap is optimized for speed:

| Codebase Size | Analysis Time |
|---------------|---------------|
| < 100 files | < 500ms |
| 100-1000 files | < 2s |
| 1000-10000 files | < 10s |

### Optimizations

- **Lightweight parsing** - No type checking for initial scan
- **Aggressive caching** - Cache parsed results
- **Incremental updates** - Only re-parse changed files
- **Virtual rendering** - Only render visible nodes

## 📝 Requirements

- VS Code 1.107.0 or higher
- TypeScript/TSX project

## 🐛 Known Issues

- Large codebases (>10,000 files) may experience slower initial analysis
- Complex circular dependencies may not render optimally

## 📄 License

MIT

## 🤝 Contributing

Contributions welcome! Please see our [contributing guide](CONTRIBUTING.md).

---


## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
