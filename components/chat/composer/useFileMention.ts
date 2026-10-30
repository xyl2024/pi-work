"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getMentionQuery, resolveMentionDirectory } from "@/lib/shared/composer-queries";
import { getRelativeFilePath, joinFilePath, normalizeFilePathSlashes } from "@/lib/shared/file-paths";
import { SLASH_PAGE_SIZE } from "../chat-input/constants";
import { filterMentionEntries, type MentionEntry } from "@/lib/client/composer/mention";

export interface UseFileMentionOptions {
  cwd?: string | null;
  text: string;
  cursorOffset: number;
}

export function useFileMention({ cwd, text, cursorOffset }: UseFileMentionOptions) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [page, setPage] = useState(0);
  const [entries, setEntries] = useState<MentionEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openGeneration, setOpenGeneration] = useState(0);
  const cacheRef = useRef(new Map<string, MentionEntry[]>());
  const requestIdRef = useRef(0);
  const openRef = useRef(false);

  const mentionQuery = useMemo(() => {
    if (!cwd) return null;
    const parsed = getMentionQuery(text, cursorOffset);
    if (!parsed) return null;
    const directory = resolveMentionDirectory(cwd, parsed.directory);
    return directory ? { ...parsed, directory } : null;
  }, [cwd, text, cursorOffset]);

  const filteredEntries = useMemo(() => {
    if (!open || !mentionQuery) return [];
    return filterMentionEntries(entries, mentionQuery.query, cwd ?? undefined);
  }, [open, mentionQuery, entries, cwd]);

  useEffect(() => {
    openRef.current = false;
    setOpen(false);
    setActiveIndex(0);
    setPage(0);
    setLoading(false);
    setEntries([]);
    setError(null);
    cacheRef.current.clear();
  }, [cwd]);

  useEffect(() => {
    if (!open || !mentionQuery || !cwd) return;
    const key = mentionQuery.directory;
    const cached = cacheRef.current.get(key);
    if (cached) {
      setEntries(cached);
      setLoading(false);
      setError(null);
      return;
    }
    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ cwd, directory: getRelativeFilePath(key, cwd) });
    fetch(`/api/file-mentions?${params}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load files");
        const data = await res.json() as { entries?: { name: string; isDir: boolean }[] };
        const next: MentionEntry[] = (data.entries ?? []).map((entry) => ({
          ...entry,
          fullPath: joinFilePath(key, entry.name),
        }));
        if (key !== normalizeFilePathSlashes(cwd).replace(/\/+$/, "")) {
          next.unshift({
            name: "..",
            fullPath: normalizeFilePathSlashes(key).replace(/\/[^/]+$/, ""),
            isDir: true,
            isParent: true,
          });
        }
        cacheRef.current.set(key, next);
        if (requestId === requestIdRef.current) setEntries(next);
      })
      .catch((cause: unknown) => {
        if ((cause as { name?: string }).name === "AbortError" || requestId !== requestIdRef.current) return;
        setEntries([]);
        setError(cause instanceof Error ? cause.message : "Failed to load files");
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
    return () => controller.abort();
  }, [open, mentionQuery, cwd, openGeneration]);

  const pageCount = Math.max(1, Math.ceil(filteredEntries.length / SLASH_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleEntries = useMemo(() => {
    const start = currentPage * SLASH_PAGE_SIZE;
    return filteredEntries.slice(start, start + SLASH_PAGE_SIZE);
  }, [filteredEntries, currentPage]);

  useEffect(() => {
    setActiveIndex(0);
    setPage(0);
  }, [mentionQuery?.query, mentionQuery?.directory]);

  useEffect(() => {
    setPage((value) => Math.min(value, pageCount - 1));
  }, [pageCount]);

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, visibleEntries.length - 1)));
  }, [visibleEntries.length]);

  const syncFileMentionMenuForEdit = useCallback((nextText: string, nextCursor: number) => {
    const nextOpen = Boolean(cwd && getMentionQuery(nextText, nextCursor));
    if (nextOpen && !openRef.current) {
      cacheRef.current.clear();
      setOpenGeneration((generation) => generation + 1);
    }
    openRef.current = nextOpen;
    setOpen(nextOpen);
  }, [cwd]);

  const closeMentionMenu = useCallback(() => {
    openRef.current = false;
    setOpen(false);
    setActiveIndex(0);
    setPage(0);
  }, []);

  const retryFileMentionLoad = useCallback(() => {
    if (!mentionQuery) return;
    cacheRef.current.delete(mentionQuery.directory);
    setOpenGeneration((generation) => generation + 1);
  }, [mentionQuery]);

  return {
    open,
    query: mentionQuery,
    filteredEntries,
    visibleEntries,
    activeIndex,
    setActiveIndex,
    page: currentPage,
    setPage,
    pageCount,
    loading,
    error,
    syncFileMentionMenuForEdit,
    closeMentionMenu,
    retryFileMentionLoad,
  };
}
