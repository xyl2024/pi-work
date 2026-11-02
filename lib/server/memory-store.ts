import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { dataPath } from "./data-dir";

export type MemoryTarget = "memory" | "user";

export const MEMORY_CHAR_LIMITS: Record<MemoryTarget, number> = {
  memory: 2200,
  user: 1375,
};

const MEMORY_DIR_NAME = "memory";

const STORE_FILE_NAMES: Record<MemoryTarget, string> = {
  memory: "MEMORY.md",
  user: "USER.md",
};

export const MEMORY_ENTRY_SEPARATOR = "\n§\n";

const LOCK_FILE_NAME = ".lock";
const LOCK_RETRY_MS = 10;
const LOCK_TIMEOUT_MS = 5000;
const LOCK_STALE_MS = 10_000;

export type MemoryStoreStatus = "ok" | "missing" | "unreadable";

export interface MemorySnapshot {
  target: MemoryTarget;
  status: MemoryStoreStatus;
  entries: string[];
  used: number;
  limit: number;
}

export type MemoryOperation =
  | { action: "add"; content: string }
  | { action: "patch"; old_text: string; content: string }
  | { action: "remove"; old_text: string };

export type MemoryWriteFailureCode =
  | "unreadable"
  | "drift"
  | "unsafe"
  | "empty"
  | "invalid"
  | "duplicate"
  | "no_match"
  | "ambiguous"
  | "budget"
  | "busy";

export interface MemoryWriteFailure {
  ok: false;
  target: MemoryTarget;
  code: MemoryWriteFailureCode;
  message: string;
  operationIndex: number;
  entries: string[];
  candidates?: string[];
  nearest?: string | null;
  matched?: string;
  attemptedUsed?: number;
  limit: number;
  used: number;
}

export interface MemoryWriteSuccess {
  ok: true;
  target: MemoryTarget;
  entries: string[];
  used: number;
  limit: number;
}

export type MemoryWriteResult = MemoryWriteSuccess | MemoryWriteFailure;

function storeDir(): string {
  return dataPath(MEMORY_DIR_NAME);
}

function storePath(target: MemoryTarget): string {
  return join(storeDir(), STORE_FILE_NAMES[target]);
}

function splitEntries(raw: string): string[] {
  if (raw === "") return [];
  return raw.split(MEMORY_ENTRY_SEPARATOR);
}

function joinEntries(entries: readonly string[]): string {
  return entries.join(MEMORY_ENTRY_SEPARATOR);
}

function usageOf(entries: readonly string[]): number {
  return joinEntries(entries).length;
}

export function readMemory(target: MemoryTarget): MemorySnapshot {
  const limit = MEMORY_CHAR_LIMITS[target];
  const path = storePath(target);
  if (!existsSync(path)) {
    return { target, status: "missing", entries: [], used: 0, limit };
  }
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { target, status: "unreadable", entries: [], used: 0, limit };
  }
  const entries = splitEntries(raw);
  return { target, status: "ok", entries, used: usageOf(entries), limit };
}

function writeAtomic(target: MemoryTarget, content: string): void {
  const dir = storeDir();
  mkdirSync(dir, { recursive: true });
  const path = storePath(target);
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  try {
    writeFileSync(tmp, content, "utf8");
    renameSync(tmp, path);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {}
    throw error;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireLock(): Promise<(() => Promise<void>) | null> {
  const dir = storeDir();
  mkdirSync(dir, { recursive: true });
  const lockPath = join(dir, LOCK_FILE_NAME);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.close();
      return async () => {
        try {
          await unlink(lockPath);
        } catch {}
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      if (Date.now() > deadline) return null;
      releaseStaleLock(lockPath);
      await sleep(LOCK_RETRY_MS);
    }
  }
}

function releaseStaleLock(lockPath: string): void {
  try {
    if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) unlinkSync(lockPath);
  } catch {}
}

const FAILURE_MESSAGES: Record<MemoryWriteFailureCode, string> = {
  unreadable: "记忆库文件读取失败，拒绝写入，以免覆盖你的手写内容。",
  drift: "记忆库中已存在超长条目（多半是手写文本），整库拒绝写入。",
  unsafe: "条目内容含有注入或外泄模式，拒绝入库。",
  empty: "条目内容为空。",
  invalid: "条目内容不能包含 § 分隔符。",
  duplicate: "条目内容与库中已有条目完全重复。",
  no_match: "没有条目匹配 old_text，请对照最接近的条目改写。",
  ambiguous: "old_text 命中多个位置，请给出更精确的 old_text。",
  budget: "记忆库超出字符预算，请一次批量删旧加新。",
  busy: "记忆库正被其它会话写入，请稍后重试。",
};

