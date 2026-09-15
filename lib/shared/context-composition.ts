// ============================================================================
// Context composition (pure)
//
// "What is this context window made of, and how much does each part take?"
//
// The provider only ever reports a *total* (pi's `getContextUsage().tokens`,
// which comes from `usage.input/output/cacheRead/cacheWrite`). Every provider
// is like that — none of them break the prompt down by source. So the split is
// inherently local, and the contract the UI publishes is: **the total is exact
// (the model said so), the split is an estimate (we computed it)**. That is why
// the total carries no decoration and every classified number is prefixed with
// `≈`. See ADR-0005 for the rejected alternatives (`chars/4`, per-provider
// encodings, the provider count_tokens endpoints) and why there is deliberately
// no "protocol overhead / unclassified" row.
//
// Four top-level buckets (CONTEXT.md, 上下文构成):
//
//   system-prompt  — the whole system prompt minus the skills listing
//   system-tools   — the API `tools` schemas (name + description + parameters)
//   skills         — the `<available_skills>…</available_skills>` listing
//   messages       — the conversation transcript on the active branch
//
// `system-prompt + skills === countTokens(whole system prompt)` **exactly**,
// because the system prompt is counted by *prefix differencing* (ADR-0005):
// tokenize the original string up to each segment boundary and subtract. BPE
// re-merges tokens across a boundary, so tokenizing the segments separately
// would not add up; subtracting prefixes telescopes to the whole by
// construction. See `lib/shared/system-prompt-segments`.
//
// The arithmetic is a **single global normalization**: count every leaf
// locally, then allocate the provider total across those leaves (largest
// remainder) so `Σ leaves === total` holds exactly — never negative, and no
// "who owns the residual" second rule.
//
// Token counting is **injected** (`countTokens`), never imported: the real
// tokenizer is a 2.4MB server-only BPE (see `lib/server/context-tokenizer.ts`),
// and injection is what keeps this module testable without any server
// dependency — the same reason `tool-call-display` takes `resolveReadPath` as a
// parameter. Like `panelTabs` / `chat-timeline` / `tool-call-display`
// (ADR-0002 / ADR-0003) this module may not import React, DOM, i18n, a client
// hook, or anything from `lib/server`.
// ============================================================================

import { splitSystemPromptLeaves } from "./system-prompt-segments";
import { formatContextTokensK } from "./context-usage";

/** The four top-level sources of a context window, per CONTEXT.md
 *  （上下文构成）. `skills` is carved out of the system prompt, so
 *  `system-prompt + skills === countTokens(whole system prompt)`. */
export const CONTEXT_BUCKET_IDS = [
  "system-prompt",
  "system-tools",
  "skills",
  "messages",
] as const;

export type ContextBucketId = (typeof CONTEXT_BUCKET_IDS)[number];

/** One context source after counting + anchoring. `tokens` / `percent` are
 *  `null` when no usable provider anchor exists — the caller then shows the
 *  local count without a percentage rather than a wrong one. */
export interface ContextCompositionLeafCount {
  /** Stable id used by the UI (labels, jump targets, expand state) and tests.
   *  `tool:<name>`, `agents:<path>`, a Context-panel anchor id, or one of the
   *  seven message ids (`user-text` / `assistant-text` / `thinking` /
   *  `tool-call` / `tool-result` / `compaction-summary` / `branch-summary`). */
  id: string;
  /** Raw local count before anchoring. Never negative. */
  localTokens: number;
  /** Local count allocated to the provider total; `null` without an anchor. */
  tokens: number | null;
  /** Share of the provider total in [0, 100]; `null` without an anchor. */
  percent: number | null;
}

/** One top-level bucket: its leaves plus the same three numbers summed. */
export interface ContextCompositionBucket {
  id: ContextBucketId;
  leaves: ContextCompositionLeafCount[];
  localTokens: number;
  tokens: number | null;
  percent: number | null;
}

/** How many of the biggest tool results the composition panel lists. */
export const TOP_TOOL_RESULTS = 5;

/** One tool result as the composition panel's Top-N list shows it: the call
 *  that produced it, what to call it, and how big it is. */
export interface ContextToolResultEntry {
  /** Stable id for the row — the tool call id when the call is in the
   *  transcript, otherwise a transcript-position id. */
  id: string;
  /** The call that produced this result; `null` when the transcript did not
   *  pair one. The row is still listed, it just cannot be jumped to. */
  toolCallId: string | null;
  /** The tool's name: from the matching call, else the result's own
   *  `toolName`, else empty. */
  toolName: string;
  /** The matching call's arguments, for the existing tool-call preview. `null`
   *  when no call matched. */
  input: Record<string, unknown> | null;
  /** Local estimate before anchoring. Never negative. */
  localTokens: number;
  /** Local count scaled to the provider total; `null` without an anchor. */
  tokens: number | null;
}

