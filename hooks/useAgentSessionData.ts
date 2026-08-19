import { useCallback } from "react";
import { sendAgentCommand, listToolsForCwd, type ToolWithActive } from "@/lib/agent-client";
import type { AgentMessage, CompactionPoint, ToolInfo } from "@/lib/types";
import { pickHighestAvailableThinkingLevel } from "@/lib/thinking-level-utils";
import type {
  AgentPhase,
  AgentRuntimeState,
  LoadContextRef,
  RuntimeStateRef,
  SessionData,
  SessionIdRef,
  StateSetter,
  StreamAction,
  ThinkingLevelOption,
} from "./useAgentSessionTypes";

type UseAgentSessionDataOptions = {
  sessionIdRef: SessionIdRef;
  modelThinkingLevels: Record<string, string[]>;
  setData: StateSetter<SessionData | null>;
  setActiveLeafId: StateSetter<string | null>;
  setMessages: StateSetter<AgentMessage[]>;
  setEntryIds: StateSetter<string[]>;
  setEntryTimestamps: StateSetter<(number | undefined)[]>;
  setCompactionPoints: StateSetter<CompactionPoint[]>;
  setCurrentModelOverride: StateSetter<{ provider: string; modelId: string } | null>;
  setThinkingLevel: StateSetter<ThinkingLevelOption>;
  setContextUsage: StateSetter<{ percent: number | null; contextWindow: number; tokens: number | null } | null>;
  setSystemPrompt: StateSetter<string | null>;
  setAgentPhase: StateSetter<AgentPhase>;
  setAgentRunningSync: (running: boolean) => void;
  setCompactingSync: (compacting: boolean) => void;
  dispatch: React.Dispatch<StreamAction>;
  setLoading: StateSetter<boolean>;
  setError: StateSetter<string | null>;
  setToolsLoading: StateSetter<boolean>;
  setToolsError: StateSetter<string | null>;
  setAvailableTools: StateSetter<ToolInfo[]>;
  /** Caller invokes this after the disk load overwrites the live tree so
   *  the live snapshot can't go stale. */
  onSessionLoaded: () => void;
  isNew: boolean;
  newSessionCwd: string | null;
  loadContextRef: LoadContextRef;
  refreshAgentRuntimeStateRef: RuntimeStateRef;
};

