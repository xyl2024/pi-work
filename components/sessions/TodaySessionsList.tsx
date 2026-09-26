"use client";

import { useCallback, useEffect, useState } from "react";
import type { SessionInfo } from "@/lib/shared/types";
import { useI18n } from "@/hooks/useI18n";
import { useAllPendingAskUserQuestions } from "@/hooks/askUserQuestionsStore";
import { useRunningSessions } from "@/hooks/runningSessionsStore";
import { startOfLocalDayMs } from "@/lib/shared/session-today";
import { SessionItem } from "./SessionItem";

interface TodaySessionsListProps {
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo) => void;
  favoriteIds: string[];
  onToggleFavorite?: (sessionId: string) => void;
  onSessionRenamed: (sessionId: string, name: string) => void;
  onSessionDeleted: (sessionId: string) => void;
  /** Bumped by the parent on session create / rename / delete / agent end. */
  refreshKey?: number;
  /** Parent-driven manual refresh (the section header button). */
  refreshSignal?: number;
}

/**
 * Flat "today's sessions" list: every session whose last activity (`modified`)
 * falls in the local calendar day, newest first. A view over the same rows the
 * grouped "Sessions" section shows — rows are reused verbatim via SessionItem,
 * so select / rename / delete / favorite / running / pending-question all
 * behave identically. The local-day boundary is computed here and handed to the
 * server, which narrows the (potentially large) list before it reaches us.
 */
export function TodaySessionsList({
  selectedSessionId,
  onSelectSession,
  favoriteIds,
  onToggleFavorite,
  onSessionRenamed,
  onSessionDeleted,
  refreshKey,
  refreshSignal,
}: TodaySessionsListProps) {
  const { t } = useI18n();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const since = startOfLocalDayMs(new Date());
      const res = await fetch(`/api/sessions?modifiedSince=${since}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { sessions: SessionInfo[] };
      setSessions(data.sessions);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on mount, then again whenever the parent signals a change (session
  // created / renamed / deleted / a turn ended) or the section's refresh
  // button is pressed. The boundary is recomputed each time, so crossing local
  // midnight is picked up on the next refresh.
  useEffect(() => {
    void load();
  }, [load, refreshKey, refreshSignal]);

  const handleRenamed = useCallback((sessionId: string, name: string) => {
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, name } : s)));
    onSessionRenamed(sessionId, name);
  }, [onSessionRenamed]);

  const handleDeleted = useCallback((sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    onSessionDeleted(sessionId);
  }, [onSessionDeleted]);

  const { byId: runningById } = useRunningSessions();
  const pendingQuestions = useAllPendingAskUserQuestions();
  const pendingQuestionSessionIds = new Set(pendingQuestions.map((p) => p.sessionId));

  const rows = sessions.map((s) => {
    const running = runningById.get(s.id);
    return running === undefined || running === s.running ? s : { ...s, running };
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", padding: "4px 8px 8px", minHeight: 40 }}>
      {loading && rows.length === 0 && (
        <div style={{ padding: "16px 8px 6px", color: "var(--text-muted)", fontSize: 12 }}>
          {t("Loading sessions...")}
        </div>
      )}
      {loadError && !loading && (
        <div style={{ padding: "16px 8px 6px", color: "#f87171", fontSize: 12 }}>
          {loadError}
        </div>
      )}
      {!loading && !loadError && rows.length === 0 && (
        <div style={{ padding: "16px 8px 6px", color: "var(--text-muted)", fontSize: 12 }}>
          {t("No sessions today")}
        </div>
      )}
      {rows.map((s) => (
        <SessionItem
          key={s.id}
          session={s}
          isSelected={s.id === selectedSessionId}
          onClick={() => onSelectSession(s)}
          onRenamed={handleRenamed}
          onDeleted={handleDeleted}
          isFavorited={favoriteIds.includes(s.id)}
          onToggleFavorite={onToggleFavorite ? () => onToggleFavorite(s.id) : undefined}
          hasPendingQuestion={pendingQuestionSessionIds.has(s.id)}
        />
      ))}
    </div>
  );
}
