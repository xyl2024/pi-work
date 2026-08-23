"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { SettingsSection } from "../SettingsSection";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useTodos, type Tag } from "@/hooks/useTodos";
import { aggregateTags, truncateTag } from "@/components/todos/user-todo/utils";
import { TagColorPicker } from "@/components/todos/user-todo/TagColorPicker";
import { tagContrastText } from "@/lib/shared/user-todo/color-presets";

/**
 * Section: Manage tags.
 *
 * Lets the user rename, recolor, and delete tags globally. Reads the
 * current tag catalog from `useTodos()` (which is fed by the same
 * `/api/todos` snapshot the right-panel TodoPanel uses), and mutates
 * via the same `renameTag` / `deleteTag` / `setTagColor` hooks. Those
 * hooks refresh the local cache and surface success/error toasts, so
 * the section is purely presentational.
 *
 * The previous implementation lived as a popover inside the todo
 * header. Moving it here keeps the header to a minimal filter + search
 * pair and gives the tag list room to breathe.
 */
export function TodoTagsSection() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const { todos, renameTag, deleteTag, setTagColor } = useTodos();

  const tagSuggestions = useMemo(() => aggregateTags(todos), [todos]);

  // Per-tag usage count, deduped case-insensitively. Powers the count
  // column on each row.
  const tagCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const todo of todos) {
      const seen = new Set<string>();
      for (const tag of todo.tags) {
        const key = tag.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        map[key] = (map[key] ?? 0) + 1;
      }
    }
    return map;
  }, [todos]);

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [colorPickerTag, setColorPickerTag] = useState<string | null>(null);

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
    if (next.length === 0 || next.toLowerCase() === editing.toLowerCase()) {
      cancelRename();
      return;
    }
    setBusy(true);
    try {
      const result = await renameTag(editing, next);
      if (result) {
        // The renamed tag is already reflected in `todos` via refresh();
        // drop the edit row so the input doesn't linger with the old key.
        setEditing(null);
        setDraft("");
      }
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
    if (ok) await deleteTag(tag);
  };

  return (
    <SettingsSection id="todo-tags" topGap>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: "0 0 4px 0" }}>
        {t("Manage tags")}
      </h3>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px 0", lineHeight: 1.5 }}>
        {t("Rename, recolor, or delete tags across all your todos. Deleting a tag removes it from every todo that uses it.")}
      </p>
      {tagSuggestions.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--text-dim)", padding: "8px 0" }}>
          {t("No tags")}
        </div>
      ) : (
        <div
          data-scroll-inset
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            maxHeight: 320,
            overflowY: "auto",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: 4,
            background: "var(--bg-subtle)",
          }}
        >
          {tagSuggestions.map((tag) => (
            <TagRow
              key={tag.name}
              tag={tag}
              count={tagCounts[tag.name.toLowerCase()] ?? 0}
              editing={editing}
              draft={draft}
              busy={busy}
              colorPickerOpen={colorPickerTag === tag.name}
              onStartRename={() => startRename(tag.name)}
              onCancelRename={cancelRename}
              onCommitRename={commitRename}
              onDraftChange={setDraft}
              onRequestDelete={() => void handleDelete(tag.name)}
              onToggleColorPicker={() => setColorPickerTag((cur) => cur === tag.name ? null : tag.name)}
              onCloseColorPicker={() => setColorPickerTag(null)}
              onPickColor={async (next) => {
                setBusy(true);
                try {
                  await setTagColor(tag.name, next);
                  setColorPickerTag(null);
                } finally {
                  setBusy(false);
                }
              }}
            />
          ))}
        </div>
      )}
    </SettingsSection>
  );
}

