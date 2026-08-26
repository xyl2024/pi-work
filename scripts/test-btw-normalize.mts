// Smoke test for the server-side context normaliser in btw-chat.ts.
// Verifies the field-name renaming that fixes the
// "tool result's tool id ... not found" 400 from the LLM API: our
// shared-types `ToolCallContent` uses `{ toolCallId, toolName, input }`,
// but the pi SDK (and its downstream LLM provider serializer) reads
// `{ id, name, arguments }` off the same content block. Without the
// rename, the tool_use block arrives at the LLM with no id and any
// following toolResult can't be matched.
//
// We import the helper indirectly by re-implementing the same shape and
// asserting against a minimal mock of the SDK-side reads — keeps the
// test free of the SDK's internal AgentSession types.

import assert from "node:assert/strict";

console.log("btw normalize smoke tests:");

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (error) {
    console.error(`  FAIL ${name}\n       ${error instanceof Error ? error.message : String(error)}`);
    failed++;
  }
}

// ── Helpers (kept in sync with lib/server/btw-chat.ts) ──────────────────
function renameToolCallBlock(block: unknown): unknown {
  if (!block || typeof block !== "object") return block;
  const b = block as Record<string, unknown>;
  if (b.type !== "toolCall") return block;
  const id = typeof b.id === "string" && b.id.length > 0
    ? b.id
    : typeof b.toolCallId === "string"
      ? b.toolCallId
      : "";
  const name = typeof b.name === "string" && b.name.length > 0
    ? b.name
    : typeof b.toolName === "string"
      ? b.toolName
      : "";
  const arguments_ = b.arguments !== undefined
    ? b.arguments
    : b.input !== undefined
      ? b.input
      : {};
  const out: Record<string, unknown> = { type: "toolCall", id, name, arguments: arguments_ };
  if (typeof b.thoughtSignature === "string") out.thoughtSignature = b.thoughtSignature;
  if (typeof b.namespace === "string") out.namespace = b.namespace;
  return out;
}

function renameAssistantContent(content: unknown): unknown[] {
  if (!Array.isArray(content)) return [];
  return content.map((block) => renameToolCallBlock(block));
}

function normalizeContextForSdk(messages: unknown[]): unknown[] {
  return messages.map((m) => {
    if (!m || typeof m !== "object") return m;
    const msg = m as Record<string, unknown>;
    if (msg.role === "assistant") {
      return {
        ...msg,
        provider: typeof msg.provider === "string" ? msg.provider : "",
        model: typeof msg.model === "string" ? msg.model : "",
        api: typeof msg.api === "string" ? msg.api : "",
        content: renameAssistantContent(msg.content),
      };
    }
    if (msg.role === "toolResult") {
      return {
        ...msg,
        toolName: typeof msg.toolName === "string" ? msg.toolName : "",
        isError: typeof msg.isError === "boolean" ? msg.isError : false,
        timestamp: typeof msg.timestamp === "number" ? msg.timestamp : Date.now(),
      };
    }
    return m;
  });
}

test("renames toolCall.toolCallId → id for SDK", () => {
  const block = { type: "toolCall", toolCallId: "call_abc", toolName: "read", input: { path: "/tmp/x" } };
  const out = renameToolCallBlock(block) as Record<string, unknown>;
  assert.equal(out.id, "call_abc", "id should be populated from toolCallId");
  assert.equal(out.name, "read", "name should be populated from toolName");
  assert.deepEqual(out.arguments, { path: "/tmp/x" }, "arguments should be populated from input");
  assert.equal(out.toolCallId, undefined, "toolCallId should be dropped");
  assert.equal(out.toolName, undefined, "toolName should be dropped");
  assert.equal(out.input, undefined, "input should be dropped");
});

test("preserves SDK-shape toolCall blocks unchanged", () => {
  const block = { type: "toolCall", id: "call_xyz", name: "grep", arguments: { pattern: "foo" }, thoughtSignature: "sig", namespace: "ns" };
  const out = renameToolCallBlock(block) as Record<string, unknown>;
  assert.equal(out.id, "call_xyz");
  assert.equal(out.name, "grep");
  assert.deepEqual(out.arguments, { pattern: "foo" });
  assert.equal(out.thoughtSignature, "sig");
  assert.equal(out.namespace, "ns");
});

test("non-toolCall blocks are passed through", () => {
  const textBlock = { type: "text", text: "hello" };
  assert.deepEqual(renameToolCallBlock(textBlock), textBlock);
  const thinkingBlock = { type: "thinking", thinking: "hmm" };
  assert.deepEqual(renameToolCallBlock(thinkingBlock), thinkingBlock);
});

test("assistant content array normalises every toolCall", () => {
  const content = [
    { type: "text", text: "let me check" },
    { type: "toolCall", toolCallId: "tc1", toolName: "read", input: { p: 1 } },
    { type: "thinking", thinking: "..." },
    { type: "toolCall", toolCallId: "tc2", toolName: "grep", input: { q: 2 } },
  ];
  const out = renameAssistantContent(content) as Array<Record<string, unknown>>;
  assert.equal(out.length, 4);
  assert.equal((out[0] as { type: string }).type, "text");
  assert.equal((out[1] as { id: string }).id, "tc1");
  assert.equal((out[1] as { name: string }).name, "read");
  assert.deepEqual((out[1] as { arguments: unknown }).arguments, { p: 1 });
  assert.equal((out[2] as { type: string }).type, "thinking");
  assert.equal((out[3] as { id: string }).id, "tc2");
});

test("normalizeContextForSdk backfills assistant provider/model/api", () => {
  const messages = [
    { role: "user", content: "hi" },
    { role: "assistant", content: [{ type: "text", text: "yo" }] },
  ];
  const out = normalizeContextForSdk(messages) as Array<Record<string, unknown>>;
  assert.equal((out[1] as { provider: string }).provider, "");
  assert.equal((out[1] as { model: string }).model, "");
  assert.equal((out[1] as { api: string }).api, "");
});

test("normalizeContextForSdk passes user through unchanged", () => {
  const messages = [{ role: "user", content: "hello" }];
  const out = normalizeContextForSdk(messages);
  assert.equal((out[0] as { role: string }).role, "user");
  assert.equal((out[0] as { content: string }).content, "hello");
});

test("normalizeContextForSdk normalises assistant toolCalls", () => {
  const messages = [{
    role: "assistant",
    provider: "anthropic",
    model: "claude",
    content: [
      { type: "toolCall", toolCallId: "call_xyz", toolName: "read", input: { p: 1 } },
    ],
  }];
  const out = normalizeContextForSdk(messages) as Array<Record<string, unknown>>;
  const block = ((out[0] as { content: Array<Record<string, unknown>> }).content)[0];
  assert.equal(block.id, "call_xyz");
  assert.equal(block.name, "read");
  assert.deepEqual(block.arguments, { p: 1 });
});

test("normalizeContextForSdk backfills toolResult toolName/isError/timestamp", () => {
  const messages = [{
    role: "toolResult",
    toolCallId: "call_xyz",
    content: [{ type: "text", text: "result" }],
  }];
  const out = normalizeContextForSdk(messages) as Array<Record<string, unknown>>;
  assert.equal((out[0] as { toolName: string }).toolName, "");
  assert.equal((out[0] as { isError: boolean }).isError, false);
  assert.equal(typeof (out[0] as { timestamp: number }).timestamp, "number");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);