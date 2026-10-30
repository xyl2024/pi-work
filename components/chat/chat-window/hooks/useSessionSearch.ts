"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";
import { decideSearchJump, type ChatTimeline } from "@/lib/shared/chat-timeline";
import { HIGHLIGHT_DURATION_MS } from "./useJumpHighlight";

const NO_MATCHES: ReadonlySet<string> = new Set<string>();

export interface UseSessionSearchOptions {
  isActive: boolean;
  sessionId: string | null;
  timeline: ChatTimeline;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  messageRefs: RefObject<Array<HTMLDivElement | null>>;
  onExplicitScroll: () => void;
  onNavigate: (leafId: string) => void;
}

export interface UseSessionSearchResult {
  visible: boolean;
  keywords: string[];
  matchedEntryIds: ReadonlySet<string>;
  highlightEntryId: string | null;
  handleResultsChange: (matchedEntryIds: string[], keyword: string) => void;
  handleJumpTo: (entryId: string, leafId: string) => void;
  handleClose: () => void;
}

export function useSessionSearch({
  isActive,
  sessionId,
  timeline,
  scrollContainerRef,
  messageRefs,
  onExplicitScroll,
  onNavigate,
}: UseSessionSearchOptions): UseSessionSearchResult {
  const [visible, setVisible] = useState(false);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [matchedEntryIds, setMatchedEntryIds] = useState<ReadonlySet<string>>(NO_MATCHES);
  const [highlightEntryId, setHighlightEntryId] = useState<string | null>(null);
  const [pendingJumpEntryId, setPendingJumpEntryId] = useState<string | null>(null);

  useEffect(() => {
    if (!isActive || !sessionId) return;
    const handleKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "f") {
        event.preventDefault();
        setVisible((open) => !open);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isActive, sessionId]);

  const clearMatches = useCallback(() => {
    setKeywords([]);
    setMatchedEntryIds(NO_MATCHES);
    setHighlightEntryId(null);
  }, []);

  useEffect(() => {
    setVisible(false);
    clearMatches();
    setPendingJumpEntryId(null);
  }, [sessionId, clearMatches]);

  useEffect(() => {
    const jump = decideSearchJump(timeline, pendingJumpEntryId);
    if (jump.kind === "skip") return;
    const row = messageRefs.current?.[jump.visibleIndex];
    const container = scrollContainerRef.current;
    if (row && container) {
      onExplicitScroll();
      const rowTop =
        row.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
      container.scrollTo({ top: rowTop - 20, behavior: "smooth" });
    }
    setHighlightEntryId(jump.entryId);
    setPendingJumpEntryId(null);
    const timer = setTimeout(() => setHighlightEntryId(null), HIGHLIGHT_DURATION_MS);
    return () => clearTimeout(timer);
  }, [pendingJumpEntryId, timeline, messageRefs, scrollContainerRef, onExplicitScroll]);

  const handleResultsChange = useCallback((ids: string[], keyword: string) => {
    setMatchedEntryIds(new Set(ids));
    setKeywords(keyword ? [keyword] : []);
    setHighlightEntryId((current) => (keyword ? current : null));
  }, []);

  const handleJumpTo = useCallback(
    (entryId: string, leafId: string) => {
      onNavigate(leafId);
      setPendingJumpEntryId(entryId);
    },
    [onNavigate],
  );

  const handleClose = useCallback(() => {
    setVisible(false);
    clearMatches();
  }, [clearMatches]);

  return {
    visible,
    keywords,
    matchedEntryIds,
    highlightEntryId,
    handleResultsChange,
    handleJumpTo,
    handleClose,
  };
}
