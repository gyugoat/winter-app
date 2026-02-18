import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import hljs from 'highlight.js';
import '../styles/fileviewer.css';

interface FileViewerProps {
  filePath: string;
  homePath: string;
}

function toRelativePath(absPath: string, homePath: string): string {
  if (absPath === homePath) return '.';
  if (absPath.startsWith(homePath + '/')) return absPath.slice(homePath.length + 1);
  return absPath;
}

function extToLang(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', json: 'json', toml: 'toml',
    yaml: 'yaml', yml: 'yaml', md: 'markdown', css: 'css', html: 'html',
    sh: 'bash', bash: 'bash', sql: 'sql', txt: 'plaintext',
  };
  return ext ? map[ext] : undefined;
}

export function FileViewer({ filePath, homePath }: FileViewerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLElement>(null);

  const lang = extToLang(filePath);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setContent(null);

    const relPath = toRelativePath(filePath, homePath);
    invoke<{ type: string; content: string }>('opencode_file_content', { path: relPath })
      .then((data) => {
        if (data.type === 'text') {
          setContent(data.content);
        } else {
          setError(`Binary file (${data.type})`);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [filePath, homePath]);

  useEffect(() => {
    if (content !== null && codeRef.current) {
      codeRef.current.removeAttribute('data-highlighted');
      hljs.highlightElement(codeRef.current);
    }
  }, [content]);

  return (
    <div className="fv-container">
      <div className="fv-breadcrumb">
        <span className="fv-full-path" title={filePath}>{filePath}</span>
      </div>
      <div className="fv-body">
        {loading && <div className="fv-status">Loading...</div>}
        {error && <div className="fv-status fv-error">{error}</div>}
        {content !== null && (
          <pre className="fv-pre"><code ref={codeRef} className={lang ? `language-${lang}` : ''}>{content}</code></pre>
        )}
      </div>
    </div>
  );
}
