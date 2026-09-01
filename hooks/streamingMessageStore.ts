"use client";

import type { AgentMessage } from "@/lib/shared/types";

export interface StreamingSnapshot {
  isStreaming: boolean;
  isThinking: boolean;
  /** True once any streamed content (thinking/body/tool output) has
   *  landed, false before the first token and after the stream closes.
   *  Unlike `streamingMessage` it's a stable boolean that only flips on
   *  content appear/disappear — chat loading indicators subscribe to it
   *  without re-rendering on every token. */
  hasContent: boolean;
  streamingMessage: Partial<AgentMessage> | null;
}

const EMPTY_SNAPSHOT: StreamingSnapshot = { isStreaming: false, isThinking: false, hasContent: false, streamingMessage: null };
type Entry = { snapshot: StreamingSnapshot; listeners: Set<() => void>; pending: Partial<AgentMessage> | null; raf: number | null };
const entries = new Map<string, Entry>();

function entry(key: string): Entry {
  let value = entries.get(key);
  if (!value) {
    value = { snapshot: EMPTY_SNAPSHOT, listeners: new Set(), pending: null, raf: null };
    entries.set(key, value);
  }
  return value;
}
function emit(e: Entry) { for (const listener of e.listeners) listener(); }
function isThinkingMessage(message: Partial<AgentMessage> | null): boolean {
  if (!message || message.role !== "assistant" || !Array.isArray(message.content)) return false;
  const block = message.content[message.content.length - 1];
  return block?.type === "thinking" && typeof block.thinking === "string";
}

/** True when the live assistant is currently emitting answer text rather than
 * thinking or assembling a tool call. Kept as a boolean selector so the chat
 * window does not re-render on every text token. */
export function isStreamingBodyMessage(message: Partial<AgentMessage> | null): boolean {
  if (!message || message.role !== "assistant" || !Array.isArray(message.content)) return false;
  const block = message.content[message.content.length - 1];
  return block?.type === "text" && typeof block.text === "string";
}

/** True while the live assistant is assembling a tool call — its input JSON is
 *  still streaming in (block.type === "toolCall"). Treated as "executing the
 *  tool" for the loading indicator so a long argument payload doesn't show a
 *  blank/thinking loader before the tool actually runs. */
export function isStreamingToolCallMessage(message: Partial<AgentMessage> | null): boolean {
  if (!message || message.role !== "assistant" || !Array.isArray(message.content)) return false;
  const block = message.content[message.content.length - 1];
  return block?.type === "toolCall";
}
function setSnapshot(e: Entry, next: StreamingSnapshot) {
  if (e.snapshot.isStreaming === next.isStreaming && e.snapshot.isThinking === next.isThinking && e.snapshot.hasContent === next.hasContent && e.snapshot.streamingMessage === next.streamingMessage) return;
  e.snapshot = next; emit(e);
}
export function subscribeStreaming(key: string, listener: () => void) { const e = entry(key); e.listeners.add(listener); return () => e.listeners.delete(listener); }
export function getStreamingSnapshot(key: string) { return entry(key).snapshot; }
export function getStreamingServerSnapshot() { return EMPTY_SNAPSHOT; }

function schedule(key: string, cb: () => void): number {
  if (typeof window === "undefined") return 0;
  return typeof window.requestAnimationFrame === "function" ? window.requestAnimationFrame(cb) : window.setTimeout(cb, 0);
}
function clear(key: string) { const e = entry(key); if (e.raf === null) return; if (typeof window !== "undefined" && window.cancelAnimationFrame) window.cancelAnimationFrame(e.raf); else if (typeof window !== "undefined") window.clearTimeout(e.raf); e.raf = null; }
function flush(key: string) { const e = entry(key); e.raf = null; const message = e.pending; e.pending = null; if (message) setSnapshot(e, { isStreaming: true, isThinking: isThinkingMessage(message), hasContent: true, streamingMessage: message }); }
export function scheduleStreamingUpdate(key: string, message: Partial<AgentMessage>) { const e = entry(key); e.pending = message; if (e.raf === null) e.raf = schedule(key, () => flush(key)); }
export function flushStreamingUpdateSync(key: string, message: Partial<AgentMessage>) { const e = entry(key); e.pending = message; clear(key); flush(key); }
export function startStreaming(key: string) {
  const e = entry(key);
  if (e.snapshot.isStreaming) return;
  e.pending = null;
  clear(key);
  setSnapshot(e, { isStreaming: true, isThinking: false, hasContent: false, streamingMessage: null });
}
export function endStreaming(key: string) { const e = entry(key); e.pending = null; clear(key); if (e.snapshot.isStreaming || e.snapshot.streamingMessage !== null) setSnapshot(e, EMPTY_SNAPSHOT); }
export function __resetStreamingStoreForTests() { for (const key of entries.keys()) { clear(key); } entries.clear(); }
