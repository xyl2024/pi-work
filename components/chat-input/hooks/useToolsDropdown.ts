"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface UseToolsDropdownResult {
  /** Whether the tools preset dropdown is open. */
  toolDropdownOpen: boolean;
  /** Custom row's expand/collapse state. Sticky within the popover's open
   *  session — collapsing on every outside click would be annoying since
   *  the user frequently toggles a checkbox, clicks outside to close the
   *  popover, then re-opens it to confirm. Collapses when the user picks
   *  Off/High (those rows auto-close the popover, so this state only
   *  persists across open/close cycles within "Custom"). */
  customExpanded: boolean;
  /** Attach to the dropdown wrapper `<div>` so outside-click detection can
   *  tell whether a click landed inside the popover. */
  toolDropdownRef: React.RefObject<HTMLDivElement | null>;
  setToolDropdownOpen: (open: boolean) => void;
  setCustomExpanded: (expanded: boolean | ((prev: boolean) => boolean)) => void;
  /** Flip `customExpanded`; the first time it expands to true, lazily fires
   *  `onFirstExpand` to trigger the tool catalog fetch. Subsequent opens
   *  reuse the in-memory catalog, so `onFirstExpand` is only called once. */
  toggleCustomExpanded: (onFirstExpand?: () => void) => void;
}

/**
 * State + outside-click dismissal for the tools preset dropdown. The
 * dropdown owns only two pieces of state (`open` and `customExpanded`);
 * the lazy "first expand" fetch is parameterised so the hook stays free
 * of any catalog-fetching dependency.
 */
export function useToolsDropdown(): UseToolsDropdownResult {
  const [toolDropdownOpen, setToolDropdownOpen] = useState(false);
  const [customExpanded, setCustomExpanded] = useState(false);
  const toolDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click. The model picker manages its own
  // outside-click dismissal internally (see ModelPicker).
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (toolDropdownRef.current && !toolDropdownRef.current.contains(e.target as Node)) {
        setToolDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggleCustomExpanded = useCallback((onFirstExpand?: () => void) => {
    setCustomExpanded((v) => {
      const next = !v;
      // First expansion triggers the catalog fetch. After that, the
      // in-memory catalog is reused for the rest of the session —
      // `ensureAvailableTools` is a no-op when the catalog is non-empty.
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