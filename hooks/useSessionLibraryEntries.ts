"use client";

import { useMemo } from "react";
import {
  deriveSessionLibraryEntries,
  filterSessionLibraryEntries,
  countSessionLibraryEntries,
  flattenSessionLibraryTiles,
  type SessionLibraryEntry,
  type SessionLibraryCounts,
  type SessionLibraryTile,
} from "@/lib/shared/session-library-derive";
import { useSessionLibraryUi } from "./sessionLibraryStore";
import { useShowFileResults } from "./showFileResultsStore";
import type { AgentMessage } from "@/lib/shared/types";

/**
 * Derive the Session Library entry list for the active session and apply
 * the current UI filter / search. Returns:
 *
 * - `entries` — full list (one entry per show_file tool call, unfiltered)
 * - `filteredEntries` — filtered + searched list
 * - `tiles` — flat per-path list for the grid view
 * - `counts` — per-filter counts (drives the filter-bar badges)
 * - `filter` / `search` — current UI state (passed through so consumers
 *   don't have to subscribe twice)
 *
 * Pure derivation: depends only on `messages` and the showFileResults
 * cache. Reactivity comes for free — when SSE pushes a new message the
 * `messages` reference changes and the memo recomputes.
 */
export function useSessionLibraryEntries(messages: AgentMessage[]): {
  entries: SessionLibraryEntry[];
  filteredEntries: SessionLibraryEntry[];
  tiles: SessionLibraryTile[];
  counts: SessionLibraryCounts;
  filter: string;
  search: string;
} {
  const ui = useSessionLibraryUi();
  const filter = ui.filter;
  const search = ui.search;
  const showFileResults = useShowFileResults();

  const entries = useMemo(
    () => deriveSessionLibraryEntries(messages, showFileResults),
    [messages, showFileResults],
  );

  const filteredEntries = useMemo(
    () => filterSessionLibraryEntries(entries, filter, search),
    [entries, filter, search],
  );

  const tiles = useMemo(
    () => flattenSessionLibraryTiles(filteredEntries),
    [filteredEntries],
  );

  const counts = useMemo(
    () => countSessionLibraryEntries(entries),
    [entries],
  );

  return { entries, filteredEntries, tiles, counts, filter, search };
}