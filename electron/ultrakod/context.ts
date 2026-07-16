// Shared context system for all models per project.
// Maintains a single source of truth for project state that persists across model switches.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

export interface ProjectContext {
  projectId: string;
  projectRoot: string;
  createdAt: string;
  updatedAt: string;
  gitDiff: string;
  fileTree: FileTreeEntry[];
  executiveSummary: string;
  modelHistory: ModelSwitchRecord[];
  activeModel: string;
  resetAt?: string; // ISO timestamp for quota reset
  metadata: Record<string, unknown>;
}

export interface FileTreeEntry {
  path: string;
  type: 'file' | 'directory';
  modified: boolean;
  lastCommit?: string;
}

export interface ModelSwitchRecord {
  fromModel: string;
  toModel: string;
  reason: string;
  timestamp: string;
  contextSnapshot: string;
}

const CONTEXT_DIR = '.ultrakod';
const CONTEXT_FILE = 'context.json';

function getContextDir(projectRoot: string): string {
  return join(projectRoot, CONTEXT_DIR);
}

function getContextPath(projectRoot: string): string {
  return join(getContextDir(projectRoot), CONTEXT_FILE);
}

function ensureContextDir(projectRoot: string): void {
  const dir = getContextDir(projectRoot);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function getGitDiff(projectRoot: string): string {
  try {
    return execSync('git diff --stat && echo "---FULL DIFF---" && git diff', {
      cwd: projectRoot,
      encoding: 'utf-8',
      timeout: 5000,
    });
  } catch {
    return 'Unable to get git diff';
  }
}

function getFileTree(projectRoot: string): FileTreeEntry[] {
  try {
    const output = execSync('git status --porcelain', {
      cwd: projectRoot,
      encoding: 'utf-8',
      timeout: 5000,
    });

    return output
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        const status = line.substring(0, 2).trim();
        const path = line.substring(3);
        return {
          path,
          type: path.endsWith('/') ? ('directory' as const) : ('file' as const),
          modified: status !== '??',
        };
      });
  } catch {
    return [];
  }
}

export function loadContext(projectRoot: string): ProjectContext | null {
  const contextPath = getContextPath(projectRoot);
  if (!existsSync(contextPath)) {
    return null;
  }

  try {
    const data = readFileSync(contextPath, 'utf-8');
    return JSON.parse(data) as ProjectContext;
  } catch {
    return null;
  }
}

export function saveContext(context: ProjectContext): void {
  ensureContextDir(context.projectRoot);
  const contextPath = getContextPath(context.projectRoot);
  context.updatedAt = new Date().toISOString();
  writeFileSync(contextPath, JSON.stringify(context, null, 2));
}

export function initializeContext(
  projectRoot: string,
  projectId: string,
  initialModel: string,
): ProjectContext {
  const existing = loadContext(projectRoot);
  if (existing) {
    return existing;
  }

  const context: ProjectContext = {
    projectId,
    projectRoot,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    gitDiff: '',
    fileTree: [],
    executiveSummary: '',
    modelHistory: [],
    activeModel: initialModel,
    metadata: {},
  };

  saveContext(context);
  return context;
}

export function updateContextForModelSwitch(
  context: ProjectContext,
  newModel: string,
  reason: string,
): ProjectContext {
  const switchRecord: ModelSwitchRecord = {
    fromModel: context.activeModel,
    toModel: newModel,
    reason,
    timestamp: new Date().toISOString(),
    contextSnapshot: context.executiveSummary,
  };

  context.modelHistory.push(switchRecord);
  context.activeModel = newModel;
  context.gitDiff = getGitDiff(context.projectRoot);
  context.fileTree = getFileTree(context.projectRoot);

  return context;
}

export function setExecutiveSummary(context: ProjectContext, summary: string): ProjectContext {
  context.executiveSummary = summary;
  return context;
}

export function setResetTime(context: ProjectContext, resetAt: string): ProjectContext {
  context.resetAt = resetAt;
  return context;
}

export function isResetDue(context: ProjectContext): boolean {
  if (!context.resetAt) {
    return false;
  }
  return new Date() >= new Date(context.resetAt);
}

export function getContextForModel(context: ProjectContext, modelId: string): string {
  return JSON.stringify(
    {
      projectId: context.projectId,
      activeModel: context.activeModel,
      requestedModel: modelId,
      gitDiff: context.gitDiff,
      fileTree: context.fileTree,
      executiveSummary: context.executiveSummary,
      modelHistory: context.modelHistory.slice(-5),
      resetAt: context.resetAt,
    },
    null,
    2,
  );
}
