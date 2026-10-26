"use client";

import { useEffect, useState } from "react";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import {
  INITIAL_TOOLBAR_LAYOUT,
  resolveToolbarLayout,
  type ToolbarLayout,
} from "@/lib/shared/toolbarLayout";

export interface ToolbarLayoutState {
  /** Attach to the toolbar's root element. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  layout: ToolbarLayout;
  /** Measured container width, `null` until the first measurement lands. */
  width: number | null;
}

/**
 * Measure the toolbar row and resolve its layout plan.
 *
 * The hysteresis (`prev`) lives here rather than in the toolbar: pending the
 * previous frame is the only way `resolveToolbarLayout` can tell "narrowing"
 * from "widening", and the plan itself stays a pure function of
 * `(width, prev)` as a result.
 *
 * `INITIAL_TOOLBAR_LAYOUT` is the fully expanded tier, which is what the
 * toolbar looks like today — so the first measured frame can only tighten,
 * never flash a row of bare icons.
 */
export function useToolbarLayout(): ToolbarLayoutState {
  const { ref, width } = useContainerWidth<HTMLDivElement>();
  const [layout, setLayout] = useState<ToolbarLayout>(INITIAL_TOOLBAR_LAYOUT);

  useEffect(() => {
    if (width === null) return;
    setLayout((prev) => resolveToolbarLayout(width, prev));
  }, [width]);

  return { containerRef: ref, layout, width };
}
