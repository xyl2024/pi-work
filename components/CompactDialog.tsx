"use client";

/* ─────────────────────────────────────────────────────────
 * COMPACT DIALOG — modal that asks for an optional "focus"
 * string before manually compacting the current session.
 *
 * Mirrors pi TUI's `/compact [focus]`: the focus is *appended*
 * to the kernel's default summarization prompt as
 * "Additional focus: …", not used to replace it. Leave the
 * input empty to use the default summarization.
 *
 * The dialog is intentionally minimal — a single textarea,
 * two buttons. Keybindings: Esc cancels, Cmd/Ctrl+Enter
 * confirms, Enter inside the textarea inserts a newline.
 * ───────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";

export interface CompactDialogProps {
  open: boolean;
  /** True while the RPC `compact` call is in flight. Disables inputs. */
  busy?: boolean;
  /** Initial text in the focus textarea (e.g. the slash-command args). */
  initialFocus?: string;
  onCancel: () => void;
  onConfirm: (focus: string) => void;
}

export function CompactDialog({
  open,
  busy = false,
  initialFocus = "",
  onCancel,
  onConfirm,
}: CompactDialogProps) {
  const { t } = useI18n();
  const [focus, setFocus] = useState(initialFocus);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Sync initial value whenever the dialog re-opens. We intentionally
  // don't re-sync on every render — once the user starts typing we
  // don't want a stale parent prop to overwrite their input.
  useEffect(() => {
    if (open) {
      setFocus(initialFocus);
    }
  }, [open, initialFocus]);

  // Auto-focus the textarea on open so the user can start typing
  // immediately. focus the parent isn't already focusing something else.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      textareaRef.current?.focus();
      // Place caret at the end, not at the start.
      const ta = textareaRef.current;
      if (ta) {
        const len = ta.value.length;
        ta.setSelectionRange(len, len);
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [open]);

  // Esc/Enter keybindings — Enter on the textarea is left alone (newline).
  // Cmd/Ctrl+Enter confirms; this keeps the textarea usable while still
  // offering a keyboard shortcut to commit.
  // NOTE: this listener runs in the capture phase, so it fires BEFORE the
  // textarea's own default Enter-newline behavior — but it only acts on
  // Escape and Cmd/Ctrl+Enter, so plain Enter still inserts a newline.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (!busy) onCancel();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (!busy) onConfirm(focus.trim());
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, busy, focus, onCancel, onConfirm]);

  // Mount target for the portal. Created after first client render to
  // avoid an SSR/hydration mismatch (the same trick ConfirmDialog uses).
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalEl(document.body);
  }, []);

  const handleConfirm = useCallback(() => {
    if (busy) return;
    onConfirm(focus.trim());
  }, [busy, focus, onConfirm]);

  if (!open || !portalEl) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("Compact context")}
      onMouseDown={(e) => {
        // Backdrop click cancels — same convention as ConfirmDialog.
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 20,
          // `min(540px, calc(100vw - 32px))` keeps the dialog responsive on
          // narrow mobile viewports where a hard maxWidth would force
          // horizontal scrolling on top of the 16px gutter padding.
          width: "min(540px, calc(100vw - 32px))",
          maxWidth: 540,
          boxShadow: "0 8px 24px rgba(0,0,0,0.32)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
          {t("Compact context?")}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            lineHeight: 1.5,
          }}
        >
          {t(
            "Manually compact the conversation so the next prompt starts from a fresh, summarized context.",
          )}
        </div>
        <label
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          <span>
            {t(
              "Optional focus (e.g. \"preserve React-specific details\"):",
            )}
          </span>
          <textarea
            ref={textareaRef}
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            disabled={busy}
            rows={3}
            spellCheck={false}
            style={{
              resize: "vertical",
              minHeight: 60,
              maxHeight: 160,
              padding: "6px 10px",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              color: "var(--text)",
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              lineHeight: 1.4,
              outline: "none",
            }}
          />
        </label>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 4,
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{
              padding: "6px 14px",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 4,
              color: "var(--text)",
              cursor: busy ? "not-allowed" : "pointer",
              fontSize: 12,
              opacity: busy ? 0.5 : 1,
            }}
          >
            {t("Cancel")}
          </button>
          <button
            type="button"
            autoFocus
            onClick={handleConfirm}
            disabled={busy}
            style={{
              padding: "6px 14px",
              background: "var(--accent)",
              border: "1px solid var(--accent)",
              borderRadius: 4,
              color: "var(--bg)",
              cursor: busy ? "wait" : "pointer",
              fontSize: 12,
              fontWeight: 600,
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? t("Compacting...") : t("Compact")}
          </button>
        </div>
      </div>
    </div>,
    portalEl,
  );
}