import { useState, useCallback } from 'react';
import type { FileTreeNode } from '../types';
import { useFileChanges } from '../hooks/useFileChanges';
import '../styles/filechanges.css';

interface FileChangesProps {
  ocSessionId: string | undefined;
  open: boolean;
  onToggle: () => void;
  externalDirectory?: string;
  onViewFile?: (absolutePath: string | null) => void;
}

const FolderIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const FileIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

const ChevronRight = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const STATUS_COLORS: Record<string, string> = {
  added: '#22c55e',
  modified: '#f59e0b',
  deleted: '#ef4444',
};

function TreeNode({
  node,
  depth,
  selectedFile,
  onSelectFile,
  onExpandDir,
  defaultOpen,
}: {
  node: FileTreeNode;
  depth: number;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  onExpandDir?: (dirPath: string) => void;
  defaultOpen: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultOpen);
  const isDir = node.type === 'directory';
  const isSelected = node.path === selectedFile;
  const needsLoad = isDir && node.children?.length === 0;

  const handleClick = useCallback(() => {
    if (isDir) {
      const willExpand = !expanded;
      setExpanded(willExpand);
      if (willExpand && needsLoad && onExpandDir) {
        onExpandDir(node.path);
      }
    } else {
      onSelectFile(node.path);
    }
  }, [isDir, expanded, needsLoad, node.path, onSelectFile, onExpandDir]);

  const statusColor = node.change ? STATUS_COLORS[node.change.status] : undefined;

  return (
    <>
      <div
        className={`fc-tree-item${isSelected ? ' selected' : ''}`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={handleClick}
      >
        {isDir && (
          <span className={`fc-chevron${expanded ? ' expanded' : ''}`}>
            <ChevronRight />
          </span>
        )}
        <span className="fc-tree-icon">
          {isDir ? <FolderIcon /> : <FileIcon />}
        </span>
        <span className="fc-tree-name" style={statusColor ? { color: statusColor } : undefined}>
          {node.name}
        </span>
        {statusColor && (
          <span className="fc-change-dot" style={{ background: statusColor }} />
        )}
      </div>
      {isDir && expanded && node.children?.map((child) => (
        <TreeNode
          key={child.path}
          node={child}
          depth={depth + 1}
          selectedFile={selectedFile}
          onSelectFile={onSelectFile}
          onExpandDir={onExpandDir}
          defaultOpen={defaultOpen}
        />
      ))}
    </>
  );
}

export function FileChanges({ ocSessionId, open, onToggle, externalDirectory, onViewFile }: FileChangesProps) {
  const {
    changes,
    fileTree,
    allFilesTree,
    loading,
    selectedFile,
    setSelectedFile,
    directory,
    viewMode,
    setViewMode,
    loadChildren,
  } = useFileChanges(ocSessionId, externalDirectory, open);

  const handleSelectFile = useCallback((path: string) => {
    const next = selectedFile === path ? null : path;
    setSelectedFile(next);
    onViewFile?.(next);
  }, [selectedFile, setSelectedFile, onViewFile]);

  const displayTree = viewMode === 'all' ? allFilesTree : fileTree;
  const browseDir = externalDirectory || directory;
  const dirName = browseDir.split('/').pop() || browseDir;

  if (!open) return null;

  return (
    <aside className="fc-panel">
      <div className="fc-header">
        <div className="fc-header-left">
          <span className="fc-count">
            {viewMode === 'changes' ? `${changes.length} Changes` : dirName}
          </span>
        </div>
        <div className="fc-header-right">
          <div className="fc-view-toggle">
            <button
              className={`fc-view-btn${viewMode === 'changes' ? ' active' : ''}`}
              onClick={() => setViewMode('changes')}
            >
              Changes
            </button>
            <button
              className={`fc-view-btn${viewMode === 'all' ? ' active' : ''}`}
              onClick={() => setViewMode('all')}
            >
              All files
            </button>
          </div>
          <button className="fc-close-btn" onClick={onToggle} aria-label="Close panel">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <div className="fc-body">
        {loading && displayTree.length === 0 && (
          <div className="fc-loading">Loading...</div>
        )}

        {!loading && viewMode === 'changes' && changes.length === 0 && (
          <div className="fc-empty">{ocSessionId ? 'No changes in this session' : 'No changes'}</div>
        )}

        {!loading && viewMode === 'all' && allFilesTree.length === 0 && (
          <div className="fc-empty">No files</div>
        )}

        <div className="fc-tree">
          {displayTree.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              selectedFile={selectedFile}
              onSelectFile={handleSelectFile}
              onExpandDir={viewMode === 'all' ? loadChildren : undefined}
              defaultOpen={viewMode === 'changes'}
            />
          ))}
        </div>

        
      </div>
    </aside>
  );
}
