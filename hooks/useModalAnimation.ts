"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ModalPhase = "entering" | "open" | "leaving" | "closed";

export type ShouldConfirmFn = () => boolean | string;

export type UseModalAnimationOptions = {
  isOpen: boolean;
  onClose: () => void;
  shouldConfirm?: ShouldConfirmFn;
  durationMs?: number;
  backdropAlpha?: number;
};

export type UseModalAnimationReturn = {
  phase: ModalPhase;
  requestClose: () => void;
  backdropStyle: React.CSSProperties;
  panelStyle: React.CSSProperties;
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
  const openFlipRafRef = useRef<number | null>(null);

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
        attempts += 1;
        if (attempts <= 120) openFlipRafRef.current = requestAnimationFrame(tick);
      }
    };
    openFlipRafRef.current = requestAnimationFrame(tick);
  }, []);

  const cancelOpenFlip = useCallback(() => {
    if (openFlipRafRef.current !== null) {
      cancelAnimationFrame(openFlipRafRef.current);
      openFlipRafRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      if (phaseRef.current === "closed" || phaseRef.current === "leaving") {
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

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
      cancelOpenFlip();
    };
  }, [cancelOpenFlip]);

  const requestClose = useCallback(() => {
    if (phaseRef.current !== "open" && phaseRef.current !== "entering") return;
    if (shouldConfirm) {
      const result = shouldConfirm();
      if (result === false) return;
      if (typeof result === "string" && !window.confirm(result)) return;
    }
    setPhase("leaving");
    if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
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