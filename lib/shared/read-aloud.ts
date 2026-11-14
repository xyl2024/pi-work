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

const SPEAKABLE_CHARACTER =
  /[0-9A-Za-z\u00c0-\u024f\u0370-\u04ff\u0590-\u05ff\u0600-\u06ff\u0900-\u097f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/;

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;

const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

const HORIZONTAL_RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;

const REFERENCE_DEFINITION = /^ {0,3}\[[^\]]+\]:\s*\S/;

const IMAGE = /!\[[^\]]*\]\([^)]*\)|!\[[^\]]*\]\[[^\]]*\]/g;

const LINK = /\[([^\]]*)\]\([^)]*\)/g;

const REFERENCE_LINK = /\[([^\]]*)\]\[[^\]]*\]/g;

const FOOTNOTE_REFERENCE = /\[\^[^\]]*\]/g;

const HTML_TAG = /<[^>]*>/g;

const BARE_URL = /(?:https?:\/\/|www\.)[^\s，。、；：！？）】」』]+/g;

const EMPHASIS = /\*\*\*|\*\*|\*|~~|__/g;

const HEADING = /^\s{0,3}#{1,6}\s+/;

const BLOCKQUOTE = /^\s{0,3}(?:>\s?)+/;

const LIST_MARKER = /^\s{0,3}(?:[-*+]|\d{1,9}[.)])\s+/;

const TASK_CHECKBOX = /^\[[ xX]\]\s+/;

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

function stripInlineCode(line: string): string {
  let out = "";
  let index = 0;
  while (index < line.length) {
    if (line[index] !== "`") {
      out += line[index];
      index += 1;
      continue;
    }
    let runLength = 0;
    while (line[index + runLength] === "`") runLength += 1;
    const fence = "`".repeat(runLength);
    const close = line.indexOf(fence, index + runLength);
    if (close === -1) {
      out += fence;
      index += runLength;
      continue;
    }
    index = close + runLength;
  }
  return out;
}

function isFenceClose(line: string, marker: string, length: number): boolean {
  const match = FENCE_CLOSE.exec(line);
  return match !== null && match[1][0] === marker && match[1].length >= length;
}

function isTableDelimiter(line: string): boolean {
  return line.includes("|") && TABLE_DELIMITER.test(line);
}

function shapeReadAloudLine(line: string): string {
  if (HORIZONTAL_RULE.test(line) || REFERENCE_DEFINITION.test(line)) return "";
  let text = stripInlineCode(line);
  text = text.replace(IMAGE, "");
  text = text.replace(LINK, "$1");
  text = text.replace(REFERENCE_LINK, "$1");
  text = text.replace(FOOTNOTE_REFERENCE, "");
  text = text.replace(HTML_TAG, "");
  text = text.replace(BARE_URL, "");
  text = text.replace(EMPHASIS, "");
  text = text.replace(BLOCKQUOTE, "");
  text = text.replace(HEADING, "");
  text = text.replace(LIST_MARKER, "");
  text = text.replace(TASK_CHECKBOX, "");
  text = text.replace(/\s*\|\s*/g, " ");
  for (const [entity, replacement] of Object.entries(ENTITIES)) {
    text = text.replaceAll(entity, replacement);
  }
  return text.replace(/\s+/g, " ").trim();
}

function shapeTableRow(line: string): string {
  return line
    .split("|")
    .map(shapeReadAloudLine)
    .filter((cell) => cell !== "")
    .join(" ");
}

function tightenCjkPunctuation(text: string): string {
  return text
    .replace(/([（「『【])\s+/g, "$1")
    .replace(/\s+([，。、；：！？）」』】])/g, "$1");
}

export function shapeReadAloudText(markdown: string): string {
  const lines = markdown.replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/);
  const paragraphs: string[] = [];
  let pending: string[] = [];

  const flush = () => {
    const paragraph = pending.filter((line) => line !== "").join("\n");
    if (paragraph !== "") paragraphs.push(paragraph);
    pending = [];
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const fence = FENCE_OPEN.exec(line);
    if (fence) {
      index += 1;
      while (index < lines.length && !isFenceClose(lines[index], fence[1][0], fence[1].length)) {
        index += 1;
      }
      index += 1;
      continue;
    }
    if (line.trim() === "") {
      flush();
      index += 1;
      continue;
    }
    if (isTableDelimiter(lines[index + 1] ?? "")) {
      const rows = [shapeReadAloudLine(line)];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim() !== "") {
        rows.push(shapeTableRow(lines[index]));
        index += 1;
      }
      flush();
      const table = rows.filter((row) => row !== "").join("\n");
      if (table !== "") paragraphs.push(table);
      continue;
    }
    pending.push(shapeReadAloudLine(line));
    index += 1;
  }
  flush();

  return tightenCjkPunctuation(paragraphs.join("\n\n")).trim();
}

export function readAloudBillingChars(text: string): number {
  let count = 0;
  for (const character of text) {
    count += HAN_CHARACTER.test(character) ? 2 : 1;
  }
  return count;
}

export function hasReadableReadAloudText(text: string): boolean {
  return SPEAKABLE_CHARACTER.test(text);
}

export function readAloudTextFromMessage(message: AssistantMessage): string {
  const { answerBlocks } = splitFinalAssistantBlocks(message);
  return answerBlocks
    .filter((block) => block.type === "text")
    .map((block) => shapeReadAloudText(block.text))
    .filter((text) => text !== "")
    .join("\n\n");
}
