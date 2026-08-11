"use client";

/**
 * SessionLibraryPreview — single-media preview view (Q12B / Q1A).
 *
 * Renders one media tile (image / video / audio) full-bleed inside the
 * modal body. ←/→ walk through the filtered media tile list cyclically.
 * Esc returns to the grid (handled in SessionLibraryModal).
 *
 * After the `show_file` → `show_media` rename the library contains only
 * multimedia. All three categories share this single preview surface so
 * users don't context-switch between image and non-image flows.
 *
 *   image   →  <img>  with loading spinner + error fallback
 *   video   →  <video controls>  with poster fallback while metadata loads
 *   audio   →  <AudioPlayer>     (existing component)
 *
 * No external lightbox — the modal's 1100px max-width is large enough
 * to feel like a focused viewer without the page-jumping of a portal'd
 * lightbox.
 */

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  backToSessionLibraryGrid,
  useSessionLibraryActions,
  useSessionLibraryUi,
} from "@/hooks/sessionLibraryStore";
import { useToast } from "@/components/Toast";
import { AudioPlayer } from "@/components/AudioPlayer";
import { copyText } from "@/components/CodeBlock";
import { encodeFilePathForApi, getFileName, joinFilePath } from "@/lib/file-paths";
import type {
  SessionLibraryCounts,
  SessionLibraryEntry,
  SessionLibraryTile,
} from "@/lib/session-library-derive";

interface Props {
  tiles: SessionLibraryTile[];
  entries: SessionLibraryEntry[];
  counts: SessionLibraryCounts;
  filter: string;
  search: string;
  cwd?: string;
  onOpenFile: (filePath: string, fileName: string) => void;
}

const MEDIA_CATEGORIES = new Set(["image", "video", "audio"]);

function makeTileKey(tile: { entryToolCallId: string; path: string }): string {
  return `${tile.entryToolCallId}|${tile.path}`;
}

function resolvePath(filePath: string, cwd?: string): string {
  if (!cwd) return filePath;
  if (filePath.startsWith("/")) return filePath;
  if (/^[a-zA-Z]:[\\/]/.test(filePath)) return filePath;
  if (filePath.startsWith("\\\\")) return filePath;
  return joinFilePath(cwd, filePath);
}

