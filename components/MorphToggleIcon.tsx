"use client";

/**
 * MorphToggleIcon — a stroke-based icon that springs between two `d` shapes
 * when `active` flips.
 *
 * Wraps `useIconMorph` so call sites pass `from`/`to`/`active` and get back
 * a drop-in <svg>. Defaults match the Lucide 24-grid stroke style (size 16,
 * stroke-width 2, snappy spring) used across pi-work's top bars.
 *
 * Usage:
 *   <MorphToggleIcon from={MENU} to={PANEL_LEFT} active={sidebarOpen} />
 *   <MorphToggleIcon from={DOWNLOAD} to={LOADER} active={isExporting} size={12} />
 */

import { useIconMorph, type IconMorphOptions } from "@/hooks/useIconMorph";

export interface MorphToggleIconProps extends IconMorphOptions {
  from: string;
  to: string;
  active: boolean;
}

export function MorphToggleIcon({ from, to, active, ...rest }: MorphToggleIconProps) {
  const { svgProps, pathProps } = useIconMorph(from, to, active, rest);
  return (
    <svg {...svgProps}>
      <path {...pathProps} />
    </svg>
  );
}