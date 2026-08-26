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

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { IconButton } from "@/components/ui/IconButton";
import { useBtw } from "@/hooks/useBtw";
import { ChatInput } from "@/components/chat/ChatInput";
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
  /** Active main-session tools and thinking level. */
  toolNames: string[];
  thinkingLevel: string;
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

function BtwPanelInner({ mainSessionId, cwd, model, systemPrompt, toolNames, thinkingLevel, mainSessionMessages }: BtwPanelProps) {
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
    toolNames,
    thinkingLevel,
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
          background: "transparent",
        }}
      >
        <span style={{ flex: 1 }} />
        <IconButton
          label={t("btw.clearButton")}
          icon={<ICONS.trash size={13} />}
          onClick={() => void handleClear()}
          disabled={btw.messages.length === 0}
          size="sm"
        />
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
          padding: "0 10px 10px",
          background: "transparent",
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
        <ChatInput
          enterToSend
          hideToolbar
          disabled={isDisabled}
          isStreaming={isStreaming}
          sessionBusy={isDisabled}
          onSend={(message) => void btw.send(message)}
          onAbort={() => btw.stop()}
          placeholder={t("Ask a quick question here, without polluting the main session's context")}
          thinkingLevel={
            thinkingLevel as "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
          }
        />
      </div>
    </div>
  );
}

// Re-export the streaming message type so callers can type-narrow the
// `useBtw` return value without digging into the hook module.
export type { AssistantMessage };