"use client";

import { useEffect, useRef, useState } from "react";

export interface TextSelectionRect {
  top: number;
  centerX: number;
  width: number;
}

export interface TextSelectionState {
  text: string;
  rect: TextSelectionRect | null;
  visible: boolean;
}

const SHOW_DELAY_MS = 250;
const MIN_CHARS = 2;

const EMPTY_STATE: TextSelectionState = {
  text: "",
  rect: null,
  visible: false,
};

export function useTextSelection(containerRef: React.RefObject<HTMLElement | null>) {
  const [state, setState] = useState<TextSelectionState>(EMPTY_STATE);
  const stateRef = useRef<TextSelectionState>(EMPTY_STATE);
  stateRef.current = state;

  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
  };

  const hide = () => {
    clearTimer();
    setState(EMPTY_STATE);
  };

  const computeRect = (selection: Selection): TextSelectionRect | null => {
    if (selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    const rects = range.getClientRects();
    if (rects.length === 0) {
      const r = range.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return { top: r.top, centerX: r.left + r.width / 2, width: r.width };
    }
    const top = rects[0];
    return { top: top.top, centerX: top.left + top.width / 2, width: top.width };
  };

  const inspectSelection = (selection: Selection): TextSelectionState => {
    const container = containerRef.current;
    if (!container) return EMPTY_STATE;
    if (selection.isCollapsed) return EMPTY_STATE;
    const anchor = selection.anchorNode;
    if (!anchor || !container.contains(anchor)) return EMPTY_STATE;
    const text = selection.toString().trim();
    if (text.length < MIN_CHARS) return EMPTY_STATE;
    const rect = computeRect(selection);
    if (!rect) return EMPTY_STATE;
    return { text, rect, visible: true };
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseUp = (_e: MouseEvent) => { // eslint-disable-line @typescript-eslint/no-unused-vars
      const selection = window.getSelection();
      if (!selection) return;
      const next = inspectSelection(selection);
      clearTimer();
      if (!next.visible) {
        hide();
        return;
      }
      showTimerRef.current = setTimeout(() => {
        showTimerRef.current = null;
        const sel = window.getSelection();
        if (!sel) return;
        const cur = inspectSelection(sel);
        if (cur.visible) setState({ text: cur.text, rect: cur.rect, visible: true });
        else hide();
      }, SHOW_DELAY_MS);
    };

    container.addEventListener("mouseup", handleMouseUp);
    return () => {
      container.removeEventListener("mouseup", handleMouseUp);
      clearTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef.current]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && stateRef.current.visible) {
        hide();
        window.getSelection()?.removeAllRanges();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      if (stateRef.current.visible) hide();
    };
    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ...state, hide };
}
