"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  foldInsertsAbove,
  shouldAnimateFoldGrowth,
  type ProcessFoldState,
} from "@/lib/shared/process-fold";

export type ProcessFoldMotion = "animate" | "instant";

export interface UseProcessFoldMotionResult {
  motion: ProcessFoldMotion;
  beginTransition: (prev: ProcessFoldState, next: ProcessFoldState) => void;
}

interface UseProcessFoldMotionOptions {
  rootRef: React.RefObject<HTMLElement | null>;
  contentRef: React.RefObject<HTMLElement | null>;
  state: ProcessFoldState;
  total: number;
}

interface PendingCommit {
  prev: ProcessFoldState;
  insertsAbove: boolean;
  scroller: HTMLElement | null;
  beforeContentHeight: number;
}

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
      setMotion("instant");
    }

    if (pending.insertsAbove && pending.scroller) {
      const inserted = newContentHeight - pending.beforeContentHeight;
      if (inserted > 0) pending.scroller.scrollTop += inserted;
    }
  }, [contentRef, motion, state]);

  return { motion, beginTransition };
}

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
