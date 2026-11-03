"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  formatMemorySnapshotTime,
  MEMORY_TARGETS,
  MEMORY_TARGET_TITLE_KEYS,
  memorySnapshotDifference,
  type MemoryEntriesResponse,
  type SessionMemorySnapshot,
} from "@/lib/shared/memory";
import type { SessionSnapshotPayload } from "@/lib/shared/session-runtime-state";

interface LoadedSnapshot {
  sessionId: string;
  snapshot: SessionMemorySnapshot | null;
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

  const labels = MEMORY_TARGETS.flatMap((target) => {
    const library = snapshot[target];
    if (library === null) return [];
    return [t("{label} {count}", { label: t(MEMORY_TARGET_TITLE_KEYS[target]), count: library.entryCount })];
  });
  const difference = memorySnapshotDifference(snapshot, current);
  const snapshotTime = formatMemorySnapshotTime(snapshot.capturedAt);

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
        <span>{` · ${t("Snapshot time {time}", { time: snapshotTime })}`}</span>
      </span>
      {difference !== null && (
        <span style={{ color: difference.changed === 0 ? "var(--text-dim)" : "var(--warning)" }}>
          {difference.changed === 0
            ? t("Matches the current file")
            : t("{count} changes not applied", { count: difference.changed })}
        </span>
      )}
    </div>
  );
}
