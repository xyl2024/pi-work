import { describe, expect, it } from "vitest";
import {
  READ_ALOUD_DEFAULT_VOICE_ID,
  READ_ALOUD_ERROR_CODES,
  READ_ALOUD_MAX_BILLING_CHARS,
  READ_ALOUD_RETRY_DELAY_MS,
  hasReadableReadAloudText,
  isReadAloudRetryableError,
  readAloudBillingChars,
  readAloudErrorCodeForStatus,
  readAloudErrorMessageKey,
  readAloudTextFromMessage,
} from "@/lib/shared/read-aloud";
import { EN_TRANSLATIONS } from "@/lib/shared/i18n-dict/en";
import { ZH_TRANSLATIONS } from "@/lib/shared/i18n-dict";
import type { AssistantMessage } from "@/lib/shared/types";

function assistant(content: AssistantMessage["content"]): AssistantMessage {
  return { role: "assistant", content, timestamp: 1, provider: "deepseek", model: "chat" };
}

describe("read-aloud shared logic", () => {
  it("uses the documented billing-character ceiling and default voice", () => {
    expect(READ_ALOUD_MAX_BILLING_CHARS).toBe(10_000);
    expect(READ_ALOUD_DEFAULT_VOICE_ID).toBe("stella");
  });

  it("counts a Chinese character as two billing characters", () => {
    expect(readAloudBillingChars("hello")).toBe(5);
    expect(readAloudBillingChars("你好")).toBe(4);
    expect(readAloudBillingChars("hi 你好")).toBe(7);
    expect(readAloudBillingChars("")).toBe(0);
  });

  it("maps upstream statuses onto stable read-aloud error codes", () => {
    expect(readAloudErrorCodeForStatus(400)).toBe("blocked");
    expect(readAloudErrorCodeForStatus(401)).toBe("missing_key");
    expect(readAloudErrorCodeForStatus(408)).toBe("timeout");
    expect(readAloudErrorCodeForStatus(413)).toBe("too_long");
    expect(readAloudErrorCodeForStatus(429)).toBe("rate_limited");
    expect(readAloudErrorCodeForStatus(503)).toBe("busy");
    expect(readAloudErrorCodeForStatus(504)).toBe("timeout");
    expect(readAloudErrorCodeForStatus(500)).toBe("failed");
    expect(readAloudErrorCodeForStatus(418)).toBe("failed");
  });

  it("extracts only the final answer text, never process blocks", () => {
    const message = assistant([
      { type: "thinking", thinking: "internal plan" },
      { type: "toolCall", toolCallId: "call-1", toolName: "read", input: { path: "a.ts" } },
      { type: "text", text: "First answer paragraph." },
      { type: "text", text: "Second answer paragraph." },
    ]);

    expect(readAloudTextFromMessage(message)).toBe(
      "First answer paragraph.\n\nSecond answer paragraph.",
    );
  });

  it("treats whitespace-only text as unreadable", () => {
    expect(hasReadableReadAloudText("  \n ")).toBe(false);
    expect(hasReadableReadAloudText("hello")).toBe(true);
  });

  it("has a localized message key for every error code", () => {
    for (const code of READ_ALOUD_ERROR_CODES) {
      const key = readAloudErrorMessageKey(code);
      expect(ZH_TRANSLATIONS[key as keyof typeof ZH_TRANSLATIONS]).toBeTruthy();
      expect(EN_TRANSLATIONS[key as keyof typeof EN_TRANSLATIONS]).toBeTruthy();
    }
  });

  it("gives every error code its own distinct message", () => {
    const keys = READ_ALOUD_ERROR_CODES.map(readAloudErrorMessageKey);
    expect(new Set(keys).size).toBe(READ_ALOUD_ERROR_CODES.length);
  });

  it("separates the too-long hint from the blocked hint", () => {
    expect(readAloudErrorMessageKey("too_long")).toContain("shorten");
    expect(readAloudErrorMessageKey("blocked")).toContain("rephrasing");
  });

  it("retries only busy, timeout and network failures", () => {
    expect(READ_ALOUD_RETRY_DELAY_MS).toBe(1000);
    for (const code of ["busy", "timeout", "network"] as const) {
      expect(isReadAloudRetryableError(code)).toBe(true);
    }
    for (const code of [
      "missing_key",
      "too_long",
      "blocked",
      "rate_limited",
      "failed",
    ] as const) {
      expect(isReadAloudRetryableError(code)).toBe(false);
    }
  });

  it("localizes the read-aloud action labels in both languages", () => {
    for (const key of ["Read aloud", "Synthesizing...", "Pause read aloud"]) {
      expect(ZH_TRANSLATIONS[key as keyof typeof ZH_TRANSLATIONS]).toBeTruthy();
      expect(EN_TRANSLATIONS[key as keyof typeof EN_TRANSLATIONS]).toBeTruthy();
    }
  });
});
