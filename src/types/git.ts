/**
 * Git Integration Type Definitions
 */

export type GitChangeStatus =
  | 'modified'      // File has been modified
  | 'added'         // New file (untracked or staged new)
  | 'deleted'       // File has been deleted
  | 'renamed'       // File has been renamed
  | 'untracked'     // New untracked file
  | 'staged'        // Changes are staged
  | 'conflict'      // Merge conflict
  | 'unchanged';    // No changes

export interface GitFileChange {
  filePath: string;
  status: GitChangeStatus;
  originalPath?: string;  // For renamed files
  additions?: number;     // Lines added
  deletions?: number;     // Lines deleted
  isStaged: boolean;
}

export interface GitRepositoryInfo {
  rootPath: string;
  branch: string;
  ahead: number;          // Commits ahead of remote
  behind: number;         // Commits behind remote
  hasChanges: boolean;
}

export interface GitAnalysisResult {
  repository: GitRepositoryInfo | null;
  changes: Map<string, GitFileChange>;
  totalChangedFiles: number;
  hasUncommittedChanges: boolean;
}
