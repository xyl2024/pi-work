import { describe, expect, it } from "vitest";
import { rankSlashResources, type SlashResource } from "@/lib/shared/slash-commands";

const skill = (name: string, description = ""): SlashResource => ({
  source: "skill",
  name,
  command: `skill:${name}`,
  description,
  path: "",
});

const names = (items: SlashResource[]): string[] => items.map((item) => item.name);

describe("rankSlashResources", () => {
  it("ranks a command match above description-only matches", () => {
    const resources = [
      skill("code-review", "Review the changes since a fixed point"),
      skill("implement", "Implement a piece of work based on a spec"),
      skill("implement-spec", "Implement the result of /to-spec"),
      skill("loop-me", "Grill me about specs"),
      skill("retro", "Conduct a retrospective"),
    ];

    expect(names(rankSlashResources(resources, "spec"))[0]).toBe("implement-spec");
  });

  it("prefers shorter commands when both share a prefix", () => {
    const resources = [skill("implement-spec"), skill("implement")];
    expect(names(rankSlashResources(resources, "implement"))).toEqual(["implement", "implement-spec"]);
  });

  it("drops resources that match nothing", () => {
    const resources = [skill("retro", "Conduct a retrospective"), skill("spec-report")];
    expect(names(rankSlashResources(resources, "zzz"))).toEqual([]);
    expect(names(rankSlashResources(resources, "spec"))).toEqual(["spec-report", "retro"]);
  });

  it("keeps the input order for an empty query", () => {
    const resources = [skill("retro"), skill("code-review")];
    expect(names(rankSlashResources(resources, ""))).toEqual(["retro", "code-review"]);
  });
});
