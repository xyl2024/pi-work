"use client";

import { useEffect, useState } from "react";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { TrashIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/Toast";
import { DangerButton } from "@/components/settings/controls";
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
} from "@/lib/shared/memory";

const DELETE_FAILURE_KEYS: Record<string, string> = {
  stale_entry: "This entry changed after the panel loaded. Refresh and try again.",
  out_of_range: "This entry is no longer at that position. Refresh and try again.",
  busy: "Another session is writing memory. Try again shortly.",
  unreadable: "Memory file cannot be read",
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
}: {
  view: MemoryLibraryView;
  usage: string | null;
}) {
  const { t } = useI18n();
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
      <span style={SECTION_TITLE_STYLE}>{t(MEMORY_TARGET_TITLE_KEYS[view.target])}</span>
      {usage !== null && (
        <span style={{ fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
          {usage}
        </span>
      )}
    </div>
  );
}

function MemoryEntryRow({
  entry,
  deleting,
  onDelete,
}: {
  entry: MemoryEntryView;
  deleting: boolean;
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
      <DangerButton
        size="compact"
        onClick={onDelete}
        disabled={deleting}
        ariaLabel={t("Delete memory entry")}
        title={t("Delete memory entry")}
        style={{ flexShrink: 0 }}
      >
        <TrashIcon width={12} height={12} />
      </DangerButton>
    </div>
  );
}

function MemoryLibrarySection({
  view,
  deletingKey,
  onDelete,
}: {
  view: MemoryLibraryView;
  deletingKey: string | null;
  onDelete: (view: MemoryLibraryView, entry: MemoryEntryView) => void;
}) {
  const { t } = useI18n();
  const state = memoryLibraryState(view);

  return (
    <section style={{ padding: "12px 16px" }}>
      <MemoryLibraryHeader
        view={view}
        usage={state === "unreadable" ? null : formatMemoryCharCounts(view.used, view.limit)}
      />
      <div style={{ marginTop: 4 }}>
        {state === "unreadable" ? (
          <div style={{ padding: "8px 0", color: "var(--error)" }}>
            {t("Memory file cannot be read")}
          </div>
        ) : state === "empty" ? (
          <div style={{ padding: "8px 0", fontStyle: "italic", color: "var(--text-dim)" }}>
            {t("No memories yet")}
          </div>
        ) : (
          view.entries.map((entry) => (
            <MemoryEntryRow
              key={entry.index}
              entry={entry}
              deleting={deletingKey === `${view.target}:${entry.index}`}
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
  const entriesUrl = memoryEntriesUrl(cwd);

  useEffect(() => {
    openMemory({ cwd });
  }, [cwd]);

  function failureMessage(body: { error?: unknown; code?: unknown }): string {
    const key = typeof body.code === "string" ? DELETE_FAILURE_KEYS[body.code] : undefined;
    if (key) return t(key);
    const reason = typeof body.error === "string" && body.error !== "" ? body.error : t("Delete failed");
    return t("Delete failed: {error}", { error: reason });
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
        toast.show({ kind: "error", message: failureMessage(body) });
        return;
      }
      applyMemoryResponse(body as MemoryEntriesResponse);
      toast.show({
        kind: "success",
        message: entry.oversized
          ? t("Deleted the oversized entry; memory is writable again")
          : t("Memory entry deleted"),
      });
    } catch (error) {
      toast.show({
        kind: "error",
        message: t("Delete failed: {error}", {
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
            deletingKey={deletingKey}
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
