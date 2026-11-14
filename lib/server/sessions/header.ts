import { closeSync, openSync, readSync, statSync } from "node:fs";
import { open } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import { ASSISTANT_SESSION_ENTRY_TYPE, isAssistantSessionMarkerData } from "@/lib/shared/assistant-marker";

export interface SessionHeaderScan {
  id: string;
  cwd: string;
  created: string;
  parentSessionPath?: string;
  name?: string;
  firstMessage?: string;
  assistant?: boolean;
}

const HEAD_CHUNK_BYTES = 16 * 1024;
const HEAD_MAX_BYTES = 1024 * 1024;
const TAIL_CHUNK_BYTES = 64 * 1024;
const TAIL_MAX_BYTES = 64 * 1024;

export function extractMessageText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        (block as { type?: string }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string"
      ) {
        return (block as { text: string }).text;
      }
    }
  }
  return undefined;
}

class HeaderParser {
  private decoder = new StringDecoder("utf8");
  private pending = "";
  private headerSeen = false;
  private id: string | undefined;
  private cwd: string | undefined;
  private created: string | undefined;
  private parentSessionPath: string | undefined;
  private name: string | undefined;
  private firstMessage: string | undefined;
  private assistant = false;

  feed(buffer: Buffer): void {
    this.consume(this.decoder.write(buffer));
  }

  flush(): void {
    const rest = this.decoder.end();
    if (rest) this.consume(rest);
    if (this.pending) {
      const line = this.pending;
      this.pending = "";
      this.takeLine(line);
    }
  }

  get idValue(): string | undefined {
    return this.id;
  }

  get complete(): boolean {
    return this.name !== undefined && this.firstMessage !== undefined;
  }

  get hasFirstMessage(): boolean {
    return this.firstMessage !== undefined;
  }

  toResult(): SessionHeaderScan | null {
    if (!this.id || !this.created) return null;
    const result: SessionHeaderScan = { id: this.id, cwd: this.cwd ?? "", created: this.created };
    if (this.parentSessionPath !== undefined) result.parentSessionPath = this.parentSessionPath;
    if (this.name !== undefined) result.name = this.name;
    if (this.firstMessage !== undefined) result.firstMessage = this.firstMessage;
    if (this.assistant) result.assistant = true;
    return result;
  }

  private consume(text: string): void {
    const lines = (this.pending + text).split("\n");
    this.pending = lines.pop() ?? "";
    for (const line of lines) this.takeLine(line);
  }

  private takeLine(line: string): void {
    if (!line) return;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (!entry || typeof entry !== "object") return;

    const entryType = (entry as { type?: unknown }).type;
    if (!this.headerSeen && entryType === "session" && typeof (entry as { id?: unknown }).id === "string") {
      this.id = (entry as { id: string }).id;
      const cwdVal = (entry as { cwd?: unknown }).cwd;
      this.cwd = typeof cwdVal === "string" ? cwdVal : "";
      const tsVal = (entry as { timestamp?: unknown }).timestamp;
      this.created = typeof tsVal === "string" ? tsVal : undefined;
      const parentVal = (entry as { parentSession?: unknown }).parentSession;
      this.parentSessionPath = typeof parentVal === "string" ? parentVal : undefined;
      this.headerSeen = true;
      return;
    }
    if (!this.headerSeen) return;

    if (
      entryType === "custom" &&
      (entry as { customType?: unknown }).customType === ASSISTANT_SESSION_ENTRY_TYPE &&
      isAssistantSessionMarkerData((entry as { data?: unknown }).data)
    ) {
      this.assistant = true;
      return;
    }
    if (entryType === "session_info" && typeof (entry as { name?: unknown }).name === "string") {
      const trimmed = ((entry as { name: string }).name).trim();
      if (trimmed) this.name = trimmed;
      return;
    }
    if (entryType === "message" && this.firstMessage === undefined) {
      const msg = (entry as { message?: { role?: unknown; content?: unknown } }).message;
      if (msg && (msg.role === "user" || msg.role === "assistant")) {
        const text = extractMessageText(msg.content);
        if (text) this.firstMessage = text;
      }
    }
  }
}

