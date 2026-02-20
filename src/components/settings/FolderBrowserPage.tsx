/**
 * FolderBrowserPage — File system directory browser with history, search, and folder creation.
 *
 * Tauri commands: opencode_get_path, opencode_list_files, search_directories, create_directory.
 * Props: current workingDirectory + onChangeDirectory callback (owned by Chat).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useI18n } from '../../i18n';
import '../../styles/settings-folder.css';

interface FolderBrowserPageProps {
  /** Click-flash ripple handler from useClickFlash */
  onFlash: (e: React.MouseEvent<HTMLElement>) => void;
  /** Currently selected working directory (absolute path) */
  workingDirectory: string;
  /** Called when the user confirms a new directory selection */
  onChangeDirectory: (dir: string) => void;
}

/**
 * Settings page for browsing the filesystem and selecting a working directory.
 *
 * @param onFlash           - ripple effect callback
 * @param workingDirectory  - current working dir (starting point for browser)
 * @param onChangeDirectory - called with selected absolute path on confirm
 */
export function FolderBrowserPage({
  onFlash,
  workingDirectory,
  onChangeDirectory,
}: FolderBrowserPageProps) {
  const { t } = useI18n();
  const [browsePath, setBrowsePath] = useState(workingDirectory || '/home');
  const [dirs, setDirs] = useState<Array<{ name: string; absolute: string }>>([]);
  const [searchResults, setSearchResults] = useState<Array<{ name: string; absolute: string }>>([]);
  const [searchValue, setSearchValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [foldersVisible, setFoldersVisible] = useState(true);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchDone, setSearchDone] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [history, setHistory] = useState<string[]>([workingDirectory || '/home']);
  const [historyIdx, setHistoryIdx] = useState(0);
  const homePathRef = useRef('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const createBtnRef = useRef<HTMLButtonElement>(null);
  const createPopupRef = useRef<HTMLDivElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const toRel = useCallback((abs: string) => {
    const home = homePathRef.current;
    if (!home) return abs;
    if (abs === home) return '.';
    if (abs.startsWith(home + '/')) return abs.slice(home.length + 1);
    return abs;
  }, []);

  useEffect(() => {
    invoke<{ home?: string }>('opencode_get_path')
      .then(d => { if (d.home) homePathRef.current = d.home; })
      .catch(() => {});
  }, []);

  const navigateTo = useCallback(async (dirPath: string, pushHistory = true) => {
    setLoading(true);
    const relPath = toRel(dirPath);
    try {
      const data = await invoke<Array<{ name: string; absolute: string; type: string; ignored: boolean }>>('opencode_list_files', { path: relPath }).catch(() => null);
      if (!data) { setLoading(false); return; }
      if (Array.isArray(data)) {
        // Show all directories — don't filter by `ignored` flag.
        // The OpenCode server marks dotfile contents as ignored (e.g. .winter/*),
        // but users who explicitly navigate into hidden folders expect to see contents.
        const filtered = data
          .filter((f) => f.type === 'directory')
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((f) => ({ name: f.name, absolute: f.absolute }));
        setDirs(filtered);
        setBrowsePath(dirPath);
        setSearchValue('');
        if (pushHistory) {
          setHistory(prev => {
            const trimmed = prev.slice(0, historyIdx + 1);
            return [...trimmed, dirPath];
          });
          setHistoryIdx(prev => prev + 1);
        }
      }
    } catch { /* best-effort */ }
    setLoading(false);
  }, [toRel, historyIdx]);

  const goBack = () => {
    if (historyIdx <= 0) return;
    const newIdx = historyIdx - 1;
    setHistoryIdx(newIdx);
    navigateTo(history[newIdx], false);
  };

  const goForward = () => {
    if (historyIdx >= history.length - 1) return;
    const newIdx = historyIdx + 1;
    setHistoryIdx(newIdx);
    navigateTo(history[newIdx], false);
  };

  const goRefresh = () => {
    navigateTo(browsePath, false);
  };

  useEffect(() => {
    navigateTo(workingDirectory || '/home', false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!searchFocused) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [searchFocused]);

  useEffect(() => {
    if (!creating) return;
    const handler = (e: MouseEvent) => {
      if (
        createPopupRef.current && !createPopupRef.current.contains(e.target as Node) &&
        createBtnRef.current && !createBtnRef.current.contains(e.target as Node)
      ) {
        setCreating(false);
        setNewFolderName('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [creating]);

  const goUp = () => {
    const parent = browsePath.replace(/\/[^/]+$/, '') || '/';
    navigateTo(parent);
  };

  useEffect(() => {
    const q = searchValue.trim();
    if (!q) { setSearchResults([]); setSearchDone(false); return; }
    setSearchDone(false);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const home = homePathRef.current || '/home';
        const results: Array<{ name: string; absolute: string }> = await invoke('search_directories', {
          root: home, query: q, maxResults: 20,
        });
        setSearchResults(results);
      } catch { setSearchResults([]); }
      setSearchDone(true);
    }, 200);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchValue]);

  const hasQuery = searchFocused && searchValue.trim().length > 0;
  const showDropdown = hasQuery && (searchResults.length > 0 || searchDone);

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    const fullPath = browsePath.endsWith('/') ? browsePath + name : browsePath + '/' + name;
    try {
      await invoke('create_directory', { path: fullPath });
      setCreating(false);
      setNewFolderName('');
      navigateTo(browsePath, false);
    } catch { /* best-effort */ }
  };

  return (
    <div className="settings-folder-browser">
      <div className="settings-folder-input-row" ref={dropdownRef}>
        <div className="settings-folder-search-wrap">
          <input
            className="settings-folder-input"
            type="text"
            placeholder="folder name"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === 'Enter' && searchValue.trim()) {
                const match = searchResults[0];
                if (match) {
                  navigateTo(match.absolute);
                  setSearchFocused(false);
                } else {
                  navigateTo(searchValue.trim());
                }
              }
              if (e.key === 'Escape') setSearchFocused(false);
            }}
            autoFocus
          />
          {showDropdown && (
            <div className="settings-folder-dropdown">
              {searchResults.length === 0 ? (
                <div className="settings-folder-dropdown-empty">No folders found</div>
              ) : searchResults.slice(0, 12).map((d) => (
                <button
                  key={d.absolute}
                  className="settings-folder-dropdown-item"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onFlash(e);
                    navigateTo(d.absolute);
                    setSearchFocused(false);
                  }}
                >
                  <span className="settings-folder-dropdown-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                  </span>
                  <span className="settings-folder-dropdown-name">{d.name}</span>
                  <span className="settings-folder-dropdown-path">{d.absolute}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          className="settings-folder-go-btn"
          onClick={(e) => {
            onFlash(e);
            if (searchValue.trim()) {
              const match = searchResults[0];
              if (match) navigateTo(match.absolute);
              else navigateTo(searchValue.trim());
            }
          }}
        >
          {t('folderSearch')}
        </button>
      </div>

      <div className="settings-folder-browse-header">
        <div className="settings-folder-nav-btns">
          <button
            className="settings-folder-nav-btn"
            onClick={(e) => { onFlash(e); goBack(); }}
            disabled={historyIdx <= 0}
            title="Back"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button
            className="settings-folder-nav-btn"
            onClick={(e) => { onFlash(e); goForward(); }}
            disabled={historyIdx >= history.length - 1}
            title="Forward"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
          <button
            className="settings-folder-nav-btn"
            onClick={(e) => { onFlash(e); goUp(); }}
            disabled={browsePath === '/'}
            title="Up"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>
          <button
            className="settings-folder-nav-btn"
            onClick={(e) => { onFlash(e); goRefresh(); }}
            title="Refresh"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
          <button
            ref={createBtnRef}
            className="settings-folder-nav-btn"
            onClick={(e) => { onFlash(e); setCreating(!creating); if (creating) setNewFolderName(''); }}
            title="New folder"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              <line x1="12" y1="11" x2="12" y2="17" />
              <line x1="9" y1="14" x2="15" y2="14" />
            </svg>
          </button>
        </div>
        <button
          className="settings-folder-toggle-btn"
          onClick={(e) => { onFlash(e); setFoldersVisible(!foldersVisible); }}
          title={foldersVisible ? 'Hide folders' : 'Show folders'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {foldersVisible
              ? <polyline points="18 15 12 9 6 15" />
              : <polyline points="6 9 12 15 18 9" />
            }
          </svg>
        </button>
      </div>

      <div className="settings-folder-actions">
        <button
          className="settings-folder-select-btn"
          onClick={(e) => { onFlash(e); onChangeDirectory(browsePath); }}
        >
          {t('folderSelect')}
        </button>
      </div>

      {foldersVisible && (
        <div className="settings-folder-dirlist">
          {loading ? (
            <div className="settings-folder-empty">{t('folderLoading')}</div>
          ) : dirs.length === 0 ? (
            <div className="settings-folder-empty">{t('folderEmpty')}</div>
          ) : (
            dirs.map((d) => (
              <button
                key={d.absolute}
                className="settings-card settings-folder-card"
                onClick={(e) => { onFlash(e); navigateTo(d.absolute); }}
              >
                <div className="settings-card-row">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  <span className="settings-card-title">{d.name}</span>
                </div>
                <span className="settings-card-subtitle">{d.absolute}</span>
              </button>
            ))
          )}
        </div>
      )}

      {creating && (
        <div className="settings-folder-create-popup" ref={createPopupRef}>
          <div className="settings-folder-create-popup-bubble">
            <input
              className="settings-folder-create-popup-input"
              type="text"
              placeholder={t('folderCreatePlaceholder')}
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === 'Enter') handleCreateFolder();
                if (e.key === 'Escape') { setCreating(false); setNewFolderName(''); }
              }}
              autoFocus
            />
            <button
              className="settings-folder-create-popup-confirm"
              onClick={(e) => { onFlash(e); handleCreateFolder(); }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                <line x1="12" y1="11" x2="12" y2="17" />
                <line x1="9" y1="14" x2="15" y2="14" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
