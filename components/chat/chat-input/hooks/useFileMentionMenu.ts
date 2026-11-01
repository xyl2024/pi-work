"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent, RefObject } from "react";
import { formatFilePathReference } from "@/lib/shared/file-reference";
import { getRelativeFilePath, joinFilePath, normalizeFilePathSlashes } from "@/lib/shared/file-paths";
import { createDirectoryListing, pageWindow, DIRECTORY_PAGE_SIZE } from "@/lib/client/directory-listing";
import { createFileMentionAdapter } from "@/lib/client/file-mentions-io";

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

function normalizeCwd(cwd: string): string {
  return normalizeFilePathSlashes(cwd).replace(/\/+$/, "");
}

function pathInsideCwd(cwd: string, path: string): boolean {
  const base = normalizeCwd(cwd);
  const candidate = normalizeFilePathSlashes(path).replace(/\/+$/, "");
  return candidate === base || candidate.startsWith(`${base}/`);
}

function getDirectoryPath(cwd: string, directory: string): string | null {
  const normalizedCwd = normalizeCwd(cwd);
  if (!directory) return normalizedCwd;
  const candidate = normalizeFilePathSlashes(joinFilePath(normalizedCwd, directory));
  return pathInsideCwd(normalizedCwd, candidate) ? candidate : null;
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
  const listing = useMemo(
    () => createDirectoryListing({ adapter: createFileMentionAdapter(cwd ?? "") }),
    [cwd],
  );
  const listingSnapshot = useSyncExternalStore(listing.subscribe, listing.get, listing.get);

  const mentionQuery = useMemo(() => {
    if (!cwd) return null;
    const parsed = getMentionQuery(value, cursorPosition);
    if (!parsed) return null;
    const directory = getDirectoryPath(cwd, parsed.directory);
    return directory ? { ...parsed, directory } : null;
  }, [cwd, value, cursorPosition]);

  const relativeDirectory = useMemo(() => {
    if (!cwd || !mentionQuery) return null;
    const normalizedCwd = normalizeCwd(cwd);
    if (mentionQuery.directory === normalizedCwd) return "";
    return getRelativeFilePath(mentionQuery.directory, cwd)
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");
  }, [cwd, mentionQuery]);

  const entries = useMemo<FileMentionEntry[]>(() => {
    if (!cwd) return [];
    const base = normalizeCwd(cwd);
    return listingSnapshot.entries.map((entry) => ({
      name: entry.name,
      fullPath: entry.path ? joinFilePath(base, entry.path) : base,
      isDir: entry.isDir,
      isParent: entry.isParent,
    }));
  }, [cwd, listingSnapshot.entries]);

  const filteredEntries = useMemo(() => {
    if (!mentionMenuOpen || !mentionQuery) return [];
    const q = mentionQuery.query.toLowerCase();
    return entries.filter((entry) => !q || entry.name.toLowerCase().includes(q) || getRelativeFilePath(entry.fullPath, cwd ?? undefined).toLowerCase().includes(q));
  }, [mentionMenuOpen, mentionQuery, entries, cwd]);

  useEffect(() => {
    setMentionMenuOpen(false);
    setMentionActiveIndex(0);
    setMentionPage(0);
  }, [cwd]);

  useEffect(() => {
    listing.reset();
  }, [mentionMenuOpen, listing]);

  useEffect(() => {
    if (!mentionMenuOpen || relativeDirectory === null) return;
    void listing.load(relativeDirectory);
  }, [mentionMenuOpen, relativeDirectory, listing]);

  const page = pageWindow(filteredEntries, mentionPage, DIRECTORY_PAGE_SIZE);
  const mentionPageCount = page.pageCount;
  const mentionCurrentPage = page.currentPage;
  const visibleMentionEntries = page.items;

  useEffect(() => {
    setMentionActiveIndex(0);
    setMentionPage(0);
  }, [mentionQuery?.query, mentionQuery?.directory]);

  useEffect(() => {
    setMentionPage((current) => Math.min(current, mentionPageCount - 1));
  }, [mentionPageCount]);

  useEffect(() => {
    setMentionActiveIndex((index) => Math.min(index, Math.max(0, visibleMentionEntries.length - 1)));
  }, [visibleMentionEntries.length]);

  const retryFileMentionLoad = useCallback(() => {
    void listing.retry();
  }, [listing]);

  const syncFileMentionMenuForEdit = useCallback((nextValue: string, cursor: number) => {
    const nextQuery = cwd ? getMentionQuery(nextValue, cursor) : null;
    setMentionMenuOpen(Boolean(nextQuery));
  }, [cwd]);

  const selectFileMention = useCallback((entry: FileMentionEntry) => {
    if (!mentionQuery || !cwd) return;
    const ta = textareaRef.current;
    const cursor = ta?.selectionStart ?? cursorPosition;
    const trailingTokenLength = value.slice(cursor).match(/^[^\s]*/)?.[0].length ?? 0;
    const tokenEnd = cursor + trailingTokenLength;
    if (entry.isParent || entry.isDir) {
      const normalizedCwd = normalizeCwd(cwd);
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
    const reference = formatFilePathReference(relative);
    const replacement = /^\s/.test(suffix) ? reference.trimEnd() : reference;
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
    if (e.key === "Backspace" && mentionQuery.query === "" && mentionQuery.directory !== normalizeCwd(cwd ?? "")) {
      e.preventDefault();
      const parent = entries.find((entry) => entry.isParent);
      if (parent) selectFileMention(parent);
      return true;
    }
    if (listingSnapshot.loading) {
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
      setMentionPage((current) => e.key === "ArrowRight"
        ? (current >= mentionPageCount - 1 ? 0 : current + 1)
        : (current <= 0 ? mentionPageCount - 1 : current - 1));
      setMentionActiveIndex(0);
      return true;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      selectFileMention(visibleMentionEntries[mentionActiveIndex] ?? visibleMentionEntries[0]);
      return true;
    }
    return false;
  }, [mentionMenuOpen, mentionQuery, cwd, entries, listingSnapshot.loading, visibleMentionEntries, mentionActiveIndex, mentionPageCount, selectFileMention]);

  return {
    mentionMenuOpen,
    mentionActiveIndex,
    mentionQuery,
    filteredEntries,
    visibleMentionEntries,
    mentionPageCount,
    mentionCurrentPage,
    loading: listingSnapshot.loading,
    error: listingSnapshot.error,
    setMentionMenuOpen,
    syncFileMentionMenuForEdit,
    handleFileMentionKeyDown,
    selectFileMention,
    retryFileMentionLoad,
  };
}
