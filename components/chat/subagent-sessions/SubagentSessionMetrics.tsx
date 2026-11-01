"use client";

import type { SubagentSessionStatsView } from "@/lib/shared/types";

export interface SubagentSessionMetricsProps {
  stats: SubagentSessionStatsView | null;
}

export function SubagentSessionMetrics(props: SubagentSessionMetricsProps) {
  void props;
  return null;
}
