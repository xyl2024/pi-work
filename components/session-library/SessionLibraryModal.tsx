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
 * - "grid"            — full-bleed masonry (default)
 * - "media-preview"   — single media tile takes the modal body; ←/→
 *                        navigate across the media list; Esc returns to
 *                        grid
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

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import {
  useSessionLibraryUi,
  useSessionLibraryActions,
  backToSessionLibraryGrid,
} from "@/hooks/sessionLibraryStore";
import { useSessionLibraryEntries } from "@/hooks/useSessionLibraryEntries";
import { useToast } from "@/components/Toast";
import { copyText } from "@/components/CodeBlock";
import { MorphToggleIcon } from "@/components/MorphToggleIcon";
import { COPY, CHECK } from "@/lib/icon-paths";
import { joinFilePath } from "@/lib/file-paths";
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
  // Open state comes from the global sessionLibrary store (no `onClose`
  // prop). The hook drives the open/close animation; `actions.close`
  // is what the parent uses to flip `isOpen` to false. `backdropAlpha`
  // is bumped to 0.55 to keep the backdrop visibly dark behind the
  // backdrop-blur — a 0.35 dim looks washed out through the blur.
  const { requestClose, backdropStyle, panelStyle, isVisible } = useModalAnimation({
    isOpen: ui.isOpen,
    onClose: actions.close,
    backdropAlpha: 0.55,
  });

  // ── Esc behavior: media-preview → grid → close ──
  // Routes the close step through `requestClose` so the leaving animation
  // plays before the store flips `isOpen` to false.
  useEffect(() => {
    if (!ui.isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (ui.viewMode === "media-preview") {
        backToSessionLibraryGrid();
      } else {
        requestClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [ui.isOpen, ui.viewMode, requestClose]);

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
  const { entries, tiles } = useSessionLibraryEntries(messages);

  // ── Current preview tile → absolute path shown in the header bar so the
  // user always knows what they're looking at. ──
  const previewPath = useMemo(() => {
    if (ui.viewMode !== "media-preview" || !ui.mediaPreviewTileKey) return null;
    const tile = tiles.find(
      (tl) => `${tl.entryToolCallId}|${tl.path}` === ui.mediaPreviewTileKey,
    );
    if (!tile) return null;
    const p = tile.path;
    if (!cwd) return p;
    if (p.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\\\")) return p;
    return joinFilePath(cwd, p);
  }, [ui.viewMode, ui.mediaPreviewTileKey, tiles, cwd]);

  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
  }, []);
  const handleCopyPath = async () => {
    if (!previewPath) return;
    try {
      await copyText(previewPath);
      setCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 1500);
      toast.show({ kind: "success", message: t("Path copied") });
    } catch {
      toast.show({ kind: "error", message: t("Failed to copy path") });
    }
  };

  if (!isVisible) return null;
  if (typeof document === "undefined") return null;

  const isEmpty = entries.length === 0;

  const node = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("Session Media Library")}
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
      style={{
        ...backdropStyle,
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
        zIndex: 9999,
        padding: "32px 16px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          ...panelStyle,
          width: "min(960px, 100%)",
          // Fixed height — the modal never resizes with the current tile
          // (small vs huge images, missing files, etc.). The body flexes.
          height: "75vh",
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* ── Compact top bar: icon, title, current path + copy, close ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "6px 12px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-subtle)",
            flexShrink: 0,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 22,
              height: 22,
              borderRadius: 5,
              background: "var(--accent)",
              color: "var(--accent-fg, #fff)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </span>
          <h2
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text)",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {t("Session Media Library")}
          </h2>
          {ui.focusToolCallId && (
            <span
              style={{
                color: "var(--text-dim)",
                fontSize: 10,
                fontFamily: "var(--font-mono)",
                background: "var(--bg-selected)",
                padding: "1px 6px",
                borderRadius: 8,
                flexShrink: 0,
              }}
            >
              ↪ {ui.focusToolCallId.slice(0, 8)}
            </span>
          )}

          {previewPath ? (
            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                textAlign: "right",
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                color: "var(--text-dim)",
              }}
            >
              {previewPath}
            </span>
          ) : (
            <div style={{ flex: 1 }} />
          )}

          {previewPath && (
            <button
              type="button"
              onClick={handleCopyPath}
              aria-label={copied ? t("Path copied") : t("Copy path")}
              title={copied ? t("Path copied") : t("Copy path")}
              style={{
                ...headerIconBtnStyle,
                color: copied ? "#22c55e" : headerIconBtnStyle.color,
              }}
            >
              <MorphToggleIcon from={COPY} to={CHECK} active={copied} size={12} />
            </button>
          )}

          <button
            type="button"
            onClick={requestClose}
            aria-label={t("Close")}
            title={t("Close")}
            style={{ ...headerIconBtnStyle, fontSize: 14, lineHeight: 1 }}
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
            cwd={cwd}
          />
        ) : (
          <SessionLibraryGrid
            tiles={tiles}
            cwd={cwd}
            onOpenFile={onOpenFile}
          />
        )}
      </div>
    </div>
  );

  return createPortal(node, document.body);
}

/** Compact 26px icon button for the header bar (copy / close). */
const headerIconBtnStyle: React.CSSProperties = {
  width: 26,
  height: 26,
  padding: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "var(--bg-panel)",
  color: "var(--text-muted)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  cursor: "pointer",
  flexShrink: 0,
};

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