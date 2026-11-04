"use client";

import type { ReactNode } from "react";
import { Clock, SlidersHorizontal, Wrench } from "lucide-react";
import { GlobeIcon } from "@/components/ui/icons";
import type { MainViewKind } from "@/lib/shared/mainView";

const MAIN_VIEW_ICON_BY_KIND: { [K in MainViewKind]: (props: { size: number }) => ReactNode } = {
  scheduler: ({ size }) => <Clock size={size} />,
  modelsConfig: ({ size }) => <SlidersHorizontal size={size} />,
  skills: ({ size }) => <Wrench size={size} />,
  channels: ({ size }) => <GlobeIcon width={size} height={size} />,
};

function iconsOfSize(size: number): Partial<Record<MainViewKind, ReactNode>> {
  const icons: Partial<Record<MainViewKind, ReactNode>> = {};
  for (const kind of Object.keys(MAIN_VIEW_ICON_BY_KIND) as MainViewKind[]) {
    const Icon = MAIN_VIEW_ICON_BY_KIND[kind];
    icons[kind] = <Icon size={size} />;
  }
  return icons;
}

export const MAIN_VIEW_COMMAND_ICON_BY_KIND = iconsOfSize(16);
export const MAIN_VIEW_NAV_ICON_BY_KIND = iconsOfSize(12);
