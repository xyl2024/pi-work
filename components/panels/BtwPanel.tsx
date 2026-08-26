"use client";

// ── BTW (By the way) panel ──────────────────────────────────────────────
//
// Right-side panel that asks the model a question grounded in the active
// session's context via a pure-chat call (no agent loop, no tool
// execution — see `lib/server/btw-chat.ts`). This panel must NEVER write
// to the main session's JSONL, NEVER enter the main session's RPC
// registry, and NEVER touch any server-side store — localStorage
// (`pi-work:btw:<sessionId>`) is the only durable home.
//
// The shell reuses the main chat's components: `MessageView` for turns,
// a `LoadingState` "Thinking..." placeholder while the assistant
// streams, and `ChatInput` in its `hideToolbar` compact mode (Enter to
// send, Stop while streaming, no placeholder). Errors surface as a red
// inline pill with a retry affordance; disabled states show an
// explanatory line above the input.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { IconButton } from "@/components/ui/IconButton";
import { RefreshIconButton } from "@/components/ui/RefreshIconButton";
import { useBtw } from "@/hooks/useBtw";
import { ChatInput } from "@/components/chat/ChatInput";
import { MessageView, CollapseNonceProvider } from "@/components/chat/MessageView";
import { ICONS } from "@/components/ui/icons";
import { Tooltip } from "../ui/Tooltip";
import LoadingState from "../ui/LoadingState";
import { hasStreamingThinking } from "../chat/chat-window/utils";
import type { AssistantMessage } from "@/lib/shared/types";

interface BtwPanelProps {
  /** Main session id — when null the panel renders the "no session"
   *  empty state and the input is disabled. */
  mainSessionId: string | null;
  /** Main session cwd — readiness gate only. The pure-chat send no
   *  longer needs it (no filesystem access). */
  cwd: string | null;
  /** Main session's current model snapshot — readiness gate only. The
   *  server re-reads the live model via the `btw_context` RPC on send. */
  model: { provider: string; modelId: string } | null;
  /** Main session's current effective system prompt — readiness gate
   *  only, and mirrored verbatim server-side on send ($2 #11). */
  systemPrompt: string | null;
  /** Main session's thinking level — used only for the input border
   *  styling; the send uses the server-side live value. */
  thinkingLevel: string;
  /** UX fallback: re-check readiness when the panel is stuck on
   *  `btw.disabled.loading` even though a session is open. Wired to
   *  the active controller's systemPrompt refresh in AppShell. */
  onRefresh: () => void;
}

export function BtwPanel(props: BtwPanelProps) {
  return (
    <CollapseNonceProvider value={0}>
      <BtwPanelInner {...props} />
    </CollapseNonceProvider>
  );
}

