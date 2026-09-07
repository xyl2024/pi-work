"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Modal open/close animation hook.
 *
 * Encapsulates the same animation as the SettingsModal animation:
 *   - backdrop fades in/out (background-color + opacity)
 *   - panel slides + scales in/out (opacity + transform)
 * with an `entering → open → leaving → closed` state machine driven by
 * CSS `transition`. The animation only fires when the styles actually
 * change — React commits the "entering" styles first, then a
 * `requestAnimationFrame` flips to "open", and the browser runs the
 * transition between the two.
 *
 * Supports two parent-side usage patterns via the single `isOpen` flag:
 *
 *   1. **Conditional mount** — the parent renders `{open && <Modal onClose={...} />}`.
 *      Pass `isOpen: true`. The hook drives the entering animation on mount,
 *      and `requestClose` sets the leaving animation and calls `onClose`
 *      after it finishes (which unmounts the modal).
 *
 *   2. **Controlled visibility** — the parent renders `<Modal open={isOpen} onClose={...} />`
 *      unconditionally and the modal decides internally when to render.
 *      Pass the `open` prop. The hook animates both open and close
 *      transitions, and exposes `isVisible` so the modal can early-return
 *      `null` before the first open and after the leaving animation ends.
 *
 * Use `shouldConfirm` to gate the close on a confirm prompt (e.g. dirty
 * forms). Return `false` to abort, `true` to close without a prompt, or
 * a string to use as the `window.confirm` message.
 */

export type ModalPhase = "entering" | "open" | "leaving" | "closed";

export type ShouldConfirmFn = () => boolean | string;

export type UseModalAnimationOptions = {
  /** Whether the parent says the modal should be visible right now. See file
   *  comment for the two supported parent-side patterns. */
  isOpen: boolean;
  /** Parent hook to flip its open state to false. For conditional-mount
   *  modals this also unmounts the modal. */
  onClose: () => void;
  /** Optional pre-close guard. See file comment. */
  shouldConfirm?: ShouldConfirmFn;
  /** Animation duration in ms. Default 220. */
  durationMs?: number;
  /** Backdrop alpha (0–1). Default 0.35 — set higher (e.g. 0.55) for
   *  immersive modals that pair with a backdrop blur. */
  backdropAlpha?: number;
};

export type UseModalAnimationReturn = {
  phase: ModalPhase;
  /** Drop-in replacement for direct `onClose` calls. Plays the leaving
   *  animation before invoking `onClose`, and respects `shouldConfirm`. */
  requestClose: () => void;
  /** Spread onto the fullscreen backdrop `<div>`. */
  backdropStyle: React.CSSProperties;
  /** Spread onto the modal panel `<div>` (compose with your own layout
   *  styles). */
  panelStyle: React.CSSProperties;
  /** True iff the modal should currently be in the DOM. Only useful for
   *  controlled-visibility modals (pattern #2). */
  isVisible: boolean;
};

const DEFAULT_DURATION_MS = 220;
const ENTER_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";

function buildStyles(
  phase: ModalPhase,
  durationMs: number,
  backdropAlpha: number,
): {
  backdropStyle: React.CSSProperties;
  panelStyle: React.CSSProperties;
} {
  const isOpen = phase === "open";
  return {
    backdropStyle: {
      position: "fixed",
      inset: 0,
      zIndex: 1000,
      background: isOpen ? `rgba(0,0,0,${backdropAlpha})` : "rgba(0,0,0,0)",
      opacity: isOpen ? 1 : 0,
      transition: `background-color ${durationMs}ms ease, opacity ${durationMs}ms ease`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    },
    panelStyle: {
      opacity: isOpen ? 1 : 0,
      transform: isOpen
        ? "translateY(0) scale(1)"
        : "translateY(8px) scale(0.96)",
      transition: `opacity ${durationMs}ms ease, transform ${durationMs}ms ${ENTER_EASING}`,
    },
  };
}

