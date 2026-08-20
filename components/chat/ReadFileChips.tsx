"use client";

import { useEffect, useRef, useState } from "react";
import { Tooltip } from "../ui/Tooltip";
import { getFileIcon } from "../files/FileIcons";
import { useI18n } from "@/hooks/useI18n";
import { useCollapseHeight } from "@/hooks/useCollapseHeight";
import type { ReadFileInfo } from "@/lib/shared/types";

const MAX_VISIBLE = 2;
const BUBBLE_WIDTH = 264;
const BUBBLE_MAX_HEIGHT = 320;
const MIN_SPACE = 120;
const CHIP_MAX_WIDTH = 150;

interface Props {
  files: ReadFileInfo[];
  onOpenFile: (filePath: string, fileName: string) => void;
}

/** Turn-level `read` file chips, rendered in the assistant message footer row.
 *  Shows at most {@link MAX_VISIBLE} chips, then a "..." that smoothly expands
 *  a bubble (down by default, up only when space below is tight) with the full
 *  list. Every chip/list row opens the file in the right-hand panel. */
export function ReadFileChips({ files, onOpenFile }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<"down" | "up">("down");
  const rootRef = useRef<HTMLDivElement>(null);
  const [bubbleMaxHeight, setBubbleMaxHeight] = useState(BUBBLE_MAX_HEIGHT);

  const visible = files.slice(0, MAX_VISIBLE);
  const hasMore = files.length > MAX_VISIBLE;

  // Toggle the bubble. On open, pick a direction — down by default, up only
  // when there isn't enough room below — and cap its height to the space
  // actually visible in that direction inside the chat scroll container, so
  // the expanding list is never clipped out of view.
  const toggle = () => {
    if (!open && rootRef.current) {
      let c: HTMLElement | null = rootRef.current.parentElement;
      while (c) {
        const oy = getComputedStyle(c).overflowY;
        if (oy === "auto" || oy === "scroll") break;
        c = c.parentElement;
      }
      const rootRect = rootRef.current.getBoundingClientRect();
      const containerRect = c ? c.getBoundingClientRect() : null;
      const spaceBelow = containerRect
        ? containerRect.bottom - rootRect.bottom
        : window.innerHeight - rootRect.bottom;
      const spaceAbove = rootRect.top - (containerRect ? containerRect.top : 0);
      if (spaceBelow >= MIN_SPACE) {
        setDirection("down");
        setBubbleMaxHeight(Math.max(MIN_SPACE, Math.min(BUBBLE_MAX_HEIGHT, Math.round(spaceBelow - 12))));
      } else {
        setDirection("up");
        setBubbleMaxHeight(Math.max(MIN_SPACE, Math.min(BUBBLE_MAX_HEIGHT, Math.round(spaceAbove - 12))));
      }
    }
    setOpen((v) => !v);
  };

  // Close on outside click / Escape; the "..." button toggles by itself.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const openFile = (f: ReadFileInfo) => {
    onOpenFile(f.path, f.name);
    setOpen(false);
  };

  return (
    <div
      ref={rootRef}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 4,
        flex: 1,
        minWidth: 0,
      }}
    >
      {visible.map((f) => (
        <Chip key={f.path} file={f} onClick={() => openFile(f)} />
      ))}
      {hasMore && (
        <div style={{ position: "relative", display: "inline-flex" }}>
          <Tooltip content={t("Show all files")}>
            <button
              type="button"
              onClick={toggle}
              aria-label={t("Show all files")}
              aria-expanded={open}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                height: 20,
                padding: "0 7px",
                background: "var(--bg-selected)",
                border: "1px solid var(--border)",
                borderRadius: 999,
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                lineHeight: 1,
              }}
            >
              ...
            </button>
          </Tooltip>
          <FileListBubble files={files} open={open} maxHeight={bubbleMaxHeight} direction={direction} onOpen={openFile} />
        </div>
      )}
    </div>
  );
}

/** One pill: [file icon + basename]. Ellipsizes long names; Tooltip shows the
 *  full absolute path. Click opens the file in the right-hand panel. */
function Chip({ file, onClick }: { file: ReadFileInfo; onClick: () => void }) {
  return (
    <Tooltip content={file.path}>
      <button
        type="button"
        onClick={onClick}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          maxWidth: CHIP_MAX_WIDTH,
          height: 20,
          padding: "0 8px",
          background: "var(--bg-selected)",
          border: "1px solid var(--border)",
          borderRadius: 999,
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        {getFileIcon(file.name, 12)}
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
          {file.name}
        </span>
      </button>
    </Tooltip>
  );
}

/** Expandable list bubble anchored to the "..." button. Defaults to expanding
 *  downward; flips upward only when there isn't enough room below. Stays
 *  mounted so close animates too: height transitions 0 ↔ measured content
 *  (clamped to BUBBLE_MAX_HEIGHT), then flips to scrollable once the
 *  transition settles for long lists. */
function FileListBubble({ files, open, maxHeight, direction, onOpen }: {
  files: ReadFileInfo[];
  open: boolean;
  maxHeight: number;
  direction: "down" | "up";
  onOpen: (f: ReadFileInfo) => void;
}) {
  const { t } = useI18n();
  const { contentRef, contentHeight, allowAnim } = useCollapseHeight<HTMLDivElement>();
  const [scrolled, setScrolled] = useState(false);
  const targetHeight = contentHeight === null ? 0 : Math.min(contentHeight, maxHeight);
  const settled = scrolled || (contentHeight !== null && contentHeight <= maxHeight);
  const anchor = direction === "down" ? { top: "calc(100% + 8px)" } : { bottom: "calc(100% + 8px)" };

  useEffect(() => {
    if (!open) {
      setScrolled(false);
      return;
    }
    if (contentHeight !== null && contentHeight > maxHeight) {
      // Match the height transition duration, then make the list scrollable.
      const id = window.setTimeout(() => setScrolled(true), 260);
      return () => window.clearTimeout(id);
    }
  }, [open, contentHeight, maxHeight]);

  return (
    <div
      aria-hidden={!open}
      style={{
        position: "absolute",
        ...anchor,
        left: 0,
        zIndex: 50,
        width: BUBBLE_WIDTH,
        height: open ? targetHeight : 0,
        overflow: !open || !settled ? "hidden" : "auto",
        transition: allowAnim ? "height 0.22s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.15s ease" : "none",
        opacity: open ? 1 : 0,
        pointerEvents: open ? "auto" : "none",
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        boxShadow: "0 10px 32px rgba(0,0,0,0.25)",
        transformOrigin: direction === "down" ? "top" : "bottom",
      }}
    >
      <div ref={contentRef} style={{ display: "flex", flexDirection: "column", gap: 2, padding: 6 }}>
        <div
          style={{
            padding: "3px 8px 6px",
            fontSize: 11,
            fontWeight: 600,
            color: "var(--text-dim)",
            borderBottom: "1px solid var(--border)",
            marginBottom: 2,
            whiteSpace: "nowrap",
          }}
        >
          {t("Files read this turn:")}
        </div>
        {files.map((f) => (
          <Tooltip key={f.path} content={f.path}>
            <button
              type="button"
              onClick={() => onOpen(f)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                width: "100%",
                height: 26,
                padding: "0 8px",
                background: "none",
                border: "none",
                borderRadius: 6,
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: 12,
                fontFamily: "var(--font-mono)",
                textAlign: "left",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
            >
              {getFileIcon(f.name, 13)}
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {f.name}
              </span>
            </button>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}
