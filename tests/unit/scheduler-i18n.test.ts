import { describe, expect, it } from "vitest";
import { EN_TRANSLATIONS, ZH_TRANSLATIONS } from "@/lib/shared/i18n-dict";

const RETIRED_KEYS = [
  "Config",
  "Here is the task's current execution config. Click modify to jump to the edit form.",
  "Modify config",
  "Select a task from the list on the left",
  "or create a new task",
  "Basic info",
  "Runs history",
  "Runs",
  "View runs",
  "Copy output",
  "Prompt (sent to agent at trigger time)",
  "Concise description, e.g. daily report",
  "Full prompt sent to agent at trigger time",
  "The cwd the agent runs in; must exist",
  "Scheduler field required",
  "all: all tools, none: chat only, custom: comma-separated tool names",
  "Cron examples hint",
  "Max lifetime hint",
  "Timezone hint",
  "Select a run to see its output",
] as const;

describe("scheduler main-view copy", () => {
  it("has Chinese copy for the master-detail empty state", () => {
    expect((ZH_TRANSLATIONS as Record<string, string>)["Select a task to see its details"]).toBeTruthy();
  });

  it("no longer defines copy retired with the tab and split-pane layouts", () => {
    const zh = ZH_TRANSLATIONS as Record<string, string>;
    const en = EN_TRANSLATIONS as Record<string, string>;
    for (const key of RETIRED_KEYS) {
      expect(zh[key]).toBeUndefined();
      expect(en[key]).toBeUndefined();
    }
  });
});
