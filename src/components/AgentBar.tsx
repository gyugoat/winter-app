/**
 * AgentBar — horizontal tab bar for switching between AI agents.
 *
 * Renders below the Titlebar. Each agent gets a clickable tab containing:
 * - Avatar circle (colored, initials fallback)
 * - Agent name
 * - Online/offline status dot
 *
 * The active agent tab has an accent bottom border.
 * Clicking a tab calls `switchAgent()` from `useAgents` and triggers
 * an SSE reconnect via the `onSwitch` callback.
 *
 * Health checks run on mount and on each focus event so the status
 * dots stay fresh without constant polling.
 */
import { useEffect, useCallback } from 'react';
import type { UseAgentsReturn } from '../hooks/useAgents';
import type { Agent } from '../types';
import '../styles/AgentBar.css';

interface AgentBarProps {
  /** Agent management hook output (agents, currentAgent, switchAgent, checkHealth, healthMap) */
  agents: UseAgentsReturn;
  /**
   * Called after the active agent is switched.
   * Use to re-establish SSE connections for the new agent.
   */
  onSwitch?: () => void;
}

/** Returns initials for an agent name — first char of each word, max 2 */
function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/** Single agent tab button */
function AgentTab({
  agent,
  isActive,
  health,
  onClick,
}: {
  agent: Agent;
  isActive: boolean;
  health: boolean | null;
  onClick: () => void;
}) {
  /** null = unchecked (grey), true = online (green), false = offline (red) */
  const statusClass =
    health === null ? 'status-unknown' : health ? 'status-online' : 'status-offline';

  return (
    <button
      className={`agent-tab${isActive ? ' active' : ''}`}
      onClick={onClick}
      aria-pressed={isActive}
      aria-label={`Switch to ${agent.name}`}
      title={agent.name}
    >
      {/* Avatar: image if avatar url set, otherwise colored initials circle */}
      <span
        className="agent-avatar"
        style={{ '--agent-color': agent.color } as React.CSSProperties}
      >
        {agent.avatar ? (
          <img src={agent.avatar} alt={agent.name} className="agent-avatar-img" />
        ) : (
          <span className="agent-avatar-initials">{getInitials(agent.name)}</span>
        )}
        <span className={`agent-status-dot ${statusClass}`} aria-hidden="true" />
      </span>

      <span className="agent-name">{agent.name}</span>
    </button>
  );
}

export function AgentBar({ agents: agentState, onSwitch }: AgentBarProps) {
  const { agents, currentAgent, switchAgent, checkHealth, healthMap } = agentState;

  /** Run health checks for all agents */
  const refreshHealth = useCallback(() => {
    for (const agent of agents) {
      checkHealth(agent);
    }
  }, [agents, checkHealth]);

  // Initial health check on mount
  useEffect(() => {
    refreshHealth();
  }, [refreshHealth]);

  // Re-check on window focus (tab comes back to foreground)
  useEffect(() => {
    window.addEventListener('focus', refreshHealth);
    return () => window.removeEventListener('focus', refreshHealth);
  }, [refreshHealth]);

  const handleSwitch = useCallback(
    (id: string) => {
      if (id === currentAgent.id) return;
      switchAgent(id, onSwitch);
    },
    [currentAgent.id, switchAgent, onSwitch]
  );

  // Don't render if config says hidden, or only one agent
  if (agents.length <= 1) return null;
  // Check config flag — bootstrap script stores this in localStorage
  try {
    const flag = localStorage.getItem('winter-store:settings.json:ui_showAgentBar');
    if (flag !== null && JSON.parse(flag) === false) return null;
  } catch { /* ignore parse errors */ }


  return (
    <div className="agent-bar" role="tablist" aria-label="AI agents">
      {agents.map((agent) => (
        <AgentTab
          key={agent.id}
          agent={agent}
          isActive={agent.id === currentAgent.id}
          health={healthMap[agent.id] ?? null}
          onClick={() => handleSwitch(agent.id)}
        />
      ))}
    </div>
  );
}
