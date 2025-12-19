# TypeMap - TypeScript/TSX Codebase Mindmap Visualizer

## Implementation Specification v1.2

---

## 1. Executive Summary

**TypeMap** is a Visual Studio Code extension that analyzes TypeScript and TSX (React) codebases and generates interactive mindmap visualizations. The primary design goal is **maximum analysis speed** through a **hybrid architecture** combining Rust-based parsing (SWC) for speed with TypeScript Language Service for deep type analysis.

### Key Features
- **Fast Parsing**: Uses SWC (Rust) for 2-3x faster initial parsing
- **Deep Type Analysis**: TypeScript Language Service for type queries on-demand
- **Find Implementations**: Find all implementations of interfaces (explicit + structural)
- **Git Integration**: Visualize uncommitted changes in the mindmap
- **Incremental Analysis**: Only re-analyze changed files

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         VS Code Extension                            │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │   Command   │  │  FileSystem │  │   Cache     │  │  Webview    │ │
│  │   Handler   │  │   Watcher   │  │   Manager   │  │   Panel     │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘ │
│         │                │                │                │        │
│  ┌──────┴────────────────┴────────────────┴────────────────┴──────┐ │
│  │                      Core Orchestrator                         │ │
│  └────────────────────────────┬───────────────────────────────────┘ │
│                               │                                     │
│  ┌────────────────────────────┴───────────────────────────────────┐ │
│  │                     Hybrid Analysis Engine                      │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │ │
│  │  │  SWC Parser  │  │ TypeAnalyzer │  │    Graph     │          │ │
│  │  │  (Fast/Rust) │  │  (TS LangSvc)│  │   Builder    │          │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘          │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                               │                                     │
│  ┌────────────────────────────┴───────────────────────────────────┐ │
│  │                    Git Integration                              │ │
│  │  ┌──────────────┐  ┌──────────────┐                            │ │
│  │  │  VS Code Git │  │  Change      │                            │ │
│  │  │  Extension   │  │  Tracker     │                            │ │
│  │  └──────────────┘  └──────────────┘                            │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                               │                                     │
│  ┌────────────────────────────┴───────────────────────────────────┐ │
│  │                    Mindmap Generator                            │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │ │
│  │  │  Layout      │  │  Node        │  │  Renderer    │          │ │
│  │  │  Engine      │  │  Aggregator  │  │  (D3/Canvas) │          │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘          │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Performance-First Design Principles

### 3.1 Speed Optimization Strategies

| Strategy | Implementation | Expected Impact |
|----------|---------------|-----------------|
| **SWC Rust Parser** | Use @swc/core for fast parsing | 2-3x speedup vs TypeScript API |
| **Hybrid Architecture** | SWC for speed, TS for types | Best of both worlds |
| **Incremental Analysis** | Only re-parse changed files | 90%+ reduction on subsequent runs |
| **Lazy Type Analysis** | TypeScript on-demand only | Avoids upfront type checking |
| **LRU Cache** | Cache parsed ASTs and symbols | Near-instant repeat queries |
| **Git Integration** | Track changes via VS Code API | Visual diff in mindmap |

### 3.2 Performance Benchmarks (Actual)

Measured on freeCodeCamp codebase (925 TypeScript files):

| Phase | Time | Notes |
|-------|------|-------|
| File Discovery | 119ms | fast-glob with gitignore |
| SWC Fast Parsing | 756ms | ~1,223 files/sec |
| TypeScript Language Service Init | 2,471ms | One-time cost |
| Find Implementations (per interface) | ~49ms | Average across 10 tests |

### 3.3 Performance Targets

| Codebase Size | Target Analysis Time | Target Render Time |
|---------------|---------------------|-------------------|
| Small (<100 files) | < 500ms | < 100ms |
| Medium (100-1000 files) | < 2s | < 300ms |
| Large (1000-10000 files) | < 10s | < 500ms |
| Enterprise (10000+ files) | < 30s | < 1s |