export function SessionLibraryPreview({
  tiles,
  cwd,
  onOpenFile,
}: Props) {
  const { t } = useI18n();
  const ui = useSessionLibraryUi();
  const actions = useSessionLibraryActions();
  const toast = useToast();

  const mediaTiles = useMemo(
    () => tiles.filter((tl) => MEDIA_CATEGORIES.has(tl.category)),
    [tiles],
  );

  const currentIndex = useMemo(() => {
    if (!ui.mediaPreviewTileKey) return 0;
    const i = mediaTiles.findIndex(
      (tl) => makeTileKey(tl) === ui.mediaPreviewTileKey,
    );
    return i >= 0 ? i : 0;
  }, [mediaTiles, ui.mediaPreviewTileKey]);

  const current = mediaTiles[currentIndex];
  const resolvedPath = current ? resolvePath(current.path, cwd) : null;
  const name = current ? getFileName(current.path) : "";

  // ── ←/→ keyboard nav (Modal-level Esc handler takes precedence) ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!current) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const next = (currentIndex - 1 + mediaTiles.length) % mediaTiles.length;
        actions.focusMedia(makeTileKey(mediaTiles[next]));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        const next = (currentIndex + 1) % mediaTiles.length;
        actions.focusMedia(makeTileKey(mediaTiles[next]));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [currentIndex, mediaTiles, current, actions]);

  if (!current || !resolvedPath) {
    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-dim)",
        }}
      >
        {t("No media in the current filter.")}
      </div>
    );
  }

  const url = `/api/files/${encodeFilePathForApi(resolvedPath)}?type=read`;

  const handleCopyPath = async () => {
    try {
      await copyText(resolvedPath);
      toast.show({ kind: "success", message: t("Path copied") });
    } catch {
      toast.show({ kind: "error", message: t("Failed to copy path") });
    }
  };

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
      }}
    >
      {/* ── Header: back, counter, prev, next ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 14px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-subtle)",
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={() => backToSessionLibraryGrid()}
          aria-label={t("Close")}
          title={t("Close")}
          style={iconBtnStyle}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <span
          style={{
            fontSize: 12,
            fontFamily: "var(--font-mono)",
            color: "var(--text-muted)",
            background: "var(--bg-selected)",
            padding: "2px 10px",
            borderRadius: 9,
            minWidth: 64,
            textAlign: "center",
          }}
        >
          {t("{n} of {total}", { n: currentIndex + 1, total: mediaTiles.length })}
        </span>

        <span
          aria-hidden="true"
          style={{
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            color: "var(--text-dim)",
            textTransform: "uppercase",
            letterSpacing: 0.4,
            padding: "2px 6px",
            borderRadius: 4,
            background: "var(--bg-selected)",
          }}
        >
          {current.category}
        </span>

        <button
          type="button"
          onClick={() => {
            const next = (currentIndex - 1 + mediaTiles.length) % mediaTiles.length;
            actions.focusMedia(makeTileKey(mediaTiles[next]));
          }}
          aria-label={t("Previous")}
          title={t("Previous")}
          disabled={mediaTiles.length <= 1}
          style={{ ...iconBtnStyle, opacity: mediaTiles.length <= 1 ? 0.4 : 1 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <button
          type="button"
          onClick={() => {
            const next = (currentIndex + 1) % mediaTiles.length;
            actions.focusMedia(makeTileKey(mediaTiles[next]));
          }}
          aria-label={t("Next")}
          title={t("Next")}
          disabled={mediaTiles.length <= 1}
          style={{ ...iconBtnStyle, opacity: mediaTiles.length <= 1 ? 0.4 : 1 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        <div style={{ flex: 1 }} />
      </div>

      {/* ── Media body ── */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "16px 24px",
          overflow: "hidden",
          background: "var(--bg)",
        }}
      >
        {current.category === "image" && (
          <ImageBody src={url} alt={name} key={url} />
        )}
        {current.category === "video" && (
          <VideoBody src={url} alt={name} key={url} />
        )}
        {current.category === "audio" && (
          <div style={{ width: "min(720px, 100%)" }}>
            <AudioPlayer src={url} title={name} />
          </div>
        )}
      </div>

      {/* ── Footer: info + actions ── */}
      <div
        style={{
          padding: "10px 16px 12px",
          borderTop: "1px solid var(--border)",
          background: "var(--bg-subtle)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexShrink: 0,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 13,
              color: "var(--text)",
              fontFamily: "var(--font-mono)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {name}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "var(--text-dim)",
              fontFamily: "var(--font-mono)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginTop: 2,
            }}
            title={resolvedPath}
          >
            {resolvedPath}
            {current.size !== undefined && (
              <span style={{ marginLeft: 8 }}>· {fmtSize(current.size)}</span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={handleCopyPath}
          style={iconBtnWithLabelStyle}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
          </svg>
          <span>{t("Copy path")}</span>
        </button>
        <button
          type="button"
          onClick={() => onOpenFile(resolvedPath, name)}
          style={iconBtnWithLabelStyle}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 17 17 7" />
            <path d="M7 7h10v10" />
          </svg>
          <span>{t("Open in tab")}</span>
        </button>
      </div>
    </div>
  );
}

const iconBtnStyle: React.CSSProperties = {
  width: 30,
  height: 30,
  padding: 0,
  border: "1px solid var(--border)",
  background: "var(--bg-panel)",
  color: "var(--text-muted)",
  borderRadius: 6,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const iconBtnWithLabelStyle: React.CSSProperties = {
  ...iconBtnStyle,
  width: "auto",
  height: 30,
  padding: "0 12px",
  gap: 6,
  fontSize: 12,
  fontFamily: "var(--font-mono)",
  flexShrink: 0,
};

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function ImageBody({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  return (
    <div
      style={{
        position: "relative",
        maxWidth: "100%",
        maxHeight: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 120,
        minHeight: 120,
      }}
    >
      {!loaded && !errored && <Spinner />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
        style={{
          display: loaded ? "block" : "none",
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: "contain",
          borderRadius: 6,
          border: "1px solid var(--border)",
        }}
      />
      {errored && <ErrorBox label={alt} />}
    </div>
  );
}

function VideoBody({ src, alt }: { src: string; alt: string }) {
  const [errored, setErrored] = useState(false);
  if (errored) return <ErrorBox label={alt} />;
  return (
    <video
      controls
      autoPlay
      src={src}
      preload="metadata"
      onError={() => setErrored(true)}
      style={{
        display: "block",
        maxWidth: "100%",
        maxHeight: "100%",
        objectFit: "contain",
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: "#000",
      }}
    />
  );
}

function Spinner() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        width: 28,
        height: 28,
        border: "3px solid var(--border)",
        borderTopColor: "var(--text-muted)",
        borderRadius: "50%",
        animation: "session-library-spin 0.9s linear infinite",
      }}
    />
  );
}

function ErrorBox({ label }: { label: string }) {
  return (
    <div
      style={{
        color: "#f87171",
        fontSize: 12,
        fontFamily: "var(--font-mono)",
        padding: "8px 12px",
        border: "1px dashed rgba(248,113,113,0.4)",
        borderRadius: 6,
      }}
    >
      {label}
    </div>
  );
}