/**
 * Git Integration Service
 * 
 * Integrates with VS Code's built-in Git extension to retrieve
 * information about file changes in the workspace.
 */

import * as vscode from 'vscode';
import { 
  GitAnalysisResult, 
  GitFileChange, 
  GitChangeStatus, 
  GitRepositoryInfo 
} from '../types';
import { logger } from '../utils';

// Git extension API types (from VS Code's git extension)
interface GitExtension {
  getAPI(version: number): GitAPI;
}

interface GitAPI {
  repositories: Repository[];
  onDidOpenRepository: vscode.Event<Repository>;
  onDidCloseRepository: vscode.Event<Repository>;
}

interface Repository {
  rootUri: vscode.Uri;
  state: RepositoryState;
  inputBox: { value: string };
}

interface RepositoryState {
  HEAD: Branch | undefined;
  refs: Ref[];
  remotes: Remote[];
  submodules: Submodule[];
  rebaseCommit: Commit | undefined;
  mergeChanges: Change[];
  indexChanges: Change[];      // Staged changes
  workingTreeChanges: Change[]; // Unstaged changes
  onDidChange: vscode.Event<void>;
}

interface Branch {
  name: string | undefined;
  commit: string | undefined;
  upstream?: { name: string; remote: string; };
  ahead?: number;
  behind?: number;
}

interface Ref {
  type: number;
  name: string | undefined;
  commit: string | undefined;
  remote: string | undefined;
}

interface Remote {
  name: string;
  fetchUrl: string | undefined;
  pushUrl: string | undefined;
}

interface Submodule {
  name: string;
  path: string;
  url: string;
}

interface Commit {
  hash: string;
  message: string;
  parents: string[];
  authorDate?: Date;
  authorName?: string;
  authorEmail?: string;
  commitDate?: Date;
}

interface Change {
  uri: vscode.Uri;
  originalUri: vscode.Uri;
  renameUri: vscode.Uri | undefined;
  status: Status;
}

// Git status codes
const enum Status {
  INDEX_MODIFIED = 0,
  INDEX_ADDED = 1,
  INDEX_DELETED = 2,
  INDEX_RENAMED = 3,
  INDEX_COPIED = 4,

  MODIFIED = 5,
  DELETED = 6,
  UNTRACKED = 7,
  IGNORED = 8,
  INTENT_TO_ADD = 9,
  INTENT_TO_RENAME = 10,
  TYPE_CHANGED = 11,

  ADDED_BY_US = 12,
  ADDED_BY_THEM = 13,
  DELETED_BY_US = 14,
  DELETED_BY_THEM = 15,
  BOTH_ADDED = 16,
  BOTH_DELETED = 17,
  BOTH_MODIFIED = 18,
}

export class GitIntegration {
  private gitApi: GitAPI | null = null;
  private initialized = false;

  /**
   * Initialize the Git integration by getting VS Code's Git extension API
   */
  async initialize(): Promise<boolean> {
    try {
      const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
      
      if (!gitExtension) {
        logger.warn('Git extension not found');
        return false;
      }

      if (!gitExtension.isActive) {
        await gitExtension.activate();
      }

      this.gitApi = gitExtension.exports.getAPI(1);
      this.initialized = true;
      logger.info('Git integration initialized');
      return true;
    } catch (error) {
      logger.error('Failed to initialize Git integration:', error as Error);
      return false;
    }
  }

