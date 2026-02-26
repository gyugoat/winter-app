/**
 * useFileChanges — tracks file changes made during an OpenCode session.
 *
 * Polls the OpenCode message history every 5 seconds to extract file operations
 * (write, edit, bash rm) and builds two parallel views:
 * - `fileTree`: tree of files changed in this session
 * - `allFilesTree`: full directory listing with change overlays
 *
 * The hook also handles lazy-loading of directory children and tracks the
 * home/worktree paths from the Rust backend for correct relative path resolution.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '../utils/invoke-shim';
import type { FileChange, FileTreeNode } from '../types';
const POLL_INTERVAL = 5000;

export type ViewMode = 'changes' | 'all';

interface UseFileChangesReturn {
  changes: FileChange[];
  fileTree: FileTreeNode[];
  allFilesTree: FileTreeNode[];
  loading: boolean;
  error: string | null;
  selectedFile: string | null;
  setSelectedFile: (path: string | null) => void;
  directory: string;
  setDirectory: (dir: string) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  loadChildren: (dirPath: string) => Promise<void>;
}


function buildTree(changes: FileChange[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  const dirMap = new Map<string, FileTreeNode>();

  for (const change of changes) {
    const cleanPath = change.path.replace(/^(\.\.\/)+/, '').replace(/^\.\//, '').replace(/^\//, '');
    const parts = cleanPath.split('/');
    let currentChildren = root;
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFile = i === parts.length - 1;

      if (isFile) {
        currentChildren.push({
          name: part,
          path: change.path,
          type: 'file',
          change,
        });
      } else {
        let dirNode = dirMap.get(currentPath);
        if (!dirNode) {
          dirNode = { name: part, path: currentPath, type: 'directory', children: [] };
          dirMap.set(currentPath, dirNode);
          currentChildren.push(dirNode);
        }
        currentChildren = dirNode.children!;
      }
    }
  }

  return root;
}

interface ApiFileEntry {
  name: string;
  path: string;
  absolute: string;
  type: 'file' | 'directory';
  ignored: boolean;
}

function dirChangeStatus(dirAbsolute: string, changesMap: Map<string, FileChange>): FileChange | undefined {
  const prefix = dirAbsolute.endsWith('/') ? dirAbsolute : dirAbsolute + '/';
  let found: FileChange | undefined;
  for (const [key, change] of changesMap) {
    if (!key.startsWith('/')) continue;
    if (key.startsWith(prefix)) {
      if (!found || change.status === 'added') found = change;
      if (found.status === 'added') break;
    }
  }
  return found;
}

function apiFilesToTree(files: ApiFileEntry[], changesMap: Map<string, FileChange>): FileTreeNode[] {
  return files
    .filter((f) => !f.ignored)
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .map((f): FileTreeNode => ({
      name: f.name,
      path: f.absolute,
      type: f.type,
      children: f.type === 'directory' ? [] : undefined,
      change: f.type === 'directory'
        ? dirChangeStatus(f.absolute, changesMap)
        : (changesMap.get(f.path) ?? changesMap.get(f.absolute) ?? changesMap.get(f.name)),
    }));
}

function toRelativePath(absPath: string, homePath: string): string {
  if (absPath === homePath) return '.';
  if (absPath.startsWith(homePath + '/')) return absPath.slice(homePath.length + 1);
  return absPath;
}

export function useFileChanges(ocSessionId: string | undefined, initialDirectory?: string, enabled = true): UseFileChangesReturn {
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  const [allFilesTree, setAllFilesTree] = useState<FileTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [directory, setDirectory] = useState(initialDirectory ?? '');
  const [viewMode, setViewMode] = useState<ViewMode>('changes');
  const changesMapRef = useRef<Map<string, FileChange>>(new Map());
  const homePathRef = useRef<string>('');
  const worktreeRef = useRef<string>('');
  const opencodeDirRef = useRef<string>('');
  const [pathReady, setPathReady] = useState(false);
  const sessionChangesCache = useRef<{ id: string; changes: FileChange[] }>({ id: '', changes: [] });

  const fetchHomePath = useCallback(async () => {
    try {
      const data = await invoke<{ home?: string; worktree?: string; directory?: string }>('opencode_get_path');
      if (data.home) homePathRef.current = data.home;
      if (data.worktree) worktreeRef.current = data.worktree;
      if (data.directory) opencodeDirRef.current = data.directory;
      if (!initialDirectory && data.directory) setDirectory(data.directory);
    } catch { /* best-effort */ }
    setPathReady(true);
  }, [initialDirectory]);

  const fetchSessionChanges = useCallback(async (sessionId: string): Promise<FileChange[]> => {
    try {
      const messages: Array<{ parts: Array<{ type: string; tool?: string; state?: { status?: string; input?: Record<string, string>; metadata?: { exists?: boolean; output?: string; exit?: number } } }> }> = await invoke('opencode_get_messages', { sessionId });

      const fileTools = new Set(['write', 'edit', 'multiEdit', 'multi_edit']);
      const bashTools = new Set(['bash', 'shell', 'shell_exec']);
      const fileMap = new Map<string, 'added' | 'modified' | 'deleted'>();

      for (const msg of messages) {
        for (const part of msg.parts ?? []) {
          if (part.type !== 'tool') continue;
          const toolName = part.tool ?? '';
          const state = part.state;
          if (!state || typeof state !== 'object') continue;
          if (state.status !== 'completed') continue;

          if (bashTools.has(toolName)) {
            const cmd = state.input?.command ?? '';
            const rmMatch = cmd.match(/\b(?:rm|trash)\s+(?:-\w+\s+)*(.+)/);
            if (rmMatch) {
              const rawArgs = rmMatch[1].replace(/[;&|].*$/, '');
              const paths = rawArgs
                .split(/\s+/)
                .map(p => p.replace(/^["']+|["']+$/g, ''))
                .filter(p => p.startsWith('/') && p.length > 1);
              for (const p of paths) {
                fileMap.set(p, 'deleted');
              }
            }
            continue;
          }

          if (!fileTools.has(toolName)) continue;
          const filePath = state.input?.filePath;
          if (!filePath) continue;
          const existed = state.metadata?.exists ?? true;
          const isEdit = toolName.includes('edit') || toolName.includes('Edit');

          const prev = fileMap.get(filePath);
          if (isEdit) {
            fileMap.set(filePath, 'modified');
          } else if (prev === 'deleted') {
            fileMap.set(filePath, 'modified');
          } else {
            fileMap.set(filePath, existed ? 'modified' : 'added');
          }
        }
      }

      return Array.from(fileMap.entries()).map(([absPath, status]) => {
        return {
          path: absPath,
          absolute: absPath,
          status,
          additions: 0,
          deletions: 0,
        };
      });
    } catch { return []; }
  }, []);

  const fetchChanges = useCallback(async () => {
    if (!directory) return;

    try {
      let sessionChanges: FileChange[] = [];
      if (ocSessionId) {
        sessionChanges = await fetchSessionChanges(ocSessionId);
        sessionChangesCache.current = { id: ocSessionId, changes: sessionChanges };
      }

      const map = new Map<string, FileChange>();
      for (const c of sessionChanges) {
        if (c.path) map.set(c.path, c);
        if (c.absolute) map.set(c.absolute, c);
        const fname = (c.absolute || c.path).split('/').pop();
        if (fname) map.set(fname, c);
      }
      changesMapRef.current = map;

      setChanges(sessionChanges);
      setFileTree(buildTree(sessionChanges));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch changes');
    }
  }, [directory, ocSessionId, fetchSessionChanges]);

  useEffect(() => {
    fetchHomePath();
  }, [fetchHomePath]);

  const fetchAllFiles = useCallback(async () => {
    const browseDir = initialDirectory || directory;
    if (!browseDir) return;
    // Use the OpenCode workspace directory (opencodeDirRef) as the base for
    // relative-path resolution — NOT the user's $HOME (homePathRef).
    // The OpenCode /file endpoint expects paths relative to its workspace root,
    // so e.g. the workspace root itself should map to "." not ".winter/workspace".
    const base = opencodeDirRef.current || worktreeRef.current || homePathRef.current;
    const relPath = base ? toRelativePath(browseDir, base) : browseDir;
    try {
      const data: ApiFileEntry[] = await invoke('opencode_list_files', { path: relPath });
      const tree = apiFilesToTree(data, changesMapRef.current);

      const existingPaths = new Set(data.map(f => f.absolute));
      const dirPrefix = browseDir.endsWith('/') ? browseDir : browseDir + '/';
      for (const [key, change] of changesMapRef.current) {
        if (change.status !== 'deleted' || !key.startsWith('/')) continue;
        if (existingPaths.has(key)) continue;
        if (!key.startsWith(dirPrefix)) continue;
        const remaining = key.slice(dirPrefix.length);
        if (remaining.includes('/')) continue;
        tree.push({
          name: remaining,
          path: key,
          type: 'file',
          change,
        });
      }

      setAllFilesTree(tree);
    } catch { /* best-effort */ }
  }, [initialDirectory, directory]);

  const loadChildren = useCallback(async (dirPath: string) => {
    const base = opencodeDirRef.current || worktreeRef.current || homePathRef.current;
    const relPath = base ? toRelativePath(dirPath, base) : dirPath;
    try {
      const data: ApiFileEntry[] = await invoke('opencode_list_files', { path: relPath });
      const children = apiFilesToTree(data, changesMapRef.current);

      setAllFilesTree((prev) => {
        const update = (nodes: FileTreeNode[]): FileTreeNode[] =>
          nodes.map((n) => {
            if (n.path === dirPath && n.type === 'directory') {
              return { ...n, children };
            }
            if (n.children) {
              return { ...n, children: update(n.children) };
            }
            return n;
          });
        return update(prev);
      });
    } catch {
      /* best-effort */
    }
  }, []);

  useEffect(() => {
    if (!directory || !enabled) return;

    setLoading(true);
    fetchChanges().finally(() => setLoading(false));

    const interval = setInterval(fetchChanges, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [directory, fetchChanges, enabled]);

  useEffect(() => {
    if (viewMode === 'all' && pathReady && (initialDirectory || directory)) {
      fetchAllFiles();
    }
  }, [viewMode, pathReady, initialDirectory, directory, fetchAllFiles]);

  return {
    changes,
    fileTree,
    allFilesTree,
    loading,
    error,
    selectedFile,
    setSelectedFile,
    directory,
    setDirectory,
    viewMode,
    setViewMode,
    loadChildren,
  };
}
