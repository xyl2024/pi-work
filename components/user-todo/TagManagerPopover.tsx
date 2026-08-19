"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useConfirm } from "@/components/ConfirmDialog";
import type { Tag } from "@/hooks/useTodos";
import { truncateTag } from "./utils";
import { TagColorPicker } from "./TagColorPicker";

export function TagManagerPopover({
  onClose,
  tagSuggestions,
  tagCounts,
  onRename,
  onDelete,
  onSetColor,
}: {
  onClose: () => void;
  tagSuggestions: Tag[];
  tagCounts: Record<string, number>;
  onRename: (from: string, to: string) => Promise<void>;
  onDelete: (tag: string) => Promise<void>;
  onSetColor: (tag: string, color: string | null) => Promise<void>;
}) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const ref = useRef<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [colorPickerTag, setColorPickerTag] = useState<string | null>(null);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!ref.current) return;
      if (e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Close the picker first if it's open; only close the manager once
        // the picker is gone. Keeps Escape focused on the innermost layer.
        if (colorPickerTag) {
          e.preventDefault();
          setColorPickerTag(null);
          return;
        }
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, colorPickerTag]);

  const startRename = (tag: string) => {
    setEditing(tag);
    setDraft(tag);
  };

  const cancelRename = () => {
    setEditing(null);
    setDraft("");
  };

  const commitRename = async () => {
    if (!editing) return;
    const next = draft.trim();
    // No-op rename (same string, or empty draft) — just exit edit mode.
    if (next.length === 0 || next.toLowerCase() === editing.toLowerCase()) {
      cancelRename();
      return;
    }
    setBusy(true);
    try {
      await onRename(editing, next);
      setEditing(null);
      setDraft("");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (tag: string) => {
    const count = tagCounts[tag.toLowerCase()] ?? 0;
    const ok = await confirm({
      title: t("Delete tag?"),
      description: count === 1
        ? t("Delete tag from {n} todo?").replace("{n}", String(count))
        : t("Delete tag from {n} todos?").replace("{n}", String(count)),
      confirmLabel: t("Delete"),
      destructive: true,
    });
    if (ok) await onDelete(tag);
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t("Manage tags")}
      style={{
        position: "absolute",
        top: "calc(100% + 4px)",
        right: 0,
        zIndex: 10,
        minWidth: 220,
        maxWidth: 280,
        padding: 6,
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.25)",
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      <div style={{ fontSize: 10, color: "var(--text-dim)", padding: "2px 8px 4px", textTransform: "uppercase", letterSpacing: 0.5 }}>
        {t("Manage tags")}
      </div>
      {tagSuggestions.length === 0 && (
        <div style={{ fontSize: 11, color: "var(--text-dim)", padding: "6px 8px" }}>
          {t("No tags")}
        </div>
      )}
      <div role="group" data-scroll-inset style={{ display: "flex", flexDirection: "column", gap: 1, maxHeight: 240, overflowY: "auto" }}>
        {tagSuggestions.map((tag) => {
          const count = tagCounts[tag.name.toLowerCase()] ?? 0;
          const isEditing = editing === tag.name;
          if (isEditing) {
            return (
              <div
                key={tag.name}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "2px 6px",
                }}
              >
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitRename();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelRename();
                    }
                  }}
                  disabled={busy}
                  aria-label={t("New tag name")}
                  style={{
                    flex: 1, minWidth: 0,
                    padding: "2px 4px",
                    fontSize: 11,
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 3,
                    color: "var(--text)",
                    fontFamily: "inherit",
                    outline: "none",
                  }}
                />
                <button
                  onClick={commitRename}
                  disabled={busy}
                  style={{
                    padding: "2px 6px", fontSize: 10,
                    background: "transparent",
                    border: "none",
                    color: busy ? "var(--text-dim)" : "var(--text-muted)",
                    cursor: busy ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {t("Save")}
                </button>
                <button
                  onClick={cancelRename}
                  disabled={busy}
                  style={{
                    padding: "2px 6px", fontSize: 10,
                    background: "transparent",
                    border: "none",
                    color: busy ? "var(--text-dim)" : "var(--text-muted)",
                    cursor: busy ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {t("Cancel")}
                </button>
              </div>
            );
          }
          return (
            <div
              key={tag.name}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "3px 8px",
                fontSize: 11,
                borderRadius: 4,
                fontFamily: "inherit",
                position: "relative",
              }}
            >
              <button
                type="button"
                onClick={() => setColorPickerTag((cur) => cur === tag.name ? null : tag.name)}
                aria-label={t("Tag color")}
                title={tag.color ?? t("Tag color")}
                style={{
                  width: 14, height: 14, padding: 0, flexShrink: 0,
                  border: "1px solid var(--border)",
                  borderRadius: 3,
                  background: tag.color ?? "transparent",
                  cursor: "pointer",
                  position: "relative",
                }}
              >
                {!tag.color && (
                  // Empty state — a small plus to hint the swatch is clickable.
                  <span
                    aria-hidden
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--text-dim)",
                      fontSize: 10,
                      lineHeight: 1,
                    }}
                  >
                    +
                  </span>
                )}
              </button>
              <span
                title={tag.name}
                style={{
                  flex: 1, minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: "var(--text)",
                }}
              >
                {truncateTag(tag.name)}
              </span>
              <span style={{ color: "var(--text-dim)", fontSize: 10, flexShrink: 0 }}>
                · {count}
              </span>
              <button
                onClick={() => startRename(tag.name)}
                disabled={busy}
                style={{
                  padding: "0 4px", fontSize: 10,
                  background: "transparent",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: busy ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)"; }}
              >
                {t("Rename tag")}
              </button>
              <button
                onClick={() => handleDelete(tag.name)}
                disabled={busy}
                style={{
                  padding: "0 4px", fontSize: 10,
                  background: "transparent",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: busy ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#f87171"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)"; }}
              >
                {t("Delete tag")}
              </button>
              {colorPickerTag === tag.name && (
                <TagColorPicker
                  value={tag.color ?? null}
                  onChange={async (next) => {
                    setBusy(true);
                    try {
                      await onSetColor(tag.name, next);
                      setColorPickerTag(null);
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}