function BtwPanelInner({ mainSessionId, cwd, model, systemPrompt, thinkingLevel, onRefresh }: BtwPanelProps) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const toast = useToast();

  const btw = useBtw({ mainSessionId });

  // Model-name / icon maps for the assistant header — mirrors the main
  // chat's /api/models fetch (useAgentSession) so message headers show
  // friendly model names + provider icons instead of raw model ids.
  const [modelNames, setModelNames] = useState<Record<string, string>>({});
  const [modelIcons, setModelIcons] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    fetch("/api/models")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { models?: Record<string, string>; modelIcons?: Record<string, string> } | null) => {
        if (cancelled || !d) return;
        setModelNames(d.models ?? {});
        if (d.modelIcons) setModelIcons(d.modelIcons);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Last persisted user turn — the error pill's retry re-sends it. The
  // user message is persisted before the fetch fires (send-first §3.3),
  // so an error never loses the question.
  const lastUserText = useMemo(() => {
    for (let i = btw.messages.length - 1; i >= 0; i--) {
      const m = btw.messages[i];
      if (m.role === "user" && typeof m.content === "string") return m.content;
    }
    return null;
  }, [btw.messages]);

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

  const btwHelpContent = (
    <div
      style={{
        maxWidth: 280,
        display: "flex",
        flexDirection: "column",
        gap: 7,
        fontSize: 11,
        lineHeight: 1.45,
        overflowWrap: "anywhere",
      }}
    >
      <div style={{ fontWeight: 700 }}>{t("About BTW")}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <div>• {t("BTW means \"By The Way\": ask questions grounded in the current session's context without interrupting the main session, and without polluting its context.")}</div>
        <div>• {t("This BTW chat runs in Chat-Only mode: no Agent loop, and no tool calls.")}</div>
        <div>• {t("It reuses the current context prompt 100% verbatim, ensuring input-cache hits.")}</div>
      </div>
    </div>
  );

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

  // UX fallback: if the panel is stuck on "loading" for an already-open
  // session, prod the active controller to re-fetch its readiness data.
  const handleRefresh = useCallback(() => {
    onRefresh();
  }, [onRefresh]);

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
        {/* "?" help button — interactive so the tooltip stays hoverable. */}
        <Tooltip content={btwHelpContent} side="bottom" align="start" delayDuration={300} interactive>
          <button
            type="button"
            aria-label={t("About BTW")}
            style={{
              width: 22,
              height: 22,
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid var(--text-dim)",
              borderRadius: "50%",
              background: "transparent",
              color: "var(--text-muted)",
              cursor: "help",
              fontSize: 13,
              fontWeight: 700,
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            ?
          </button>
        </Tooltip>
        <span style={{ flex: 1 }} />
        <RefreshIconButton
          onClick={() => void handleRefresh()}
          label={t("btw.refreshHint")}
        />
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
        {btw.phase === "error" && (
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid rgba(248,113,113,0.45)",
              background: "rgba(248,113,113,0.06)",
              color: "#f87171",
              fontSize: 12,
              lineHeight: 1.5,
              marginBottom: 12,
            }}
          >
            <div style={{ flex: 1, minWidth: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {t(btw.errorMessage ?? "btw.error.network")}
            </div>
            {lastUserText && (
              <button
                type="button"
                onClick={() => void btw.send(lastUserText)}
                aria-label={t("Retry")}
                style={{
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "3px 8px",
                  height: 22,
                  background: "none",
                  border: "1px solid rgba(248,113,113,0.45)",
                  borderRadius: 5,
                  color: "#f87171",
                  cursor: "pointer",
                  fontSize: 11,
                  whiteSpace: "nowrap",
                  transition: "color 0.12s",
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
                {t("Retry")}
              </button>
            )}
          </div>
        )}
        {btw.messages.length === 0 && btw.streamingMessage === null ? (
          <div style={{ padding: "32px 12px", textAlign: "center", color: "var(--text-dim)", fontSize: 12, lineHeight: 1.6 }}>
            {t("btw.empty")}
          </div>
        ) : (
          // Same list spacing as the main chat: each MessageView carries
          // its own 16px bottom margin; no extra container gap.
          <div style={{ display: "flex", flexDirection: "column" }}>
            {btw.messages.map((message, idx) => (
              <MessageView
                key={`${idx}-${message.role}-${(message as { timestamp?: number }).timestamp ?? ""}`}
                message={message}
                // Turn-final assistants show their time on hover, same
                // rule as ChatWindow (BTW has one assistant per turn).
                showTimestamp={message.role === "assistant"}
                modelNames={modelNames}
                modelIcons={modelIcons}
                toolResults={btw.inFlightToolResults}
              />
            ))}
            {btw.streamingMessage && (
              <MessageView
                key="btw-streaming"
                message={btw.streamingMessage}
                isStreaming
                modelNames={modelNames}
                modelIcons={modelIcons}
                toolResults={btw.inFlightToolResults}
              />
            )}
            {isStreaming && btw.streamingMessage &&
              (btw.streamingMessage.content.length === 0 || hasStreamingThinking(btw.streamingMessage)) && (
                <div className="py-2">
                  <LoadingState label={t("Thinking...")} variant="spark" />
                </div>
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