import { describe, expect, it } from "vitest";
import { formatToolAnnotation, formatToolDuration } from "@/lib/shared/tool-duration";

describe("formatToolDuration", () => {
  it("renders sub-second durations in milliseconds", () => {
    expect(formatToolDuration(0)).toBe("0ms");
    expect(formatToolDuration(320)).toBe("320ms");
    expect(formatToolDuration(999)).toBe("999ms");
  });

  it("renders durations under ten seconds with one decimal", () => {
    expect(formatToolDuration(1000)).toBe("1.0s");
    expect(formatToolDuration(1200)).toBe("1.2s");
    expect(formatToolDuration(7340)).toBe("7.3s");
    expect(formatToolDuration(9999)).toBe("10.0s");
  });

  it("renders ten to sixty seconds as whole seconds", () => {
    expect(formatToolDuration(10000)).toBe("10s");
    expect(formatToolDuration(12000)).toBe("12s");
    expect(formatToolDuration(12500)).toBe("13s");
    expect(formatToolDuration(59999)).toBe("1m00s");
  });

  it("renders a minute or more as padded minutes and seconds", () => {
    expect(formatToolDuration(60000)).toBe("1m00s");
    expect(formatToolDuration(63000)).toBe("1m03s");
    expect(formatToolDuration(125000)).toBe("2m05s");
  });

  it("treats missing or invalid durations as nothing to show", () => {
    expect(formatToolDuration(undefined)).toBeNull();
    expect(formatToolDuration(null)).toBeNull();
    expect(formatToolDuration(Number.NaN)).toBeNull();
    expect(formatToolDuration(Number.POSITIVE_INFINITY)).toBeNull();
    expect(formatToolDuration(-1)).toBeNull();
  });
});

describe("formatToolAnnotation", () => {
  it("merges a timeout and a duration into one annotation", () => {
    expect(formatToolAnnotation({ timeout: "10", durationMs: 1200 })).toBe("(timeout=10s, duration=1.2s)");
  });

  it("shows only the timeout when the duration is missing", () => {
    expect(formatToolAnnotation({ timeout: "10" })).toBe("(timeout=10s)");
  });

  it("shows only the duration when the timeout is missing", () => {
    expect(formatToolAnnotation({ durationMs: 1200 })).toBe("(duration=1.2s)");
    expect(formatToolAnnotation({ timeout: null, durationMs: 320 })).toBe("(duration=320ms)");
  });

  it("renders nothing when neither is present", () => {
    expect(formatToolAnnotation({})).toBeNull();
    expect(formatToolAnnotation({ timeout: null, durationMs: undefined })).toBeNull();
    expect(formatToolAnnotation({ timeout: "", durationMs: Number.NaN })).toBeNull();
  });
});
