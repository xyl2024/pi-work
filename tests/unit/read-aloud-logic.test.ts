import { describe, expect, it } from "vitest";
import {
  READ_ALOUD_DEFAULT_VOICE_ID,
  READ_ALOUD_ERROR_CODES,
  READ_ALOUD_MAX_BILLING_CHARS,
  READ_ALOUD_RETRY_DELAY_MS,
  READ_ALOUD_SERVER_ERROR_CODES,
  READ_ALOUD_SERVER_ERROR_STATUS,
  hasReadableReadAloudText,
  isReadAloudRetryableError,
  readAloudBillingChars,
  readAloudErrorMessageKey,
  readAloudTextFromMessage,
} from "@/lib/shared/read-aloud";
import { deepSeekSynthesisErrorCodeForStatus } from "@/lib/shared/deepseek";
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
    expect(deepSeekSynthesisErrorCodeForStatus(400)).toBe("blocked");
    expect(deepSeekSynthesisErrorCodeForStatus(401)).toBe("missing_key");
    expect(deepSeekSynthesisErrorCodeForStatus(408)).toBe("timeout");
    expect(deepSeekSynthesisErrorCodeForStatus(413)).toBe("too_long");
    expect(deepSeekSynthesisErrorCodeForStatus(429)).toBe("rate_limited");
    expect(deepSeekSynthesisErrorCodeForStatus(503)).toBe("busy");
    expect(deepSeekSynthesisErrorCodeForStatus(504)).toBe("timeout");
    expect(deepSeekSynthesisErrorCodeForStatus(500)).toBe("failed");
    expect(deepSeekSynthesisErrorCodeForStatus(418)).toBe("failed");
  });

  it("derives the server error codes and statuses from the shared error list", () => {
    expect(READ_ALOUD_SERVER_ERROR_CODES).not.toContain("network");
    expect(READ_ALOUD_SERVER_ERROR_CODES).toHaveLength(READ_ALOUD_ERROR_CODES.length - 1);
    expect(READ_ALOUD_SERVER_ERROR_STATUS.invalid_request).toBe(400);
    for (const code of READ_ALOUD_SERVER_ERROR_CODES) {
      expect(READ_ALOUD_SERVER_ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
    }
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

  it("treats non-Latin scripts as readable", () => {
    for (const text of ["สวัสดี", "مرحبا", "Привет", "こんにちは", "नमस्ते"]) {
      expect(hasReadableReadAloudText(text)).toBe(true);
    }
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
    expect(readAloudErrorMessageKey("invalid_request")).toBe("Nothing to read aloud");
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
      "invalid_request",
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
