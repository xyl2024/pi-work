import { describe, expect, it } from "vitest";
import { modelDisplayName } from "@/lib/shared/model-display";

describe("modelDisplayName", () => {
  it("prefers the provider-qualified name", () => {
    expect(
      modelDisplayName(
        { "anthropic:claude-x": "Claude X", "claude-x": "Short" },
        "anthropic",
        "claude-x",
      ),
    ).toBe("Claude X");
  });

  it("falls back to the bare model id key", () => {
    expect(modelDisplayName({ "claude-x": "Short" }, "anthropic", "claude-x")).toBe("Short");
  });

  it("falls back to the raw model id when the name is unknown", () => {
    expect(modelDisplayName({}, "anthropic", "claude-x")).toBe("claude-x");
    expect(modelDisplayName(undefined, "anthropic", "claude-x")).toBe("claude-x");
  });

  it("looks up the bare key when the provider is missing", () => {
    expect(modelDisplayName({ "claude-x": "Short" }, undefined, "claude-x")).toBe("Short");
  });
});
