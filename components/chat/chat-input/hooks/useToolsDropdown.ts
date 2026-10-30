"use client";

import { useCallback, useRef, useState } from "react";

export interface UseToolsDropdownResult {
  toolDropdownOpen: boolean;
  customExpanded: boolean;
  toolDropdownRef: React.RefObject<HTMLDivElement | null>;
  setToolDropdownOpen: (open: boolean) => void;
  setCustomExpanded: (expanded: boolean | ((prev: boolean) => boolean)) => void;
  toggleCustomExpanded: (onFirstExpand?: () => void) => void;
}

export function useToolsDropdown(): UseToolsDropdownResult {
  const [toolDropdownOpen, setToolDropdownOpen] = useState(false);
  const [customExpanded, setCustomExpanded] = useState(false);
  const toolDropdownRef = useRef<HTMLDivElement>(null);

  const toggleCustomExpanded = useCallback((onFirstExpand?: () => void) => {
    setCustomExpanded((v) => {
      const next = !v;
      if (next && onFirstExpand) {
        onFirstExpand();
      }
      return next;
    });
  }, []);

  return {
    toolDropdownOpen,
    customExpanded,
    toolDropdownRef,
    setToolDropdownOpen,
    setCustomExpanded,
    toggleCustomExpanded,
  };
}