"use client";

// ── BTW (By the way) panel ──────────────────────────────────────────────
//
// Right-side panel that asks a temporary, in-memory, read-only-only
// agent grounded in the active session's context. Per the handoff, this
// panel must NEVER write to the main session's JSONL, NEVER enter the
// main session's RPC registry, and NEVER touch any server-side store.
// localStorage (`pi-work:btw:<sessionId>`) is the only durable home.
//
// The shell is intentionally minimal:
//   - header: title + "Clear" button (secondary confirmation via
//     `useConfirm`; handoff §3.3 manual clear is destructive)
//   - body: scrollable message list rendering user + assistant turns
//     with the same `MessageView` the main chat uses, plus a thin
//     "streaming" placeholder for the in-flight assistant
//   - footer: textarea (Enter send / Shift+Enter newline, handoff
//     §3.2) plus an explicit "Stop" button while streaming
//
// Error / disabled states use the same look as the other right panels —
// a single line of muted text in the empty state, an inline error pill
// with a retry affordance when `phase === "error"`. Disabled-while-
// loading states ("no session" / "loading") render a tooltip on the
// textarea wrapper explaining why.

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { useBtw } from "@/hooks/useBtw";
import { MessageView, CollapseNonceProvider } from "@/components/chat/MessageView";
import { ICONS } from "@/components/ui/icons";
import type { AgentMessage, AssistantMessage } from "@/lib/shared/types";

interface BtwPanelProps {
  /** Main session id — when null the panel renders the "no session"
   *  empty state and the input is disabled. */
  mainSessionId: string | null;
  /** Main session cwd at send time. */
  cwd: string | null;
  /** Main session's current model snapshot. */
  model: { provider: string; modelId: string } | null;
  /** Main session's current effective system prompt — passed through
   *  verbatim to the BTW agent per handoff §2 #11. */
  systemPrompt: string | null;
  /** All main-session messages (latest snapshot). Used by the hook
   *  on the FIRST send (handoff §3.4). */
  mainSessionMessages: AgentMessage[];
}

export function BtwPanel(props: BtwPanelProps) {
  return (
    <CollapseNonceProvider value={0}>
      <BtwPanelInner {...props} />
    </CollapseNonceProvider>
  );
}