export interface ContextComposition {
  /** Every top-level bucket, in canonical order, always all four. */
  buckets: ContextCompositionBucket[];
  /** The transcript's biggest tool results, biggest first, at most
   *  `TOP_TOOL_RESULTS` — empty when there are none, in which case the panel
   *  renders neither a list nor a title. */
  topToolResults: ContextToolResultEntry[];
  /** Σ of every leaf's local count — the normalization denominator. */
  localTotal: number;
  /** The provider-reported total this composition was anchored to, or `null`
   *  when there was no usable anchor (no usage yet, or nothing to classify). */
  anchoredTotalTokens: number | null;
}

/** A tool definition as it is sent in the API `tools` parameter. */
export interface ContextToolSchema {
  name?: string | null;
  description?: string | null;
  parameters?: unknown;
}

/** A transcript message, read structurally: the composition only needs to tell
 *  the roles apart and pull out their text-bearing fields. */
export interface ContextMessage {
  role?: string | null;
  content?: unknown;
  /** toolResult: the call that produced this result. Absent on transcripts
   *  that did not pair them; the Top-N list then still counts the result but
   *  has nothing to jump to. */
  toolCallId?: unknown;
  /** toolResult: the tool's own name, used only when no matching call was
   *  found. */
  toolName?: unknown;
  /** bashExecution */
  command?: unknown;
  output?: unknown;
  /** bashExecution: `!!`-prefixed commands are not sent to the model at all
   *  (pi's `convertToLlm` drops them), so they must not consume a share of the
   *  context. */
  excludeFromContext?: boolean;
  /** branchSummary / compactionSummary */
  summary?: unknown;
}

export interface ContextCompositionInput {
  /** The system prompt exactly as sent to the model (pi's
   *  `agent.state.systemPrompt`). */
  systemPrompt?: string | null;
  /** The tool definitions sent in the API `tools` parameter (pi's
   *  `agent.state.tools`). */
  tools?: readonly ContextToolSchema[] | null;
  /** The conversation transcript on the active branch (pi's
   *  `agent.state.messages`). */
  messages?: readonly ContextMessage[] | null;
  /** Provider-anchored exact total (pi's `getContextUsage().tokens`).
   *  `null` while the provider hasn't reported usage yet (no assistant reply,
   *  or right after a compaction). */
  anchoredTotalTokens: number | null;
  /** The injected tokenizer — the only entry point to token counting. */
  countTokens: (text: string) => number;
}

/** A leaf's local count before anchoring. */
interface RawLeaf {
  id: string;
  localTokens: number;
}

interface RawBucket {
  id: ContextBucketId;
  leaves: RawLeaf[];
}

/** pi's own image stand-in (`compaction/compaction.js`): an image counts as
 *  4800 characters, i.e. 1200 tokens at pi's chars/4 ratio. Reused here rather
 *  than inventing a second image equivalence (see #33's notes). */
const IMAGE_TOKEN_EQUIVALENT = 1200;

/** The seven message buckets, in display order. `user-text` is "user-side
 *  input", which includes bash executions and custom messages — not just the
 *  text the user typed. Compaction and branch summaries are **their own**
 *  buckets: pi folds them into user messages in `convertToLlm`, so lumping
 *  them into `user-text` would show the single biggest block of a long
 *  compacted conversation as if the user had typed it. */
/** The seven message leaves, in canonical order. `MessageCompositionLeafId` is
 *  the key union the UI's label `Record` is built from, so adding a role here
 *  is a compile error in the panel instead of an untranslated row. */
const MESSAGE_COMPOSITION_LEAF_IDS = [
  "user-text",
  "assistant-text",
  "thinking",
  "tool-call",
  "tool-result",
  "compaction-summary",
  "branch-summary",
] as const;

export type MessageCompositionLeafId = (typeof MESSAGE_COMPOSITION_LEAF_IDS)[number];

/** A usable anchor is a positive, finite number. Anything else (missing,
 *  zero, negative, NaN) degrades the whole composition to unanchored. */
function usableAnchor(anchoredTotalTokens: number | null | undefined): number | null {
  if (typeof anchoredTotalTokens !== "number" || !Number.isFinite(anchoredTotalTokens)) return null;
  return anchoredTotalTokens > 0 ? anchoredTotalTokens : null;
}