function TagRow({
  tag,
  count,
  editing,
  draft,
  busy,
  colorPickerOpen,
  onStartRename,
  onCancelRename,
  onCommitRename,
  onDraftChange,
  onRequestDelete,
  onToggleColorPicker,
  onCloseColorPicker,
  onPickColor,
}: {
  tag: Tag;
  count: number;
  editing: string | null;
  draft: string;
  busy: boolean;
  colorPickerOpen: boolean;
  onStartRename: () => void;
  onCancelRename: () => void;
  onCommitRename: () => void;
  onDraftChange: (v: string) => void;
  onRequestDelete: () => void;
  onToggleColorPicker: () => void;
  onCloseColorPicker: () => void;
  onPickColor: (next: string | null) => Promise<void>;
}) {
  const { t } = useI18n();
  const isEditing = editing === tag.name;
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Close the color picker on outside click. The picker is anchored to
  // the swatch button; clicks anywhere else should dismiss it.
  useEffect(() => {
    if (!colorPickerOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!popoverRef.current) return;
      if (e.target instanceof Node && popoverRef.current.contains(e.target)) return;
      onCloseColorPicker();
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [colorPickerOpen, onCloseColorPicker]);

  if (isEditing) {
    return (
      <div
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "4px 8px",
          background: "var(--bg)",
          borderRadius: 4,
        }}
      >
        <input
          autoFocus
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); void onCommitRename(); }
            else if (e.key === "Escape") { e.preventDefault(); onCancelRename(); }
          }}
          disabled={busy}
          aria-label={t("New tag name")}
          style={{
            flex: 1, minWidth: 0,
            padding: "3px 6px",
            fontSize: 12,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 3,
            color: "var(--text)",
            fontFamily: "inherit",
          }}
        />
        <button
          onClick={() => void onCommitRename()}
          disabled={busy}
          style={rowButtonStyle(busy)}
        >
          {t("Save")}
        </button>
        <button
          onClick={onCancelRename}
          disabled={busy}
          style={rowButtonStyle(busy)}
        >
          {t("Cancel")}
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "4px 8px",
        background: "var(--bg)",
        borderRadius: 4,
        position: "relative",
      }}
    >
      <button
        type="button"
        onClick={onToggleColorPicker}
        aria-label={t("Tag color")}
        title={tag.color ?? t("Tag color")}
        style={{
          width: 16, height: 16, padding: 0, flexShrink: 0,
          border: "1px solid var(--border)",
          borderRadius: 3,
          background: tag.color ?? "transparent",
          cursor: "pointer",
          position: "relative",
        }}
      >
        {!tag.color && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-dim)",
              fontSize: 11,
              lineHeight: 1,
            }}
          >
            +
          </span>
        )}
      </button>
      {tag.color && (
        <span
          aria-hidden
          style={{
            display: "inline-block",
            padding: "1px 8px",
            fontSize: 11,
            background: tag.color,
            color: tagContrastText(tag.color),
            borderRadius: 10,
            lineHeight: 1.5,
            flexShrink: 0,
          }}
        >
          {truncateTag(tag.name)}
        </span>
      )}
      <span
        title={tag.name}
        style={{
          flex: 1, minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: "var(--text)",
          fontSize: 13,
        }}
      >
        {tag.color ? tag.name : truncateTag(tag.name)}
      </span>
      <span style={{ color: "var(--text-dim)", fontSize: 11, flexShrink: 0 }}>
        · {count}
      </span>
      <button
        onClick={onStartRename}
        disabled={busy}
        style={rowButtonStyle(busy)}
        onMouseEnter={(e) => { if (!busy) e.currentTarget.style.color = "var(--text)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
      >
        {t("Rename tag")}
      </button>
      <button
        onClick={onRequestDelete}
        disabled={busy}
        style={rowButtonStyle(busy)}
        onMouseEnter={(e) => { if (!busy) e.currentTarget.style.color = "#f87171"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
      >
        {t("Delete tag")}
      </button>
      {colorPickerOpen && (
        <div ref={popoverRef} style={{ position: "relative" }}>
          <TagColorPicker
            value={tag.color ?? null}
            onChange={(next) => void onPickColor(next)}
          />
        </div>
      )}
    </div>
  );
}

function rowButtonStyle(busy: boolean): React.CSSProperties {
  return {
    padding: "3px 8px",
    fontSize: 11,
    background: "transparent",
    border: "none",
    color: busy ? "var(--text-dim)" : "var(--text-muted)",
    cursor: busy ? "not-allowed" : "pointer",
    fontFamily: "inherit",
    borderRadius: 3,
    flexShrink: 0,
  };
}
