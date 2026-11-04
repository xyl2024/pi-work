"use client";

import type { ReactNode } from "react";
import { Clock } from "lucide-react";
import type { MainViewKind } from "@/lib/shared/mainView";

export const MAIN_VIEW_COMMAND_ICON_BY_KIND: Partial<Record<MainViewKind, ReactNode>> = {
  scheduler: <Clock size={16} />,
};
