import {
  deepSeekSynthesisErrorCodeForStatus,
  type DeepSeekSynthesisErrorCode,
} from "./deepseek";
import { splitFinalAssistantBlocks } from "./message-display";
import type { AssistantMessage } from "./types";

export const READ_ALOUD_MAX_BILLING_CHARS = 10_000;

export const READ_ALOUD_DEFAULT_VOICE_ID = "stella";

export const READ_ALOUD_VOICE_IDS = ["stella", "tide"] as const;

export type ReadAloudVoiceId = (typeof READ_ALOUD_VOICE_IDS)[number];

export const READ_ALOUD_SYNTHESIZE_TIMEOUT_MS = 120_000;

export const READ_ALOUD_MAX_AUDIO_BYTES = 20 * 1024 * 1024;

const READ_ALOUD_SERVER_ERROR_CODES = [
  "missing_key",
  "too_long",
  "blocked",
  "rate_limited",
  "busy",
  "timeout",
  "failed",
] as const satisfies readonly DeepSeekSynthesisErrorCode[];

export const READ_ALOUD_ERROR_CODES = [...READ_ALOUD_SERVER_ERROR_CODES, "network"] as const;

export type ReadAloudErrorCode = (typeof READ_ALOUD_ERROR_CODES)[number];

export const READ_ALOUD_RETRY_DELAY_MS = 1000;

const RETRYABLE_ERROR_CODES: ReadonlySet<ReadAloudErrorCode> = new Set([
  "busy",
  "timeout",
  "network",
]);

const ERROR_MESSAGE_KEYS: Record<ReadAloudErrorCode, string> = {
  missing_key: "Read aloud needs a DeepSeek key",
  too_long: "Too long for read aloud, shorten the answer",
  blocked: "The voice service blocked this answer, try rephrasing it",
  rate_limited: "Read aloud is rate limited, try again later",
  busy: "Read aloud is busy, try again later",
  timeout: "Read aloud timed out, try again later",
  network: "Network error, try again",
  failed: "Read aloud failed, try again",
};

export function readAloudErrorMessageKey(code: ReadAloudErrorCode): string {
  return ERROR_MESSAGE_KEYS[code];
}

export function isReadAloudRetryableError(code: ReadAloudErrorCode): boolean {
  return RETRYABLE_ERROR_CODES.has(code);
}

export function isReadAloudErrorCode(value: unknown): value is ReadAloudErrorCode {
  return typeof value === "string" && (READ_ALOUD_ERROR_CODES as readonly string[]).includes(value);
}

export function readAloudErrorCodeForStatus(status: number): ReadAloudErrorCode {
  return deepSeekSynthesisErrorCodeForStatus(status);
}

export function readAloudVoiceId(value: unknown): ReadAloudVoiceId {
  return typeof value === "string" && (READ_ALOUD_VOICE_IDS as readonly string[]).includes(value)
    ? (value as ReadAloudVoiceId)
    : READ_ALOUD_DEFAULT_VOICE_ID;
}

const HAN_CHARACTER = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

export function readAloudBillingChars(text: string): number {
  let count = 0;
  for (const character of text) {
    count += HAN_CHARACTER.test(character) ? 2 : 1;
  }
  return count;
}

export function hasReadableReadAloudText(text: string): boolean {
  return text.trim().length > 0;
}

export function readAloudTextFromMessage(message: AssistantMessage): string {
  const { answerBlocks } = splitFinalAssistantBlocks(message);
  return answerBlocks
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
}
