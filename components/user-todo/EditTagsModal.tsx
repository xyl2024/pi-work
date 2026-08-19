"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/Toast";
import { tagContrastText } from "@/lib/user-todo/color-presets";
import type { Tag, Todo } from "@/hooks/useTodos";
import { MAX_TAG_LENGTH } from "./utils";

/**
 * Modal for adding and removing tags on a single todo. Reached from the
 * TodoItem context menu's "Edit tags" entry; the inline tag chips on the todo
 * itself are now read-only (rendered only on hover) and only this dialog can
 * mutate the tag list. Every add/remove is persisted immediately via
 * `onSave`, so closing the dialog is always safe — no "discard" path needed.
 */
export function EditTagsModal({
  todo,
  tagSuggestions,
  onSave,
  onClose,
}: {
  todo: Todo;
  tagSuggestions: Tag[];
  onSave: (tags: Tag[]) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [tags, setTags] = useState<Tag[]>(todo.tags);
  const [draft, setDraft] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalEl(document.body);
  }, []);

  // Filtered suggestions: tags that exist globally but are not yet attached
  // to this todo. Empty input shows the top of the catalog as a discoverable
  // pick-list; typing filters by case-insensitive prefix.
  const suggestions = useMemo(() => {
    const attached = new Set(tags.map((tg) => tg.name.toLowerCase()));
    const pool = tagSuggestions.filter((tg) => !attached.has(tg.name.toLowerCase()));
    const q = draft.trim().toLowerCase();
    if (!q) return pool.slice(0, 8);
    return pool
      .filter((tg) => tg.name.toLowerCase().startsWith(q))
      .slice(0, 8);
  }, [draft, tagSuggestions, tags]);

  const draftTrim = draft.trim();
  const canCreate = draftTrim.length > 0
    && !tags.some((tg) => tg.name.toLowerCase() === draftTrim.toLowerCase())
    && !tagSuggestions.some((tg) => tg.name.toLowerCase() === draftTrim.toLowerCase());

  type SuggestionItem =
    | { kind: "existing"; tag: Tag }
    | { kind: "create"; name: string };

  const items = useMemo<SuggestionItem[]>(() => {
    const list: SuggestionItem[] = suggestions.map((tg) => ({ kind: "existing", tag: tg }));
    if (canCreate) list.push({ kind: "create", name: draftTrim });
    return list;
  }, [suggestions, canCreate, draftTrim]);

  const dropdownOpen = items.length > 0;

  const persist = (next: Tag[]) => {
    setTags(next);
    onSave(next);
  };

  const addTag = (name: string, color?: string) => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    if (trimmed.length > MAX_TAG_LENGTH) {
      toast.show({ kind: "error", message: t("Tag is too long") });
      return;
    }
    const key = trimmed.toLowerCase();
    if (tags.some((tg) => tg.name.toLowerCase() === key)) {
      toast.show({ kind: "error", message: t("Tag already added") });
      return;
    }
    // Inherit color from the global catalog if the typed/selected name
    // matches an existing tag — same convention used by the create-todo
    // input and TagManagerPopover.
    const existing = tagSuggestions.find((s) => s.name.toLowerCase() === key);
    persist([...tags, { name: trimmed, color: existing?.color ?? color }]);
    setDraft("");
    setActiveIndex(0);
    inputRef.current?.focus();
  };

  const removeTag = (name: string) => {
    persist(tags.filter((tg) => tg.name.toLowerCase() !== name.toLowerCase()));
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (dropdownOpen) {
        const item = items[activeIndex];
        if (item?.kind === "existing") addTag(item.tag.name, item.tag.color);
        else if (item?.kind === "create") addTag(item.name);
      } else if (draftTrim.length > 0) {
        addTag(draftTrim);
      }
    } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
      e.preventDefault();
      removeTag(tags[tags.length - 1].name);
    } else if (e.key === "ArrowDown" && dropdownOpen) {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp" && dropdownOpen) {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + items.length) % items.length);
    }
  };

  // ESC closes — capture phase + stopPropagation so it doesn't conflict with
  // any outer keydown listeners (e.g. PermissionDialog's escape).
  useEffect(() => {
    if (!portalEl) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [portalEl, onClose]);

  if (!portalEl) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("Edit tags")}
      onMouseDown={(e) => {
        // Click on backdrop (outside the card) closes
        if (e.target === e.currentTarget) onClose();
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
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 16,
          minWidth: 360,
          maxWidth: 480,
          boxShadow: "0 8px 24px rgba(0,0,0,0.32)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{t("Edit tags")}</div>
          <button
            onClick={onClose}
            aria-label={t("Close")}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 20, height: 20, padding: 0,
              background: "transparent", border: "none",
              color: "var(--text-muted)", cursor: "pointer",
              borderRadius: 3,
            }}
          >
            <svg width="10" height="10" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="1" y1="1" x2="7" y2="7" />
              <line x1="7" y1="1" x2="1" y2="7" />
            </svg>
          </button>
        </div>

        {/* Current tags */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, minHeight: 22 }}>
          {tags.length === 0 ? (
            <span style={{ fontSize: 11, color: "var(--text-dim)", fontStyle: "italic" }}>
              {t("No tags")}
            </span>
          ) : (
            tags.map((tg, i) => (
              <span
                key={`${tg.name}-${i}`}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "1px 4px 1px 8px",
                  fontSize: 11,
                  background: tg.color ?? "var(--bg-hover)",
                  color: tg.color ? tagContrastText(tg.color) : "var(--text-muted)",
                  border: tg.color ? "none" : "1px solid var(--border)",
                  borderRadius: 10,
                  lineHeight: 1.5,
                }}
              >
                {tg.name}
                <button
                  type="button"
                  onClick={() => removeTag(tg.name)}
                  aria-label={t("Remove tag")}
                  style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: 14, height: 14, padding: 0,
                    background: "transparent", border: "none",
                    borderRadius: 7,
                    color: tg.color ? "inherit" : "var(--text-dim)",
                    opacity: tg.color ? 0.65 : 1,
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => {
                    if (tg.color) e.currentTarget.style.opacity = "1";
                    else e.currentTarget.style.color = "var(--text)";
                  }}
                  onMouseLeave={(e) => {
                    if (tg.color) e.currentTarget.style.opacity = "0.65";
                    else e.currentTarget.style.color = "var(--text-dim)";
                  }}
                >
                  <svg width="7" height="7" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <line x1="1" y1="1" x2="7" y2="7" />
                    <line x1="7" y1="1" x2="1" y2="7" />
                  </svg>
                </button>
              </span>
            ))
          )}
        </div>

        {/* Input */}
        <div style={{ position: "relative" }}>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={t("Type a tag name…")}
            aria-label={t("Type a tag name…")}
            autoFocus
            style={{
              width: "100%",
              padding: "6px 8px",
              fontSize: 12,
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              outline: "none",
              color: "var(--text)",
              fontFamily: "inherit",
              boxSizing: "border-box",
            }}
          />
          {dropdownOpen && (
            <div
              role="listbox"
              data-scroll-inset
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                left: 0,
                right: 0,
                zIndex: 1,
                maxHeight: 200,
                overflowY: "auto",
                padding: 4,
                background: "var(--bg-panel)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                boxShadow: "0 4px 12px rgba(0, 0, 0, 0.25)",
                display: "flex",
                flexDirection: "column",
                gap: 1,
              }}
            >
              {items.map((item, i) => {
                const isActive = i === activeIndex;
                if (item.kind === "existing") {
                  return (
                    <button
                      key={`existing-${item.tag.name}`}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      // mousedown (not click) so the input doesn't blur and
                      // wipe the draft before our handler runs.
                      onMouseDown={(e) => {
                        e.preventDefault();
                        addTag(item.tag.name, item.tag.color);
                      }}
                      onMouseEnter={() => setActiveIndex(i)}
                      style={{
                        padding: "4px 8px",
                        fontSize: 11,
                        textAlign: "left",
                        background: isActive ? "var(--bg-selected)" : "transparent",
                        border: "none",
                        borderRadius: 3,
                        cursor: "pointer",
                        color: "var(--text)",
                        fontFamily: "inherit",
                        display: "flex", alignItems: "center", gap: 6,
                      }}
                    >
                      {item.tag.color ? (
                        <span
                          style={{
                            padding: "0 6px",
                            borderRadius: 8,
                            background: item.tag.color,
                            color: tagContrastText(item.tag.color),
                            fontSize: 10,
                            lineHeight: 1.5,
                          }}
                        >
                          {item.tag.name}
                        </span>
                      ) : (
                        item.tag.name
                      )}
                    </button>
                  );
                }
                return (
                  <button
                    key={`create-${item.name}`}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      addTag(item.name);
                    }}
                    onMouseEnter={() => setActiveIndex(i)}
                    style={{
                      padding: "4px 8px",
                      fontSize: 11,
                      textAlign: "left",
                      background: isActive ? "var(--bg-selected)" : "transparent",
                      border: "none",
                      borderLeft: "2px dashed var(--border)",
                      borderRadius: 3,
                      cursor: "pointer",
                      color: "var(--text-muted)",
                      fontFamily: "inherit",
                    }}
                  >
                    {t("Create tag #{tag}").replace("{tag}", item.name)}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              padding: "5px 12px",
              fontSize: 12,
              background: "var(--accent)",
              border: "1px solid var(--accent)",
              borderRadius: 4,
              color: "var(--bg)",
              cursor: "pointer",
              fontFamily: "inherit",
              fontWeight: 500,
            }}
          >
            {t("Done")}
          </button>
        </div>
      </div>
    </div>,
    portalEl
  );
}