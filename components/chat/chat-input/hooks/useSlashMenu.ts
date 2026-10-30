"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";
import { getSlashQuery } from "@/lib/shared/composer-queries";
import { rankSlashResources, type SlashResource } from "@/lib/shared/slash-commands";
import { BUILTIN_SLASH_ACTIONS, SLASH_PAGE_SIZE } from "../constants";

export interface UseSlashMenuOptions {
  slashResourceKey: string | undefined;
  slashResources: SlashResource[];
  onSlashAction?: (action: string) => void;
  value: string;
  cursorPosition: number;
  setValue: (next: string | ((prev: string) => string)) => void;
  setCursorPosition: (pos: number) => void;
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
  selectSlashResource: (item: SlashResource) => void;
  handleSlashKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  syncSlashMenuForEdit: (value: string, cursor: number) => void;
}

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
    const builtinMatches = rankSlashResources(BUILTIN_SLASH_ACTIONS, q);
    const matches = rankSlashResources(slashResources, q);
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
        const ta = textareaRef.current;
        const cursor = ta?.selectionStart ?? cursorPosition;
        const query = getSlashQuery(value, cursor);
        const nextValue = query ? value.slice(0, query.start) + value.slice(cursor) : "";
        setValue(nextValue);
        setCursorPosition(query ? query.start : 0);
        setSlashMenuOpen(false);
        setSlashActiveIndex(0);
        setSlashPage(0);
        setSelectedSlashResource(null);
        if (ta) {
          ta.style.height = "auto";
          ta.focus();
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

  const syncSlashMenuForEdit = useCallback(
    (v: string, cursor: number) => {
      setSlashMenuOpen((prev) => {
        if (cursor > 0 && v.slice(0, cursor).endsWith("/")) return true;
        const token = getSlashQuery(v, cursor);
        return Boolean(prev && token);
      });
    },
    [],
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
        setSlashPage((page) => (page >= slashPageCount - 1 ? 0 : page + 1));
        setSlashActiveIndex(0);
        return true;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setSlashPage((page) => (page <= 0 ? slashPageCount - 1 : page - 1));
        setSlashActiveIndex(0);
        return true;
      }
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
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
    syncSlashMenuForEdit,
  };
}