export function useModalAnimation({
  isOpen,
  onClose,
  shouldConfirm,
  durationMs = DEFAULT_DURATION_MS,
  backdropAlpha = 0.35,
}: UseModalAnimationOptions): UseModalAnimationReturn {
  const [phase, setPhase] = useState<ModalPhase>(
    isOpen ? "entering" : "closed",
  );
  const phaseRef = useRef<ModalPhase>(phase);
  phaseRef.current = phase;
  const closeTimerRef = useRef<number | null>(null);
  // Pending rAF that flips "entering" → "open". Kept in a ref so the
  // retry loop (see scheduleOpenFlip) can be cancelled by a later close.
  const openFlipRafRef = useRef<number | null>(null);

  // Flip "entering" → "open" one frame after the entering styles commit,
  // so the browser paints the entering styles before the transition starts.
  //
  // This is NOT a plain one-shot rAF. The `setPhase("entering")` that the
  // caller just issued is processed by React's scheduler (a macrotask), and
  // a busy page — e.g. the sidebar's always-on GrokBot 60fps rAF loop — can
  // push the browser's next "update the rendering" step (which runs rAF
  // callbacks) AHEAD of that macrotask. A one-shot rAF would then fire while
  // `phaseRef.current` is still the pre-commit value, its guard would skip
  // the flip, and nothing would ever reschedule it: the modal strands at
  // "entering" as an invisible (opacity 0) fullscreen backdrop that swallows
  // every click. So the callback retries frame-by-frame until the entering
  // commit lands; after a generous cap it gives up silently rather than
  // fighting a close that has already started.
  const scheduleOpenFlip = useCallback(() => {
    if (openFlipRafRef.current !== null) cancelAnimationFrame(openFlipRafRef.current);
    let attempts = 0;
    const tick = () => {
      openFlipRafRef.current = null;
      const current = phaseRef.current;
      if (current === "entering") {
        setPhase("open");
        return;
      }
      if (current === "closed" || current === "leaving") {
        // Entering commit not landed yet (or a close raced in) — retry,
        // bounded so a stray loop can't outlive a real close.
        attempts += 1;
        if (attempts <= 120) openFlipRafRef.current = requestAnimationFrame(tick);
      }
      // current === "open": already flipped by an earlier tick.
    };
    openFlipRafRef.current = requestAnimationFrame(tick);
  }, []);

  const cancelOpenFlip = useCallback(() => {
    if (openFlipRafRef.current !== null) {
      cancelAnimationFrame(openFlipRafRef.current);
      openFlipRafRef.current = null;
    }
  }, []);

  // Sync isOpen → phase across mount, open, and close edges.
  //
  // Mount case (isOpen=true on first render): initial state is "entering",
  // we schedule a rAF that flips to "open" so the browser paints the
  // entering styles before the target styles commit.
  //
  // Open edge (closed/leaving → entering → open): same rAF pattern.
  //
  // Close edge (open/entering → leaving → closed): setTimeout flips to
  // "closed" after the animation finishes so `isVisible` becomes false
  // and the parent can short-circuit rendering.
  useEffect(() => {
    if (isOpen) {
      if (phaseRef.current === "closed" || phaseRef.current === "leaving") {
        // Reopening while a close is still in flight: cancel the pending
        // close timer, otherwise it fires mid-reopen and yanks the modal
        // closed again (stray onClose + vanished modal).
        if (closeTimerRef.current !== null) {
          clearTimeout(closeTimerRef.current);
          closeTimerRef.current = null;
        }
        setPhase("entering");
        scheduleOpenFlip();
        return;
      }
      if (phaseRef.current === "entering") {
        scheduleOpenFlip();
      }
      return;
    }

    // !isOpen — drive the close from any live phase (open / entering /
    // leaving). A pending open flip must die with the close, otherwise its
    // retry could flip the modal back open mid-close. Re-scheduling on "leaving" is deliberate: if this effect
    // re-runs while a close is already animating (e.g. the parent flipped
    // `open` again mid-close), the previous run's cleanup clears the timer,
    // and without a re-schedule here the phase would strand at "leaving"
    // forever — leaving an invisible fullscreen backdrop that swallows
    // every click on the page. Always keeping one timer alive guarantees
    // the phase terminates at "closed".
    if (
      phaseRef.current === "open" ||
      phaseRef.current === "entering" ||
      phaseRef.current === "leaving"
    ) {
      setPhase("leaving");
      if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
      closeTimerRef.current = window.setTimeout(() => {
        setPhase("closed");
        closeTimerRef.current = null;
      }, durationMs);
      return () => {
        if (closeTimerRef.current !== null) {
          clearTimeout(closeTimerRef.current);
          closeTimerRef.current = null;
        }
      };
    }
    return undefined;
  }, [isOpen, durationMs, scheduleOpenFlip, cancelOpenFlip]);

  // Cleanup any pending close timer / open flip when the modal unmounts.
  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
      cancelOpenFlip();
    };
  }, [cancelOpenFlip]);

  const requestClose = useCallback(() => {
    // Act from "open" AND "entering" — the latter matters because a click
    // can land on the backdrop within the first animation frame window;
    // no-op'ing there would strand an invisible backdrop that swallows
    // clicks and can never be dismissed. Repeats while already leaving
    // are no-ops.
    if (phaseRef.current !== "open" && phaseRef.current !== "entering") return;
    if (shouldConfirm) {
      const result = shouldConfirm();
      if (result === false) return;
      if (typeof result === "string" && !window.confirm(result)) return;
    }
    setPhase("leaving");
    if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      // Push phase to "closed" BEFORE calling onClose. For controlled-
      // visibility modals the `isOpen` flip triggers our own useEffect,
      // which only starts the close timer when phase is "open"/"entering".
      // Since requestClose has already set phase to "leaving", that effect
      // becomes a no-op and the modal would stay mounted forever — which
      // leaves a backdrop blocking the whole page. Setting "closed" here
      // ourselves guarantees `isVisible` flips to false and the modal
      // unmounts regardless of which branch the useEffect ends up taking.
      setPhase("closed");
      onClose();
      closeTimerRef.current = null;
    }, durationMs);
  }, [onClose, shouldConfirm, durationMs]);

  const { backdropStyle, panelStyle } = buildStyles(phase, durationMs, backdropAlpha);

  return {
    phase,
    requestClose,
    backdropStyle,
    panelStyle,
    isVisible: phase !== "closed",
  };
}