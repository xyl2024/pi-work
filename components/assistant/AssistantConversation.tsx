"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowUp, Square } from "lucide-react";
import { useAgentSession } from "@/hooks/useAgentSession";
import { useI18n } from "@/hooks/useI18n";
import {
  projectAssistantConversation,
  type AssistantConversationSession,
} from "@/lib/shared/assistant-conversation";
import {
  fetchAssistantSessions,
  type AssistantSessionPayload,
} from "@/lib/client/assistant-sessions";
import { selectLatestAssistantSession } from "@/lib/shared/assistant-session";
import { extractMessageText } from "@/lib/shared/message-content";
import { isAtTop } from "@/lib/shared/scroll-follow";
import type { SessionInfo } from "@/lib/shared/types";

const bubbleBaseStyle: CSSProperties = {
  maxWidth: "78%",
  padding: "8px 12px",
  borderRadius: "var(--radius-lg)",
  fontSize: 14,
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const userBubbleStyle: CSSProperties = {
  ...bubbleBaseStyle,
  alignSelf: "flex-end",
  background: "var(--accent)",
  color: "#fff",
  border: "none",
};

const assistantBubbleStyle: CSSProperties = {
  ...bubbleBaseStyle,
  alignSelf: "flex-start",
  background: "var(--assistant-bg)",
  color: "var(--text)",
  border: "1px solid var(--border)",
};

function distanceFromBottom(element: HTMLElement): number {
  return element.scrollHeight - element.scrollTop - element.clientHeight;
}

function TypingIndicator() {
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center", padding: "2px 0" }}>
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="assistant-typing-dot"
          style={{
            width: 6,
            height: 6,
            borderRadius: "var(--radius-xs)",
            background: "var(--text-muted)",
            animationDelay: `${index * 0.18}s`,
          }}
        />
      ))}
    </span>
  );
}

interface AssistantChatProps {
  tabId: string;
  isActive: boolean;
  cwd: string | null;
  session: SessionInfo | null;
  history: readonly AssistantSessionPayload[];
  onAgentStatusChange?: (status: {
    running: boolean;
    streaming: boolean;
    error: string | null;
  }) => void;
}

