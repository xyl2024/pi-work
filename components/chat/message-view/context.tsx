"use client";

import { createContext, useContext } from "react";

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