function shouldStopHeadRead(parser: HeaderParser, offset: number): boolean {
  if (parser.complete) return true;
  return parser.hasFirstMessage && offset >= HEAD_CHUNK_BYTES;
}

export function readSessionHeader(filePath: string): SessionHeaderScan | null {
  let fd: number;
  try {
    fd = openSync(filePath, "r");
  } catch {
    return null;
  }
  try {
    const parser = new HeaderParser();
    const chunk = Buffer.allocUnsafe(HEAD_CHUNK_BYTES);
    let offset = 0;
    let eof = false;
    while (!eof && offset < HEAD_MAX_BYTES) {
      let bytesRead = 0;
      try {
        bytesRead = readSync(fd, chunk, 0, chunk.length, offset);
      } catch {
        break;
      }
      if (bytesRead === 0) eof = true;
      offset += bytesRead;
      parser.feed(chunk.subarray(0, bytesRead));
      if (shouldStopHeadRead(parser, offset)) break;
    }
    parser.flush();
    return parser.toResult();
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

export interface ScanSessionHeaderOptions {
  knownNameFor?: (sessionId: string) => string | undefined;
  size?: number;
}

export async function scanSessionHeader(
  filePath: string,
  options: ScanSessionHeaderOptions = {},
): Promise<SessionHeaderScan | null> {
  let size = options.size;
  if (size === undefined) {
    try {
      size = statSync(filePath).size;
    } catch {
      return null;
    }
  }

  let handle;
  try {
    handle = await open(filePath, "r");
  } catch {
    return null;
  }

  try {
    const parser = new HeaderParser();
    const headChunk = Buffer.allocUnsafe(HEAD_CHUNK_BYTES);
    let offset = 0;
    let eof = false;
    while (!eof && offset < HEAD_MAX_BYTES && offset < size) {
      const length = Math.min(HEAD_CHUNK_BYTES, size - offset);
      const { bytesRead } = await handle.read(headChunk, 0, length, offset);
      if (bytesRead === 0) {
        eof = true;
        break;
      }
      offset += bytesRead;
      parser.feed(headChunk.subarray(0, bytesRead));
      if (shouldStopHeadRead(parser, offset)) break;
    }
    parser.flush();

    const header = parser.toResult();
    if (!header) return null;
    if (header.name !== undefined) return header;
    if (options.knownNameFor?.(header.id) !== undefined) return header;
    if (eof || offset >= size) return header;

    const tailName = await findLastNameInTail(handle, size, offset);
    if (tailName !== undefined) return { ...header, name: tailName };
    return header;
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => {});
  }
}

async function findLastNameInTail(
  handle: { read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }> },
  size: number,
  alreadyRead: number,
): Promise<string | undefined> {
  const stopAt = Math.max(alreadyRead, size - TAIL_MAX_BYTES);
  let end = size;
  const chunks: Buffer[] = [];
  let budget = 0;

  while (end > stopAt && budget < TAIL_MAX_BYTES) {
    const start = Math.max(stopAt, end - TAIL_CHUNK_BYTES);
    const length = end - start;
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    if (bytesRead === 0) break;
    chunks.unshift(buffer.subarray(0, bytesRead));
    budget += bytesRead;
    end = start;

    const name = lastNameInLines(Buffer.concat(chunks).toString("utf8"), start > 0);
    if (name !== undefined) return name;
  }

  return undefined;
}

function lastNameInLines(text: string, dropFirstPartialLine: boolean): string | undefined {
  const lines = text.split("\n");
  let found: string | undefined;
  for (let i = dropFirstPartialLine ? 1 : 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || !line.includes("session_info")) continue;
    try {
      const entry = JSON.parse(line) as { type?: unknown; name?: unknown };
      if (entry.type !== "session_info" || typeof entry.name !== "string") continue;
      const trimmed = entry.name.trim();
      if (trimmed) found = trimmed;
    } catch {
    }
  }
  return found;
}