function BtwPanelInner({ mainSessionId, cwd, model, systemPrompt, mainSessionMessages }: BtwPanelProps) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const toast = useToast();
  const messagesRef = useRef(mainSessionMessages);
  messagesRef.current = mainSessionMessages;

  const getMainSessionMessages = useCallback(() => messagesRef.current, []);

  const btw = useBtw({
    mainSessionId,
    cwd,
    model,
    systemPrompt,
    getMainSessionMessages,
  });

  // Surface quota / quota errors via the global toast so the user is
  // nudged to clear without losing focus on the input.
  const lastErrorRef = useRef<string | null>(null);
  useEffect(() => {
    const err = btw.lastError;
    if (err && err !== lastErrorRef.current) {
      lastErrorRef.current = err;
      toast.show({ kind: "error", message: err });
    } else if (!err) {
      lastErrorRef.current = null;
    }
  }, [btw.lastError, toast]);

  const isStreaming = btw.phase === "streaming" || btw.phase === "loading";
  const isDisabled = !mainSessionId || !model || !systemPrompt || !cwd;

  // ── Header actions ────────────────────────────────────────────────
  const handleClear = useCallback(async () => {
    if (btw.messages.length === 0) return;
    const ok = await confirm({
      title: t("btw.clearConfirmTitle"),
      description: t("btw.clearConfirmBody"),
      confirmLabel: t("btw.clearButton"),
      cancelLabel: t("Cancel"),
      destructive: true,
    });
    if (ok) btw.clear();
  }, [btw, confirm, t]);

  // ── Input wiring ──────────────────────────────────────────────────
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== "Enter") return;
      if (e.shiftKey) return; // Shift+Enter → newline
      if (e.nativeEvent.isComposing) return;
      if (isStreaming) return;
      e.preventDefault();
      const value = draft;
      if (!value.trim()) return;
      setDraft("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      void btw.send(value);
    },
    [btw, draft, isStreaming],
  );

  const handleInput = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, []);

  const disabledReason = useMemo(() => {
    if (!mainSessionId) return t("btw.disabled.noSession");
    if (!cwd || !systemPrompt) return t("btw.disabled.loading");
    return null;
  }, [cwd, mainSessionId, systemPrompt, t]);

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "transparent",
        color: "var(--text)",
        fontSize: 13,
      }}
    >
      {/* Header */}
      <div
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-subtle)",
        }}
      >
        <span
          aria-hidden
          style={{
            fontFamily: "var(--font-mono)",
            fontWeight: 700,
            fontSize: 10,
            letterSpacing: 0.8,
            color: "var(--accent)",
            padding: "2px 6px",
            borderRadius: 4,
            background: "var(--accent-soft, rgba(83,179,203,0.12))",
          }}
        >
          BTW
        </span>
        <span style={{ flex: 1, color: "var(--text-muted)", fontSize: 12 }}>
          {t("btw.title")}
        </span>
        <button
          type="button"
          onClick={() => void handleClear()}
          disabled={btw.messages.length === 0}
          aria-label={t("btw.clearButton")}
          title={t("btw.clearButton")}
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            color: "var(--text-muted)",
            borderRadius: 4,
            padding: "3px 8px",
            fontSize: 11,
            cursor: btw.messages.length === 0 ? "not-allowed" : "pointer",
            opacity: btw.messages.length === 0 ? 0.5 : 1,
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <ICONS.close size={11} />
            {t("btw.clearButton")}
          </span>
        </button>
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "8px 12px",
        }}
      >
        {btw.messages.length === 0 && btw.streamingMessage === null ? (
          <div style={{ padding: "32px 12px", textAlign: "center", color: "var(--text-dim)", fontSize: 12, lineHeight: 1.6 }}>
            {t("btw.empty")}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {btw.messages.map((message, idx) => (
              <MessageView
                key={`${idx}-${message.role}-${(message as { timestamp?: number }).timestamp ?? ""}`}
                message={message}
                showTimestamp={false}
                toolResults={btw.inFlightToolResults}
              />
            ))}
            {btw.streamingMessage && (
              <MessageView
                key="btw-streaming"
                message={btw.streamingMessage}
                isStreaming
                showTimestamp={false}
                toolResults={btw.inFlightToolResults}
              />
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          flexShrink: 0,
          padding: "8px 12px 10px 12px",
          borderTop: "1px solid var(--border)",
          background: "var(--bg-subtle)",
        }}
      >
        {disabledReason && (
          <div
            style={{
              fontSize: 11,
              color: "var(--text-dim)",
              marginBottom: 6,
              fontStyle: "italic",
            }}
          >
            {disabledReason}
          </div>
        )}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 8,
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "6px 8px",
            background: "var(--bg)",
          }}
        >
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            placeholder={t("btw.placeholder")}
            disabled={isDisabled}
            rows={1}
            aria-label={t("btw.placeholder")}
            title={disabledReason ?? undefined}
            style={{
              flex: 1,
              minHeight: 22,
              maxHeight: 160,
              resize: "none",
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--text)",
              fontFamily: "inherit",
              fontSize: 13,
              lineHeight: 1.5,
              opacity: isDisabled ? 0.6 : 1,
              cursor: isDisabled ? "not-allowed" : "text",
            }}
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={() => btw.stop()}
              aria-label={t("btw.stop")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                background: "transparent",
                border: "1px solid var(--border)",
                color: "var(--text)",
                borderRadius: 4,
                padding: "4px 8px",
                fontSize: 11,
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <span style={{ display: "inline-block", width: 8, height: 8, background: "currentColor", borderRadius: 1 }} aria-hidden />
              {t("btw.stop")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (!draft.trim()) return;
                const value = draft;
                setDraft("");
                if (textareaRef.current) textareaRef.current.style.height = "auto";
                void btw.send(value);
              }}
              disabled={isDisabled || !draft.trim()}
              aria-label={t("Send")}
              style={{
                background: "transparent",
                border: "1px solid var(--border)",
                color: !isDisabled && draft.trim() ? "var(--accent)" : "var(--text-dim)",
                borderRadius: 4,
                padding: "4px 8px",
                fontSize: 11,
                cursor: !isDisabled && draft.trim() ? "pointer" : "not-allowed",
                opacity: !isDisabled && draft.trim() ? 1 : 0.6,
                flexShrink: 0,
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
                {t("Send")}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Re-export the streaming message type so callers can type-narrow the
// `useBtw` return value without digging into the hook module.
export type { AssistantMessage };