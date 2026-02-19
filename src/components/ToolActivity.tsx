import { useState, useCallback, memo } from 'react';
import type { ToolActivity as ToolActivityType } from '../types';
import '../styles/tools.css';

/** Format tool name for display — strip mcp_ prefix, humanize */
function formatToolName(name: string): string {
  let display = name.replace(/^mcp_/, '');
  const NAMES: Record<string, string> = {
    bash: 'Terminal',
    read: 'Read File',
    write: 'Write File',
    edit: 'Edit File',
    glob: 'Find Files',
    grep: 'Search',
    todowrite: 'Todo',
    question: 'Question',
    webfetch: 'Web Fetch',
    google_search: 'Google Search',
    lsp_diagnostics: 'Diagnostics',
    lsp_goto_definition: 'Go to Definition',
    lsp_find_references: 'Find References',
    lsp_rename: 'Rename Symbol',
    ast_grep_search: 'AST Search',
    ast_grep_replace: 'AST Replace',
    call_omo_agent: 'Delegate Agent',
    skill: 'Load Skill',
    look_at: 'Analyze',
    context7_resolve_library_id: 'Resolve Library',
    'context7_query-docs': 'Query Docs',
    project_rag_query_codebase: 'Search Codebase',
    project_rag_search_git_history: 'Git History',
    session_list: 'Sessions',
    session_read: 'Read Session',
    session_search: 'Search Sessions',
  };
  return NAMES[display] || display.replace(/_/g, ' ');
}

/** Status icon for each tool state — SVG only (no emoji, Ubuntu WebKit compat) */
function StatusIcon({ status }: { status: ToolActivityType['status'] }) {
  if (status === 'running') {
    return (
      <span className="tool-status-icon running">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      </span>
    );
  }
  if (status === 'completed') {
    return (
      <span className="tool-status-icon completed">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    );
  }
  return (
    <span className="tool-status-icon error">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </span>
  );
}

interface ToolCardProps {
  tool: ToolActivityType;
}

const ToolCard = memo(function ToolCard({ tool }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false);

  const toggle = useCallback(() => {
    if (tool.result) setExpanded((v) => !v);
  }, [tool.result]);

  const hasResult = !!tool.result;
  const isLong = (tool.result?.length ?? 0) > 200;
  const displayName = formatToolName(tool.name);

  return (
    <div className={`tool-card tool-card--${tool.status}`}>
      <button
        className={`tool-card-header${hasResult ? ' clickable' : ''}`}
        onClick={toggle}
        aria-expanded={expanded}
        tabIndex={hasResult ? 0 : -1}
      >
        <StatusIcon status={tool.status} />
        <span className="tool-card-name">{displayName}</span>
        {tool.status === 'running' && (
          <span className="tool-card-dots">
            <span /><span /><span />
          </span>
        )}
        {hasResult && (
          <span className={`tool-card-chevron${expanded ? ' open' : ''}`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        )}
      </button>
      {expanded && tool.result && (
        <div className="tool-card-result">
          <pre>{isLong ? tool.result.slice(0, 1500) + (tool.result.length > 1500 ? '\n...(truncated)' : '') : tool.result}</pre>
        </div>
      )}
    </div>
  );
});

interface ToolActivityListProps {
  tools: ToolActivityType[];
}

export function ToolActivityList({ tools }: ToolActivityListProps) {
  if (!tools || tools.length === 0) return null;

  return (
    <div className="tool-activity-list">
      {tools.map((tool) => (
        <ToolCard key={tool.id} tool={tool} />
      ))}
    </div>
  );
}
