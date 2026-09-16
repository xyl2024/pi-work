// The one-tap anchor choices, shared by the create chips and the row's
// re-schedule menu so the two can never drift apart. Labels are i18n keys
// resolved by the caller (`t(...)`); the values are the domain's
// `PlanAnchorChoice`, resolved to a real anchor against the browser's today.
import type { PlanAnchorChoice } from "@/lib/shared/plans";

/** Chip order, left to right. */
export const ANCHOR_CHOICES: readonly PlanAnchorChoice[] = [
  "inbox",
  "today",
  "tomorrow",
  "week",
  "month",
];

export const ANCHOR_CHOICE_LABEL_KEY: Record<PlanAnchorChoice, string> = {
  inbox: "plans.inbox",
  today: "Today",
  tomorrow: "Tomorrow",
  week: "plans.week",
  month: "plans.month",
};
