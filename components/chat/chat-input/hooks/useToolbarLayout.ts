"use client";

import { useEffect, useState } from "react";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import {
  INITIAL_TOOLBAR_LAYOUT,
  resolveToolbarLayout,
  type ToolbarLayout,
} from "@/lib/shared/toolbarLayout";

export interface ToolbarLayoutState {
  containerRef: React.RefObject<HTMLDivElement | null>;
  layout: ToolbarLayout;
  width: number | null;
}

export function useToolbarLayout(): ToolbarLayoutState {
  const { ref, width } = useContainerWidth<HTMLDivElement>();
  const [layout, setLayout] = useState<ToolbarLayout>(INITIAL_TOOLBAR_LAYOUT);

  useEffect(() => {
    if (width === null) return;
    setLayout((prev) => resolveToolbarLayout(width, prev));
  }, [width]);

  return { containerRef: ref, layout, width };
}