export function useAgentSessionData(options: UseAgentSessionDataOptions) {
  const {
    sessionIdRef,
    modelThinkingLevels,
    setData,
    setActiveLeafId,
    setMessages,
    setEntryIds,
    setEntryTimestamps,
    setCompactionPoints,
    setCurrentModelOverride,
    setThinkingLevel,
    setContextUsage,
    setSystemPrompt,
    setAgentPhase,
    setAgentRunningSync,
    setCompactingSync,
    dispatch,
    setLoading,
    setError,
    setToolsLoading,
    setToolsError,
    setAvailableTools,
    onSessionLoaded,
    isNew,
    newSessionCwd,
    loadContextRef,
    refreshAgentRuntimeStateRef,
  } = options;

  const loadSession = useCallback(async (sid: string, showLoading = false, includeState = false) => {
    try {
      if (showLoading) setLoading(true);
      const url = includeState
        ? `/api/sessions/${encodeURIComponent(sid)}?includeState`
        : `/api/sessions/${encodeURIComponent(sid)}`;
      const res = await fetch(url);
      if (res.status === 404) {
        if (showLoading) {
          setData(null);
          setActiveLeafId(null);
          setMessages([]);
          setError(null);
        }
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as SessionData & { agentState?: AgentRuntimeState };
      setData(d);
      // data.tree is now authoritative (fresh from disk); drop any live tree
      // pushed during the previous streaming window so it can't go stale.
      onSessionLoaded();
      setActiveLeafId(d.leafId);
      setMessages(d.context.messages);
      setEntryIds(d.context.entryIds ?? []);
      setEntryTimestamps(d.context.entryTimestamps ?? []);
      setCompactionPoints(d.context.compactionPoints ?? []);
      setCurrentModelOverride(null);
      setError(null);
      // Helper: pick the highest thinking level the current model supports, or
      // fall back to the raw value if it isn't the legacy "auto" sentinel.
      // Older sessions may persist "auto" — a frontend-only sentinel that
      // is no longer offered — so map it to the model's highest level so
      // the badge matches what the agent is actually using.
      const migrateLegacyAuto = (raw: string | undefined): ThinkingLevelOption | null => {
        if (typeof raw !== "string") return null;
        if (raw !== "auto") return raw as ThinkingLevelOption;
        const modelKey = d.context.model
          ? `${d.context.model.provider}:${d.context.model.modelId}`
          : null;
        const available = modelKey ? modelThinkingLevels[modelKey] ?? null : null;
        return pickHighestAvailableThinkingLevel(available);
      };

      // Apply thinking-level migration centrally: prefer the live agent
      // state when present, else fall back to the level recorded in the
      // session file. Older sessions may persist "auto" — map it to the
      // model's highest supported level so the badge always matches the
      // agent's actual setting.
      const liveLevel = d.agentState?.state?.thinkingLevel;
      const fileLevel = d.context.thinkingLevel && d.context.thinkingLevel !== "off"
        ? d.context.thinkingLevel
        : null;
      const migrated = migrateLegacyAuto(liveLevel ?? fileLevel ?? undefined);
      if (migrated !== null) setThinkingLevel(migrated);

      return d.agentState ?? null;
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [modelThinkingLevels, onSessionLoaded, setActiveLeafId, setCompactionPoints, setCurrentModelOverride, setData, setEntryIds, setEntryTimestamps, setError, setLoading, setMessages, setThinkingLevel]);

  const loadContext = useCallback(async (sid: string, leafId: string | null) => {
    try {
      const url = leafId
        ? `/api/sessions/${encodeURIComponent(sid)}/context?leafId=${encodeURIComponent(leafId)}`
        : `/api/sessions/${encodeURIComponent(sid)}/context`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as { context: { messages: AgentMessage[]; entryIds: string[]; entryTimestamps?: (number | undefined)[]; compactionPoints?: CompactionPoint[] } };
      setMessages(d.context.messages);
      setEntryIds(d.context.entryIds ?? []);
      setEntryTimestamps(d.context.entryTimestamps ?? []);
      setCompactionPoints(d.context.compactionPoints ?? []);
    } catch (e) {
      console.error("Failed to load context:", e);
    }
  }, [setCompactionPoints, setEntryIds, setEntryTimestamps, setMessages]);

  // Lazy fetcher for the tool catalog: called by ChatInput when the user
  // opens the tools popover for the first time. New sessions don't have an
  // AgentSession yet (they're lazily started by POST /api/agent/new), so
  // we can't use `get_tools` for them — fall back to the cwd-only endpoint
  // POST /api/agent/tools which spins up an ephemeral session internally.
  // Idempotent: if the catalog is already populated, do nothing.
  const ensureAvailableTools = useCallback(async (availableToolsLength: number, toolsLoading: boolean) => {
    if (availableToolsLength > 0 || toolsLoading) return;
    setToolsLoading(true);
    setToolsError(null);
    try {
      let catalog: ToolInfo[];
      if (isNew) {
        if (!newSessionCwd) throw new Error("No cwd available for new session");
        catalog = await listToolsForCwd(newSessionCwd);
      } else {
        const sid = sessionIdRef.current;
        if (!sid) throw new Error("No session id");
        const tools = await sendAgentCommand<ToolWithActive[]>(sid, { type: "get_tools" });
        catalog = tools.map(({ name, description }) => ({ name, description }));
      }
      catalog.sort((a, b) => a.name.localeCompare(b.name));
      setAvailableTools(catalog);
    } catch (e) {
      console.error("Failed to ensure available tools:", e);
      setToolsError(e instanceof Error ? e.message : String(e));
    } finally {
      setToolsLoading(false);
    }
  }, [isNew, newSessionCwd, sessionIdRef, setAvailableTools, setToolsError, setToolsLoading]);

  const applyAgentRuntimeState = useCallback((agentState: AgentRuntimeState | null | undefined) => {
    const state = agentState?.state;
    if (state?.contextUsage !== undefined) setContextUsage(state.contextUsage ?? null);
    if (state?.systemPrompt !== undefined) setSystemPrompt(state.systemPrompt ?? null);

    const compacting = state?.isCompacting === true || state?.phase === "compacting";
    const running = Boolean(
      compacting ||
      state?.isRunning === true ||
      state?.isStreaming === true ||
      (agentState?.running === true && !state),
    );

    if (compacting) {
      setAgentRunningSync(true);
      setCompactingSync(true);
      setAgentPhase({ kind: "compacting" });
    } else if (running) {
      setAgentRunningSync(true);
      setCompactingSync(false);
      setAgentPhase({ kind: "waiting_model" });
    } else {
      setAgentRunningSync(false);
      setCompactingSync(false);
      setAgentPhase(null);
      dispatch({ type: "end" });
    }
  }, [dispatch, setAgentPhase, setAgentRunningSync, setCompactingSync, setContextUsage, setSystemPrompt]);

  const refreshAgentRuntimeState = useCallback(async (sid = sessionIdRef.current) => {
    if (!sid) return null;
    const res = await fetch(`/api/agent/${encodeURIComponent(sid)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const runtimeState = await res.json() as AgentRuntimeState;
    applyAgentRuntimeState(runtimeState);
    return runtimeState;
  }, [applyAgentRuntimeState, sessionIdRef]);

  // Keep refs in sync so the SSE transport layer can call into us.
  loadContextRef.current = loadContext;
  refreshAgentRuntimeStateRef.current = refreshAgentRuntimeState;

  return {
    loadSession,
    loadContext,
    loadContextRef,
    ensureAvailableTools,
    applyAgentRuntimeState,
    refreshAgentRuntimeState,
    refreshAgentRuntimeStateRef,
  };
}
