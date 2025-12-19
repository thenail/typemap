/**
 * TypeMap Constants
 * Centralized constant values used throughout the extension
 */

/**
 * Extension identifiers
 */
export const EXTENSION_ID = 'typemap';
export const EXTENSION_NAME = 'TypeMap';

/**
 * Command identifiers
 */
export const COMMANDS = {
  ANALYZE: `${EXTENSION_ID}.analyze`,
  ANALYZE_FILE: `${EXTENSION_ID}.analyzeFile`,
  SHOW_MINDMAP: `${EXTENSION_ID}.showMindmap`,
  SHOW_MINDMAP_D3: `${EXTENSION_ID}.showMindmapD3`,
  SHOW_TYPE_HIERARCHY: `${EXTENSION_ID}.showTypeHierarchy`,
  SHOW_DEPENDENCIES: `${EXTENSION_ID}.showDependencies`,
  REFRESH: `${EXTENSION_ID}.refresh`,
  CLEAR_CACHE: `${EXTENSION_ID}.clearCache`,
  EXPORT_SVG: `${EXTENSION_ID}.exportSVG`,
  EXPORT_JSON: `${EXTENSION_ID}.exportJSON`,
  FIND_IMPLEMENTATIONS: `${EXTENSION_ID}.findImplementations`,
  VISUALIZATION_DEMO: `${EXTENSION_ID}.visualizationDemo`,
} as const;

/**
 * Context keys for conditional command visibility
 */
export const CONTEXT_KEYS = {
  HAS_ANALYSIS: `${EXTENSION_ID}.hasAnalysis`,
} as const;

/**
 * Storage keys for workspace/global state
 */
export const STORAGE_KEYS = {
  LAST_ANALYSIS: `${EXTENSION_ID}.lastAnalysis`,
  GRAPH_DATA: `${EXTENSION_ID}.graphData`,
  CACHE_PREFIX: `${EXTENSION_ID}.cache`,
} as const;

/**
 * Webview identifiers
 */
export const WEBVIEW = {
  MINDMAP_VIEW_TYPE: `${EXTENSION_ID}Mindmap`,
  MINDMAP_TITLE: 'TypeMap Mindmap',
} as const;

/**
 * File patterns
 */
export const FILE_PATTERNS = {
  TYPESCRIPT: '**/*.ts',
  TSX: '**/*.tsx',
  ALL_TS: '**/*.{ts,tsx}',
} as const;

/**
 * Default exclude patterns
 */
export const DEFAULT_EXCLUDES = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/*.spec.ts',
  '**/*.spec.tsx',
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.d.ts',
  '**/*.d.tsx',
] as const;

/**
 * Performance limits
 */
export const LIMITS = {
  MAX_FILES: 50000,
  MAX_DEPTH: 50,
  DEFAULT_CACHE_SIZE_MB: 100,
  BATCH_SIZE: 50,
} as const;
