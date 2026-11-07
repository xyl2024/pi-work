import { describe, expect, it } from "vitest";
import {
  advancedSettingKind,
  advancedSettingRows,
  parseAdvancedSettingInput,
  setAdvancedSetting,
} from "@/lib/shared/models-config-advanced";

describe("advancedSettingRows", () => {
  it("flattens nested settings into dotted paths", () => {
    const rows = advancedSettingRows({ supportsStore: true, openRouterRouting: { zdr: false } });
    expect(rows).toEqual([
      { path: "supportsStore", value: true, kind: "boolean" },
      { path: "openRouterRouting.zdr", value: false, kind: "boolean" },
    ]);
  });

  it("skips unset values and empty objects", () => {
    expect(advancedSettingRows({ a: undefined, nested: {}, empty: [] })).toEqual([
      { path: "empty", value: [], kind: "json" },
    ]);
    expect(advancedSettingRows(undefined)).toEqual([]);
    expect(advancedSettingRows({})).toEqual([]);
  });

  it("keeps arrays and objects inside arrays as json leaves", () => {
    const rows = advancedSettingRows({ order: ["a", "b"], nested: { list: [{ x: 1 }] } });
    expect(rows).toEqual([
      { path: "order", value: ["a", "b"], kind: "json" },
      { path: "nested.list", value: [{ x: 1 }], kind: "json" },
    ]);
  });
});

describe("advancedSettingKind", () => {
  it("classifies leaf values", () => {
    expect(advancedSettingKind(true)).toBe("boolean");
    expect(advancedSettingKind(0.5)).toBe("number");
    expect(advancedSettingKind("deepseek")).toBe("string");
    expect(advancedSettingKind(null)).toBe("json");
    expect(advancedSettingKind({ a: 1 })).toBe("json");
  });
});

describe("setAdvancedSetting", () => {
  it("sets a nested path without mutating the source", () => {
    const source = { openRouterRouting: { zdr: false } };
    const next = setAdvancedSetting(source, "openRouterRouting.allow_fallbacks", true);
    expect(next).toEqual({ openRouterRouting: { zdr: false, allow_fallbacks: true } });
    expect(source).toEqual({ openRouterRouting: { zdr: false } });
  });

  it("overwrites existing leaves with a differently typed value", () => {
    expect(setAdvancedSetting({ maxTokensField: "max_tokens" }, "maxTokensField", 3)).toEqual({
      maxTokensField: 3,
    });
  });

  it("removes a leaf and prunes empty parents", () => {
    expect(setAdvancedSetting({ a: { b: 1 } }, "a.b", undefined)).toBeUndefined();
    expect(setAdvancedSetting({ a: { b: 1, c: 2 } }, "a.b", undefined)).toEqual({ a: { c: 2 } });
  });

  it("creates missing parents when setting a new path", () => {
    expect(setAdvancedSetting(undefined, "images.resize.maxWidth", 1024)).toEqual({
      images: { resize: { maxWidth: 1024 } },
    });
  });
});

describe("parseAdvancedSettingInput", () => {
  it("parses numbers and rejects non-numeric text", () => {
    expect(parseAdvancedSettingInput("1024", "number")).toEqual({ ok: true, value: 1024 });
    expect(parseAdvancedSettingInput("12px", "number")).toEqual({ ok: false });
  });

  it("parses booleans and rejects other words", () => {
    expect(parseAdvancedSettingInput("true", "boolean")).toEqual({ ok: true, value: true });
    expect(parseAdvancedSettingInput("false", "boolean")).toEqual({ ok: true, value: false });
    expect(parseAdvancedSettingInput("TRUE", "boolean")).toEqual({ ok: true, value: true });
    expect(parseAdvancedSettingInput("yes", "boolean")).toEqual({ ok: false });
  });

  it("keeps strings verbatim", () => {
    expect(parseAdvancedSettingInput("max_tokens", "string")).toEqual({ ok: true, value: "max_tokens" });
    expect(parseAdvancedSettingInput("", "string")).toEqual({ ok: false });
  });

  it("parses json leaves and rejects broken json", () => {
    expect(parseAdvancedSettingInput('["a",1]', "json")).toEqual({ ok: true, value: ["a", 1] });
    expect(parseAdvancedSettingInput("{ nope", "json")).toEqual({ ok: false });
  });
});
