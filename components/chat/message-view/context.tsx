"use client";

import { createContext, useContext } from "react";

const CollapseNonceContext = createContext(0);

export const CollapseNonceProvider = CollapseNonceContext.Provider;

export function useCollapseNonce(): number {
  return useContext(CollapseNonceContext);
}
