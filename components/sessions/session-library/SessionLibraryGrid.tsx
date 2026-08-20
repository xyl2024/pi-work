"use client";

/**
 * SessionLibraryGrid — grid view body of the Session Library modal.
 *
 * A masonry tile layout (CSS columns). Each tile keeps its natural aspect
 * ratio: images render at full width / natural height, videos show their
 * first frame with a duration badge + play affordance, and audio is a
 * square "album card" with a deterministic gradient cover. Failed entries
 * are rendered as full-width error rows below the masonry — they don't
 * occupy media slots but stay visible so users notice.
 *
 * Pending (streaming) entries render as a subtle dashed-border card so the
 * user knows the tool call hasn't completed yet.
 *
 * The grid auto-scrolls to the focused entry once on mount when the modal
 * was opened from a tool-call card (`focusToolCallId`), then briefly
 * flashes a highlight ring around the matched tile.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  useSessionLibraryActions,
  useSessionLibraryUi,
  focusSessionLibraryMedia,
} from "@/hooks/sessionLibraryStore";
import { encodeFilePathForApi, joinFilePath, getFileName } from "@/lib/shared/file-paths";
import {
  DurationBadge,
  EqualizerBars,
  gradientFromPath,
  useInView,
  useMediaDuration,
} from "./MediaBits";
import type {
  SessionLibraryTile,
} from "@/lib/shared/session-library-derive";

interface Props {
  tiles: SessionLibraryTile[];
  cwd?: string;
  onOpenFile: (filePath: string, fileName: string) => void;
}

const MEDIA_CATEGORIES = new Set(["image", "video", "audio"]);

export function SessionLibraryGrid({
  tiles,
  cwd,
  onOpenFile,
}: Props) {
  const { t } = useI18n();
  const ui = useSessionLibraryUi();
  const actions = useSessionLibraryActions();

  // ── Auto-scroll + flash on focusToolCallId ──
  const gridRef = useRef<HTMLDivElement>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const targetId = ui.focusToolCallId;
    if (!targetId) return;
    const el = gridRef.current?.querySelector<HTMLElement>(
      `[data-tool-call-id="${CSS.escape(targetId)}"]`,
    );
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("session-library-flash");
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => {
      el.classList.remove("session-library-flash");
      // Clear focus once flashed so re-opening the modal doesn't re-flash
      actions.setFilter(ui.filter);
    }, 1600);
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
    // Intentionally only run when focusToolCallId changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.focusToolCallId]);

  // ── Partition tiles: media vs compact non-media rows (only failure
  // paths survive as compact rows now — `show_media` only accepts image /
  // video / audio, so the "non-media" bucket is effectively just the
  // failed entries). ──
  //
  // `known` guards the cold-cache case: after a reload / session switch the
  // runtime cache is empty, so `exists` is a best-effort false. Those tiles
  // still render (the file is usually there); only cache-confirmed failures
  // land in the error rows.
  const mediaTiles = useMemo(
    () => tiles.filter((tl) => MEDIA_CATEGORIES.has(tl.category) && (!tl.known || tl.exists)),
    [tiles],
  );
  const nonMediaTiles = useMemo(
    () => tiles.filter((tl) => !MEDIA_CATEGORIES.has(tl.category)),
    [tiles],
  );

  // Failed entries (cache-confirmed misses). Always render as full-
  // width error rows, even in the "all" filter, so users notice.
  const failedTiles = useMemo(
    () => tiles.filter((tl) => tl.resolved && tl.known && !tl.exists),
    [tiles],
  );

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* ── Scrollable body: masonry + non-image rows + failed rows ── */}
      <div
        ref={gridRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {mediaTiles.length > 0 && (
          <div
            style={{
              // Masonry: CSS columns let every tile keep its natural
              // aspect ratio (portrait screenshots stay tall, videos
              // keep their frame, audio is a square album card).
              columnWidth: 210,
              columnGap: 12,
              maxWidth: "100%",
            }}
          >
            {mediaTiles.map((tile) => (
              <div
                key={`${tile.entryToolCallId}-${tile.path}`}
                style={{ breakInside: "avoid", marginBottom: 12 }}
              >
                <MediaTile
                  tile={tile}
                  cwd={cwd}
                  onOpenFile={onOpenFile}
                />
              </div>
            ))}
          </div>
        )}

        {nonMediaTiles.length > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {nonMediaTiles.map((tile) => (
              <CompactRow
                key={`${tile.entryToolCallId}-${tile.path}`}
                tile={tile}
                cwd={cwd}
                onOpenFile={onOpenFile}
              />
            ))}
          </div>
        )}

        {failedTiles.length > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              marginTop: mediaTiles.length > 0 || nonMediaTiles.length > 0 ? 8 : 0,
              paddingTop: mediaTiles.length > 0 || nonMediaTiles.length > 0 ? 12 : 0,
              borderTop:
                mediaTiles.length > 0 || nonMediaTiles.length > 0
                  ? "1px dashed var(--border)"
                  : "none",
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#f87171",
                textTransform: "uppercase",
                letterSpacing: 0.5,
                fontFamily: "var(--font-mono)",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span>⚠</span>
              <span>
                {t("Failed")} · {failedTiles.length}
              </span>
            </div>
            {failedTiles.map((tile) => (
              <ErrorRow
                key={`err-${tile.entryToolCallId}-${tile.path}`}
                tile={tile}
                cwd={cwd}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Media tile (image / video / audio) ──────────────────────────────────

function MediaTile({
  tile,
  cwd,
  onOpenFile,
}: {
  tile: SessionLibraryTile;
  cwd?: string;
  onOpenFile: (filePath: string, fileName: string) => void;
}) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const [imgErrored, setImgErrored] = useState(false);
  const resolvedPath = resolvePath(tile.path, cwd);
  const url = `/api/files/${encodeFilePathForApi(resolvedPath)}?type=read`;
  const name = getFileName(tile.path);

  if (!tile.resolved) {
    return <PendingTile name={name} />;
  }

  const openPreview = () => focusSessionLibraryMedia(`${tile.entryToolCallId}|${tile.path}`);
  const openInTab = () => onOpenFile(resolvedPath, name);

  return (
    <div
      data-tool-call-id={tile.entryToolCallId}
      role="button"
      tabIndex={0}
      aria-label={name}
      onClick={openPreview}
      onDoubleClick={openInTab}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openPreview();
        }
      }}
      title={tile.path}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        borderRadius: 10,
        overflow: "hidden",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        cursor: "pointer",
        transition: "transform 0.14s ease, border-color 0.14s ease, box-shadow 0.14s ease",
        transform: hovered ? "translateY(-2px)" : "none",
        borderColor: hovered ? "var(--accent)" : undefined,
        boxShadow: hovered ? "0 8px 24px rgba(0,0,0,0.18)" : "none",
      }}
    >
      {tile.category === "video" && <VideoTileMedia src={url} />}
      {tile.category === "audio" && <AudioTileMedia src={url} path={tile.path} />}
      {tile.category === "image" &&
        (imgErrored ? (
          <BrokenMediaTile />
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={url}
            alt={name}
            loading="lazy"
            onError={() => setImgErrored(true)}
            style={{ display: "block", width: "100%", height: "auto" }}
          />
        ))}

      {/* Center play button for videos — brightens on hover. */}
      {tile.category === "video" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: hovered ? "rgba(0,0,0,0.18)" : "rgba(0,0,0,0.06)",
            transition: "opacity 0.14s ease, background 0.14s ease",
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: "rgba(0,0,0,0.55)",
              border: "1px solid rgba(255,255,255,0.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              transform: hovered ? "scale(1.08)" : "scale(1)",
              transition: "transform 0.14s ease",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14z" />
            </svg>
          </span>
        </div>
      )}

      {/* Audio tiles get a small decorative equalizer over their cover. */}
      {tile.category === "audio" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <EqualizerBars playing={false} width={56} height={30} barCount={7} />
        </div>
      )}

      {/* Name bar — always visible; right side keeps room for badges. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: "18px 8px 5px",
          background: "linear-gradient(transparent, rgba(0,0,0,0.78))",
          color: "#fff",
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          display: "flex",
          alignItems: "center",
          gap: 6,
          pointerEvents: "none",
        }}
      >
        <span
          style={{
            flex: 1,
            minWidth: 0,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            textAlign: "left",
          }}
        >
          {name}
        </span>
        {tile.size !== undefined && (
          <span style={{ fontSize: 10, opacity: 0.85, flexShrink: 0 }}>
            {fmtSize(tile.size)}
          </span>
        )}
      </div>

      <OpenInTabHint
        onClick={(e) => {
          e.stopPropagation();
          openInTab();
        }}
        label={t("Open in tab")}
      />
    </div>
  );
}

// Fallback for a media file that failed to load (e.g. deleted on disk
// after a cold-cache reload) — a muted placeholder instead of a broken
// image glyph.
function BrokenMediaTile() {
  const { t } = useI18n();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        minHeight: 120,
        background: "var(--bg-subtle)",
        color: "var(--text-dim)",
        fontSize: 11,
        fontFamily: "var(--font-mono)",
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 12 }}>✕</span>
      <span>{t("Failed to load")}</span>
    </div>
  );
}

// Video tile body: uses a real <video preload="metadata"> element so the
// first frame doubles as the poster (no extra thumbnail fetch), and reads
// the duration + intrinsic aspect ratio from its metadata. The source is
// only attached once the tile scrolls into view.
function VideoTileMedia({ src }: { src: string }) {
  const [ref, inView] = useInView<HTMLVideoElement>();
  const [duration, setDuration] = useState<number | null>(null);
  const [aspect, setAspect] = useState<string | null>(null);
  return (
    <>
      <video
        ref={ref}
        src={inView ? src : undefined}
        preload="metadata"
        muted
        playsInline
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          if (Number.isFinite(el.duration)) setDuration(el.duration);
          if (el.videoWidth && el.videoHeight) {
            setAspect(`${el.videoWidth} / ${el.videoHeight}`);
          }
        }}
        style={{
          display: "block",
          width: "100%",
          aspectRatio: aspect ?? "16 / 9",
          background: "#000",
          pointerEvents: "none",
        }}
      />
      <DurationBadge seconds={duration} />
    </>
  );
}

// Audio tile body: deterministic gradient cover (album art) + duration.
function AudioTileMedia({ src, path }: { src: string; path: string }) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const duration = useMediaDuration(inView ? src : undefined, "audio");
  return (
    <div
      ref={ref}
      style={{
        aspectRatio: "1 / 1",
        background: gradientFromPath(path),
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "repeating-linear-gradient(115deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 8px)",
        }}
      />
      <DurationBadge seconds={duration} />
    </div>
  );
}

// ── Compact non-image row ────────────────────────────────────────────────

function CompactRow({
  tile,
  cwd,
  onOpenFile,
}: {
  tile: SessionLibraryTile;
  cwd?: string;
  onOpenFile: (filePath: string, fileName: string) => void;
}) {
  const { t } = useI18n();
  const resolvedPath = resolvePath(tile.path, cwd);
  const name = getFileName(tile.path);
  const isPending = !tile.resolved;

  return (
    <button
      type="button"
      data-tool-call-id={tile.entryToolCallId}
      onClick={() => focusSessionLibraryMedia(`${tile.entryToolCallId}|${tile.path}`)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        cursor: isPending ? "default" : "pointer",
        fontSize: 12,
        color: "var(--text)",
        textAlign: "left",
        transition: "border-color 0.1s ease, background 0.1s ease",
      }}
      onMouseEnter={(e) => {
        if (isPending) return;
        e.currentTarget.style.borderColor = "var(--accent)";
        e.currentTarget.style.background = "var(--bg-hover, var(--bg-subtle))";
      }}
      onMouseLeave={(e) => {
        if (isPending) return;
        e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.background = "var(--bg)";
      }}
      title={tile.path}
    >
      <CategoryGlyph category={tile.category} />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontFamily: "var(--font-mono)",
        }}
      >
        {name}
      </span>
      {tile.size !== undefined && (
        <span
          style={{
            color: "var(--text-dim)",
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            flexShrink: 0,
          }}
        >
          {fmtSize(tile.size)}
        </span>
      )}
      {isPending && (
        <span
          style={{
            color: "var(--text-dim)",
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            flexShrink: 0,
          }}
        >
          {t("Loading…")}
        </span>
      )}
      {!isPending && (
        <OpenInTabHint
          onClick={(e) => {
            e.stopPropagation();
            onOpenFile(resolvedPath, name);
          }}
          label={t("Open in tab")}
        />
      )}
    </button>
  );
}

// ── Error row ───────────────────────────────────────────────────────────

function ErrorRow({ tile, cwd }: { tile: SessionLibraryTile; cwd?: string }) {
  const resolvedPath = resolvePath(tile.path, cwd);
  const name = getFileName(tile.path);
  return (
    <div
      title={tile.path}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "8px 12px",
        background: "rgba(248,113,113,0.05)",
        border: "1px dashed rgba(248,113,113,0.4)",
        borderRadius: 6,
        fontSize: 12,
      }}
    >
      <span aria-hidden="true" style={{ color: "#f87171", flexShrink: 0, lineHeight: 1.4 }}>⚠</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
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
            color: "var(--text-dim)",
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            marginTop: 2,
            wordBreak: "break-all",
          }}
        >
          {resolvedPath}
        </div>
        {tile.error && (
          <div
            style={{
              color: "#f87171",
              fontSize: 11,
              marginTop: 4,
            }}
          >
            {tile.error}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Pending tile (streaming) ─────────────────────────────────────────────

function PendingTile({ name }: { name: string }) {
  const { t } = useI18n();
  return (
    <div
      style={{
        position: "relative",
        border: "1px dashed var(--border)",
        borderRadius: 8,
        background: "var(--bg-subtle)",
        aspectRatio: "1 / 1",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        color: "var(--text-dim)",
        padding: 8,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 18,
          height: 18,
          border: "2px solid var(--border)",
          borderTopColor: "var(--text-muted)",
          borderRadius: "50%",
          animation: "session-library-spin 0.9s linear infinite",
        }}
      />
      <div
        style={{
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          maxWidth: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {name}
      </div>
      <div style={{ fontSize: 10, fontFamily: "var(--font-mono)" }}>
        {t("Loading…")}
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────

function CategoryGlyph({ category }: { category: string }) {
  const label = categoryLabel(category);
  return (
    <span
      aria-hidden="true"
      style={{
        width: 24,
        height: 24,
        flexShrink: 0,
        background: "var(--bg-selected)",
        color: "var(--text-muted)",
        borderRadius: 4,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 10,
        fontFamily: "var(--font-mono)",
        fontWeight: 600,
      }}
    >
      {label}
    </span>
  );
}

function categoryLabel(category: string): string {
  switch (category) {
    case "image":
      return "IMG";
    case "video":
      return "VID";
    case "audio":
      return "AUD";
    case "pdf":
      return "PDF";
    case "html":
      return "HTML";
    case "text":
      return "TXT";
    case "binary":
      return "BIN";
    default:
      return "?";
  }
}

function OpenInTabHint({
  onClick,
  label,
}: {
  onClick: (e: React.MouseEvent) => void;
  label: string;
}) {
  return (
    <span
      role="button"
      tabIndex={-1}
      onClick={onClick}
      title={label}
      style={{
        position: "absolute",
        top: 6,
        right: 6,
        width: 24,
        height: 24,
        padding: 0,
        border: "1px solid rgba(255,255,255,0.2)",
        background: "rgba(0,0,0,0.55)",
        color: "#fff",
        borderRadius: 5,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: 0,
        transition: "opacity 0.15s ease",
        cursor: "pointer",
      }}
      className="session-library-open-in-tab"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 17 17 7" />
        <path d="M7 7h10v10" />
      </svg>
    </span>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────

function resolvePath(filePath: string, cwd?: string): string {
  if (!cwd) return filePath;
  if (filePath.startsWith("/")) return filePath;
  if (/^[a-zA-Z]:[\\/]/.test(filePath)) return filePath;
  if (filePath.startsWith("\\\\")) return filePath;
  return joinFilePath(cwd, filePath);
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// CSS keyframes + flash class — injected via a global <style> tag the
// first time the grid mounts. Cheaper than a CSS module for this size.
let styleInjected = false;
function injectStyles() {
  if (styleInjected || typeof document === "undefined") return;
  styleInjected = true;
  const style = document.createElement("style");
  style.setAttribute("data-source", "session-library");
  style.textContent = `
    @keyframes session-library-spin {
      to { transform: rotate(360deg); }
    }
    .session-library-open-in-tab:hover,
    button:hover > .session-library-open-in-tab,
    button:hover .session-library-open-in-tab {
      opacity: 1 !important;
    }
    .session-library-flash {
      animation: session-library-flash-anim 1.4s ease-out;
    }
    @keyframes session-library-flash-anim {
      0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.6); }
      30% { box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.4); }
      100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
    }
  `;
  document.head.appendChild(style);
}
injectStyles();