"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { useAgentSession } from "@/hooks/useAgentSession";
import { useI18n } from "@/hooks/useI18n";
import { useStreamingMessage } from "@/hooks/useStreamingMessage";
import { selectLatestAssistantSession } from "@/lib/shared/assistant-session";
import { extractMessageText } from "@/lib/shared/message-content";
import type { AgentMessage, SessionInfo } from "@/lib/shared/types";

interface AssistantChatProps {
  tabId: string;
  isActive: boolean;
  cwd: string | null;
  session: SessionInfo | null;
}

function AssistantChat({ tabId, isActive, cwd, session }: AssistantChatProps) {
  const { t } = useI18n();
  const [createdSession, setCreatedSession] = useState<SessionInfo | null>(null);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const activeSession = createdSession ?? session;

  const {
    messages,
    agentRunning,
    streamState,
    handleSend,
    handleAbort,
  } = useAgentSession({
    session: activeSession,
    newSessionCwd: cwd,
    isActive,
    controllerId: tabId,
    onSessionCreated: setCreatedSession,
  });
  const streaming = useStreamingMessage(tabId);

  const bubbles = useMemo(() => {
    return messages.flatMap((message, index) => {
      if (message.role !== "user" && message.role !== "assistant") return [];
      const text = extractMessageText(message).trim();
      if (!text) return [];
      return [{ key: `${message.role}-${index}`, role: message.role, text }];
    });
  }, [messages]);

  const streamingText = streamState.isStreaming && streaming.streamingMessage
    ? extractMessageText(streaming.streamingMessage as AgentMessage).trim()
    : "";
  const showStreaming = streamingText !== "" && bubbles[bubbles.length - 1]?.text !== streamingText;

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [bubbles.length, streamingText]);

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
            style={{
              alignSelf: bubble.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "78%",
              padding: "8px 12px",
              borderRadius: 16,
              fontSize: 14,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              background: bubble.role === "user" ? "var(--accent)" : "var(--assistant-bg)",
              color: bubble.role === "user" ? "#fff" : "var(--text)",
              border: bubble.role === "user" ? "none" : "1px solid var(--border)",
            }}
          >
            {bubble.text}
          </div>
        ))}
        {showStreaming ? (
          <div
            style={{
              alignSelf: "flex-start",
              maxWidth: "78%",
              padding: "8px 12px",
              borderRadius: 16,
              fontSize: 14,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              background: "var(--assistant-bg)",
              color: "var(--text)",
              border: "1px solid var(--border)",
            }}
          >
            {streamingText}
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
            borderRadius: 18,
            border: "1px solid var(--border)",
            background: "var(--bg-panel)",
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
              borderRadius: 16,
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

export function AssistantConversation({ tabId, isActive }: { tabId: string; isActive: boolean }) {
  const [cwd, setCwd] = useState<string | null>(null);
  const [latest, setLatest] = useState<SessionInfo | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [cwdResponse, sessionsResponse] = await Promise.all([
          fetch("/api/default-cwd", { method: "POST" }),
          fetch("/api/assistant/sessions"),
        ]);
        if (cancelled) return;
        if (cwdResponse.ok) {
          const data = await cwdResponse.json() as { cwd?: string };
          setCwd(data.cwd ?? null);
        }
        if (sessionsResponse.ok) {
          const data = await sessionsResponse.json() as { sessions?: SessionInfo[] };
          setLatest(selectLatestAssistantSession(data.sessions ?? []));
        }
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
    />
  );
}
