"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";
import { getRelativeFilePath, joinFilePath, normalizeFilePathSlashes } from "@/lib/shared/file-paths";
import { SLASH_PAGE_SIZE } from "../constants";

export interface FileMentionEntry {
  name: string;
  fullPath: string;
  isDir: boolean;
  isParent?: boolean;
}

export interface FileMentionQuery {
  start: number;
  query: string;
  directory: string;
}

export interface UseFileMentionMenuOptions {
  cwd?: string | null;
  value: string;
  cursorPosition: number;
  setValue: (next: string | ((prev: string) => string)) => void;
  setCursorPosition: (pos: number) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

function getMentionQuery(value: string, cursor: number): FileMentionQuery | null {
  const before = value.slice(0, cursor);
  const match = before.match(/(^|\s)@([^\s]*)$/);
  if (!match) return null;
  const start = (match.index ?? 0) + match[1].length;
  const raw = match[2].replace(/\\/g, "/");
  const parts = raw.split("/");
  const last = parts.pop() ?? "";
  const directoryParts = parts.filter(Boolean);
  return { start, query: last, directory: directoryParts.join("/") };
}

function pathInsideCwd(cwd: string, path: string): boolean {
  const base = normalizeFilePathSlashes(cwd).replace(/\/+$/, "");
  const candidate = normalizeFilePathSlashes(path).replace(/\/+$/, "");
  return candidate === base || candidate.startsWith(`${base}/`);
}

function getDirectoryPath(cwd: string, directory: string): string | null {
  const normalizedCwd = normalizeFilePathSlashes(cwd).replace(/\/+$/, "");
  if (!directory) return normalizedCwd;
  const candidate = normalizeFilePathSlashes(joinFilePath(normalizedCwd, directory));
  return pathInsideCwd(normalizedCwd, candidate) ? candidate : null;
}

function codeSpan(path: string): string {
  let longest = 0;
  for (const match of path.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  const fence = "`".repeat(longest + 1);
  return `${fence}${path}${fence}`;
}

export function useFileMentionMenu({
  cwd,
  value,
  cursorPosition,
  setValue,
  setCursorPosition,
  textareaRef,
}: UseFileMentionMenuOptions) {
  const [mentionMenuOpen, setMentionMenuOpen] = useState(false);
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const [mentionPage, setMentionPage] = useState(0);
  const [entries, setEntries] = useState<FileMentionEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openGeneration, setOpenGeneration] = useState(0);
  const cacheRef = useRef(new Map<string, FileMentionEntry[]>());
  const requestIdRef = useRef(0);

  const mentionQuery = useMemo(() => {
    if (!cwd) return null;
    const parsed = getMentionQuery(value, cursorPosition);
    if (!parsed) return null;
    const directory = getDirectoryPath(cwd, parsed.directory);
    return directory ? { ...parsed, directory } : null;
  }, [cwd, value, cursorPosition]);

  const filteredEntries = useMemo(() => {
    if (!mentionMenuOpen || !mentionQuery) return [];
    const q = mentionQuery.query.toLowerCase();
    return entries.filter((entry) => !q || entry.name.toLowerCase().includes(q) || getRelativeFilePath(entry.fullPath, cwd ?? undefined).toLowerCase().includes(q));
  }, [mentionMenuOpen, mentionQuery, entries, cwd]);

  useEffect(() => {
    setMentionMenuOpen(false);
    setMentionActiveIndex(0);
    setMentionPage(0);
    cacheRef.current.clear();
    setEntries([]);
    setError(null);
  }, [cwd]);

  useEffect(() => {
    if (!mentionMenuOpen || !mentionQuery || !cwd) return;
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
        const next: FileMentionEntry[] = (data.entries ?? []).map((entry) => ({
          ...entry,
          fullPath: joinFilePath(key, entry.name),
        }));
        if (key !== normalizeFilePathSlashes(cwd).replace(/\/+$/, "")) {
          next.unshift({ name: "..", fullPath: normalizeFilePathSlashes(key).replace(/\/[^/]+$/, ""), isDir: true, isParent: true });
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
  }, [mentionMenuOpen, mentionQuery, cwd, openGeneration]);

  const mentionPageCount = Math.max(1, Math.ceil(filteredEntries.length / SLASH_PAGE_SIZE));
  const mentionCurrentPage = Math.min(mentionPage, mentionPageCount - 1);
  const visibleMentionEntries = useMemo(() => {
    const start = mentionCurrentPage * SLASH_PAGE_SIZE;
    return filteredEntries.slice(start, start + SLASH_PAGE_SIZE);
  }, [filteredEntries, mentionCurrentPage]);

  useEffect(() => {
    setMentionActiveIndex(0);
    setMentionPage(0);
  }, [mentionQuery?.query, mentionQuery?.directory]);

  useEffect(() => {
    setMentionPage((page) => Math.min(page, mentionPageCount - 1));
  }, [mentionPageCount]);

  useEffect(() => {
    setMentionActiveIndex((index) => Math.min(index, Math.max(0, visibleMentionEntries.length - 1)));
  }, [visibleMentionEntries.length]);

  const retryFileMentionLoad = useCallback(() => {
    if (!mentionQuery) return;
    cacheRef.current.delete(mentionQuery.directory);
    setOpenGeneration((generation) => generation + 1);
  }, [mentionQuery]);

  const syncFileMentionMenuForEdit = useCallback((nextValue: string, cursor: number) => {
    const nextQuery = cwd ? getMentionQuery(nextValue, cursor) : null;
    setMentionMenuOpen((previous) => {
      const next = Boolean(nextQuery);
      if (next && !previous) {
        cacheRef.current.clear();
        setOpenGeneration((generation) => generation + 1);
      }
      return next;
    });
  }, [cwd]);

  const selectFileMention = useCallback((entry: FileMentionEntry) => {
    if (!mentionQuery || !cwd) return;
    const ta = textareaRef.current;
    const cursor = ta?.selectionStart ?? cursorPosition;
    const trailingTokenLength = value.slice(cursor).match(/^[^\s]*/)?.[0].length ?? 0;
    const tokenEnd = cursor + trailingTokenLength;
    if (entry.isParent || entry.isDir) {
      const normalizedCwd = normalizeFilePathSlashes(cwd).replace(/\/+$/, "");
      const currentRelativeDirectory = mentionQuery.directory === normalizedCwd
        ? ""
        : getRelativeFilePath(mentionQuery.directory, cwd)
          .replace(/^\/+/, "")
          .replace(/\/+$/, "");
      const relative = entry.isParent
        ? currentRelativeDirectory.split("/").slice(0, -1).join("/")
        : [currentRelativeDirectory, entry.name].filter(Boolean).join("/");
      const replacement = relative ? `@${relative}/` : "@";
      const nextValue = value.slice(0, mentionQuery.start) + replacement + value.slice(tokenEnd);
      const nextCursor = mentionQuery.start + replacement.length;
      setValue(nextValue);
      setCursorPosition(nextCursor);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(nextCursor, nextCursor);
      });
      return;
    }
    const relative = getRelativeFilePath(entry.fullPath, cwd).replace(/^\/+/, "");
    const suffix = value.slice(tokenEnd);
    const replacement = `${codeSpan(`./${relative}`)}${/^\s/.test(suffix) ? "" : " "}`;
    const nextValue = value.slice(0, mentionQuery.start) + replacement + suffix;
    const nextCursor = mentionQuery.start + replacement.length;
    setValue(nextValue);
    setCursorPosition(nextCursor);
    setMentionMenuOpen(false);
    setMentionActiveIndex(0);
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(nextCursor, nextCursor);
    });
  }, [mentionQuery, cwd, textareaRef, cursorPosition, value, setValue, setCursorPosition]);

  const handleFileMentionKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!mentionMenuOpen || !mentionQuery) return false;
    if (e.key === "Escape") {
      e.preventDefault();
      setMentionMenuOpen(false);
      return true;
    }
    if (e.key === "Backspace" && mentionQuery.query === "" && mentionQuery.directory !== normalizeFilePathSlashes(cwd ?? "").replace(/\/+$/, "")) {
      e.preventDefault();
      const parent = entries.find((entry) => entry.isParent);
      if (parent) selectFileMention(parent);
      return true;
    }
    if (loading) {
      if (e.key === "Enter" || e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        return true;
      }
      return false;
    }
    if (visibleMentionEntries.length === 0) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setMentionActiveIndex((index) => e.key === "ArrowDown"
        ? (index + 1) % visibleMentionEntries.length
        : (index - 1 + visibleMentionEntries.length) % visibleMentionEntries.length);
      return true;
    }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      setMentionPage((page) => e.key === "ArrowRight"
        ? (page >= mentionPageCount - 1 ? 0 : page + 1)
        : (page <= 0 ? mentionPageCount - 1 : page - 1));
      setMentionActiveIndex(0);
      return true;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      selectFileMention(visibleMentionEntries[mentionActiveIndex] ?? visibleMentionEntries[0]);
      return true;
    }
    return false;
  }, [mentionMenuOpen, mentionQuery, cwd, entries, loading, visibleMentionEntries, mentionActiveIndex, mentionPageCount, selectFileMention]);

  return {
    mentionMenuOpen,
    mentionActiveIndex,
    mentionQuery,
    filteredEntries,
    visibleMentionEntries,
    mentionPageCount,
    mentionCurrentPage,
    loading,
    error,
    setMentionMenuOpen,
    syncFileMentionMenuForEdit,
    handleFileMentionKeyDown,
    selectFileMention,
    retryFileMentionLoad,
  };
}