function failure(
  target: MemoryTarget,
  code: MemoryWriteFailureCode,
  operationIndex: number,
  entries: readonly string[],
  extra: Partial<Omit<MemoryWriteFailure, "ok" | "target" | "code" | "operationIndex" | "message" | "entries">> = {},
): MemoryWriteFailure {
  return {
    ok: false,
    target,
    code,
    operationIndex,
    message: FAILURE_MESSAGES[code],
    entries: [...entries],
    limit: MEMORY_CHAR_LIMITS[target],
    used: usageOf(entries),
    ...extra,
  };
}

const CHAR_FOLDING: Record<string, string> = {
  "“": '"',
  "”": '"',
  "„": '"',
  "‟": '"',
  "«": '"',
  "»": '"',
  "‘": "'",
  "’": "'",
  "‚": "'",
  "‛": "'",
  "–": "-",
  "—": "-",
  "―": "-",
  "−": "-",
};

interface NormalizedText {
  text: string;
  starts: number[];
  ends: number[];
}

function normalizeWithOffsets(raw: string): NormalizedText {
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!;
    const folded = /\s/.test(char) ? " " : (CHAR_FOLDING[char] ?? char);
    if (folded === " " && text.endsWith(" ")) {
      ends[ends.length - 1] = index + 1;
      continue;
    }
    text += folded;
    starts.push(index);
    ends.push(index + 1);
  }
  while (text.startsWith(" ")) {
    text = text.slice(1);
    starts.shift();
    ends.shift();
  }
  while (text.endsWith(" ")) {
    text = text.slice(0, -1);
    starts.pop();
    ends.pop();
  }
  return { text, starts, ends };
}

function spansIn(haystack: string, needle: string): number[] {
  const spans: number[] = [];
  if (needle === "") return spans;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return spans;
    spans.push(at);
    from = at + 1;
  }
}

interface EntrySpan {
  index: number;
  start: number;
  end: number;
}

function exactSpans(entries: readonly string[], needle: string): EntrySpan[] {
  const spans: EntrySpan[] = [];
  entries.forEach((entry, index) => {
    for (const start of spansIn(entry, needle)) {
      spans.push({ index, start, end: start + needle.length });
    }
  });
  return spans;
}

function forgivingSpans(entries: readonly string[], needle: string): EntrySpan[] {
  const normalizedNeedle = normalizeWithOffsets(needle).text;
  if (normalizedNeedle === "") return [];
  const spans: EntrySpan[] = [];
  entries.forEach((entry, index) => {
    const normalized = normalizeWithOffsets(entry);
    for (const at of spansIn(normalized.text, normalizedNeedle)) {
      const start = normalized.starts[at];
      const end = normalized.ends[at + normalizedNeedle.length - 1];
      if (start === undefined || end === undefined) continue;
      spans.push({ index, start, end });
    }
  });
  return spans;
}

type MatchOutcome =
  | { kind: "unique"; span: EntrySpan }
  | { kind: "ambiguous"; candidates: string[] }
  | { kind: "none" };

function matchEntry(entries: readonly string[], needle: string): MatchOutcome {
  const exact = exactSpans(entries, needle);
  const spans = exact.length > 0 ? exact : forgivingSpans(entries, needle);
  if (spans.length === 0) return { kind: "none" };
  const indexes = [...new Set(spans.map((span) => span.index))];
  if (spans.length === 1 && indexes.length === 1) return { kind: "unique", span: spans[0]! };
  if (indexes.length === 1) return { kind: "ambiguous", candidates: [entries[indexes[0]!]!] };
  if (indexes.length > 1) return { kind: "ambiguous", candidates: indexes.map((index) => entries[index]!) };
  return { kind: "none" };
}

function bigramsOf(text: string): Set<string> {
  const normalized = normalizeWithOffsets(text).text.toLowerCase();
  const grams = new Set<string>();
  for (let index = 0; index + 1 < normalized.length; index += 1) {
    grams.add(normalized.slice(index, index + 2));
  }
  return grams;
}