/** Count a string, clamping a non-finite or negative result to 0. */
function countLeaf(text: string, countTokens: (text: string) => number): number {
  const raw = countTokens(text);
  return Number.isFinite(raw) ? Math.max(0, raw) : 0;
}

/** `JSON.stringify` without ever throwing (a cyclic schema would otherwise
 *  take down the whole estimate). */
function serializeParameters(parameters: unknown): string {
  if (parameters === undefined || parameters === null) return "";
  try {
    return JSON.stringify(parameters) ?? "";
  } catch {
    return "";
  }
}

/** Serialize one tool the way the provider receives it: name + description +
 *  the parameter schema. This is deliberately *not* the one-line tool list
 *  inside the system prompt — that list belongs to `system-prompt` and is
 *  about 50× smaller. Adding the two together would misprice "how much would I
 *  save by dropping a tool" by that factor. */
function toolBuckets(tools: readonly ContextToolSchema[] | null | undefined, countTokens: (text: string) => number): RawLeaf[] {
  const leaves: RawLeaf[] = [];
  (tools ?? []).forEach((tool, index) => {
    const name = typeof tool?.name === "string" ? tool.name : "";
    const description = typeof tool?.description === "string" ? tool.description : "";
    const text = `${name}\n${description}\n${serializeParameters(tool?.parameters)}`;
    leaves.push({ id: `tool:${name || index}`, localTokens: countLeaf(text, countTokens) });
  });
  return leaves;
}

/** Text of a message content value: a raw string, or the `text` blocks of a
 *  content array (plus an image stand-in per image block). */
function contentText(content: unknown): { text: string; images: number } {
  if (typeof content === "string") return { text: content, images: 0 };
  if (!Array.isArray(content)) return { text: "", images: 0 };
  const parts: string[] = [];
  let images = 0;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const typed = block as Record<string, unknown>;
    if (typed.type === "text" && typeof typed.text === "string") parts.push(typed.text);
    else if (typed.type === "image") images += 1;
  }
  return { text: parts.join("\n"), images };
}

/** Count the transcript into the seven message leaves. Mirrors pi's
 *  `estimateTokens` role coverage (the SDK is the authority on which roles
 *  exist) but counts with the injected tokenizer instead of chars/4. */
function messageBuckets(messages: readonly ContextMessage[] | null | undefined, countTokens: (text: string) => number): RawLeaf[] {
  const totals = new Map<MessageCompositionLeafId, number>(MESSAGE_COMPOSITION_LEAF_IDS.map((id) => [id, 0]));
  const add = (id: MessageCompositionLeafId, text: string, images = 0) => {
    totals.set(id, (totals.get(id) ?? 0) + countLeaf(text, countTokens) + images * IMAGE_TOKEN_EQUIVALENT);
  };

  for (const message of messages ?? []) {
    const role = typeof message?.role === "string" ? message.role : "";
    switch (role) {
      case "user":
      case "custom": {
        const content = contentText(message?.content);
        add("user-text", content.text, content.images);
        break;
      }
      case "toolResult": {
        const content = contentText(message?.content);
        add("tool-result", content.text, content.images);
        break;
      }
      case "bashExecution": {
        // `!!`-prefixed bash is excluded from the model request, so it is not
        // part of the context window either.
        if (message?.excludeFromContext === true) break;
        const command = typeof message?.command === "string" ? message.command : "";
        const output = typeof message?.output === "string" ? message.output : "";
        add("user-text", `${command}${output}`);
        break;
      }
      case "compactionSummary": {
        add("compaction-summary", typeof message?.summary === "string" ? message.summary : "");
        break;
      }
      case "branchSummary": {
        add("branch-summary", typeof message?.summary === "string" ? message.summary : "");
        break;
      }
      case "assistant": {
        if (!Array.isArray(message?.content)) break;
        for (const block of message.content) {
          if (!block || typeof block !== "object") continue;
          const typed = block as Record<string, unknown>;
          if (typed.type === "text" && typeof typed.text === "string") add("assistant-text", typed.text);
          else if (typed.type === "thinking" && typeof typed.thinking === "string") add("thinking", typed.thinking);
          else if (typed.type === "toolCall") {
            const name = typeof typed.name === "string" ? typed.name : "";
            add("tool-call", `${name}${serializeParameters(typed.arguments)}`);
          }
        }
        break;
      }
      // Unknown roles are ignored rather than guessed into an existing bucket.
      default:
        break;
    }
  }

  return MESSAGE_COMPOSITION_LEAF_IDS.map((id) => ({ id, localTokens: totals.get(id) ?? 0 }));
}

