"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  memorySnapshotChanges,
  type MemoryEntriesResponse,
  type MemoryLibrarySnapshot,
  type MemoryTarget,
  type SessionMemorySnapshot,
} from "@/lib/shared/memory";
import type { SessionSnapshotPayload } from "@/lib/shared/session-runtime-state";

const LIBRARY_ORDER: readonly MemoryTarget[] = ["memory", "user"];

const LIBRARY_TITLE_KEYS: Record<MemoryTarget, string> = {
  memory: "Agent notes",
  user: "User profile",
};

interface LoadedSnapshot {
  sessionId: string;
  snapshot: SessionMemorySnapshot | null;
}

function changedEntriesOf(
  snapshot: SessionMemorySnapshot,
  current: MemoryEntriesResponse,
): number | null {
  let changed = 0;
  for (const target of LIBRARY_ORDER) {
    const library: MemoryLibrarySnapshot | null = snapshot[target];
    if (library === null) continue;
    const view = current[target];
    if (view.status === "unreadable") return null;
    changed += memorySnapshotChanges(library, view.entries);
  }
  return changed;
}

export function MemorySnapshotRow({
  sessionId,
  current,
}: {
  sessionId: string | null;
  current: MemoryEntriesResponse | null;
}) {
  const { t } = useI18n();
  const [loaded, setLoaded] = useState<LoadedSnapshot | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    fetch(`/api/agent/${encodeURIComponent(sessionId)}`)
      .then((result) => result.json() as Promise<SessionSnapshotPayload>)
      .then((body) => {
        if (cancelled) return;
        setLoaded({ sessionId, snapshot: body.state?.memorySnapshot ?? null });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ sessionId, snapshot: null });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const snapshot = loaded !== null && loaded.sessionId === sessionId ? loaded.snapshot : null;
  if (sessionId === null || snapshot === null) return null;

  const labels = LIBRARY_ORDER.flatMap((target) => {
    const library = snapshot[target];
    if (library === null) return [];
    return [t("{label} {count}", { label: t(LIBRARY_TITLE_KEYS[target]), count: library.entryCount })];
  });
  const changed = current === null ? null : changedEntriesOf(snapshot, current);

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 8,
        padding: "8px 16px",
        borderBottom: "1px solid var(--border)",
        fontSize: 11,
        color: "var(--text-dim)",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <span>
        {t("Session memory snapshot")}
        <span style={{ color: "var(--text-muted)" }}>{` · ${labels.join(" · ")}`}</span>
      </span>
      {changed !== null && (
        <span style={{ color: changed === 0 ? "var(--text-dim)" : "var(--warning)" }}>
          {changed === 0 ? t("Matches the current file") : t("{count} changes not applied", { count: changed })}
        </span>
      )}
    </div>
  );
}