function similarity(a: string, b: string): number {
  const left = bigramsOf(a);
  const right = bigramsOf(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return (2 * shared) / (left.size + right.size);
}

function nearestEntry(entries: readonly string[], needle: string): string | null {
  let best: string | null = null;
  let bestScore = -1;
  for (const entry of entries) {
    const score = similarity(entry, needle);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return best;
}

const UNSAFE_CONTENT_PATTERNS: readonly RegExp[] = [
  /\b(ignore|disregard|forget|override)\b[^\n]{0,40}\b(previous|prior|above|earlier|all)\b[^\n]{0,24}\b(instruction|instructions|prompt|prompts|rule|rules|direction|directions)\b/i,
  /\b(you are now|from now on you|act as (the )?system|new (system )?(instructions?|prompt)\s*:)/i,
  /\b(reveal|print|repeat|show|output|leak|dump)\b[^\n]{0,40}\b(system prompt|system message|initial instructions?|hidden prompt)\b/i,
  /\b(do not|don't|never)\b[^\n]{0,20}\b(tell|inform|mention|reveal|show|notice)\b[^\n]{0,30}\b(the )?(user|human)\b/i,
  /\b(without (the )?(user|human)('s)? (knowledge|consent|permission)|secretly|covertly|silently (send|post|upload))\b/i,
  /\b(send|post|upload|exfiltrate|transmit|forward|leak|curl|wget)\b[^\n]{0,80}\b(api[ _-]?keys?|access[ _-]?tokens?|secrets?|passwords?|credentials?|private keys?|\.env|environment variables?)\b/i,
  /(\bsk-[A-Za-z0-9_-]{16,}|\bghp_[A-Za-z0-9]{20,}|\bAKIA[0-9A-Z]{16}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----)/,
  /(<\|?(im_start|im_end|endoftext|system|assistant|user)\|?>|\[\/?INST\]|<<\/?SYS>>|<system>|<\/system>)/i,
  /(忽略|无视|忘记|忘掉|抛开|覆盖)[^\n]{0,12}(之前|以上|上面|前面|前述|所有|全部|先前)[^\n]{0,12}(指令|指示|提示词|规则|要求|约束)/,
  /(不要|别|禁止|切勿)[^\n]{0,8}(告诉|告知|通知|提醒|透露|展示)[^\n]{0,8}(用户|人类)/,
  /(泄露|泄漏|输出|打印|重复|展示|透露|告诉我)[^\n]{0,10}(系统提示词|系统指令|系统消息|初始指令|隐藏提示)/,
  /(发送|上传|提交|外传|回传|转发)[^\n]{0,20}(密钥|令牌|密码|凭据|api ?key|token|私钥)/,
  /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/,
];

function unsafeMatch(raw: string): boolean {
  return UNSAFE_CONTENT_PATTERNS.some((pattern) => pattern.test(raw));
}

function validatedContent(raw: string): { text: string } | { code: "empty" | "invalid" | "unsafe" } {
  if (raw.trim() === "") return { code: "empty" };
  if (raw.includes(MEMORY_ENTRY_SEPARATOR)) return { code: "invalid" };
  if (unsafeMatch(raw)) return { code: "unsafe" };
  return { text: raw.trim() };
}

type OperationOutcome =
  | { kind: "applied"; entries: string[] }
  | { kind: "failed"; code: MemoryWriteFailureCode; detail: Partial<MemoryWriteFailure> };

function applyOne(entries: string[], operation: MemoryOperation): OperationOutcome {
  if (operation.action === "add") {
    const content = validatedContent(operation.content);
    if ("code" in content) return { kind: "failed", code: content.code, detail: {} };
    if (entries.some((entry) => entry.trim() === content.text)) {
      return { kind: "failed", code: "duplicate", detail: { matched: content.text } };
    }
    return { kind: "applied", entries: [...entries, content.text] };
  }
  const match = matchEntry(entries, operation.old_text);
  if (match.kind === "none") {
    return { kind: "failed", code: "no_match", detail: { nearest: nearestEntry(entries, operation.old_text) } };
  }
  if (match.kind === "ambiguous") {
    return { kind: "failed", code: "ambiguous", detail: { candidates: match.candidates } };
  }
  if (operation.action === "remove") {
    return { kind: "applied", entries: entries.filter((_, index) => index !== match.span.index) };
  }
  const content = validatedContent(operation.content);
  if ("code" in content) return { kind: "failed", code: content.code, detail: {} };
  const next = [...entries];
  const entry = next[match.span.index]!;
  next[match.span.index] = entry.slice(0, match.span.start) + content.text + entry.slice(match.span.end);
  return { kind: "applied", entries: next };
}

export async function applyMemoryOperations(
  target: MemoryTarget,
  operations: readonly MemoryOperation[],
): Promise<MemoryWriteResult> {
  if (operations.length === 0) {
    const snapshot = readMemory(target);
    if (snapshot.status === "unreadable") return failure(target, "unreadable", 0, []);
    return { ok: true, target, entries: snapshot.entries, used: snapshot.used, limit: snapshot.limit };
  }
  const release = await acquireLock();
  if (release === null) return failure(target, "busy", 0, []);
  try {
    const snapshot = readMemory(target);
    if (snapshot.status === "unreadable") return failure(target, "unreadable", 0, []);
    const oversized = snapshot.entries.find((entry) => entry.length > snapshot.limit);
    if (oversized !== undefined) {
      return failure(target, "drift", 0, snapshot.entries, { matched: oversized });
    }
    let entries = [...snapshot.entries];
    for (let index = 0; index < operations.length; index += 1) {
      const outcome = applyOne(entries, operations[index]!);
      if (outcome.kind === "failed") {
        return failure(target, outcome.code, index, snapshot.entries, outcome.detail);
      }
      entries = outcome.entries;
    }
    const used = usageOf(entries);
    if (used > snapshot.limit) {
      return failure(target, "budget", operations.length - 1, snapshot.entries, { attemptedUsed: used });
    }
    writeAtomic(target, joinEntries(entries));
    return { ok: true, target, entries, used, limit: snapshot.limit };
  } finally {
    await release();
  }
}
