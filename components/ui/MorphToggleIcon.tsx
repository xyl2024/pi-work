"use client";

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