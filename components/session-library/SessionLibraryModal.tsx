"use client";

/**
 * SessionLibraryModal — 会话媒体库 (Session Media Library).
 *
 * Top-level modal that renders every `show_media` artifact of the active
 * session. Opens from the `SessionLibraryOpenButton` (chat bottom-right)
 * or from the "已添加 N 个文件 · M 个失败" status row on each
 * `ToolCallCard` (which passes `focusToolCallId` so the modal can scroll
 * the matching entry into view and briefly highlight it).
 *
 * After the `show_file` → `show_media` rename the library contains only
 * multimedia (image / video / audio). Two view modes:
 *
 * - "grid"            — full-bleed grid + filter bar (default)
 * - "media-preview"   — single media tile takes the modal body; ←/→
 *                        navigate across the filtered media list; Esc
 *                        returns to grid
 *
 * Close behavior:
 * - Esc: media-preview → grid → close (double-step)
 * - Click backdrop: close immediately
 * - Top-right × button: close immediately
 * - Switching sessions via the global effect also closes the modal
 *
 * The modal is portal'd into `document.body` so it escapes any parent
 * stacking context and we can lock body scroll while it's open.
 */

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import {
  useSessionLibraryUi,
  useSessionLibraryActions,
  backToSessionLibraryGrid,
} from "@/hooks/sessionLibraryStore";
import { useSessionLibraryEntries } from "@/hooks/useSessionLibraryEntries";
import type { AgentMessage } from "@/lib/types";
import { SessionLibraryGrid } from "./SessionLibraryGrid";
import { SessionLibraryPreview } from "./SessionLibraryPreview";

interface Props {
  messages: AgentMessage[];
  cwd?: string;
  /** Called when the user wants to open a file in the right-hand tab. */
  onOpenFile: (filePath: string, fileName: string) => void;
}

export function SessionLibraryModal({ messages, cwd, onOpenFile }: Props) {
  const { t } = useI18n();
  const ui = useSessionLibraryUi();
  const actions = useSessionLibraryActions();

  // ── Esc behavior: media-preview → grid → close ──
  useEffect(() => {
    if (!ui.isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (ui.viewMode === "media-preview") {
        backToSessionLibraryGrid();
      } else {
        actions.close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [ui.isOpen, ui.viewMode, actions]);

  // ── Body scroll lock ──
  useEffect(() => {
    if (!ui.isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [ui.isOpen]);

  // ── Session switch safety: AppShell calls resetSessionLibrary on
  // session change. Here we just defensively close if messages become null.
  useEffect(() => {
    if (!ui.isOpen) return;
    if (!messages) {
      actions.close();
    }
  }, [ui.isOpen, messages, actions]);

  // ── Stable derived data (computed once, passed down to children) ──
  const { entries, filteredEntries, tiles, counts, filter, search } =
    useSessionLibraryEntries(messages);

  if (!ui.isOpen) return null;
  if (typeof document === "undefined") return null;

  const isEmpty = entries.length === 0;

  const node = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("Session Media Library")}
      onClick={(e) => {
        if (e.target === e.currentTarget) actions.close();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "32px 16px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(1100px, 100%)",
          maxHeight: "85vh",
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* ── Top bar: × close, title, count ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-subtle)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span
              aria-hidden="true"
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                background: "var(--accent)",
                color: "var(--accent-fg, #fff)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 14,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="9" cy="9" r="2" />
                <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
              </svg>
            </span>
            <h2
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 600,
                color: "var(--text)",
              }}
            >
              {t("Session Media Library")}
            </h2>
            <span
              style={{
                color: "var(--text-dim)",
                fontSize: 12,
                fontFamily: "var(--font-mono)",
                background: "var(--bg-selected)",
                padding: "2px 8px",
                borderRadius: 9,
              }}
            >
              {counts.total} {t("files")}
            </span>
            {ui.focusToolCallId && (
              <span
                style={{
                  color: "var(--text-dim)",
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  background: "var(--bg-selected)",
                  padding: "2px 8px",
                  borderRadius: 9,
                }}
              >
                ↪ {ui.focusToolCallId.slice(0, 8)}
              </span>
            )}
          </div>

          <div style={{ flex: 1 }} />

          <button
            type="button"
            onClick={() => actions.close()}
            aria-label={t("Close")}
            title={t("Close")}
            style={{
              width: 32,
              height: 32,
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--bg-panel)",
              color: "var(--text-muted)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* ── Body ── */}
        {isEmpty ? (
          <EmptyState />
        ) : ui.viewMode === "media-preview" ? (
          <SessionLibraryPreview
            tiles={tiles}
            entries={filteredEntries}
            counts={counts}
            filter={filter}
            search={search}
            cwd={cwd}
            onOpenFile={onOpenFile}
          />
        ) : (
          <SessionLibraryGrid
            tiles={tiles}
            entries={filteredEntries}
            counts={counts}
            filter={filter}
            search={search}
            cwd={cwd}
            onOpenFile={onOpenFile}
          />
        )}
      </div>
    </div>
  );

  return createPortal(node, document.body);
}

function EmptyState() {
  const { t } = useI18n();
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 24px",
        color: "var(--text-dim)",
        textAlign: "center",
        gap: 12,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 64,
          height: 64,
          borderRadius: 16,
          background: "var(--bg-selected)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-muted)",
        }}
      >
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="9" cy="9" r="2" />
          <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
        </svg>
      </div>
      <div style={{ fontSize: 14, color: "var(--text-muted)", maxWidth: 460 }}>
        {t("No files in this session yet.")}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-dim)", maxWidth: 460, lineHeight: 1.6 }}>
        {t(
          "Let the agent use the show_media tool to surface images, video, and audio — they all land here. PDFs, Markdown, HTML, and plain text previews go through the right-hand file viewer instead.",
        )}
      </div>
    </div>
  );
}