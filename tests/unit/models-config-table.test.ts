import { describe, expect, it } from "vitest";
import {
  formatContextWindow,
  formatModelPrice,
  modelCapabilities,
  modelTableRow,
  runtimeModelTableItems,
} from "@/lib/shared/models-config-table";

describe("formatContextWindow", () => {
  it("renders a million tokens as a rounded million label", () => {
    expect(formatContextWindow(1_000_000)).toBe("1M");
    expect(formatContextWindow(1_048_576)).toBe("1M");
    expect(formatContextWindow(2_500_000)).toBe("2.5M");
  });

  it("renders thousands as a rounded thousand label", () => {
    expect(formatContextWindow(200_000)).toBe("200K");
    expect(formatContextWindow(128_000)).toBe("128K");
    expect(formatContextWindow(1_500)).toBe("1.5K");
  });

  it("keeps small windows as plain numbers", () => {
    expect(formatContextWindow(512)).toBe("512");
    expect(formatContextWindow(8192)).toBe("8.2K");
  });

  it("marks a missing or nonsensical window as unknown", () => {
    expect(formatContextWindow(undefined)).toBe("—");
    expect(formatContextWindow(null)).toBe("—");
    expect(formatContextWindow(0)).toBe("—");
    expect(formatContextWindow(Number.NaN)).toBe("—");
  });
});

describe("formatModelPrice", () => {
  it("renders dollars per million tokens without noise", () => {
    expect(formatModelPrice(3)).toBe("$3");
    expect(formatModelPrice(0.075)).toBe("$0.075");
    expect(formatModelPrice(15.5)).toBe("$15.5");
  });

  it("distinguishes a free model from a missing price", () => {
    expect(formatModelPrice(0)).toBe("$0");
    expect(formatModelPrice(undefined)).toBe("—");
    expect(formatModelPrice(Number.NaN)).toBe("—");
  });
});

describe("modelCapabilities", () => {
  it("lists the capabilities a model declares", () => {
    expect(
      modelCapabilities({ id: "m", reasoning: true, input: ["text", "image"], api: "openai-responses" }),
    ).toEqual(["Reasoning", "Image input", "API override"]);
  });

  it("is empty for a model with no declared capability", () => {
    expect(modelCapabilities({ id: "m" })).toEqual([]);
    expect(modelCapabilities({ id: "m", input: ["text"], api: "   " })).toEqual([]);
  });
});

describe("runtimeModelTableItems", () => {
  const models = [
    { id: "claude-sonnet-4", name: "Claude Sonnet 4", provider: "anthropic", contextWindow: 200_000, cost: { input: 3, output: 15 } },
    { id: "gpt-4o", name: "GPT-4o", provider: "openai", contextWindow: 128_000, cost: { input: 2.5, output: 10 } },
    { id: "claude-haiku-3", name: "Claude Haiku 3", provider: "anthropic", contextWindow: 200_000, cost: { input: 0.25, output: 1.25 } },
  ];

  it("keeps only the models of the asked provider, in catalog order", () => {
    expect(runtimeModelTableItems(models, "anthropic").map((item) => item.model.id)).toEqual([
      "claude-sonnet-4",
      "claude-haiku-3",
    ]);
  });

  it("is empty for a provider that contributes no model", () => {
    expect(runtimeModelTableItems(models, "google")).toEqual([]);
    expect(runtimeModelTableItems([], "anthropic")).toEqual([]);
  });

  it("gives every row its own key even when a provider repeats a model id", () => {
    const duplicated = [
      { id: "m", provider: "p" },
      { id: "m", provider: "p" },
      { id: "m", provider: "q" },
    ];
    const keys = runtimeModelTableItems(duplicated, "p").map((item) => item.key);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });
});

describe("modelTableRow", () => {
  it("shows the display name with the id underneath", () => {
    expect(modelTableRow({ id: "claude-3-5-sonnet", name: "Claude Sonnet 3.5" })).toEqual({
      title: "Claude Sonnet 3.5",
      subtitle: "claude-3-5-sonnet",
      capabilities: [],
      context: "—",
      inputPrice: "—",
      outputPrice: "—",
    });
  });

  it("falls back to the id when the model has no name", () => {
    expect(modelTableRow({ id: "gpt-4o" })).toMatchObject({ title: "gpt-4o", subtitle: null });
  });

  it("does not repeat the id when it is already the title", () => {
    expect(modelTableRow({ id: "gpt-4o", name: "gpt-4o" })).toMatchObject({
      title: "gpt-4o",
      subtitle: null,
    });
  });

  it("ignores a blank display name", () => {
    expect(modelTableRow({ id: "gpt-4o", name: "   " })).toMatchObject({
      title: "gpt-4o",
      subtitle: null,
    });
  });

  it("carries context and input / output prices into the row", () => {
    expect(
      modelTableRow({
        id: "gpt-4o",
        contextWindow: 128_000,
        cost: { input: 2.5, output: 10, cacheRead: 1, cacheWrite: 0 },
      }),
    ).toMatchObject({ context: "128K", inputPrice: "$2.5", outputPrice: "$10" });
  });
});
