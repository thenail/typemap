/**
 * Configuration Type Definitions
 */

export type LayoutAlgorithm = 'radial' | 'tree' | 'force-directed' | 'cluster';
export type Theme = 'auto' | 'light' | 'dark';

export interface TypeMapConfig {
  analysis: {
    include: string[];
    exclude: string[];
    maxFiles: number;
    maxDepth: number;
  };
  visualization: {
    layout: LayoutAlgorithm;
    theme: Theme;
  };
  performance: {
    workerCount: number;
    cacheSize: number;
  };
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: TypeMapConfig = {
  analysis: {
    include: ['**/*.ts', '**/*.tsx'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/*.spec.ts',
      '**/*.spec.tsx',
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.d.ts',
      '**/*.d.tsx'
    ],
    maxFiles: 10000,
    maxDepth: 5
  },
  visualization: {
    layout: 'radial',
    theme: 'auto'
  },
  performance: {
    workerCount: 0,
    cacheSize: 100
  }
};
