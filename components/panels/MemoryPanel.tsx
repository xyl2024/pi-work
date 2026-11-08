"use client";

import { useEffect, useState } from "react";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { IconButton } from "@/components/ui/IconButton";
import { CheckIcon, CloseIcon, EditIcon, PlusIcon, TrashIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/Toast";
import { DangerButton, TextArea } from "@/components/settings/controls";
import { useI18n } from "@/hooks/useI18n";
import { MemorySnapshotRow } from "./MemorySnapshotRow";
import {
  applyMemoryResponse,
  memoryEntriesUrl,
  openMemory,
  useMemoryPanel,
} from "@/lib/client/memory-panel";
import {
  formatMemoryCharCounts,
  MEMORY_TARGETS,
  MEMORY_TARGET_TITLE_KEYS,
  memoryLibraryState,
  type MemoryEntriesResponse,
  type MemoryEntryView,
  type MemoryLibraryView,
  type MemoryTarget,
} from "@/lib/shared/memory";

const WRITE_FAILURE_KEYS: Record<string, string> = {
  stale_entry: "This entry changed after the panel loaded. Refresh and try again.",
  out_of_range: "This entry is no longer at that position. Refresh and try again.",
  busy: "Another session is writing memory. Try again shortly.",
  unreadable: "Memory file cannot be read",
  duplicate: "Memory entry already exists",
  empty: "Memory entries cannot be empty",
  invalid: "Memory entries cannot contain the entry separator",
  unsafe: "Memory entry contains unsafe content",
  budget: "Memory library is full. Delete or shorten another entry first.",
  drift: "Memory library has an oversized entry. Delete or shorten it first.",
};

const OVERSIZED_PREVIEW_CHARS = 400;

const SECTION_TITLE_STYLE = {
  fontSize: 11,
  fontWeight: 700,
  color: "var(--text)",
} as const;

const BADGE_STYLE = {
  flexShrink: 0,
  padding: "1px 6px",
  borderRadius: 4,
  background: "color-mix(in srgb, var(--warning) 18%, transparent)",
  color: "var(--warning)",
  fontSize: 10,
  fontWeight: 600,
} as const;

interface MemoryEditor {
  target: MemoryTarget;
  index: number | null;
  hash: string | null;
  text: string;
}

function MemoryPanelHeader({ enabled }: { enabled: boolean }) {
  const { t } = useI18n();
  if (enabled) return null;
  return (
    <div
      style={{
        padding: "8px 16px",
        borderBottom: "1px solid var(--border)",
        color: "var(--text-muted)",
        fontSize: 11,
      }}
    >
      {t("This session will not inject memory")}
    </div>
  );
}

function MemoryLibraryHeader({
  view,
  usage,
  canAdd,
  adding,
  onAdd,
}: {
  view: MemoryLibraryView;
  usage: string | null;
  canAdd: boolean;
  adding: boolean;
  onAdd: () => void;
}) {
  const { t } = useI18n();
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <span style={SECTION_TITLE_STYLE}>{t(MEMORY_TARGET_TITLE_KEYS[view.target])}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {usage !== null && (
          <span style={{ fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
            {usage}
          </span>
        )}
        {canAdd && !adding && (
          <IconButton
            label={t("Add memory entry")}
            onClick={onAdd}
            size="xs"
            variant="subtle"
          >
            <PlusIcon size={12} />
          </IconButton>
        )}
      </div>
    </div>
  );
}

function MemoryComposer({
  value,
  pending,
  placeholder,
  onChange,
  onSave,
  onCancel,
}: {
  value: string;
  pending: boolean;
  placeholder: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <div style={{ padding: "8px 0", borderTop: "1px solid var(--border)" }}>
      <TextArea
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={pending}
        style={{ minHeight: 120, fontSize: 12 }}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 4, marginTop: 6 }}>
        <IconButton
          label={t("Save memory entry")}
          onClick={onSave}
          disabled={pending}
          size="xs"
          variant="primary"
        >
          <CheckIcon size={12} />
        </IconButton>
        <IconButton
          label={t("Cancel editing")}
          onClick={onCancel}
          disabled={pending}
          size="xs"
          variant="subtle"
        >
          <CloseIcon size={12} />
        </IconButton>
      </div>
    </div>
  );
}

