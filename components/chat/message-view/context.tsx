"use client";

import { createContext, useContext } from "react";
import type { MessageCallMetrics } from "@/lib/shared/token-audit-types";

const CollapseNonceContext = createContext(0);

export const CollapseNonceProvider = CollapseNonceContext.Provider;

export function useCollapseNonce(): number {
  return useContext(CollapseNonceContext);
}

/**
 * Opens a file in the right panel. Provided around rendered chat messages so
 * the markdown link renderer can turn bare file paths (`[a.ts](src/a.ts)`)
 * into panel opens — see `lib/shared/file-link.ts` for the rule. Outside the
 * provider (scheduler / skill markdown) links keep their native behaviour.
 */
export interface FileLinkHandler {
  openFile: (filePath: string, fileName: string) => void;
  /** Session cwd used to anchor relative hrefs. */
  cwd?: string | null;
}

const FileLinkContext = createContext<FileLinkHandler | null>(null);

export const FileLinkProvider = FileLinkContext.Provider;

export function useFileLinkHandler(): FileLinkHandler | null {
  return useContext(FileLinkContext);
}

/**
 * TTFT / TPS of every recorded call in the session, keyed by message id.
 *
 * Context rather than a prop: the map arrives asynchronously, often after the
 * history is already rendered, and `MessageView` / `AssistantMessageView` are
 * memoized on their props — context is the one update path that reaches them
 * without invalidating those memo boundaries.
 */
const MessageCallMetricsContext = createContext<ReadonlyMap<string, MessageCallMetrics> | null>(null);

export const MessageCallMetricsProvider = MessageCallMetricsContext.Provider;

/** Metrics for one assistant message, or `null` when none were recorded. */
export function useMessageCallMetrics(messageId?: string | number | null): MessageCallMetrics | null {
  const metrics = useContext(MessageCallMetricsContext);
  if (!metrics || messageId === undefined || messageId === null) return null;
  return metrics.get(String(messageId)) ?? null;
}
