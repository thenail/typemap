/**
 * Utility Type Definitions
 */

import { MindmapNode } from './graph';

export interface Position {
  x: number;
  y: number;
}

export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

export interface LayoutNode extends MindmapNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Result type for operations that can fail
 */
export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

/**
 * Disposable interface for cleanup
 */
export interface Disposable {
  dispose(): void;
}
