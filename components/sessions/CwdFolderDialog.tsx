"use client";

/**
 * CwdFolderDialog — 可视化目录选择弹窗 (visual folder chooser).
 *
 * Opened from CwdPicker's "Select folder..." entry. Browse the filesystem
 * one level at a time (single-level list, like a system folder picker):
 * click a folder to enter it (double-click also enters), Up button /
 * breadcrumb-free path bar for jumping, and a hidden-files toggle. The
 * current directory is confirmed with "Open" — no folder creation, no
 * write operations anywhere: listing goes through the read-only
 * `GET /api/files?type=list` route (which serves the whole filesystem).
 *
 * Client-safe path helpers live here instead of importing Node's `path`
 * (browser bundle). They cover POSIX + Windows drive letters, matching
 * the shapes `lib/file-paths.ts` and the files route already handle.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { encodeFilePathForApi } from "@/lib/shared/file-paths";
import { FolderIcon } from "../files/FileIcons";
import { Tooltip } from "../ui/Tooltip";

// ── Client-safe path helpers ─────────────────────────────────────────────

/** Split an absolute path into segments, keeping a Windows drive ("C:") as
 *  its own segment. Backslashes are normalized to slashes first. */
function parsePathSegments(p: string): string[] {
  return p
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .split("/")
    .filter((x) => x.length > 0 && x !== ".");
}

function isDriveRoot(p: string): boolean {
  return /^[a-zA-Z]:$/.test(p);
}

/** Normalize user-typed input into an absolute directory path. `~` and
 *  relative paths resolve against the home directory; `.`/`..` segments are
 *  collapsed. Returns null for empty input. */
function normalizeLogicalPath(input: string, home: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let p = trimmed;
  if (p === "~") p = home;
  else if (p.startsWith("~/")) p = home + "/" + p.slice(2);
  else if (!p.startsWith("/") && !p.startsWith("\\\\") && !isDriveRoot(p)) {
    p = home + "/" + p;
  }
  const out: string[] = [];
  for (const seg of parsePathSegments(p)) {
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  if (out.length === 0) return "/";
  if (p.startsWith("//") || p.startsWith("\\\\")) return "//" + out.join("/");
  if (isDriveRoot(out[0])) {
    return out.length === 1 ? `${out[0]}/` : `${out[0]}/${out.slice(1).join("/")}`;
  }
  return "/" + out.join("/");
}

function joinDirPath(parent: string, name: string): string {
  return parent.endsWith("/") ? parent + name : parent + "/" + name;
}

function getParentDirPath(p: string): string | null {
  const segs = parsePathSegments(p);
  if (segs.length === 0) return null; // "/" has no parent
  if (segs.length === 1) return isDriveRoot(segs[0]) ? null : "/";
  const parentSegs = segs.slice(0, -1);
  if (isDriveRoot(parentSegs[0])) {
    return parentSegs.length === 1
      ? `${parentSegs[0]}/`
      : `${parentSegs[0]}/${parentSegs.slice(1).join("/")}`;
  }
  if (p.startsWith("//") || p.startsWith("\\\\")) return "//" + parentSegs.join("/");
  return "/" + parentSegs.join("/");
}

// ── Home directory (fetched once, cached at module scope) ────────────────

let cachedHome: string | null | undefined;
async function fetchHome(): Promise<string | null> {
  if (cachedHome !== undefined) return cachedHome;
  try {
    const res = await fetch("/api/home");
    const data = (await res.json()) as { home?: string };
    cachedHome = data.home ?? null;
  } catch {
    cachedHome = null;
  }
  return cachedHome;
}

// ── Directory listing (read-only, whole filesystem) ──────────────────────

async function fetchSubdirs(dirPath: string): Promise<string[]> {
  const res = await fetch(`/api/files/${encodeFilePathForApi(dirPath)}?type=list`);
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    const msg = data?.error ?? "";
    if (msg.includes("Not found")) throw new Error("Folder not found");
    if (msg.includes("Not a directory")) throw new Error("Not a folder");
    throw new Error("Failed to load folder");
  }
  const data = (await res.json()) as { entries?: { name: string; isDir: boolean }[] };
  // Folders only — this is a folder chooser, files are noise.
  return (data.entries ?? []).filter((e) => e.isDir).map((e) => e.name);
}

// ── Small icon button with tooltip + hover ───────────────────────────────

function IconButton({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 26,
          height: 26,
          flexShrink: 0,
          background: hovered ? "var(--bg-hover)" : "none",
          border: "none",
          borderRadius: 6,
          color: disabled ? "var(--text-dim)" : "var(--text-muted)",
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function DirRow({
  name,
  selected,
  onSelect,
  onOpen,
}: {
  name: string;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "6px 10px",
        background: selected ? "var(--bg-selected)" : hovered ? "var(--bg-hover)" : "none",
        border: "none",
        borderRadius: 6,
        color: "var(--text)",
        cursor: "pointer",
        textAlign: "left",
        fontSize: 12.5,
      }}
    >
      <FolderIcon size={14} name={name} />
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {name}
      </span>
    </button>
  );
}

// ── Dialog ───────────────────────────────────────────────────────────────

interface CwdFolderDialogProps {
  /** True while mounted (conditional-mount pattern; see useModalAnimation). */
  open: boolean;
  /** Directory shown when the dialog opens; falls back to home, then "/". */
  startPath?: string | null;
  onClose: () => void;
  /** Fires with the confirmed absolute directory path. */
  onSelect: (dir: string) => void;
}