/**
 * The whole system prompt, split into its leaves and counted by prefix
 * differencing so the parts telescope to `countTokens(systemPrompt)` exactly.
 * Returns the leaves twice-partitioned: skills (its own bucket) and everything
 * else (the system-prompt bucket).
 */
function systemPromptBuckets(
  systemPrompt: string | null | undefined,
  countTokens: (text: string) => number,
): { prompt: RawLeaf[]; skills: RawLeaf[] } {
  const prompt: RawLeaf[] = [];
  const skills: RawLeaf[] = [];
  if (!systemPrompt) return { prompt, skills };

  let previousPrefix = 0;
  for (const leaf of splitSystemPromptLeaves(systemPrompt)) {
    const prefix = countLeaf(systemPrompt.slice(0, leaf.end), countTokens);
    const localTokens = Math.max(0, prefix - previousPrefix);
    previousPrefix = prefix;
    (leaf.kind === "skills" ? skills : prompt).push({ id: leaf.id, localTokens });
  }
  return { prompt, skills };
}

/** The transcript's tool calls, keyed by call id, so a tool result can be
 *  named after the call that produced it. pi's raw `ToolCall` block carries the
 *  id as `id` (`toolCallId` is the normalized name the client projection uses),
 *  and `agent.state.messages` is raw — both are read so either shape pairs. */
function toolCallsById(
  messages: readonly ContextMessage[] | null | undefined,
): Map<string, { toolName: string; input: Record<string, unknown> | null }> {
  const calls = new Map<string, { toolName: string; input: Record<string, unknown> | null }>();
  for (const message of messages ?? []) {
    if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (!block || typeof block !== "object") continue;
      const typed = block as Record<string, unknown>;
      if (typed.type !== "toolCall") continue;
      const id =
        typeof typed.id === "string" ? typed.id : typeof typed.toolCallId === "string" ? typed.toolCallId : "";
      if (!id) continue;
      const args = typed.arguments ?? typed.input;
      calls.set(id, {
        toolName: typeof typed.name === "string" ? typed.name : typeof typed.toolName === "string" ? typed.toolName : "",
        input: args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : null,
      });
    }
  }
  return calls;
}

/** The transcript's tool results, biggest first, capped at `TOP_TOOL_RESULTS`.
 *  Counted with the same content + image stand-in as the aggregate
 *  `tool-result` leaf, so a listed result can never exceed the bucket it
 *  belongs to. */
function collectTopToolResults(
  messages: readonly ContextMessage[] | null | undefined,
  countTokens: (text: string) => number,
): Array<Omit<ContextToolResultEntry, "tokens">> {
  const calls = toolCallsById(messages);
  const entries: Array<Omit<ContextToolResultEntry, "tokens"> & { index: number }> = [];
  (messages ?? []).forEach((message, index) => {
    if (message?.role !== "toolResult") return;
    const rawToolCallId =
      typeof message.toolCallId === "string" && message.toolCallId ? message.toolCallId : null;
    const call = rawToolCallId ? calls.get(rawToolCallId) : undefined;
    const content = contentText(message.content);
    entries.push({
      index,
      id: rawToolCallId && call ? rawToolCallId : `tool-result:${index}`,
      // Only a result whose call is in the same transcript can be jumped to.
      // An id with no matching call (a truncated or imported transcript) is
      // exposed as "no target" so the panel does not render a button that
      // scrolls nowhere.
      toolCallId: call ? rawToolCallId : null,
      toolName: call?.toolName ?? (typeof message.toolName === "string" ? message.toolName : ""),
      input: call?.input ?? null,
      localTokens: countLeaf(content.text, countTokens) + content.images * IMAGE_TOKEN_EQUIVALENT,
    });
  });
  return entries
    .sort((a, b) => b.localTokens - a.localTokens || a.index - b.index)
    .slice(0, TOP_TOOL_RESULTS)
    .map((entry) => ({
      id: entry.id,
      toolCallId: entry.toolCallId,
      toolName: entry.toolName,
      input: entry.input,
      localTokens: entry.localTokens,
    }));
}

/** Build the four buckets' raw (unanchored) leaves. */
function buildRawBuckets(input: ContextCompositionInput): RawBucket[] {
  const { prompt, skills } = systemPromptBuckets(input.systemPrompt, input.countTokens);
  return [
    { id: "system-prompt", leaves: prompt },
    { id: "system-tools", leaves: toolBuckets(input.tools, input.countTokens) },
    { id: "skills", leaves: skills },
    { id: "messages", leaves: messageBuckets(input.messages, input.countTokens) },
  ];
}