---

## 4. Core Components Specification

### 4.1 File Discovery Engine

```typescript
interface FileDiscoveryConfig {
  rootPath: string;
  include: string[];        // Default: ['**/*.ts', '**/*.tsx']
  exclude: string[];        // Default: ['**/node_modules/**', '**/dist/**', '**/*.d.ts', '**/*.d.tsx']
  maxDepth: number;         // Default: 50
  maxFiles: number;         // Default: 50000
  useGitignore: boolean;    // Default: true
}

interface FileDiscoveryResult {
  files: string[];
  totalSize: number;
  discoveryTimeMs: number;
}
```

**Fast Discovery Implementation:**
- Use `vscode.workspace.findFiles()` with glob patterns (leverages VS Code's native file indexing)
- Fallback to `fast-glob` library for non-workspace scenarios
- Stream results instead of collecting all files first
- Respect `.gitignore` via `ignore` package

### 4.2 Hybrid Analysis Engine

#### 4.2.1 Two-Path Architecture

**Fast Path: SWC Parser (Rust)**
```typescript
// src/analysis/swcParser.ts
interface SwcParserResult {
  filePath: string;
  symbols: LightweightSymbol[];
  imports: ImportInfo[];
  exports: ExportInfo[];
  relationships: SymbolRelationship[];  // implements/extends
  parseTimeMs: number;
}

// Uses @swc/core - Rust-based parser
// ~2.4x faster than TypeScript API
// Extracts: symbols, imports, exports, explicit implements/extends
// Time: ~0.8ms per file (vs ~2ms for TypeScript)
```

**Deep Path: TypeScript Language Service (On-Demand)**
```typescript
// src/analysis/typeAnalyzer.ts
interface TypeAnalyzer {
  initialize(rootPath: string, files: string[]): Promise<void>;
  findImplementations(symbolName: string, filePath: string): Promise<ImplementationInfo[]>;
  findReferences(symbolName: string, filePath: string): Promise<ReferenceInfo[]>;
  getTypeHierarchy(symbolName: string, filePath: string): Promise<TypeHierarchyNode>;
}

interface ImplementationInfo {
  symbol: LightweightSymbol;
  isExplicit: boolean;     // implements keyword vs structural match
  matchedMembers: string[];
}

// Uses TypeScript Language Service
// Only triggered for type queries (Find Implementations, etc.)
// Supports structural typing - finds classes that satisfy interface shape
// ~50ms per query after initialization
```

#### 4.2.2 When to Use Each Path

| Use Case | Parser | Reason |
|----------|--------|--------|
| Initial mindmap generation | SWC | Speed - 2.4x faster |
| File change detection | SWC | Quick re-parse |
| Find implementations | TypeScript | Needs type system |
| Type hierarchy | TypeScript | Needs type resolution |
| Structural matching | TypeScript | Can't do in Rust |

#### 4.2.3 Relationship Detection

```typescript
type RelationshipType =
  | 'implements'   // class implements interface
  | 'extends'      // class/interface extends another
  | 'uses'         // imports/uses another symbol
  | 'contains';    // namespace/module contains

interface SymbolRelationship {
  fromSymbol: string;
  toSymbol: string;
  type: RelationshipType;
  filePath: string;
}

// SWC extracts explicit relationships (implements/extends keywords)
// TypeScript finds structural matches (duck typing)
```

### 4.3 Caching System

#### 4.3.1 Multi-Layer Cache Architecture

```
┌─────────────────────────────────────────┐
│         L1: In-Memory LRU Cache         │  ← Hot data, ~100MB limit
│         (Parsed ASTs, Symbol Maps)      │
├─────────────────────────────────────────┤
│         L2: Workspace Storage           │  ← Warm data, persistent
│         (Serialized Analysis Results)   │
├─────────────────────────────────────────┤
│         L3: Global Storage              │  ← Cold data, shared
│         (Common library signatures)     │
└─────────────────────────────────────────┘
```

#### 4.3.2 Cache Invalidation Strategy

```typescript
interface CacheEntry {
  key: string;              // File path or symbol ID
  hash: string;             // Content hash (xxhash for speed)
  timestamp: number;
  data: unknown;
  dependencies: string[];   // Invalidate if these change
}

// Invalidation triggers:
// 1. File content hash change
// 2. tsconfig.json modification
// 3. Package.json dependency change
// 4. Manual cache clear command
```

### 4.4 Git Integration

#### 4.4.1 Git Status Tracking

```typescript
// src/git/gitIntegration.ts
type GitChangeStatus =
  | 'modified'      // File has been modified
  | 'added'         // New file
  | 'deleted'       // File has been deleted
  | 'renamed'       // File has been renamed
  | 'untracked'     // New untracked file
  | 'staged'        // Changes are staged
  | 'conflict'      // Merge conflict
  | 'unchanged';    // No changes

interface GitFileChange {
  filePath: string;
  status: GitChangeStatus;
  originalPath?: string;  // For renamed files
  isStaged: boolean;
}

interface GitAnalysisResult {
  repository: GitRepositoryInfo | null;
  changes: Map<string, GitFileChange>;
  totalChangedFiles: number;
  hasUncommittedChanges: boolean;
}
```

#### 4.4.2 Integration with VS Code Git Extension

```typescript
// Uses vscode.extensions.getExtension('vscode.git')
// Retrieves:
// - repo.state.indexChanges (staged)
// - repo.state.workingTreeChanges (unstaged)
// - repo.state.mergeChanges (conflicts)

// Applied to graph nodes for visualization
interface NodeMetadata {
  // ... other fields
  gitStatus?: GitChangeStatus;  // For visual highlighting
}
```

#### 4.4.3 Git Statistics in Graph

```typescript
interface GitStatistics {
  totalChanged: number;
  modified: number;
  added: number;
  deleted: number;
  untracked: number;
  staged: number;
  conflict: number;
}

// Added to GraphStatistics for summary view
```

### 4.5 Graph Data Structure

```typescript
interface MindmapNode {
  id: string;
  label: string;
  type: NodeType;
  filePath?: string;
  children: string[];       // Child node IDs
  metadata: NodeMetadata;
}

type NodeType = 
  | 'root'
  | 'folder'
  | 'file'
  | 'namespace'
  | 'class'
  | 'interface'
  | 'function'
  | 'type'
  | 'enum'
  | 'variable'
  | 'component'      // React component (TSX)
  | 'hook';          // React hook (useSomething)

interface NodeMetadata {
  linesOfCode: number;
  complexity: number;
  exportCount: number;
  importCount: number;
  isEntryPoint: boolean;
}

interface MindmapGraph {
  nodes: Map<string, MindmapNode>;
  edges: Edge[];
  rootId: string;
  statistics: GraphStatistics;
}
```

### 4.5 Visualization Engine

#### 4.5.1 Rendering Strategy

**Primary: Canvas-based rendering**
- Use HTML5 Canvas for large graphs (1000+ nodes)
- WebGL fallback for extreme cases (10000+ nodes)
- Virtual viewport rendering (only render visible nodes)

**Secondary: SVG for small graphs**
- Better interaction handling
- Easier styling
- Used for < 500 nodes

#### 4.5.2 Layout Algorithms

```typescript
type LayoutAlgorithm = 
  | 'radial'          // Default: Fast, good for hierarchies
  | 'tree'            // Traditional mindmap
  | 'force-directed'  // Shows relationships
  | 'cluster';        // Groups by folder/namespace

interface LayoutConfig {
  algorithm: LayoutAlgorithm;
  nodeSpacing: number;
  levelSpacing: number;
  maxVisibleDepth: number;
  collapseThreshold: number;  // Auto-collapse if > N children
}
```

---

## 5. Extension API Design

### 5.1 Commands

| Command ID | Title | Keybinding | Description |
|------------|-------|------------|-------------|
| `typemap.analyze` | TypeMap: Analyze Workspace | - | Full codebase analysis with git status |
| `typemap.analyzeFile` | TypeMap: Analyze Current File | - | Single file deep analysis |
| `typemap.showMindmap` | TypeMap: Show Mindmap | - | Open visualization panel |
| `typemap.refresh` | TypeMap: Refresh | - | Re-analyze changed files |
| `typemap.clearCache` | TypeMap: Clear Cache | - | Invalidate all caches |
| `typemap.exportSVG` | TypeMap: Export as SVG | - | Export current view |
| `typemap.exportJSON` | TypeMap: Export as JSON | - | Export graph data |
| `typemap.findImplementations` | TypeMap: Find Implementations | `Ctrl+Shift+I` | Find all implementations of interface at cursor |

### 5.2 Context Menu

The "Find Implementations" command is available in the editor context menu for TypeScript/TSX files.

### 5.2 Configuration Schema

```jsonc
{
  "typemap.analysis.include": {
    "type": "array",
    "default": ["**/*.ts", "**/*.tsx"],
    "description": "Glob patterns for files to analyze"
  },
  "typemap.analysis.exclude": {
    "type": "array",
    "default": ["**/node_modules/**", "**/dist/**", "**/*.spec.ts", "**/*.spec.tsx", "**/*.test.ts", "**/*.test.tsx"],
    "description": "Glob patterns for files to exclude"
  },
  "typemap.analysis.maxFiles": {
    "type": "number",
    "default": 10000,
    "description": "Maximum number of files to analyze"
  },
  "typemap.analysis.maxDepth": {
    "type": "number",
    "default": 5,
    "description": "Maximum depth for initial mindmap"
  },
  "typemap.visualization.layout": {
    "type": "string",
    "enum": ["radial", "tree", "force-directed", "cluster"],
    "default": "radial",
    "description": "Default layout algorithm"
  },
  "typemap.visualization.theme": {
    "type": "string",
    "enum": ["auto", "light", "dark"],
    "default": "auto",
    "description": "Visualization theme"
  },
  "typemap.performance.workerCount": {
    "type": "number",
    "default": 0,
    "description": "Number of worker threads (0 = auto)"
  },
  "typemap.performance.cacheSize": {
    "type": "number",
    "default": 100,
    "description": "L1 cache size in MB"
  }
}
```

### 5.3 Webview Communication Protocol

```typescript
// Extension → Webview
type ExtensionMessage = 
  | { type: 'init'; data: MindmapGraph }
  | { type: 'update'; data: Partial<MindmapGraph> }
  | { type: 'highlight'; nodeIds: string[] }
  | { type: 'progress'; percent: number; message: string }
  | { type: 'error'; message: string };

// Webview → Extension
type WebviewMessage = 
  | { type: 'nodeClick'; nodeId: string }
  | { type: 'nodeExpand'; nodeId: string }
  | { type: 'nodeCollapse'; nodeId: string }
  | { type: 'search'; query: string }
  | { type: 'export'; format: 'svg' | 'png' | 'json' }
  | { type: 'ready' };
```

---

## 6. File Structure

```
typemap/
├── package.json
├── tsconfig.json
├── webpack.config.js
├── .vscodeignore
├── README.md
├── CHANGELOG.md
├── IMPLEMENTATION_SPEC.md
├── src/
│   ├── extension.ts                 # Extension entry point
│   ├── constants.ts                 # Command IDs, context keys
│   ├── commands/
│   │   ├── index.ts                 # Barrel export
│   │   ├── analyze.ts               # Workspace analysis
│   │   ├── showMindmap.ts           # Visualization panel
│   │   ├── export.ts                # SVG/JSON export
│   │   └── findImplementations.ts   # Find implementations command
│   ├── analysis/
│   │   ├── index.ts                 # Barrel export
│   │   ├── fileDiscovery.ts         # Fast file enumeration (fast-glob)
│   │   ├── lightweightParser.ts     # TypeScript-based parser
│   │   ├── swcParser.ts             # SWC Rust-based fast parser
│   │   ├── typeAnalyzer.ts          # TypeScript Language Service
│   │   └── symbolExtractor.ts       # Symbol extraction utilities
│   ├── git/
│   │   ├── index.ts                 # Barrel export
│   │   └── gitIntegration.ts        # VS Code Git extension integration
│   ├── graph/
│   │   ├── index.ts                 # Barrel export
│   │   ├── graphBuilder.ts          # Build mindmap structure + git status
│   │   └── nodeAggregator.ts        # Collapse/expand logic
│   ├── cache/
│   │   ├── index.ts                 # Barrel export
│   │   ├── cacheManager.ts          # Multi-layer cache
│   │   └── persistentCache.ts       # Workspace storage
│   ├── visualization/
│   │   ├── webviewProvider.ts       # VS Code webview
│   │   └── messageHandler.ts        # Webview communication
│   ├── utils/
│   │   ├── index.ts                 # Barrel export
│   │   ├── hash.ts                  # Fast hashing (xxhash-wasm)
│   │   ├── profiler.ts              # Performance measurement
│   │   └── logger.ts                # Structured logging
│   ├── types/
│   │   ├── index.ts                 # Barrel export
│   │   ├── symbols.ts               # Symbol types + relationships
│   │   ├── graph.ts                 # Graph types + git status
│   │   ├── analysis.ts              # Analysis types
│   │   ├── git.ts                   # Git types
│   │   ├── cache.ts                 # Cache types
│   │   ├── config.ts                # Configuration types
│   │   ├── webview.ts               # Webview message types
│   │   └── utils.ts                 # Utility types
│   └── test/
│       └── benchmark/
│           ├── tsconfig.json        # Benchmark-specific config
│           ├── runBenchmark.ts      # Main benchmark runner
│           ├── standaloneBenchmark.ts
│           ├── typeAnalyzerBenchmark.ts  # TypeAnalyzer perf tests
│           ├── swcBenchmark.ts      # SWC vs TS comparison
│           └── transformBenchmark.ts
├── webview/
│   ├── index.html
│   ├── src/
│   │   ├── main.ts                  # Webview entry
│   │   ├── mindmap.ts               # Core rendering
│   │   ├── canvas/
│   │   │   ├── renderer.ts          # Canvas rendering
│   │   │   └── viewport.ts          # Virtual scrolling
│   │   ├── interaction/
│   │   │   ├── zoom.ts              # Pan/zoom handling
│   │   │   ├── selection.ts         # Node selection
│   │   │   └── search.ts            # Search highlighting
│   │   └── layout/
│   │       ├── radial.ts
│   │       ├── tree.ts
│   │       └── force.ts
│   └── styles/
│       ├── mindmap.css
│       └── themes/
│           ├── light.css
│           └── dark.css
└── test/
    ├── unit/
    │   ├── lightweightParser.test.ts
    │   ├── graphBuilder.test.ts
    │   └── cacheManager.test.ts
    ├── integration/
    │   └── fullAnalysis.test.ts
    └── fixtures/
        └── sampleProject/
```

---

## 7. Performance Optimization Details

### 7.1 Lightweight Parser Implementation

The lightweight parser is the key to fast initial analysis. It uses a combination of:

1. **Line-based regex scanning** for quick export detection
2. **Minimal AST parsing** using `ts.createSourceFile` with `ScriptTarget.Latest`
3. **No type checking** - skip `ts.createProgram` for Phase 1

```typescript
// Pseudo-implementation
async function lightweightParse(filePath: string): Promise<LightweightSymbol[]> {
  const content = await fs.promises.readFile(filePath, 'utf8');
  
  // Quick regex scan for exports (< 0.1ms per file)
  const exportMatches = content.matchAll(EXPORT_REGEX);
  
  // Determine script kind based on file extension
  const isTsx = filePath.endsWith('.tsx');
  const scriptKind = isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  
  // Minimal AST only if needed (< 1ms per file)
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    false,  // setParentNodes = false for speed
    scriptKind
  );
  
  // Shallow traversal - only top-level declarations
  // For TSX: also extract React component definitions
  return extractTopLevelSymbols(sourceFile, { includeTsxComponents: isTsx });
}
```

### 7.2 Incremental Update Algorithm

The `IncrementalUpdateManager` class provides efficient updates when files change:

```typescript
// Key components of the incremental update system:

// 1. Debounced change registration (300ms default)
// Batches rapid file changes to avoid redundant processing
registerChange(filePath: string, changeType: 'created' | 'changed' | 'deleted'): void {
  this.pendingChanges.set(filePath, changeType);
  this.scheduleUpdate(); // Debounced
}

// 2. Optimized change handlers
async handleFileChanged(filePath: string, graph: MindmapGraph): Promise<PatchOperation[]> {
  const patches: PatchOperation[] = [];
  
  // Check if content actually changed (via hash)
  if (contentHash === cachedHash) return []; // No actual change
  
  // Remove old nodes from this file
  for (const nodeId of graph.fileIndex.get(filePath) || []) {
    patches.push({ type: 'remove', nodeId });
  }
  
  // Re-parse with SWC (fast)
  const symbols = await parser.parseFile(filePath);
  
  // Add new nodes
  for (const symbol of symbols) {
    patches.push({ type: 'add', node: createNode(symbol) });
  }
  
  return patches;
}

// 3. Efficient graph patching (no full rebuild)
applyPatches(graph: MindmapGraph, patches: PatchOperation[]): void {
  for (const patch of patches) {
    switch (patch.type) {
      case 'add': graph.nodes.set(patch.node.id, patch.node); break;
      case 'remove': graph.nodes.delete(patch.nodeId); break;
      case 'update': Object.assign(graph.nodes.get(patch.nodeId)!, patch.changes); break;
    }
  }
  // Update edges, file index, etc.
}
```

**Performance Comparison** (Tree-sitter benchmark results):

| Operation | Tree-sitter | TypeScript API | Notes |
|-----------|-------------|----------------|-------|
| Full parse (925 files) | ~730ms | ~715ms | Similar for full parse |
| Incremental edit | **0.17-0.27ms** | ~2ms | Tree-sitter 8-13x faster |

The current implementation uses hash-based change detection and targeted graph patching
to minimize work. For even faster incremental updates, Tree-sitter's incremental parsing
could be integrated (trades ~20ms initial overhead for sub-millisecond edit updates).

### 7.3 Virtual Viewport Rendering

For large mindmaps, only render visible nodes:

```typescript
interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

function getVisibleNodes(
  graph: MindmapGraph,
  viewport: Viewport
): MindmapNode[] {
  const visibleBounds = calculateVisibleBounds(viewport);
  
  return Array.from(graph.nodes.values()).filter(node => 
    isNodeInBounds(node, visibleBounds)
  );
}

// Render only ~100-500 nodes at any time
// Use requestAnimationFrame for smooth updates
```

---

## 8. Dependencies

### 8.1 Production Dependencies

| Package | Purpose | Size Impact |
|---------|---------|-------------|
| `typescript` | Type analysis, Language Service | ~15 MB (bundled) |
| `@swc/core` | Rust-based fast parsing | ~30 MB (native) |
| `fast-glob` | File discovery | ~30 KB |
| `xxhash-wasm` | Fast content hashing | ~20 KB |

### 8.2 Development Dependencies

| Package | Purpose |
|---------|---------|
| `@types/vscode` | VS Code API types |
| `@types/node` | Node.js types |
| `webpack` | Bundling |
| `ts-loader` | TypeScript compilation |
| `ts-node` | Benchmark execution |
| `eslint` | Code linting |
| `@vscode/test-electron` | Integration testing |

---

## 9. Implementation Status

### Phase 1: Core Analysis ✅ COMPLETE
- [x] File discovery with glob patterns
- [x] Lightweight parser (TypeScript API)
- [x] SWC fast parser (Rust)
- [x] Basic graph data structure
- [x] In-memory LRU cache
- [x] Performance benchmarks

### Phase 2: Deep Analysis ✅ COMPLETE
- [x] TypeScript Language Service integration
- [x] TypeAnalyzer for type queries
- [x] Find Implementations command
- [x] Structural type matching
- [x] Type hierarchy analysis

### Phase 3: Git Integration ✅ COMPLETE
- [x] VS Code Git extension API integration
- [x] File change status tracking
- [x] Git status in graph nodes
- [x] Git statistics in analysis results

### Phase 4: Incremental Updates ✅ COMPLETE
- [x] IncrementalUpdateManager class
- [x] Debounced file change batching (300ms)
- [x] Hash-based change detection
- [x] Graph patching (add/remove/update nodes)
- [x] File watcher integration
- [x] Update notifications (onUpdate callback)
- [x] Tree-sitter benchmark for comparison

### Phase 5: Visualization 🔄 IN PROGRESS
- [ ] Webview panel setup
- [ ] Canvas-based renderer
- [ ] Radial layout algorithm
- [ ] Basic pan/zoom interaction
- [ ] Git status visual highlighting
- [ ] Incremental update visual refresh

### Phase 6: Features (Planned)
- [ ] Multiple layout algorithms
- [ ] Search and filtering
- [ ] Export functionality

### Phase 7: Polish (Planned)
- [ ] Theme support
- [ ] Keyboard navigation
- [ ] Performance profiling dashboard
- [ ] Documentation

---

## 10. Success Metrics

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| SWC parsing speed | < 1ms per file | ~0.8ms | ✅ |
| Files/sec (SWC) | > 1000 | 1,223 | ✅ |
| TypeAnalyzer init | < 3s for 1K files | 2.5s | ✅ |
| Find Implementations | < 100ms per query | ~49ms | ✅ |
| Memory usage | < 200MB for 10K files | TBD | 🔄 |
| Cache hit rate | > 90% on subsequent runs | TBD | 🔄 |

---

## 11. Future Enhancements

1. **Dependency Graph Mode** - Visualize import/export relationships
2. **Complexity Heatmap** - Color nodes by cyclomatic complexity
3. **Change History** - Show how architecture evolved over time (git history)
4. **Team Annotations** - Collaborative notes on nodes
5. **AI Integration** - Suggest refactoring based on structure
6. **Multi-language Support** - Extend to JavaScript, Vue, Svelte
7. **React Component Tree** - Visualize component hierarchy from TSX
8. **Find References** - Navigate to all usages of a symbol
9. **Call Graph** - Visualize function call relationships
10. **PR Diff View** - Highlight changes between branches

---

## 12. Technical Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Worker thread overhead | Slower for small projects | Skip workers for < 50 files |
| TypeScript API changes | Breaking updates | Pin TS version, abstract API |
| WebView memory limits | Crashes on huge graphs | Virtual rendering, pagination |
| Cache corruption | Invalid results | Hash validation, auto-clear |

---

*Specification Version: 1.1*  
*Last Updated: December 18, 2025*  
*Author: TypeMap Development Team*

## Changelog

### v1.1 (December 18, 2025)
- Added hybrid architecture (SWC + TypeScript Language Service)
- Added TypeAnalyzer for deep type queries
- Added Find Implementations command with structural matching
- Added Git integration for tracking uncommitted changes
- Added actual performance benchmarks from freeCodeCamp codebase
- Updated file structure to reflect implementation
- Updated implementation status with completed phases

### v1.0 (December 17, 2025)
- Initial specification
