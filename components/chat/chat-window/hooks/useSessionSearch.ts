"use client";

/**
 * In-session search wiring for one chat window.
 *
 * The rule — which visible message a matched session entry resolves to, and
 * whether a pending jump is ready — lives in the chat timeline projection
 * (`lib/shared/chat-timeline.ts`). This hook owns only the state and the DOM
 * scroll; dependencies (the active-tab flag, the navigation callback, the
 * scrollport, the message-row refs and the timeline) come in as parameters.
 *
 * `SessionSearch`'s interface is deliberately unchanged: it reports matches and
 * asks for a jump, and this hook decides where that jump lands.
 */

import { useCallback, useEffect, useState, type RefObject } from "react";
import { decideSearchJump, type ChatTimeline } from "@/lib/shared/chat-timeline";

/** How long a jumped-to message stays highlighted before fading out. */
const HIGHLIGHT_DURATION_MS = 2000;

/** Empty hit set shared across renders (never mutated). */
const NO_MATCHES: ReadonlySet<string> = new Set<string>();

export interface UseSessionSearchOptions {
  /** True only for the tab currently projected into the visible chat view. */
  isActive: boolean;
  /** Selected session id; null on the new-session page. */
  sessionId: string | null;
  /** Chat timeline projection of the session's messages. */
  timeline: ChatTimeline;
  /** The chat scrollport that holds the message rows. */
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  /** Message row elements, indexed by visible index. */
  messageRefs: RefObject<Array<HTMLDivElement | null>>;
  /** Re-engage streaming follow before an explicit jump scrolls. */
  onExplicitScroll: () => void;
  /** Switch to the branch that contains the matched entry. */
  onNavigate: (leafId: string) => void;
}

export interface UseSessionSearchResult {
  /** Whether the search bar is open. */
  visible: boolean;
  /** Keywords the visible message rows highlight. */
  keywords: string[];
  /** Session entry ids the current search matched. */
  matchedEntryIds: ReadonlySet<string>;
  /** Entry id currently flashing, or null. */
  highlightEntryId: string | null;
  /** `SessionSearch.onResultsChange`, passed straight through. */
  handleResultsChange: (matchedEntryIds: string[], keyword: string) => void;
  /** `SessionSearch.onJumpTo`, passed straight through. */
  handleJumpTo: (entryId: string, leafId: string) => void;
  /** `SessionSearch.onClose`, passed straight through. */
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

  // Ctrl+F toggles the search bar — but only for the visible tab, so a
  // background tab never steals the shortcut.
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

  // Clearing the hit set is identical for a session switch and a close.
  const clearMatches = useCallback(() => {
    setKeywords([]);
    setMatchedEntryIds(NO_MATCHES);
    setHighlightEntryId(null);
  }, []);

  // A session switch starts search over: keyword, hits, highlight and any
  // pending jump are all cleared, so reopening search is a clean slate.
  useEffect(() => {
    setVisible(false);
    clearMatches();
    setPendingJumpEntryId(null);
  }, [sessionId, clearMatches]);

  // A pending jump: resolve the entry to a visible row through the projection,
  // scroll it into view, then flash it off after two seconds.
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
