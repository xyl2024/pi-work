"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";
import { getSlashQuery, type SlashResource } from "@/lib/shared/slash-commands";
import { BUILTIN_SLASH_ACTIONS, SLASH_PAGE_SIZE } from "../constants";

export interface UseSlashMenuOptions {
  /** Active session id — used as a reset trigger for the slash menu state. */
  slashResourceKey: string | undefined;
  /** Slash resources catalog from the backend. */
  slashResources: SlashResource[];
  /** Parent-callback for built-in actions like "new" / "compact". */
  onSlashAction?: (action: string) => void;
  /** Current textarea value, kept in sync with the parent's `setValue`. */
  value: string;
  /** Current caret position. */
  cursorPosition: number;
  /** Callback to update the parent's value (used when applying a slash
   *  command, which strips the typed prefix). */
  setValue: (next: string | ((prev: string) => string)) => void;
  setCursorPosition: (pos: number) => void;
  /** Ref to the textarea so the hook can refocus + reset its height after
   *  applying a slash command. */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

export interface UseSlashMenuResult {
  selectedSlashResource: SlashResource | null;
  slashMenuOpen: boolean;
  slashActiveIndex: number;
  slashPage: number;
  slashQuery: ReturnType<typeof getSlashQuery>;
  filteredSlashResources: SlashResource[];
  visibleSlashResources: SlashResource[];
  slashPageCount: number;
  slashCurrentPage: number;
  setSlashMenuOpen: (open: boolean) => void;
  setSelectedSlashResource: (resource: SlashResource | null) => void;
  /** Apply a slash resource: for built-in actions, fires `onSlashAction`
   *  directly; for prompt templates, records it as the selected resource
   *  so `formatSlashContent` runs at send time. */
  selectSlashResource: (item: SlashResource) => void;
  /** Handle arrow / space / escape keys while the slash menu is open.
   *  Returns `true` if the event was consumed (the parent should early-return). */
  handleSlashKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => boolean;
}

/**
 * Slash-command menu: filter the catalog by the typed prefix, paginate the
 * results, and own the cursor / keyboard navigation. Built-in `/new` and
 * `/compact` actions fire through `onSlashAction` rather than expanding a
 * prompt template.
 */
export function useSlashMenu({
  slashResourceKey,
  slashResources,
  onSlashAction,
  value,
  cursorPosition,
  setValue,
  setCursorPosition,
  textareaRef,
}: UseSlashMenuOptions): UseSlashMenuResult {
  const [selectedSlashResource, setSelectedSlashResource] = useState<SlashResource | null>(null);
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [slashPage, setSlashPage] = useState(0);

  // Reset menu state when the slash catalog key changes (the parent keys
  // the catalog by session id + a refetch counter; resets here mean the
  // user never sees stale items after switching projects or refreshing).
  useEffect(() => {
    setSelectedSlashResource(null);
    setSlashMenuOpen(false);
    setSlashActiveIndex(0);
    setSlashPage(0);
  }, [slashResourceKey]);

  const slashQuery = useMemo(() => getSlashQuery(value, cursorPosition), [value, cursorPosition]);

  const filteredSlashResources = useMemo(() => {
    if (!slashMenuOpen || !slashQuery) return [];
    const q = slashQuery.query.toLowerCase();
    const builtinMatches = BUILTIN_SLASH_ACTIONS.filter(
      (item) =>
        item.command.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q),
    );
    const matches = slashResources.filter(
      (item) =>
        item.command.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q),
    );
    return builtinMatches.length > 0 ? [...builtinMatches, ...matches] : matches;
  }, [slashMenuOpen, slashQuery, slashResources]);

  const slashPageCount = Math.max(1, Math.ceil(filteredSlashResources.length / SLASH_PAGE_SIZE));
  const slashCurrentPage = Math.min(slashPage, slashPageCount - 1);
  const visibleSlashResources = useMemo(() => {
    const start = slashCurrentPage * SLASH_PAGE_SIZE;
    return filteredSlashResources.slice(start, start + SLASH_PAGE_SIZE);
  }, [filteredSlashResources, slashCurrentPage]);

  useEffect(() => {
    setSlashActiveIndex(0);
    setSlashPage(0);
  }, [slashQuery?.query, slashResources]);

  useEffect(() => {
    setSlashPage((page) => Math.min(page, slashPageCount - 1));
  }, [slashPageCount]);

  useEffect(() => {
    setSlashActiveIndex((index) => Math.min(index, Math.max(0, visibleSlashResources.length - 1)));
  }, [visibleSlashResources.length]);

  const selectSlashResource = useCallback(
    (item: SlashResource) => {
      if (item.source === "action") {
        onSlashAction?.(item.command);
        setValue("");
        setCursorPosition(0);
        setSlashMenuOpen(false);
        setSlashActiveIndex(0);
        setSlashPage(0);
        setSelectedSlashResource(null);
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
          textareaRef.current.focus();
        }
        return;
      }

      const ta = textareaRef.current;
      const cursor = ta?.selectionStart ?? cursorPosition;
      const query = getSlashQuery(value, cursor);
      const nextValue = query ? value.slice(0, query.start) + value.slice(cursor) : value;

      setSelectedSlashResource(item);
      setValue(nextValue);
      setSlashMenuOpen(false);
      setSlashActiveIndex(0);
      setSlashPage(0);

      requestAnimationFrame(() => {
        const nextCursor = query ? query.start : cursor;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(nextCursor, nextCursor);
        setCursorPosition(nextCursor);
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    [cursorPosition, value, onSlashAction, textareaRef, setValue, setCursorPosition],
  );

  const handleSlashKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!slashMenuOpen || !slashQuery || visibleSlashResources.length === 0) return false;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashActiveIndex((i) => (i + 1) % visibleSlashResources.length);
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashActiveIndex((i) => (i - 1 + visibleSlashResources.length) % visibleSlashResources.length);
        return true;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setSlashPage((page) => Math.min(page + 1, slashPageCount - 1));
        setSlashActiveIndex(0);
        return true;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setSlashPage((page) => Math.max(page - 1, 0));
        setSlashActiveIndex(0);
        return true;
      }
      if ((e.key === " " || e.code === "Space") && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        selectSlashResource(visibleSlashResources[slashActiveIndex] ?? visibleSlashResources[0]);
        return true;
      }
      return false;
    },
    [slashMenuOpen, slashQuery, visibleSlashResources, slashActiveIndex, slashPageCount, selectSlashResource],
  );

  return {
    selectedSlashResource,
    slashMenuOpen,
    slashActiveIndex,
    slashPage,
    slashQuery,
    filteredSlashResources,
    visibleSlashResources,
    slashPageCount,
    slashCurrentPage,
    setSlashMenuOpen,
    setSelectedSlashResource,
    selectSlashResource,
    handleSlashKeyDown,
  };
}