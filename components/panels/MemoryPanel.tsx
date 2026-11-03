"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { MemorySnapshotRow } from "./MemorySnapshotRow";
import {
  formatMemoryCharCounts,
  memoryLibraryState,
  type MemoryEntriesResponse,
  type MemoryEntryView,
  type MemoryLibraryView,
  type MemoryTarget,
} from "@/lib/shared/memory";

const LIBRARY_ORDER: readonly MemoryTarget[] = ["memory", "user"];

const LIBRARY_TITLE_KEYS: Record<MemoryTarget, string> = {
  memory: "Agent notes",
  user: "User profile",
};

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

function MemoryPanelHeader({ globalEnabled }: { globalEnabled: boolean }) {
  const { t } = useI18n();
  if (globalEnabled) return null;
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
      <span style={SECTION_TITLE_STYLE}>{t(LIBRARY_TITLE_KEYS[view.target])}</span>
      {usage !== null && (
        <span style={{ fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
          {usage}
        </span>
      )}
    </div>
  );
}

function MemoryEntryRow({ entry }: { entry: MemoryEntryView }) {
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
      {entry.oversized && <span style={BADGE_STYLE}>{t("Oversized entry")}</span>}
    </div>
  );
}

function MemoryLibrarySection({ view }: { view: MemoryLibraryView }) {
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
          view.entries.map((entry) => <MemoryEntryRow key={entry.index} entry={entry} />)
        )}
      </div>
    </section>
  );
}

export function MemoryPanel({ sessionId }: { sessionId: string | null }) {
  const { t } = useI18n();
  const [response, setResponse] = useState<MemoryEntriesResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/memory/entries")
      .then(async (result) => {
        const body = (await result.json().catch(() => ({}))) as
          & Partial<MemoryEntriesResponse>
          & { error?: string };
        if (!result.ok || body.error || !body.memory || !body.user) {
          throw new Error(body.error ?? `HTTP ${result.status}`);
        }
        if (!cancelled) setResponse(body as MemoryEntriesResponse);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      {response !== null && <MemoryPanelHeader globalEnabled={response.globalEnabled} />}
      {response !== null ? (
        LIBRARY_ORDER.map((target) => (
          <MemoryLibrarySection key={target} view={response[target]} />
        ))
      ) : (
        <div style={{ padding: "24px 16px", fontStyle: "italic", color: failed ? "var(--error)" : "var(--text-dim)" }}>
          {failed ? t("Failed to load memory") : t("Loading…")}
        </div>
      )}
    </div>
  );
}