/** Distribute `anchoredTotal` across the local counts proportionally, using
 *  the largest-remainder method so the parts sum to `anchoredTotal` exactly
 *  (plain rounding can land one token off, which the UI would show as "the
 *  four buckets don't add up"). */
function allocateTokens(localTokens: number[], anchoredTotal: number): number[] {
  const localTotal = localTokens.reduce((sum, value) => sum + value, 0);
  if (localTotal <= 0 || anchoredTotal <= 0) return localTokens.map(() => 0);
  const exact = localTokens.map((value) => (value * anchoredTotal) / localTotal);
  const allocated = exact.map((value) => Math.floor(value));
  let remaining = anchoredTotal - allocated.reduce((sum, value) => sum + value, 0);
  const byFraction = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let i = 0; remaining > 0 && i < byFraction.length; i++) {
    allocated[byFraction[i].index] += 1;
    remaining -= 1;
  }
  return allocated;
}

/**
 * Count a context window's leaves locally and anchor them to the provider's
 * exact total. Pure: everything it needs (the prompt, the schemas, the
 * transcript, the counting function) comes in as arguments.
 *
 * Invariants, valid for every input:
 *  - `Σ buckets.localTokens === localTotal`;
 *  - with an anchor, `Σ leaves.tokens === anchoredTotalTokens` and
 *    `Σ leaves.percent === 100` (allocation is exact, not rounded);
 *  - `system-prompt.localTokens + skills.localTokens === countTokens(systemPrompt)`;
 *  - `localTokens >= 0` and `tokens >= 0`; no `NaN` / `Infinity`, ever.
 */
export function computeContextComposition(input: ContextCompositionInput): ContextComposition {
  const rawBuckets = buildRawBuckets(input);
  const toolResults = collectTopToolResults(input.messages, input.countTokens);
  const localTotal = rawBuckets.reduce(
    (sum, bucket) => sum + bucket.leaves.reduce((bucketSum, leaf) => bucketSum + leaf.localTokens, 0),
    0,
  );
  const anchoredTotalTokens = usableAnchor(input.anchoredTotalTokens);

  // No usable anchor, or nothing to classify: stay unanchored rather than
  // invent a split or divide by zero.
  if (anchoredTotalTokens === null || localTotal <= 0) {
    return {
      buckets: rawBuckets.map((bucket) => ({
        id: bucket.id,
        leaves: bucket.leaves.map((leaf) => ({ ...leaf, tokens: null, percent: null })),
        localTokens: bucket.leaves.reduce((sum, leaf) => sum + leaf.localTokens, 0),
        tokens: null,
        percent: null,
      })),
      topToolResults: toolResults.map((entry) => ({ ...entry, tokens: null })),
      localTotal,
      anchoredTotalTokens: null,
    };
  }

  const allocated = allocateTokens(
    rawBuckets.flatMap((bucket) => bucket.leaves.map((leaf) => leaf.localTokens)),
    anchoredTotalTokens,
  );

  let cursor = 0;
  const buckets: ContextCompositionBucket[] = rawBuckets.map((bucket) => {
    const leaves = bucket.leaves.map((leaf) => {
      const tokens = allocated[cursor++];
      return { ...leaf, tokens, percent: (tokens / anchoredTotalTokens) * 100 };
    });
    const tokens = leaves.reduce((sum, leaf) => sum + (leaf.tokens ?? 0), 0);
    return {
      id: bucket.id,
      leaves,
      localTokens: bucket.leaves.reduce((sum, leaf) => sum + leaf.localTokens, 0),
      tokens,
      percent: (tokens / anchoredTotalTokens) * 100,
    };
  });

  return {
    buckets,
    // A listed result is a fraction of the `tool-result` leaf, so it is scaled
    // by the same global factor as that leaf instead of getting a share of its
    // own — the list must not read as if it were a fifth bucket.
    topToolResults: toolResults.map((entry) => ({
      ...entry,
      tokens: Math.round(entry.localTokens * (anchoredTotalTokens / localTotal)),
    })),
    localTotal,
    anchoredTotalTokens,
  };
}

/** One-decimal percentage for the ring tooltip, dropping a trailing `.0` so a
 *  solo bucket reads as `100%` rather than `100.0%`. */
export function formatCompositionPercent(percent: number): string {
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(1);
}

/** A local estimate as it is printed: `≈ 12.3K`. The `≈` is the only thing that
 *  tells a classified number apart from the provider-exact total (ADR-0005) —
 *  keeping it in one helper is what stops the ring tooltip and the composition
 *  panel from drifting into two different agreements with the user. */
export function formatEstimatedTokens(tokens: number): string {
  return `≈ ${formatContextTokensK(tokens)}`;
}
