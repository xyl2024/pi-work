import { describe, expect, it } from "vitest";
import {
  advancedSettingEntries,
  advancedSettingValueText,
  parseAdvancedSettingValue,
  withAdvancedSettingValue,
} from "@/lib/shared/models-config-advanced";

describe("advancedSettingEntries", () => {
  it("is empty without a record", () => {
    expect(advancedSettingEntries(undefined)).toEqual([]);
    expect(advancedSettingEntries({})).toEqual([]);
  });

  it("lists every configured key in sorted order", () => {
    expect(advancedSettingEntries({ zeta: true, alpha: "on" })).toEqual([
      { key: "alpha", value: "on" },
      { key: "zeta", value: "true" },
    ]);
  });
});

describe("advancedSettingValueText", () => {
  it("keeps string values literal", () => {
    expect(advancedSettingValueText("Bearer token")).toBe("Bearer token");
  });

  it("serializes structured values", () => {
    expect(advancedSettingValueText({ thinkingFormat: "deepseek" })).toBe('{"thinkingFormat":"deepseek"}');
    expect(advancedSettingValueText(0)).toBe("0");
    expect(advancedSettingValueText(false)).toBe("false");
  });

  it("renders missing values as empty text", () => {
    expect(advancedSettingValueText(null)).toBe("");
    expect(advancedSettingValueText(undefined)).toBe("");
  });
});

describe("parseAdvancedSettingValue", () => {
  it("parses JSON scalars and objects", () => {
    expect(parseAdvancedSettingValue("true")).toBe(true);
    expect(parseAdvancedSettingValue("42")).toBe(42);
    expect(parseAdvancedSettingValue('{"a":1}')).toEqual({ a: 1 });
  });

  it("falls back to a literal string", () => {
    expect(parseAdvancedSettingValue("Bearer token")).toBe("Bearer token");
  });

  it("treats blank text as missing", () => {
    expect(parseAdvancedSettingValue("   ")).toBeUndefined();
  });
});

describe("withAdvancedSettingValue", () => {
  it("updates one key without mutating the source", () => {
    const source = { "x-org": "pi", "x-region": "cn" };
    const next = withAdvancedSettingValue(source, "x-org", "pi-work");
    expect(next).toEqual({ "x-org": "pi-work", "x-region": "cn" });
    expect(source).toEqual({ "x-org": "pi", "x-region": "cn" });
  });

  it("writes non-string values into compat flags", () => {
    expect(withAdvancedSettingValue({}, "requiresReasoningContentOnAssistantMessages", "true")).toEqual({
      requiresReasoningContentOnAssistantMessages: true,
    });
  });

  it("drops a key whose value is cleared", () => {
    expect(withAdvancedSettingValue({ only: "one" }, "only", "")).toBeUndefined();
  });

  it("edits a nested model override value", () => {
    const modelOverrides = { "claude-sonnet-4": { contextWindow: 200000 } };
    expect(withAdvancedSettingValue(modelOverrides, "claude-sonnet-4", '{"contextWindow":1000000}')).toEqual({
      "claude-sonnet-4": { contextWindow: 1000000 },
    });
  });
});
