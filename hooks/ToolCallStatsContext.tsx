"use client";

import { createContext, useContext, useCallback, useRef, type ReactNode } from "react";
import type { ToolCallEndReport, ToolCallStartReport } from "@/lib/shared/tool-call-stats-types";

// ── Event types ──
//
// The two lifecycle reports are declared once, in the shared layer, because the
// session reducer produces them as effects (see lib/shared/session-events.ts).
// Here they only gain the `timestamp` the adapter stamps when it performs the
// effect — the reducer cannot read a clock and stay pure.

export type ToolCallStartEvent = ToolCallStartReport & { timestamp: number };

export type ToolCallEndEvent = ToolCallEndReport & { timestamp: number };

export interface ToolCallStatsReset {
  type: "reset";
}

export type ToolCallStatsEvent = ToolCallStartEvent | ToolCallEndEvent | ToolCallStatsReset;

// ── Dispatch type ──

export type ToolCallStatsDispatch = (event: ToolCallStatsEvent) => void;

// ── Context ──

interface ToolCallStatsContextValue {
  /** Called by useAgentSession to emit events */
  emit: ToolCallStatsDispatch;
  /** Called once by useToolCallStats to register its listener */
  register: (fn: ToolCallStatsDispatch) => void;
}

const ToolCallStatsContext = createContext<ToolCallStatsContextValue | null>(null);

export function ToolCallStatsProvider({ children }: { children: ReactNode }) {
  const listenerRef = useRef<ToolCallStatsDispatch | null>(null);

  const emit: ToolCallStatsDispatch = useCallback((event: ToolCallStatsEvent) => {
    listenerRef.current?.(event);
  }, []);

  const register = useCallback((fn: ToolCallStatsDispatch) => {
    listenerRef.current = fn;
  }, []);

  return (
    <ToolCallStatsContext.Provider value={{ emit, register }}>
      {children}
    </ToolCallStatsContext.Provider>
  );
}

/** Call this from useAgentSession to push tool lifecycle events into the stats hook. */
export function useToolCallStatsEmit(): ToolCallStatsDispatch {
  const ctx = useContext(ToolCallStatsContext);
  // Return a no-op if not wrapped (safe to call unconditionally)
  return ctx?.emit ?? (() => {});
}

/** Call this once from useToolCallStats to register its internal dispatch. */
export function useToolCallStatsRegister(fn: ToolCallStatsDispatch): void {
  const ctx = useContext(ToolCallStatsContext);
  const registeredRef = useRef(false);
  if (ctx && !registeredRef.current) {
    ctx.register(fn);
    registeredRef.current = true;
  }
}
