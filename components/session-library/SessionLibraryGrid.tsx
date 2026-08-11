"use client";

/**
 * SessionLibraryGrid — grid view body of the Session Library modal.
 *
 * Combines the filter tabs (Q3D / Q17B), the search box, and the responsive
 * tile grid (Q4B). Each tile is either an image preview tile (covers with
 * object-fit: contain so portrait screenshots letterbox correctly) or a
 * compact non-image row (PDF / video / audio / text / binary).
 *
 * Failed entries are rendered as full-width error rows below the grid (Q7A)
 * — they don't occupy image slots but stay visible inside the "全部" filter.
 *
 * Pending (streaming) entries render as a subtle dashed-border card so the
 * user knows the tool call hasn't completed yet (Q18A).
 *
 * The grid auto-scrolls to the focused entry once on mount when the modal
 * was opened from a tool-call card (`focusToolCallId`), then briefly
 * flashes a highlight ring around the matched tile.
 */

import { useEffect, useMemo, useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  useSessionLibraryActions,
  useSessionLibraryUi,
  focusSessionLibraryMedia,
} from "@/hooks/sessionLibraryStore";
import { encodeFilePathForApi, joinFilePath, getFileName } from "@/lib/file-paths";
import type {
  SessionLibraryCounts,
  SessionLibraryEntry,
  SessionLibraryTile,
} from "@/lib/session-library-derive";
import type { SessionLibraryFilter } from "@/hooks/sessionLibraryStore";

interface Props {
  tiles: SessionLibraryTile[];
  entries: SessionLibraryEntry[];
  counts: SessionLibraryCounts;
  filter: string;
  search: string;
  cwd?: string;
  onOpenFile: (filePath: string, fileName: string) => void;
}

const FILTER_TABS: Array<{
  key: SessionLibraryFilter;
  labelKey: string;
}> = [
  { key: "all", labelKey: "All" },
  { key: "image", labelKey: "Images" },
  { key: "video", labelKey: "Videos" },
  { key: "audio", labelKey: "Audio" },
  { key: "failed", labelKey: "Failed" },
];

const MEDIA_CATEGORIES = new Set(["image", "video", "audio"]);

export function SessionLibraryGrid({
  tiles,
  entries,
  counts,
  filter,
  search,
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
  const mediaTiles = useMemo(
    () => tiles.filter((tl) => MEDIA_CATEGORIES.has(tl.category)),
    [tiles],
  );
  const nonMediaTiles = useMemo(
    () => tiles.filter((tl) => !MEDIA_CATEGORIES.has(tl.category)),
    [tiles],
  );

  // Failed entries (resolved but exists === false). Always render as full-
  // width error rows, even in the "all" filter, so users notice.
  const failedTiles = useMemo(
    () => tiles.filter((tl) => tl.resolved && !tl.exists),
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
      {/* ── Filter bar + search ── */}
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-subtle)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 4,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          {FILTER_TABS.map((tab) => {
            const active = filter === tab.key;
            const count = counts.byFilter[tab.key] ?? 0;
            const failedInFilter =
              tab.key !== "all" && tab.key !== "failed"
                ? counts.byFilter.failed
                : 0;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => actions.setFilter(tab.key)}
                aria-pressed={active}
                style={{
                  padding: "4px 10px",
                  fontSize: 12,
                  borderRadius: 999,
                  border: active ? "1px solid var(--accent)" : "1px solid var(--border)",
                  background: active ? "var(--accent)" : "var(--bg-panel)",
                  color: active ? "var(--accent-fg, #fff)" : "var(--text-muted)",
                  cursor: "pointer",
                  fontWeight: active ? 600 : 400,
                  transition: "all 0.12s",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span>{t(tab.labelKey)}</span>
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: "var(--font-mono)",
                    opacity: 0.8,
                  }}
                >
                  {count}
                </span>
                {tab.key === "failed" && count > 0 && (
                  <span
                    aria-hidden="true"
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "#f87171",
                    }}
                  />
                )}
                {tab.key !== "all" &&
                  tab.key !== "failed" &&
                  failedInFilter > 0 && (
                    <span
                      aria-hidden="true"
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "#f87171",
                      }}
                    />
                  )}
              </button>
            );
          })}
        </div>

        <div style={{ flex: 1 }} />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "4px 8px",
            minWidth: 200,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-dim)" }}>
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder={t("Search files…")}
            value={search}
            onChange={(e) => actions.setSearch(e.target.value)}
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              outline: "none",
              background: "transparent",
              color: "var(--text)",
              fontSize: 12,
              fontFamily: "inherit",
            }}
          />
        </div>
      </div>

      {/* ── Scrollable body: grid + non-image rows + failed rows ── */}
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
        {tiles.length === 0 && entries.length > 0 && (
          <div
            style={{
              padding: "32px 16px",
              color: "var(--text-dim)",
              fontSize: 12,
              textAlign: "center",
            }}
          >
            {t("No matches for the current filter.")}
          </div>
        )}

        {mediaTiles.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
              gap: 10,
              alignContent: "start",
            }}
          >
            {mediaTiles.map((tile) => (
              <ImageTile
                key={`${tile.entryToolCallId}-${tile.path}`}
                tile={tile}
                cwd={cwd}
                onOpenFile={onOpenFile}
              />
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

        {failedTiles.length > 0 && filter !== "failed" && (
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

// ── Image tile ──────────────────────────────────────────────────────────

function ImageTile({
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
  const url = `/api/files/${encodeFilePathForApi(resolvedPath)}?type=read`;
  const name = getFileName(tile.path);

  if (!tile.resolved) {
    return <PendingTile name={name} />;
  }

  return (
    <button
      type="button"
      data-tool-call-id={tile.entryToolCallId}
      onClick={() => focusSessionLibraryMedia(`${tile.entryToolCallId}|${tile.path}`)}
      onDoubleClick={() => onOpenFile(resolvedPath, name)}
      style={{
        position: "relative",
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--bg)",
        cursor: "pointer",
        padding: 0,
        overflow: "hidden",
        aspectRatio: "1 / 1",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "transform 0.1s ease, border-color 0.1s ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--accent)";
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.transform = "none";
      }}
      title={tile.path}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={name}
        loading="lazy"
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: "contain",
          display: "block",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: "4px 8px",
          background: "linear-gradient(transparent, rgba(0,0,0,0.75))",
          color: "#fff",
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          textAlign: "left",
        }}
      >
        {name}
      </div>
      <OpenInTabHint
        onClick={(e) => {
          e.stopPropagation();
          onOpenFile(resolvedPath, name);
        }}
        label={t("Open in tab")}
      />
    </button>
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