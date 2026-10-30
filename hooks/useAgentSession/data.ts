import { useCallback } from "react";
import { sendAgentCommand, listToolsForCwd, type ToolWithActive } from "@/lib/client/agent-client";
import type { AgentMessage, CompactionPoint, ToolInfo } from "@/lib/shared/types";
import { adoptDiskTranscript } from "@/lib/shared/session-runtime-state";
import { pickClosestAvailableThinkingLevel, pickHighestAvailableThinkingLevel } from "@/lib/shared/thinking-level-utils";
import type { SessionRuntimeInput } from "@/lib/shared/session-events";
import type {
  AgentRuntimeState,
  LoadContextRef,
  RuntimeStateRef,
  SessionData,
  SessionIdRef,
  StateSetter,
  ThinkingLevelOption,
} from "./types";

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
  applyRuntimeInput: (input: SessionRuntimeInput) => void;
  setLoading: StateSetter<boolean>;
  setError: StateSetter<string | null>;
  setToolsLoading: StateSetter<boolean>;
  setToolsError: StateSetter<string | null>;
  setAvailableTools: StateSetter<ToolInfo[]>;
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
    applyRuntimeInput,
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
      onSessionLoaded();
      setActiveLeafId(d.leafId);
      setMessages((previous) => adoptDiskTranscript(previous, d.context.messages));
      setEntryIds(d.context.entryIds ?? []);
      setEntryTimestamps(d.context.entryTimestamps ?? []);
      setCompactionPoints(d.context.compactionPoints ?? []);
      setCurrentModelOverride(null);
      setError(null);
      const migrateLegacyAuto = (raw: string | undefined): ThinkingLevelOption | null => {
        if (typeof raw !== "string") return null;
        if (raw !== "auto") return raw as ThinkingLevelOption;
        const modelKey = d.context.model
          ? `${d.context.model.provider}:${d.context.model.modelId}`
          : null;
        const available = modelKey ? modelThinkingLevels[modelKey] ?? null : null;
        return pickHighestAvailableThinkingLevel(available);
      };

      const liveLevel = d.agentState?.state?.thinkingLevel;
      const fileLevel = d.context.thinkingLevel && d.context.thinkingLevel !== "off"
        ? d.context.thinkingLevel
        : null;
      const migrated = migrateLegacyAuto(liveLevel ?? fileLevel ?? undefined);
      if (migrated !== null) {
        const modelKey = d.context.model
          ? `${d.context.model.provider}:${d.context.model.modelId}`
          : null;
        const avail = modelKey ? modelThinkingLevels[modelKey] ?? null : null;
        setThinkingLevel(avail && avail.length > 0
          ? pickClosestAvailableThinkingLevel(migrated, avail)
          : migrated);
      }

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
      setMessages((previous) => (leafId === null ? adoptDiskTranscript(previous, d.context.messages) : d.context.messages));
      setEntryIds(d.context.entryIds ?? []);
      setEntryTimestamps(d.context.entryTimestamps ?? []);
      setCompactionPoints(d.context.compactionPoints ?? []);
    } catch (e) {
      console.error("Failed to load context:", e);
    }
  }, [setCompactionPoints, setEntryIds, setEntryTimestamps, setMessages]);

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
        catalog = tools.map(({ name, description, active }) => ({ name, description, active }));
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

  const refreshAgentRuntimeState = useCallback(async (sid = sessionIdRef.current) => {
    if (!sid) return null;
    const res = await fetch(`/api/agent/${encodeURIComponent(sid)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const snapshot = await res.json() as AgentRuntimeState;
    applyRuntimeInput({ type: "client_snapshot", snapshot });
    return snapshot;
  }, [applyRuntimeInput, sessionIdRef]);

  loadContextRef.current = loadContext;
  refreshAgentRuntimeStateRef.current = refreshAgentRuntimeState;

  return {
    loadSession,
    loadContext,
    loadContextRef,
    ensureAvailableTools,
    refreshAgentRuntimeState,
    refreshAgentRuntimeStateRef,
  };
}
