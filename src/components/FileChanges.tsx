/**
 * FileChanges — slide-in side panel showing files changed in the current session.
 *
 * Two view modes:
 * - "Changes": files written/edited/deleted by the AI in this session
 * - "All files": full directory tree of the working directory
 *
 * The panel can be detached by dragging the header, becoming a floating window.
 * It snaps back to the docked position when dragged close to the right edge.
 * The width is resizable via a drag handle on the left edge of the panel.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import type { FileTreeNode } from '../types';
import { useFileChanges } from '../hooks/useFileChanges';
import '../styles/filechanges.css';

interface FileChangesProps {
  ocSessionId: string | undefined;
  open: boolean;
  onToggle: () => void;
  externalDirectory?: string;
  onViewFile?: (absolutePath: string | null) => void;
  onDetachChange?: (detached: boolean) => void;
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

export function FileChanges({ ocSessionId, open, onToggle, externalDirectory, onViewFile, onDetachChange }: FileChangesProps) {
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

  const [snapRadius, setSnapRadius] = useState(100);
  const [detachThreshold, setDetachThreshold] = useState(20);
  const [snapDuration, setSnapDuration] = useState(260);

  useEffect(() => {
    const style = getComputedStyle(document.documentElement);
    const sr = parseInt(style.getPropertyValue('--fc-snap-radius'), 10);
    const dt = parseInt(style.getPropertyValue('--fc-detach-threshold'), 10);
    const sd = parseInt(style.getPropertyValue('--fc-snap-duration'), 10);
    if (!isNaN(sr)) setSnapRadius(sr);
    if (!isNaN(dt)) setDetachThreshold(dt);
    if (!isNaN(sd)) setSnapDuration(sd);
  }, []);

  const [panelWidth, setPanelWidth] = useState(280);
  const [isDetached, setIsDetached] = useState(false);
  const [isSnapping, setIsSnapping] = useState(false);
  const [hasSlid, setHasSlid] = useState(false);
  const [detachedPos, setDetachedPos] = useState({ x: 0, y: 0 });
  const [detachedSize, setDetachedSize] = useState({ w: 280, h: 500 });

  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    dragging: boolean;
    detached: boolean;
  } | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const detachedPosRef = useRef({ x: 0, y: 0 });
  const detachedSizeRef = useRef({ w: 280, h: 500 });
  const panelWidthRef = useRef(280);
  const snapRadiusRef = useRef(100);
  const detachThresholdRef = useRef(20);
  const snapDurationRef = useRef(260);

  useEffect(() => {
    document.documentElement.style.setProperty('--fc-panel-width', `${panelWidth}px`);
    panelWidthRef.current = panelWidth;
  }, [panelWidth]);

  useEffect(() => { onDetachChange?.(isDetached); }, [isDetached, onDetachChange]);
  useEffect(() => { detachedPosRef.current = detachedPos; }, [detachedPos]);
  useEffect(() => { detachedSizeRef.current = detachedSize; }, [detachedSize]);
  useEffect(() => { snapRadiusRef.current = snapRadius; }, [snapRadius]);
  useEffect(() => { detachThresholdRef.current = detachThreshold; }, [detachThreshold]);
  useEffect(() => { snapDurationRef.current = snapDuration; }, [snapDuration]);

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const newW = Math.max(200, Math.min(600, r.startW + (r.startX - e.clientX)));
      setPanelWidth(newW);
    };
    const handleUp = () => {
      if (!resizeRef.current) return;
      resizeRef.current = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
    return () => {
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
    };
  }, []);

  useEffect(() => {
    const handleDragMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;

      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (!d.detached && dist < detachThresholdRef.current) return;

      if (!d.detached) {
        d.detached = true;
        const panel = panelRef.current;
        if (panel) {
          const rect = panel.getBoundingClientRect();
          d.offsetX = e.clientX - rect.left;
          d.offsetY = e.clientY - rect.top;
          setDetachedSize({ w: rect.width, h: rect.height });
        }
        setIsDetached(true);
        setIsSnapping(false);
      }

      setDetachedPos({
        x: e.clientX - d.offsetX,
        y: e.clientY - d.offsetY,
      });
    };

    const handleDragUp = () => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';

      if (!d.detached) return;

      const pos = detachedPosRef.current;
      const size = detachedSizeRef.current;
      const pw = panelWidthRef.current;
      const rightEdgeDist = window.innerWidth - (pos.x + size.w);
      if (rightEdgeDist < snapRadiusRef.current) {
        setIsSnapping(true);
        setDetachedPos({ x: window.innerWidth - pw, y: 36 });
        setDetachedSize({ w: pw, h: window.innerHeight - 36 });
        setTimeout(() => {
          setIsDetached(false);
          setIsSnapping(false);
        }, snapDurationRef.current);
      }
    };

    document.addEventListener('pointermove', handleDragMove);
    document.addEventListener('pointerup', handleDragUp);
    return () => {
      document.removeEventListener('pointermove', handleDragMove);
      document.removeEventListener('pointerup', handleDragUp);
    };
  }, []);

  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    resizeRef.current = { startX: e.clientX, startW: panelWidth };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  }, [panelWidth]);

  const handleHeaderDragStart = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;

    e.preventDefault();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      offsetX: 0,
      offsetY: 0,
      dragging: true,
      detached: false,
    };
    document.body.style.userSelect = 'none';
  }, []);

  const handleSelectFile = useCallback((path: string) => {
    const next = selectedFile === path ? null : path;
    setSelectedFile(next);
    onViewFile?.(next);
  }, [selectedFile, setSelectedFile, onViewFile]);

  const displayTree = viewMode === 'all' ? allFilesTree : fileTree;
  const browseDir = externalDirectory || directory;
  const dirName = browseDir.split('/').pop() || browseDir;

  if (!open) return null;

  const panelClassName = [
    'fc-panel',
    isDetached ? 'fc-panel--detached' : '',
    isSnapping ? 'fc-panel--snapping' : '',
    hasSlid ? 'fc-panel--no-intro' : '',
  ].filter(Boolean).join(' ');

  const panelStyle: React.CSSProperties = isDetached
    ? {
        width: `${detachedSize.w}px`,
        height: `${detachedSize.h}px`,
        left: `${detachedPos.x}px`,
        top: `${detachedPos.y}px`,
        position: 'fixed',
      }
    : { width: `${panelWidth}px` };

  return (
    <aside className={panelClassName} style={panelStyle} ref={panelRef} onAnimationEnd={() => setHasSlid(true)}>
      {!isDetached && <div className="fc-resize-handle" onPointerDown={handleResizeStart} />}
      <div className="fc-header" onPointerDown={handleHeaderDragStart} style={{ cursor: 'grab' }}>
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