export function CwdFolderDialog({ open, startPath, onClose, onSelect }: CwdFolderDialogProps) {
  const { t } = useI18n();
  const { requestClose, backdropStyle, panelStyle, isVisible } = useModalAnimation({
    isOpen: open,
    onClose,
    backdropAlpha: 0.4,
  });

  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [dirs, setDirs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [showHidden, setShowHidden] = useState(false);

  const homeRef = useRef<string | null>(null);
  const loadSeqRef = useRef(0);
  const startPathRef = useRef(startPath);
  useEffect(() => {
    startPathRef.current = startPath;
  }, [startPath]);

  const loadDir = useCallback(async (dir: string, keepInput = false) => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setLoadError(null);
    setSelected(null);
    try {
      const names = await fetchSubdirs(dir);
      if (seq !== loadSeqRef.current) return; // superseded by a newer navigation
      setCurrentPath(dir);
      setDirs(names);
      if (!keepInput) setPathInput(dir);
    } catch (e) {
      if (seq !== loadSeqRef.current) return;
      setLoadError(e instanceof Error ? e.message : t("Failed to load folder"));
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [t]);

  // Initial load: home directory (or the provided start path).
  useEffect(() => {
    void (async () => {
      const home = await fetchHome();
      homeRef.current = home;
      await loadDir(startPathRef.current || home || "/");
    })();
  }, [loadDir]);

  // Escape closes; body scroll is locked while the dialog is visible.
  useEffect(() => {
    if (!isVisible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        requestClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prev;
    };
  }, [isVisible, requestClose]);

  const goUp = useCallback(() => {
    if (!currentPath) return;
    const parent = getParentDirPath(currentPath);
    if (parent) void loadDir(parent);
  }, [currentPath, loadDir]);

  const goHome = useCallback(() => {
    if (homeRef.current) void loadDir(homeRef.current);
  }, [loadDir]);

  const submitPathInput = useCallback(() => {
    if (!homeRef.current) return;
    const resolved = normalizeLogicalPath(pathInput, homeRef.current);
    if (resolved) void loadDir(resolved);
  }, [pathInput, loadDir]);

  const handleConfirm = useCallback(() => {
    if (!currentPath) return;
    onSelect(currentPath);
    requestClose();
  }, [currentPath, onSelect, requestClose]);

  const visibleDirs = showHidden ? dirs : dirs.filter((d) => !d.startsWith("."));

  if (typeof document === "undefined") return null;
  if (!isVisible) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("Select folder")}
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
      style={{ ...backdropStyle, zIndex: 9999, padding: "24px 16px" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          ...panelStyle,
          width: "min(560px, 100%)",
          height: "min(480px, 80vh)",
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 12px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-subtle)",
            flexShrink: 0,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <FolderIcon size={14} />
          </span>
          <h2
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text)",
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {t("Select folder")}
          </h2>
          <IconButton label={t("Cancel")} onClick={requestClose}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </IconButton>
        </div>

        {/* Path bar: Home / Up / input / Go */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 12px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <IconButton label={t("Home")} onClick={goHome} disabled={!homeRef.current}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 10.5 12 3l9 7.5" />
              <path d="M5 9.5V21h14V9.5" />
            </svg>
          </IconButton>
          <IconButton
            label={t("Parent folder")}
            onClick={goUp}
            disabled={!currentPath || !getParentDirPath(currentPath)}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </IconButton>
          <input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitPathInput();
              }
            }}
            spellCheck={false}
            placeholder="/path/to/project"
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              padding: "5px 8px",
              border: "1px solid var(--border)",
              borderRadius: 6,
              outline: "none",
              background: "var(--bg)",
              color: "var(--text)",
              boxSizing: "border-box",
            }}
          />
          <IconButton label={t("Go")} onClick={submitPathInput} disabled={!pathInput.trim()}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </IconButton>
        </div>

        {/* Hidden-files toggle */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "5px 12px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            role="checkbox"
            aria-checked={showHidden}
            onClick={() => setShowHidden((v) => !v)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 14,
              height: 14,
              flexShrink: 0,
              background: showHidden ? "var(--accent)" : "var(--bg)",
              border: "1px solid " + (showHidden ? "var(--accent)" : "var(--border)"),
              borderRadius: 4,
              cursor: "pointer",
              padding: 0,
              color: "#fff",
            }}
          >
            {showHidden && (
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12.5 9.5 18 20 6.5" />
              </svg>
            )}
          </button>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("Show hidden files")}</span>
        </div>

        {/* Directory list */}
        <div data-scroll-inset style={{ flex: 1, overflowY: "auto", padding: "6px 8px", minHeight: 0 }}>
          {loading ? (
            <div style={{ padding: "14px 10px", fontSize: 11, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 7 }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4" />
              </svg>
              {t("Loading...")}
            </div>
          ) : loadError ? (
            <div style={{ padding: "14px 10px", fontSize: 11, color: "#f87171" }}>{loadError}</div>
          ) : visibleDirs.length === 0 ? (
            <div style={{ padding: "14px 10px", fontSize: 11, color: "var(--text-dim)" }}>
              {t("Empty folder")}
            </div>
          ) : (
            visibleDirs.map((name) => (
              <DirRow
                key={name}
                name={name}
                selected={name === selected}
                onSelect={() => setSelected(name)}
                onOpen={() => currentPath && void loadDir(joinDirPath(currentPath, name))}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            padding: "10px 12px",
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={requestClose}
            style={{
              padding: "6px 14px",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text)",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            {t("Cancel")}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!currentPath}
            style={{
              padding: "6px 14px",
              background: "var(--accent)",
              border: "1px solid var(--accent)",
              borderRadius: 6,
              color: "var(--bg)",
              cursor: currentPath ? "pointer" : "default",
              fontSize: 12,
              fontWeight: 600,
              opacity: currentPath ? 1 : 0.5,
            }}
          >
            {t("Open")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
