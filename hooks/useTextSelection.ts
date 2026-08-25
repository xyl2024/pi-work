"use client";

import { useEffect, useRef, useState } from "react";

export interface TextSelectionRect {
  /** Viewport-space bounding rect of the topmost row of the selection. */
  top: number;
  /** Viewport-space center x of the topmost row. */
  centerX: number;
  width: number;
}

export interface TextSelectionState {
  /** Selected plain text. Empty when no usable selection. */
  text: string;
  /** Viewport-space rect to anchor the toolbar against. */
  rect: TextSelectionRect | null;
  /** True when the selection satisfies the size threshold and lives
   *  inside the registered container — i.e. the toolbar should be shown. */
  visible: boolean;
}

const SHOW_DELAY_MS = 250;
const MIN_CHARS = 2;

const EMPTY_STATE: TextSelectionState = {
  text: "",
  rect: null,
  visible: false,
};

/**
 * Track a text selection that lives inside a single container element.
 *
 * Scoping the listener to the container (rather than `window`) keeps the
 * sidebar, file viewer, right panel, and chat input from accidentally
 * triggering the toolbar. The hook owns all of the dismissal logic
 * (ESC / scroll / outside-mousedown) so the toolbar component is a
 * pure renderer over `state`.
 */
export function useTextSelection(containerRef: React.RefObject<HTMLElement | null>) {
  const [state, setState] = useState<TextSelectionState>(EMPTY_STATE);
  // Latest state in a ref so the document-level listeners (mousedown,
  // keydown, scroll) can read it without re-binding on every state change.
  const stateRef = useRef<TextSelectionState>(EMPTY_STATE);
  stateRef.current = state;

  // Hold the pending show-timer so a rapid re-selection can cancel the
  // previous one before it fires.
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

  /** Compute the viewport rect for the topmost row of the current
   *  selection, or null if the selection no longer resolves to a
   *  Range. */
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

  /** Decide whether the selection lives inside the chat container and
   *  satisfies the size threshold. The container check uses the
   *  `anchorNode` so a selection that starts inside the container but
   *  drags out is still shown — the user clearly *began* in chat. */
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

  // ── mouseup on the container: schedule the toolbar ───────────────────
  // The container-scoped listener means only mouseups inside the chat
  // message area count — mouseups in the chat input, sidebar, or right
  // panel are ignored. The 250ms delay prevents the toolbar from
  // popping in for a transient "I'm just clicking through" gesture.
  //
  // We deliberately do NOT add a document-level mousedown listener:
  // that listener would fire for every mousedown in the app and
  // (more importantly) would race with the floating toolbar's own
  // button clicks — the toolbar's onMouseDown stops propagation, but
  // cross-tree native listeners and React event-delegation boundaries
  // make that race fragile. Instead, the container's `mouseup` is the
  // single source of truth for "is there a new selection in chat?":
  // any selection the user makes is replaced atomically by the next
  // mouseup, so a stale toolbar naturally re-evaluates.
  //
  // The effect depends on `containerRef.current` (read fresh on every
  // render) rather than the ref object itself. ChatWindowContent has
  // early returns for loading / error states, so the first commit may
  // render without the scroll container being mounted — ref.current is
  // null and the effect bails. When the session finishes loading and
  // the container actually mounts, ref.current becomes the real div,
  // this re-renders, and the effect re-runs to attach the listener.
  // Depending on the ref *object* (which is stable across renders)
  // would have left the listener bound to nothing.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseUp = (_e: MouseEvent) => { // eslint-disable-line @typescript-eslint/no-unused-vars
      const selection = window.getSelection();
      if (!selection) return;
      const next = inspectSelection(selection);
      // Always reset the previous show-timer so the toolbar never
      // appears for a *stale* selection that the user has already
      // replaced.
      clearTimer();
      if (!next.visible) {
        // A genuine empty/short re-selection should hide the toolbar
        // immediately rather than wait out the delay.
        hide();
        return;
      }
      showTimerRef.current = setTimeout(() => {
        showTimerRef.current = null;
        // Re-read selection at fire time: the user may have moved on.
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

  // ── ESC: hide + clear the underlying selection so the browser's
  //    native highlight goes away with the toolbar. ─────────────────────
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

  // ── scroll anywhere: hide ──────────────────────────────────────────────
  // Scrolling the chat moves the selection off-screen, so a fixed
  // toolbar would either (a) track the selection via repeated reads
  // (jittery + burns layout work on every scroll tick) or (b) stay
  // put and float over unrelated content. Hiding is the simpler
  // answer that matches Notion / Medium behaviour. The capture phase
  // catches scroll events bubbling from any nested container (e.g.
  // the file viewer's internal scroll).
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