function AssistantChat({ tabId, isActive, cwd, session, history, onAgentStatusChange }: AssistantChatProps) {
  const { t } = useI18n();
  const [createdSession, setCreatedSession] = useState<SessionInfo | null>(null);
  const [loadedStart, setLoadedStart] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const prependScrollHeightRef = useRef<number | null>(null);
  const previousVisibleCountRef = useRef(0);
  const activeSession = createdSession ?? session;

  const {
    messages,
    agentRunning,
    streamState,
    error,
    runtimeError,
    handleSend,
    handleAbort,
  } = useAgentSession({
    session: activeSession,
    newSessionCwd: cwd,
    isActive,
    controllerId: tabId,
    assistantSession: true,
    onSessionCreated: setCreatedSession,
  });

  const projection = useMemo(() => {
    const activeId = activeSession?.id;
    const snapshot = activeId ? history.find((entry) => entry.id === activeId) : undefined;
    const inputs: AssistantConversationSession[] = [];
    for (const entry of history) {
      if (entry.id === activeId) continue;
      inputs.push({
        id: entry.id,
        cwd: entry.cwd,
        created: entry.created,
        assistant: true,
        messages: entry.messages ?? [],
      });
    }
    if (activeSession) {
      inputs.push({
        id: activeSession.id,
        cwd: activeSession.cwd,
        created: activeSession.created,
        assistant: true,
        messages: messages.length > 0 ? messages : snapshot?.messages ?? [],
      });
    }
    return projectAssistantConversation(inputs, {
      defaultCwd: cwd ?? activeSession?.cwd ?? "",
    });
  }, [activeSession, cwd, history, messages]);

  useEffect(() => {
    if (loadedStart !== null) return;
    setLoadedStart(projection.latestPageStart);
  }, [loadedStart, projection.latestPageStart]);

  const bubbles = useMemo(() => {
    const start = loadedStart ?? projection.latestPageStart;
    return projection.messages.slice(start).flatMap((message, offset) => {
      if (message.role !== "user" && message.role !== "assistant") return [];
      const text = extractMessageText(message).trim();
      if (!text) return [];
      return [{ key: `${message.role}-${start + offset}`, role: message.role, text }];
    });
  }, [loadedStart, projection]);

  const awaitingAssistant = agentRunning && bubbles[bubbles.length - 1]?.role !== "assistant";

  useEffect(() => {
    onAgentStatusChange?.({
      running: agentRunning,
      streaming: streamState.isStreaming,
      error: error ?? runtimeError,
    });
  }, [agentRunning, streamState.isStreaming, error, runtimeError, onAgentStatusChange]);

  useEffect(() => {
    if (loadedStart === null) return;
    const element = scrollRef.current;
    const previousVisibleCount = previousVisibleCountRef.current;
    previousVisibleCountRef.current = projection.visibleCount;
    if (!element || prependScrollHeightRef.current !== null) return;
    if (projection.visibleCount <= previousVisibleCount) return;
    const distance = distanceFromBottom(element);
    if (previousVisibleCount === 0 || distance < 100) element.scrollTop = element.scrollHeight;
  }, [loadedStart, projection.visibleCount]);

  const bubbleCountRef = useRef(0);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const appended = bubbles.length > bubbleCountRef.current;
    bubbleCountRef.current = bubbles.length;
    const appendedNow = appended || awaitingAssistant;
    if (!appendedNow) return;
    const frame = requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [bubbles.length, awaitingAssistant]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    const previousHeight = prependScrollHeightRef.current;
    if (!element || previousHeight === null) return;
    element.scrollTop += element.scrollHeight - previousHeight;
    prependScrollHeightRef.current = null;
  }, [loadedStart]);

  const loadEarlier = useCallback(() => {
    const element = scrollRef.current;
    if (!element || loadedStart === null || loadedStart <= 0) return;
    if (prependScrollHeightRef.current !== null) return;
    const atTop = isAtTop({
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
      clientHeight: element.clientHeight,
    });
    if (!atTop) return;
    const page = projection.pageBefore(loadedStart);
    if (page.messages.length === 0 || page.start === loadedStart) return;
    prependScrollHeightRef.current = element.scrollHeight;
    setLoadedStart(page.start);
  }, [loadedStart, projection]);

  useEffect(() => {
    if (loadedStart === null || loadedStart <= 0) return;
    const element = scrollRef.current;
    if (!element || element.scrollHeight > element.clientHeight) return;
    loadEarlier();
  }, [bubbles.length, loadedStart, loadEarlier]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || agentRunning) return;
    setDraft("");
    const sent = await handleSend(text);
    if (!sent) setDraft(text);
  }, [agentRunning, draft, handleSend]);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send();
  }, [send]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: isActive ? "flex" : "none",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        ref={scrollRef}
        onScroll={loadEarlier}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: "20px 16px",
        }}
      >
        {bubbles.map((bubble) => (
          <div
            key={bubble.key}
            className="assistant-bubble-in"
            style={bubble.role === "user" ? userBubbleStyle : assistantBubbleStyle}
          >
            {bubble.text}
          </div>
        ))}
        {awaitingAssistant ? (
          <div style={assistantBubbleStyle}>
            <TypingIndicator />
          </div>
        ) : null}
      </div>
      <div style={{ flexShrink: 0, padding: "0 16px 16px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 8,
            padding: "8px 8px 8px 14px",
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--text-dim)",
            background: "transparent",
          }}
        >
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("Message the assistant")}
            rows={1}
            style={{
              flex: 1,
              minHeight: 28,
              maxHeight: 160,
              resize: "none",
              border: "none",
              outline: "none",
              background: "transparent",
              color: "var(--text)",
              fontSize: 14,
              lineHeight: "20px",
              padding: "4px 0",
              fontFamily: "inherit",
            }}
          />
          <button
            type="button"
            aria-label={agentRunning ? t("Stop") : t("Send")}
            title={agentRunning ? t("Stop") : t("Send")}
            onClick={() => {
              if (agentRunning) void handleAbort();
              else void send();
            }}
            disabled={!agentRunning && !draft.trim()}
            style={{
              flexShrink: 0,
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "var(--radius-lg)",
              border: "none",
              cursor: agentRunning || draft.trim() ? "pointer" : "default",
              background: agentRunning || draft.trim() ? "var(--accent)" : "var(--bg-hover)",
              color: agentRunning || draft.trim() ? "#fff" : "var(--text-muted)",
            }}
          >
            {agentRunning ? <Square size={14} fill="currentColor" /> : <ArrowUp size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AssistantConversation({ tabId, isActive, onAgentStatusChange }: {
  tabId: string;
  isActive: boolean;
  onAgentStatusChange?: (status: {
    running: boolean;
    streaming: boolean;
    error: string | null;
  }) => void;
}) {
  const [cwd, setCwd] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AssistantSessionPayload[]>([]);
  const [ready, setReady] = useState(false);
  const latest = useMemo(() => selectLatestAssistantSession(sessions), [sessions]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [cwdResponse, assistantSessions] = await Promise.all([
          fetch("/api/default-cwd", { method: "POST" }),
          fetchAssistantSessions({ includeMessages: true }),
        ]);
        if (cancelled) return;
        if (cwdResponse.ok) {
          const data = await cwdResponse.json() as { cwd?: string };
          setCwd(data.cwd ?? null);
        }
        setSessions(assistantSessions);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) return null;

  return (
    <AssistantChat
      key={latest?.id ?? "new"}
      tabId={tabId}
      isActive={isActive}
      cwd={cwd}
      session={latest}
      history={sessions}
      onAgentStatusChange={onAgentStatusChange}
    />
  );
}