  /**
   * Get all git changes for files in the workspace
   */
  async getChanges(workspaceRoot: string): Promise<GitAnalysisResult> {
    if (!this.initialized || !this.gitApi) {
      return {
        repository: null,
        changes: new Map(),
        totalChangedFiles: 0,
        hasUncommittedChanges: false,
      };
    }

    // Find the repository for this workspace
    const repo = this.gitApi.repositories.find(r => 
      workspaceRoot.toLowerCase().startsWith(r.rootUri.fsPath.toLowerCase())
    );

    if (!repo) {
      logger.debug('No git repository found for workspace:', workspaceRoot);
      return {
        repository: null,
        changes: new Map(),
        totalChangedFiles: 0,
        hasUncommittedChanges: false,
      };
    }

    const changes = new Map<string, GitFileChange>();

    // Process staged changes (index)
    for (const change of repo.state.indexChanges) {
      const filePath = change.uri.fsPath;
      const status = this.mapStatusToGitChangeStatus(change.status, true);
      
      changes.set(filePath, {
        filePath,
        status,
        originalPath: change.renameUri?.fsPath,
        isStaged: true,
      });
    }

    // Process working tree changes (unstaged)
    for (const change of repo.state.workingTreeChanges) {
      const filePath = change.uri.fsPath;
      const existing = changes.get(filePath);
      
      // If file is both staged and has working tree changes, mark as modified
      if (existing) {
        existing.status = 'modified';
        existing.isStaged = false; // Has unstaged changes too
      } else {
        const status = this.mapStatusToGitChangeStatus(change.status, false);
        changes.set(filePath, {
          filePath,
          status,
          originalPath: change.renameUri?.fsPath,
          isStaged: false,
        });
      }
    }

    // Process merge conflicts
    for (const change of repo.state.mergeChanges) {
      const filePath = change.uri.fsPath;
      changes.set(filePath, {
        filePath,
        status: 'conflict',
        isStaged: false,
      });
    }

    // Build repository info
    const repoInfo: GitRepositoryInfo = {
      rootPath: repo.rootUri.fsPath,
      branch: repo.state.HEAD?.name || 'HEAD',
      ahead: repo.state.HEAD?.ahead || 0,
      behind: repo.state.HEAD?.behind || 0,
      hasChanges: changes.size > 0,
    };

    return {
      repository: repoInfo,
      changes,
      totalChangedFiles: changes.size,
      hasUncommittedChanges: changes.size > 0,
    };
  }

  /**
   * Get git change status for a specific file
   */
  getFileStatus(filePath: string, gitResult: GitAnalysisResult): GitChangeStatus {
    const change = gitResult.changes.get(filePath);
    return change?.status || 'unchanged';
  }

  /**
   * Check if a file has uncommitted changes
   */
  hasChanges(filePath: string, gitResult: GitAnalysisResult): boolean {
    return gitResult.changes.has(filePath);
  }

  /**
   * Map VS Code Git status to our GitChangeStatus
   */
  private mapStatusToGitChangeStatus(status: Status, isStaged: boolean): GitChangeStatus {
    switch (status) {
      case Status.INDEX_MODIFIED:
      case Status.MODIFIED:
      case Status.TYPE_CHANGED:
        return isStaged ? 'staged' : 'modified';

      case Status.INDEX_ADDED:
      case Status.INTENT_TO_ADD:
        return isStaged ? 'staged' : 'added';

      case Status.INDEX_DELETED:
      case Status.DELETED:
        return 'deleted';

      case Status.INDEX_RENAMED:
      case Status.INTENT_TO_RENAME:
        return 'renamed';

      case Status.UNTRACKED:
        return 'untracked';

      case Status.ADDED_BY_US:
      case Status.ADDED_BY_THEM:
      case Status.DELETED_BY_US:
      case Status.DELETED_BY_THEM:
      case Status.BOTH_ADDED:
      case Status.BOTH_DELETED:
      case Status.BOTH_MODIFIED:
        return 'conflict';

      case Status.IGNORED:
      case Status.INDEX_COPIED:
      default:
        return 'unchanged';
    }
  }

  /**
   * Subscribe to git changes
   */
  onDidChange(callback: () => void): vscode.Disposable | null {
    if (!this.initialized || !this.gitApi) {
      return null;
    }

    const disposables: vscode.Disposable[] = [];

    for (const repo of this.gitApi.repositories) {
      disposables.push(repo.state.onDidChange(callback));
    }

    return vscode.Disposable.from(...disposables);
  }

  /**
   * Get statistics about changes by status
   */
  getChangeStatistics(gitResult: GitAnalysisResult): Record<GitChangeStatus, number> {
    const stats: Record<GitChangeStatus, number> = {
      modified: 0,
      added: 0,
      deleted: 0,
      renamed: 0,
      untracked: 0,
      staged: 0,
      conflict: 0,
      unchanged: 0,
    };

    for (const change of gitResult.changes.values()) {
      stats[change.status]++;
    }

    return stats;
  }
}

// Singleton instance
let gitIntegration: GitIntegration | null = null;

export function getGitIntegration(): GitIntegration {
  if (!gitIntegration) {
    gitIntegration = new GitIntegration();
  }
  return gitIntegration;
}
