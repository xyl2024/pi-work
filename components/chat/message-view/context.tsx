"use client";

import { createContext, useContext } from "react";
import type { MessageCallMetrics } from "@/lib/shared/token-audit-types";

const CollapseNonceContext = createContext(0);

export const CollapseNonceProvider = CollapseNonceContext.Provider;

export function useCollapseNonce(): number {
  return useContext(CollapseNonceContext);
}

export interface FileLinkHandler {
  openFile: (filePath: string, fileName: string) => void;
  cwd?: string | null;
}

const FileLinkContext = createContext<FileLinkHandler | null>(null);

export const FileLinkProvider = FileLinkContext.Provider;

export function useFileLinkHandler(): FileLinkHandler | null {
  return useContext(FileLinkContext);
}

const MessageCallMetricsContext = createContext<ReadonlyMap<string, MessageCallMetrics> | null>(null);

export const MessageCallMetricsProvider = MessageCallMetricsContext.Provider;

export function useMessageCallMetrics(messageId?: string | number | null): MessageCallMetrics | null {
  const metrics = useContext(MessageCallMetricsContext);
  if (!metrics || messageId === undefined || messageId === null) return null;
  return metrics.get(String(messageId)) ?? null;
}
