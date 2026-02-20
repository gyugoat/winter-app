/**
 * useAgents — manages the list of available AI agents and the active agent.
 *
 * Loads the agent configuration from Tauri Store (`settings.json → agents`).
 * Falls back to a hardcoded default if nothing is configured:
 * - Winter (port 6096) — the primary local assistant
 *
 * Provides:
 * - `agents`: full list of configured agents
 * - `currentAgent`: the agent currently selected
 * - `switchAgent(id, onReconnect?)`: switches active agent and triggers a reconnect callback
 * - `checkHealth(agent)`: pings the agent's `/global/health` endpoint; returns true if alive
 * - `healthMap`: Record<agentId, boolean | null> — null = unchecked, true = online, false = offline
 */
import { useState, useEffect, useCallback } from 'react';
import { load } from '@tauri-apps/plugin-store';
import type { Agent } from '../types';

const STORE_FILE = 'settings.json';
const AGENTS_KEY = 'agents';
const ACTIVE_AGENT_KEY = 'active_agent_id';

/** Default agents used when no configuration is stored */
const DEFAULT_AGENTS: Agent[] = [
  {
    id: 'winter',
    name: 'Winter',
    avatar: '',
    proxyPort: 6096,
    workspace: '',
    color: '#3b82f6',
    type: 'opencode',
  },
];

/**
 * Pings the given agent's health endpoint.
 * Returns true if the agent responds with HTTP 2xx, false otherwise.
 */
async function pingAgent(agent: Agent): Promise<boolean> {
  try {
    const url = `http://localhost:${agent.proxyPort}/global/health`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export interface UseAgentsReturn {
  /** All configured agents */
  agents: Agent[];
  /** Currently active agent */
  currentAgent: Agent;
  /**
   * Switch to a different agent by ID.
   * Persists the new agent's URL to the Tauri store so the Rust backend
   * picks it up on the next request (`get_opencode_url()`).
   * @param id - The agent ID to switch to
   * @param onReconnect - Optional callback invoked after the agent is switched
   *                      (use to re-establish SSE connections etc.)
   */
  switchAgent: (id: string, onReconnect?: () => void) => Promise<void>;
  /**
   * Pings a specific agent and updates `healthMap`.
   * @returns true if the agent is reachable
   */
  checkHealth: (agent: Agent) => Promise<boolean>;
  /** Online/offline status per agent ID. null = not yet checked */
  healthMap: Record<string, boolean | null>;
}

/**
 * Hook for managing multi-agent state.
 * Persists the active agent selection to `settings.json`.
 */
export function useAgents(): UseAgentsReturn {
  const [agents, setAgents] = useState<Agent[]>(DEFAULT_AGENTS);
  const [currentAgentId, setCurrentAgentId] = useState<string>(DEFAULT_AGENTS[0].id);
  const [healthMap, setHealthMap] = useState<Record<string, boolean | null>>({});

  // 스토어에서 에이전트 목록 및 마지막 선택 에이전트 로드
  useEffect(() => {
    (async () => {
      try {
        const store = await load(STORE_FILE);
        const savedAgents = await store.get<Agent[]>(AGENTS_KEY);
        const savedActiveId = await store.get<string>(ACTIVE_AGENT_KEY);

        if (Array.isArray(savedAgents) && savedAgents.length > 0) {
          setAgents(savedAgents);
          // 저장된 활성 에이전트가 목록에 있으면 복원
          if (savedActiveId && savedAgents.some((a) => a.id === savedActiveId)) {
            setCurrentAgentId(savedActiveId);
          } else {
            setCurrentAgentId(savedAgents[0].id);
          }
        }

        // 초기 상태를 null(미확인)로 설정
        const initialHealth: Record<string, boolean | null> = {};
        const list = Array.isArray(savedAgents) && savedAgents.length > 0 ? savedAgents : DEFAULT_AGENTS;
        for (const a of list) {
          initialHealth[a.id] = null;
        }
        setHealthMap(initialHealth);
      } catch {
        // 스토어 없거나 오류 → 기본값 사용
      }
    })();
  }, []);

  const checkHealth = useCallback(async (agent: Agent): Promise<boolean> => {
    const alive = await pingAgent(agent);
    setHealthMap((prev) => ({ ...prev, [agent.id]: alive }));
    return alive;
  }, []);

  const switchAgent = useCallback(
    async (id: string, onReconnect?: () => void) => {
      const agent = agents.find((a) => a.id === id);
      if (!agent) return;

      // 스토어에 활성 에이전트 ID + opencode URL 저장
      // Rust backend reads opencode_url via get_opencode_url() on every request
      try {
        const store = await load(STORE_FILE);
        await store.set(ACTIVE_AGENT_KEY, id);
        await store.set('opencode_url', `http://localhost:${agent.proxyPort}`);
        if (agent.workspace) {
          await store.set('opencode_directory', agent.workspace);
        }
        await store.save();
      } catch {
        // Store write failed — Rust backend still has old URL, don't switch
        console.error('[useAgents] Store write failed, agent switch aborted');
        return;
      }

      setCurrentAgentId(id);
      onReconnect?.();
    },
    [agents]
  );

  const currentAgent = agents.find((a) => a.id === currentAgentId) ?? agents[0] ?? DEFAULT_AGENTS[0];

  return { agents, currentAgent, switchAgent, checkHealth, healthMap };
}