function MemoryEntryRow({
  entry,
  editing,
  pending,
  text,
  onChangeText,
  onEdit,
  onSave,
  onCancel,
  onDelete,
}: {
  entry: MemoryEntryView;
  editing: boolean;
  pending: boolean;
  text: string;
  onChangeText: (value: string) => void;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "8px 0",
        borderTop: "1px solid color-mix(in srgb, var(--border) 60%, transparent)",
        ...(entry.oversized
          ? { borderLeft: "2px solid var(--warning)", paddingLeft: 8 }
          : {}),
      }}
    >
      {editing ? (
        <div style={{ flex: 1, minWidth: 0 }}>
          {entry.oversized && (
            <div style={{ ...BADGE_STYLE, display: "inline-block", marginBottom: 6 }}>
              {t("External write, not separated by the entry separator")}
            </div>
          )}
          <TextArea
            value={text}
            onChange={onChangeText}
            disabled={pending}
            style={{ minHeight: 120, fontSize: 12 }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 4, marginTop: 6 }}>
            <IconButton
              label={t("Save memory entry")}
              onClick={onSave}
              disabled={pending}
              size="xs"
              variant="primary"
            >
              <CheckIcon size={12} />
            </IconButton>
            <IconButton
              label={t("Cancel editing")}
              onClick={onCancel}
              disabled={pending}
              size="xs"
              variant="subtle"
            >
              <CloseIcon size={12} />
            </IconButton>
          </div>
        </div>
      ) : (
        <>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              color: "var(--text-muted)",
            }}
          >
            {entry.text}
          </span>
          {entry.oversized && (
            <span style={BADGE_STYLE}>{t("External write, not separated by the entry separator")}</span>
          )}
          <IconButton
            label={t("Edit memory entry")}
            onClick={onEdit}
            disabled={pending}
            size="xs"
            variant="ghost"
          >
            <EditIcon size={12} />
          </IconButton>
          <DangerButton
            size="compact"
            onClick={onDelete}
            disabled={pending}
            ariaLabel={t("Delete memory entry")}
            title={t("Delete memory entry")}
            style={{ flexShrink: 0 }}
          >
            <TrashIcon width={12} height={12} />
          </DangerButton>
        </>
      )}
    </div>
  );
}

function MemoryLibrarySection({
  view,
  editor,
  deletingKey,
  saving,
  onStartAdd,
  onStartEdit,
  onChangeText,
  onSave,
  onCancel,
  onDelete,
}: {
  view: MemoryLibraryView;
  editor: MemoryEditor | null;
  deletingKey: string | null;
  saving: boolean;
  onStartAdd: () => void;
  onStartEdit: (entry: MemoryEntryView) => void;
  onChangeText: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: (view: MemoryLibraryView, entry: MemoryEntryView) => void;
}) {
  const { t } = useI18n();
  const state = memoryLibraryState(view);
  const editing = editor?.target === view.target ? editor : null;
  const adding = editing?.index === null;
  const pending = saving || deletingKey !== null;
  const canAdd = state !== "unreadable";

  return (
    <section style={{ padding: "12px 16px" }}>
      <MemoryLibraryHeader
        view={view}
        usage={state === "unreadable" ? null : formatMemoryCharCounts(view.used, view.limit)}
        canAdd={canAdd}
        adding={adding}
        onAdd={onStartAdd}
      />
      <div style={{ marginTop: 4 }}>
        {adding && (
          <MemoryComposer
            value={editing.text}
            pending={pending}
            placeholder={t("New memory entry")}
            onChange={onChangeText}
            onSave={onSave}
            onCancel={onCancel}
          />
        )}
        {state === "unreadable" ? (
          <div style={{ padding: "8px 0", color: "var(--error)" }}>
            {t("Memory file cannot be read")}
          </div>
        ) : state === "empty" && !adding ? (
          <div style={{ padding: "8px 0", fontStyle: "italic", color: "var(--text-dim)" }}>
            {t("No memories yet")}
          </div>
        ) : (
          view.entries.map((entry) => (
            <MemoryEntryRow
              key={entry.index}
              entry={entry}
              editing={editing?.index === entry.index}
              pending={pending}
              text={editing?.index === entry.index ? editing.text : entry.text}
              onChangeText={onChangeText}
              onEdit={() => onStartEdit(entry)}
              onSave={onSave}
              onCancel={onCancel}
              onDelete={() => onDelete(view, entry)}
            />
          ))
        )}
      </div>
    </section>
  );
}

