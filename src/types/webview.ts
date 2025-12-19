/**
 * Webview Communication Type Definitions
 */

import { SerializedGraph } from './graph';
import { LayoutAlgorithm } from './config';

// Extension → Webview messages
export type ExtensionMessage =
  | { type: 'init'; data: SerializedGraph }
  | { type: 'update'; data: Partial<SerializedGraph> }
  | { type: 'highlight'; nodeIds: string[] }
  | { type: 'progress'; percent: number; message: string }
  | { type: 'error'; message: string }
  | { type: 'themeChanged'; theme: 'light' | 'dark' };

// Webview → Extension messages
export type WebviewMessage =
  | { type: 'nodeClick'; nodeId: string }
  | { type: 'nodeExpand'; nodeId: string }
  | { type: 'nodeCollapse'; nodeId: string }
  | { type: 'search'; query: string }
  | { type: 'export'; format: 'svg' | 'png' | 'json' }
  | { type: 'layoutChange'; layout: LayoutAlgorithm }
  | { type: 'ready' };
