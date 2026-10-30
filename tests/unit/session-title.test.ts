import { describe, expect, it } from "vitest";
import { cleanFirstMessage, NO_MESSAGES_PLACEHOLDER, sessionDisplayTitle } from "@/lib/shared/session-title";

describe("cleanFirstMessage", () => {
  it("keeps real text and trims it", () => {
    expect(cleanFirstMessage("  fix the parser  ")).toBe("fix the parser");
  });

  it("collapses pi's placeholder to empty", () => {
    expect(cleanFirstMessage(NO_MESSAGES_PLACEHOLDER)).toBe("");
    expect(cleanFirstMessage(` ${NO_MESSAGES_PLACEHOLDER} `)).toBe("");
  });

  it("collapses missing and blank text to empty", () => {
    expect(cleanFirstMessage(undefined)).toBe("");
    expect(cleanFirstMessage(null)).toBe("");
    expect(cleanFirstMessage("   ")).toBe("");
  });
});

describe("sessionDisplayTitle", () => {
  it("prefers the session name", () => {
    expect(sessionDisplayTitle({ id: "01a01ffa-023", name: "Refactor auth", firstMessage: "hi" })).toBe(
      "Refactor auth",
    );
  });

  it("ignores a blank name", () => {
    expect(sessionDisplayTitle({ id: "01a01ffa-023", name: "  ", firstMessage: "hi" })).toBe("hi");
  });

  it("falls back to the first message when unnamed, truncated", () => {
    expect(sessionDisplayTitle({ id: "01a01ffa-023", name: null, firstMessage: "x".repeat(80) })).toBe(
      "x".repeat(50),
    );
    expect(sessionDisplayTitle({ id: "01a01ffa-023", firstMessage: "x".repeat(80) }, 60)).toBe("x".repeat(60));
  });

  it("uses the id stub — the unnamed fallback — instead of the placeholder", () => {
    expect(
      sessionDisplayTitle({ id: "01a01ffa-023", name: null, firstMessage: NO_MESSAGES_PLACEHOLDER }),
    ).toBe("01a01ffa-023");
    expect(sessionDisplayTitle({ id: "01a01ffa-023", name: undefined, firstMessage: "" })).toBe("01a01ffa-023");
  });
});