export function MemoryPanel({ sessionId, cwd }: { sessionId: string | null; cwd: string | null }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const toast = useToast();
  const { view } = useMemoryPanel();
  const response = view.response;
  const failed = view.loadError !== null;
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [editor, setEditor] = useState<MemoryEditor | null>(null);
  const [saving, setSaving] = useState(false);
  const entriesUrl = memoryEntriesUrl(cwd);

  useEffect(() => {
    openMemory({ cwd });
  }, [cwd]);

  function failureMessage(body: { error?: unknown; code?: unknown }, fallback: string): string {
    const key = typeof body.code === "string" ? WRITE_FAILURE_KEYS[body.code] : undefined;
    if (key) return t(key);
    const reason = typeof body.error === "string" && body.error !== "" ? body.error : t(fallback);
    return t("{action}: {error}", { action: t(fallback), error: reason });
  }

  async function sendWrite(
    method: "POST" | "PATCH",
    body: Record<string, unknown>,
  ): Promise<MemoryEntriesResponse | null> {
    const result = await fetch(entriesUrl, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await result.json().catch(() => ({}))) as
      & Partial<MemoryEntriesResponse>
      & { error?: unknown; code?: unknown };
    if (!result.ok || payload.error || !payload.memory || !payload.user) {
      toast.show({ kind: "error", message: failureMessage(payload, "Save failed") });
      return null;
    }
    const next = payload as MemoryEntriesResponse;
    applyMemoryResponse(next);
    return next;
  }

  async function handleSave() {
    if (editor === null || saving) return;
    setSaving(true);
    try {
      const adding = editor.index === null;
      const next = await sendWrite(
        adding ? "POST" : "PATCH",
        adding
          ? { target: editor.target, content: editor.text }
          : { target: editor.target, index: editor.index, hash: editor.hash, content: editor.text },
      );
      if (next === null) return;
      setEditor(null);
      toast.show({
        kind: "success",
        message: adding ? t("Memory entry added") : t("Memory entry updated"),
      });
    } catch (error) {
      toast.show({
        kind: "error",
        message: t("{action}: {error}", {
          action: t("Save failed"),
          error: error instanceof Error ? error.message : String(error),
        }),
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(view: MemoryLibraryView, entry: MemoryEntryView) {
    const countLine = t("Entry {index} of {count} in {file}.", {
      index: entry.index + 1,
      count: view.entries.length,
      file: view.file,
    });
    const preview = entry.oversized
      ? `${entry.text.slice(0, OVERSIZED_PREVIEW_CHARS)}…`
      : entry.text;
    const description = entry.oversized
      ? `${preview}\n\n${countLine}\n${t("This entry was written externally, not separated by the entry separator. Deleting it loses this handwritten text; it has been backed up to a .bak file.")}`
      : `${preview}\n\n${countLine}\n${t("This cannot be undone.")}`;

    const ok = await confirm({
      title: t("Delete memory entry?"),
      description,
      confirmLabel: t("Delete"),
    });
    if (!ok) return;

    const key = `${view.target}:${entry.index}`;
    setDeletingKey(key);
    try {
      const result = await fetch(entriesUrl, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: view.target, index: entry.index, hash: entry.hash }),
      });
      const body = (await result.json().catch(() => ({}))) as
        & Partial<MemoryEntriesResponse>
        & { error?: unknown; code?: unknown };
      if (!result.ok || body.error || !body.memory || !body.user) {
        toast.show({ kind: "error", message: failureMessage(body, "Delete failed") });
        return;
      }
      applyMemoryResponse(body as MemoryEntriesResponse);
      if (editor?.target === view.target && editor.index === entry.index) setEditor(null);
      toast.show({
        kind: "success",
        message: entry.oversized
          ? t("Deleted the oversized entry; memory is writable again")
          : t("Memory entry deleted"),
      });
    } catch (error) {
      toast.show({
        kind: "error",
        message: t("{action}: {error}", {
          action: t("Delete failed"),
          error: error instanceof Error ? error.message : String(error),
        }),
      });
    } finally {
      setDeletingKey(null);
    }
  }

  return (
    <div
      style={{
        height: "100%",
        overflowY: "auto",
        color: "var(--text-muted)",
        fontSize: 12,
        lineHeight: 1.6,
      }}
    >
      <MemorySnapshotRow sessionId={sessionId} current={response} />
      {response !== null && <MemoryPanelHeader enabled={response.enabled} />}
      {response !== null ? (
        MEMORY_TARGETS.map((target) => (
          <MemoryLibrarySection
            key={target}
            view={response[target]}
            editor={editor}
            deletingKey={deletingKey}
            saving={saving}
            onStartAdd={() => setEditor({ target, index: null, hash: null, text: "" })}
            onStartEdit={(entry) =>
              setEditor({ target, index: entry.index, hash: entry.hash, text: entry.text })
            }
            onChangeText={(text) => setEditor((current) => (current === null ? current : { ...current, text }))}
            onSave={() => void handleSave()}
            onCancel={() => setEditor(null)}
            onDelete={(view, entry) => void handleDelete(view, entry)}
          />
        ))
      ) : (
        <div style={{ padding: "24px 16px", fontStyle: "italic", color: failed ? "var(--error)" : "var(--text-dim)" }}>
          {failed ? t("Failed to load memory") : t("Loading…")}
        </div>
      )}
    </div>
  );
}
