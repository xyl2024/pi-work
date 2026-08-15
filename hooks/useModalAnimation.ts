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
        setPhase("entering");
        const raf = requestAnimationFrame(() => {
          // Guard: if the modal was already closed again before the rAF
          // fired (rapid open/close click), skip the open transition.
          if (phaseRef.current === "entering") setPhase("open");
        });
        return () => cancelAnimationFrame(raf);
      }
      if (phaseRef.current === "entering") {
        const raf = requestAnimationFrame(() => {
          if (phaseRef.current === "entering") setPhase("open");
        });
        return () => cancelAnimationFrame(raf);
      }
      return undefined;
    }

    // !isOpen
    if (phaseRef.current === "open" || phaseRef.current === "entering") {
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
  }, [isOpen, durationMs]);

  // Cleanup any pending close timer when the modal unmounts entirely.
  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const requestClose = useCallback(() => {
    // Only act from "open" — repeats while animating are no-ops, and
    // before "open" the panel isn't interactive yet anyway.
    if (phaseRef.current !== "open") return;
    if (shouldConfirm) {
      const result = shouldConfirm();
      if (result === false) return;
      if (typeof result === "string" && !window.confirm(result)) return;
    }
    setPhase("leaving");
    if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
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