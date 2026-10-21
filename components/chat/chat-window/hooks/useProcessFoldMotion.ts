"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  foldInsertsAbove,
  shouldAnimateFoldGrowth,
  type ProcessFoldState,
} from "@/lib/shared/process-fold";

/** The height transition the fold's body should run for the commit in flight. */
export type ProcessFoldMotion = "animate" | "instant";

export interface UseProcessFoldMotionResult {
  motion: ProcessFoldMotion;
  /**
   * Call right before committing a fold state change: it captures the scroll
   * anchor the commit needs and picks `instant` when rows are about to be
   * prepended to already-rendered content (a height transition there would
   * fight the per-frame scroll compensation).
   */
  beginTransition: (prev: ProcessFoldState, next: ProcessFoldState) => void;
}

interface UseProcessFoldMotionOptions {
  /** The fold group's root, used to find the scrolling ancestor. */
  rootRef: React.RefObject<HTMLElement | null>;
  /** The measured content box whose `scrollHeight` tracks the rendered rows. */
  contentRef: React.RefObject<HTMLElement | null>;
  /** The fold state the caller just committed. */
  state: ProcessFoldState;
  /** Rows this turn can show — the window arithmetic's input. */
  total: number;
}

interface PendingCommit {
  prev: ProcessFoldState;
  insertsAbove: boolean;
  scroller: HTMLElement | null;
  beforeContentHeight: number;
}

/**
 * The DOM half of the turn-fold: height motion and scroll anchoring. The rules
 * it applies live in `lib/shared/process-fold.ts`; this hook only measures,
 * compares and writes `scrollTop`.
 *
 * Two paths are deliberately different. Content that grows *below* the summary
 * row (collapsed → partial/full) may animate while it is short. Content
 * prepended *above* already-rendered rows (partial → more) must never animate:
 * it is compensated with `scrollTop += insertedHeight` in the layout phase, and
 * running a height transition at the same time would keep re-moving the anchor.
 * The fold body also opts out of browser scroll anchoring
 * (`overflow-anchor: none`), so only this compensation runs.
 */
export function useProcessFoldMotion({
  rootRef,
  contentRef,
  state,
  total,
}: UseProcessFoldMotionOptions): UseProcessFoldMotionResult {
  const [motion, setMotion] = useState<ProcessFoldMotion>("animate");
  const pendingRef = useRef<PendingCommit | null>(null);

  const beginTransition = useCallback(
    (prev: ProcessFoldState, next: ProcessFoldState) => {
      const insertsAbove = foldInsertsAbove(prev, next, total);
      pendingRef.current = {
        prev,
        insertsAbove,
        scroller: insertsAbove ? findScrollParent(rootRef.current) : null,
        beforeContentHeight: contentRef.current?.scrollHeight ?? 0,
      };
      setMotion(insertsAbove ? "instant" : "animate");
    },
    [contentRef, rootRef, total],
  );

  useLayoutEffect(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    const newContentHeight = contentRef.current?.scrollHeight ?? 0;

    if (
      motion === "animate" &&
      !shouldAnimateFoldGrowth(pending.prev, state, newContentHeight - pending.beforeContentHeight)
    ) {
      // Runs before paint, so the first painted frame is already the final
      // layout instead of the start of a long slide.
      setMotion("instant");
    }

    if (pending.insertsAbove && pending.scroller) {
      const inserted = newContentHeight - pending.beforeContentHeight;
      if (inserted > 0) pending.scroller.scrollTop += inserted;
    }
  }, [contentRef, motion, state]);

  return { motion, beginTransition };
}

/** The nearest scrolling ancestor; the chat scrollport is the only candidate
 *  in practice. */
function findScrollParent(node: HTMLElement | null): HTMLElement | null {
  let el = node?.parentElement ?? null;
  while (el) {
    if (/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}
