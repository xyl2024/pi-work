import { describe, expect, it } from "vitest";
import { parseSessionExportFormat, sessionExportExtension } from "@/lib/shared/session-export";

describe("session export format", () => {
  it("defaults to html for missing or unknown values", () => {
    expect(parseSessionExportFormat(null)).toBe("html");
    expect(parseSessionExportFormat("")).toBe("html");
    expect(parseSessionExportFormat("pdf")).toBe("html");
    expect(parseSessionExportFormat("HTML")).toBe("html");
  });

  it("keeps jsonl when requested", () => {
    expect(parseSessionExportFormat("jsonl")).toBe("jsonl");
    expect(sessionExportExtension("jsonl")).toBe("jsonl");
    expect(sessionExportExtension("html")).toBe("html");
  });
});
