"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { useContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import { Tooltip } from "@/components/ui/Tooltip";
import { extractImagesFromHtml, ImageLightbox } from "@/components/renderers/ImageLightbox";
import { highlightMatch } from "@/components/ui/HighlightText";
import { tagContrastText } from "@/lib/shared/user-todo/color-presets";
import { MorphToggleIcon } from "@/components/ui/MorphToggleIcon";
import { EMPTY_CHECKBOX, CHECKBOX_CHECKED } from "@/lib/client/icon-paths";
import { hasCompletionNoteContent } from "@/lib/shared/completion-note";
import { RichTextEditor } from "./RichTextEditor";
import type { Tag, Todo, Priority } from "@/hooks/useTodos";
import { PriorityChip } from "./PriorityChip";
import { DeadlineControl } from "./DeadlineControl";
import { TodoDescriptionView } from "./TodoDescriptionView";
import { EditTagsModal } from "./EditTagsModal";
import { descriptionToPlainText, copyDescriptionAsRichText } from "./utils";

export function TodoItem({
  todo,
  onToggleDone,
  onUpdate,
  onDelete,
  onExport,
  searchTerm,
  tagSuggestions,
}: {
  todo: Todo;
  onToggleDone: () => void;
  onUpdate: (patch: { title?: string; description?: string; completionNote?: string; done?: boolean; deadline?: number; tags?: Tag[]; priority?: Priority | null }) => void;
  onDelete: () => void;
  onExport: () => Promise<void>;
  searchTerm: string;
  tagSuggestions: Tag[];
}) {
  const { t } = useI18n();
  const toast = useToast();
  const cm = useContextMenu();
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [editingCompletion, setEditingCompletion] = useState(false);
  const [detailsVisible, setDetailsVisible] = useState(!todo.done);
  const [titleDraft, setTitleDraft] = useState(todo.title);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [deadlinePickerOpen, setDeadlinePickerOpen] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [editTagsOpen, setEditTagsOpen] = useState(false);
  // Brief red-border pulse on the completion-note editor when the user tries
  // to toggle done on an empty note. Cleared on a setTimeout so the same
  // visual cue can re-fire if the user ignores it and tries again.
  const [completionHighlight, setCompletionHighlight] = useState(false);
  const completionSectionRef = useRef<HTMLDivElement | null>(null);

  // Latest HTML coming out of the RichTextEditor while editingDesc is true.
  // Read by the pagehide flush below so a page refresh can keep the request
  // alive across unload via fetch keepalive. Kept in a ref (not state) so
  // reading it on unload doesn't trigger a re-render.
  const latestDescriptionRef = useRef<string>(todo.description ?? "");
  // Mirror of the above for the completion-note editor.
  const latestCompletionRef = useRef<string>(todo.completionNote ?? "");
  // Latest todo.id / todo.description — kept in refs so the pagehide handler
  // (registered once when editingDesc flips on) always sees the current
  // values instead of the stale ones captured by the original closure.
  const todoIdRef = useRef(todo.id);
  const todoDescRef = useRef(todo.description ?? "");
  const todoCompletionRef = useRef(todo.completionNote ?? "");
  todoIdRef.current = todo.id;
  todoDescRef.current = todo.description ?? "";
  todoCompletionRef.current = todo.completionNote ?? "";

  const openDeadlinePicker = () => setDeadlinePickerOpen(true);

  // Gallery of every image reference in the description, for lightbox
  // prev/next navigation. Scans the Tiptap-emitted HTML (not legacy markdown)
  // — see `extractImagesFromHtml` in components/ImageLightbox.tsx. Todo image
  // URLs are already absolute (/api/todo-images/...) so the view passes
  // identity for the resolveSrc callback.
  const gallery = useMemo(
    () => extractImagesFromHtml(todo.description ?? ""),
    [todo.description],
  );
  // Completion-note images feed the same lightbox so prev/next works across
  // both fields. Order matters for index stability — description first, then
  // completion — so clicks in the completion view resolve to the right slot.
  const completionGallery = useMemo(
    () => extractImagesFromHtml(todo.completionNote ?? ""),
    [todo.completionNote],
  );
  const combinedGallery = useMemo(
    () => [...gallery, ...completionGallery],
    [gallery, completionGallery],
  );

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const items: ContextMenuItem[] = [
      {
        key: "rename",
        label: t("Rename"),
        onSelect: () => {
          setTitleDraft(todo.title);
          setEditingTitle(true);
        },
      },
      {
        // Right-click fallback for the priority chip click — useful when the
        // user is mousing over the title text rather than the small chip
        // icon, or on touch devices that don't have a hover affordance.
        // The visible chip on the row already shows the current value, so
        // we deliberately do not mark the active option here.
        key: "set-priority-high",
        label: t("High priority"),
        onSelect: () => onUpdate({ priority: "high" }),
      },
      {
        key: "set-priority-medium",
        label: t("Medium priority"),
        onSelect: () => onUpdate({ priority: "medium" }),
      },
      {
        key: "set-priority-low",
        label: t("Low priority"),
        onSelect: () => onUpdate({ priority: "low" }),
      },
      ...(todo.priority !== undefined
        ? [{
            key: "clear-priority",
            label: t("No priority"),
            onSelect: () => onUpdate({ priority: null }),
          }]
        : []),
      {
        key: "set-deadline",
        label: todo.deadline !== undefined ? t("Change deadline") : t("Set deadline"),
        onSelect: openDeadlinePicker,
      },
      ...(todo.deadline !== undefined
        ? [{
            key: "clear-deadline",
            label: t("Clear deadline"),
            onSelect: () => onUpdate({ deadline: undefined }),
          }]
        : []),
      {
        key: "edit-tags",
        label: t("Edit tags"),
        disabled: todo.done,
        onSelect: () => setEditTagsOpen(true),
      },
      {
        key: "export",
        label: t("Export as zip"),
        onSelect: () => {
          onExport().catch((e) =>
            toast.show({ kind: "error", message: t("Export failed") + ": " + String(e) }),
          );
        },
      },
      {
        key: "copy-as-markdown",
        label: t("Copy as Markdown"),
        // Nothing to copy when there's no description body — the result
        // would be an empty string, which is useless to paste.
        disabled: !(todo.description && todo.description.trim()),
        onSelect: async () => {
          try {
            const text = descriptionToPlainText(todo.description ?? "");
            await navigator.clipboard.writeText(text);
            toast.show({ kind: "success", message: t("Copied") });
          } catch {
            toast.show({ kind: "error", message: t("Copy failed") });
          }
        },
      },
      {
        key: "copy-rich-text",
        label: t("Copy rich text"),
        disabled: !(todo.description && todo.description.trim()),
        onSelect: async () => {
          try {
            await copyDescriptionAsRichText(todo.description ?? "");
            toast.show({ kind: "success", message: t("Copied") });
          } catch {
            toast.show({ kind: "error", message: t("Copy failed") });
          }
        },
      },
      {
        key: "delete",
        label: t("Delete"),
        destructive: true,
        onSelect: () => { onDelete(); },
      },
    ];
    cm.open({ x: e.clientX, y: e.clientY, items });
  };

  const commitTitle = () => {
    const trimmed = titleDraft.trim();
    if (trimmed.length === 0) {
      toast.show({ kind: "error", message: t("Title cannot be empty") });
      setTitleDraft(todo.title);
      setEditingTitle(false);
      return;
    }
    if (trimmed !== todo.title) {
      onUpdate({ title: trimmed });
    }
    setEditingTitle(false);
  };

  const commitDescription = (value: string) => {
    if (value !== (todo.description ?? "")) {
      onUpdate({ description: value });
    }
    setEditingDesc(false);
  };

  const commitCompletion = (value: string) => {
    if (value !== (todo.completionNote ?? "")) {
      onUpdate({ completionNote: value });
    }
    setEditingCompletion(false);
  };

  // Pulse the completion-note editor with a red border for ~1.2s after a
  // failed mark-done attempt so the user knows where to look.
  const pulseCompletionHighlight = useCallback(() => {
    setCompletionHighlight(true);
    window.setTimeout(() => setCompletionHighlight(false), 1200);
  }, []);

  // Keep latestDescriptionRef.current in sync with the live editor while it is open.
  // RichTextEditorInner fires this on every transaction (sanitized HTML), so
  // pagehide below has something authoritative to send.
  const handleEditorChange = useCallback((html: string) => {
    latestDescriptionRef.current = html;
  }, []);

  // Mirror of the above for the completion-note editor.
  const handleCompletionEditorChange = useCallback((html: string) => {
    latestCompletionRef.current = html;
  }, []);

  // Wrap the parent's `onToggleDone` with a client-side guard: when the user
  // is trying to mark a todo as done (i.e. current done is false), require
  // a non-empty completion note first. The server re-validates (defense in
  // depth) — this is purely for instant UX feedback so the optimistic toggle
  // never has to roll back for the obvious "user forgot to fill it in" case.
  const handleToggleDone = useCallback(() => {
    const tryingToComplete = !todo.done;
    if (tryingToComplete) {
      // Prefer the in-flight editor HTML (latestCompletionRef) over the
      // stored todo.completionNote — the user may have typed something
      // they haven't blurred out of the editor yet.
      const candidate = latestCompletionRef.current || todo.completionNote || "";
      if (!hasCompletionNoteContent(candidate)) {
        setDetailsVisible(true);
        setEditingCompletion(true);
        pulseCompletionHighlight();
        toast.show({
          kind: "error",
          message: t("Please fill in completion status before marking done"),
        });
        // Scroll the completion section into view on the next paint so the
        // user sees the editor the toast just complained about.
        window.requestAnimationFrame(() => {
          completionSectionRef.current?.scrollIntoView({
            block: "center",
            behavior: "smooth",
          });
        });
        return;
      }
    }
    onToggleDone();
  }, [todo.done, todo.completionNote, onToggleDone, pulseCompletionHighlight, toast, t]);

  // Flush unsaved description edits when the page is going away (refresh /
  // browser tab close). The editor's own unmount-cleanup in
  // RichTextEditorInner handles in-page navigation (tab switch), but the
  // browser may unload the React tree before that cleanup completes — so we
  // also wire a keepalive fetch on pagehide. pagehide fires after React's
  // cleanups on most browsers, making it a reliable backstop.
  useEffect(() => {
    if (!editingDesc) return;
    const flush = () => {
      const latest = latestDescriptionRef.current;
      if (latest === todoDescRef.current) return;
      // Fire-and-forget: keepalive lets the request outlive the unload so
      // a refresh during active editing doesn't drop the diff.
      try {
        void fetch("/api/todos", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: todoIdRef.current, description: latest }),
          keepalive: true,
        });
      } catch {
        // Best-effort — nothing useful we can do in a synchronous unload hook.
      }
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
    };
  }, [editingDesc]);

  // Same pattern for the completion-note editor. Two independent pagehide
  // listeners are cheaper than merging them and easier to reason about.
  useEffect(() => {
    if (!editingCompletion) return;
    const flush = () => {
      const latest = latestCompletionRef.current;
      if (latest === todoCompletionRef.current) return;
      try {
        void fetch("/api/todos", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: todoIdRef.current, completionNote: latest }),
          keepalive: true,
        });
      } catch {
        // Best-effort — see description flush above.
      }
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
    };
  }, [editingCompletion]);

  return (
    <div
      onContextMenu={handleContextMenu}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "8px 6px",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        style={{ display: "flex", alignItems: "center", gap: 8 }}
      >
        <button
          onClick={handleToggleDone}
          aria-label={t("Toggle done")}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 14, height: 14, flexShrink: 0,
            background: todo.done ? "var(--accent)" : "transparent",
            border: `1.5px solid ${todo.done ? "var(--accent)" : "var(--text-dim)"}`,
            borderRadius: 3,
            cursor: "pointer",
            padding: 0,
            color: "var(--bg)",
            transition: "background 0.1s, border-color 0.1s",
          }}
        >
          <MorphToggleIcon
            from={EMPTY_CHECKBOX}
            to={CHECKBOX_CHECKED}
            active={todo.done}
            size={9}
            viewBox="0 0 10 10"
            strokeWidth={2}
          />
        </button>
        {/* Priority chip sits between the checkbox and the chevron. Rendered
            only when a priority is set; the title then slides over so an unset
            todo still reads flush against the checkbox. */}
        {todo.priority && (
          <PriorityChip
            value={todo.priority}
            onChange={(next) => onUpdate({ priority: next })}
          />
        )}
        <span
          aria-hidden="true"
          style={{
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 10,
            height: 10,
            color: "var(--text-dim)",
            transform: detailsVisible ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.1s",
          }}
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="2.5 1.5 5.5 4 2.5 6.5" />
          </svg>
        </span>
        {editingTitle ? (
          <input
            value={titleDraft}
            autoFocus
            onChange={(e) => setTitleDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitTitle(); }
              else if (e.key === "Escape") { e.preventDefault(); setTitleDraft(todo.title); setEditingTitle(false); }
            }}
            onBlur={commitTitle}
            style={{
              flex: 1, minWidth: 0,
              padding: "2px 4px",
              fontSize: 13, fontWeight: 500,
              background: "var(--bg-selected)",
              border: "1px solid var(--accent)",
              borderRadius: 3,
              color: "var(--text)",
              fontFamily: "inherit",
            }}
          />
        ) : (
          <Tooltip content={todo.title} side="top" align="start">
            <span
              onClick={() => setDetailsVisible((v) => !v)}
              onDoubleClick={() => { setTitleDraft(todo.title); setEditingTitle(true); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setDetailsVisible((v) => !v);
                }
              }}
              role="button"
              tabIndex={editingTitle ? -1 : 0}
              aria-expanded={detailsVisible}
              style={{
                flex: 1, minWidth: 0,
                fontSize: 13, fontWeight: 500,
                color: todo.done
                  ? "var(--text-muted)"
                  : (todo.tags.find((t) => t.color)?.color ?? "var(--text)"),
                textDecoration: todo.done ? "line-through" : "none",
                cursor: "pointer",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {highlightMatch(todo.title, searchTerm)}
            </span>
          </Tooltip>
        )}
        {!editingTitle && hovering && todo.tags.length > 0 && (
          <div
            style={{
              display: "flex", gap: 4, alignItems: "center",
              flexShrink: 0,
            }}
          >
            {todo.tags.map((tg, i) => (
              <span
                key={`${tg.name}-${i}`}
                style={{
                  display: "inline-flex", alignItems: "center",
                  padding: "1px 8px",
                  fontSize: 11,
                  background: tg.color ?? "var(--bg-panel)",
                  color: tg.color ? tagContrastText(tg.color) : "var(--text-muted)",
                  border: tg.color ? "none" : "1px solid var(--border)",
                  borderRadius: 10,
                  lineHeight: 1.5,
                }}
              >
                {tg.name}
              </span>
            ))}
          </div>
        )}
        <DeadlineControl
          todo={todo}
          open={deadlinePickerOpen}
          onOpenChange={setDeadlinePickerOpen}
          onChange={(v) => onUpdate({ deadline: v })}
        />
      </div>
      {detailsVisible && (editingDesc && !todo.done ? (
        <RichTextEditor
          defaultValue={todo.description ?? ""}
          onSave={commitDescription}
          onCancel={() => setEditingDesc(false)}
          onChange={handleEditorChange}
          placeholder={t("Add description...")}
        />
      ) : (
        <div style={{ marginLeft: 22 }}>
          <div
            onDoubleClick={todo.done ? undefined : () => setEditingDesc(true)}
            style={{
              minHeight: 18,
              fontSize: 12,
              lineHeight: 1.5,
              color: todo.done ? "var(--text-dim)" : "var(--text-muted)",
              textDecoration: todo.done ? "line-through" : "none",
              textDecorationColor: todo.done ? "var(--text-muted)" : undefined,
              cursor: todo.done ? "default" : "text",
              padding: "2px 0",
            }}
          >
            {todo.description ? (
              <TodoDescriptionView
                html={todo.description}
                searchTerm={searchTerm}
                onImageClick={(src) => {
                  const idx = gallery.findIndex((g) => g.src === src);
                  if (idx >= 0) setLightboxIndex(idx);
                }}
              />
            ) : (
              <span style={{ color: "var(--text-dim)", fontStyle: "italic" }}>{t("Add description...")}</span>
            )}
          </div>
        </div>
      ))}
      {detailsVisible && (
        <div style={{ marginLeft: 22 }} ref={completionSectionRef}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              marginTop: 4,
              marginBottom: 2,
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: 0.4,
              color: todo.done ? "var(--text-muted)" : "var(--text-dim)",
            }}
          >
            <span>{t("Completion status")}</span>
            {todo.done && todo.completionNote && hasCompletionNoteContent(todo.completionNote) && (
              <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                · {t("filled")}
              </span>
            )}
          </div>
          {editingCompletion ? (
            <div
              style={{
                // No border in edit mode — the RichTextEditor's own toolbar +
                // content area carry the chrome. When a failed mark-done
                // attempt pulses `completionHighlight`, swap to a subtle red
                // background tint as the cue.
                background: completionHighlight ? "rgba(239, 68, 68, 0.1)" : "transparent",
                borderRadius: 3,
                transition: "background-color 0.3s",
              }}
            >
              <RichTextEditor
                defaultValue={todo.completionNote ?? ""}
                onSave={commitCompletion}
                onCancel={() => setEditingCompletion(false)}
                onChange={handleCompletionEditorChange}
                placeholder={t("Add completion status...")}
              />
            </div>
          ) : (
            <div
              onDoubleClick={() => setEditingCompletion(true)}
              style={{
                minHeight: 18,
                fontSize: 12,
                lineHeight: 1.5,
                color: todo.completionNote ? "var(--text)" : "var(--text-dim)",
                cursor: "text",
                padding: "2px 0",
                borderLeft: `2px solid ${completionHighlight ? "#ef4444" : "transparent"}`,
                paddingLeft: 6,
                transition: "border-color 0.3s",
              }}
            >
              {todo.completionNote && hasCompletionNoteContent(todo.completionNote) ? (
                <TodoDescriptionView
                  html={todo.completionNote}
                  searchTerm={searchTerm}
                  onImageClick={(src) => {
                    const idx = completionGallery.findIndex((g) => g.src === src);
                    if (idx >= 0) setLightboxIndex(idx);
                  }}
                />
              ) : (
                <span style={{ fontStyle: "italic" }}>{t("Add completion status...")}</span>
              )}
            </div>
          )}
        </div>
      )}
      {lightboxIndex !== null && combinedGallery.length > 0 && (
        <ImageLightbox
          images={combinedGallery}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
        />
      )}
      {editTagsOpen && (
        <EditTagsModal
          todo={todo}
          tagSuggestions={tagSuggestions}
          onSave={(tags) => onUpdate({ tags })}
          onClose={() => setEditTagsOpen(false)}
        />
      )}
    </div>
  );
}