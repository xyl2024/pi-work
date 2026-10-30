import { splitSystemPromptLeaves } from "./system-prompt-segments";
import { formatContextTokensK } from "./context-usage";

export const CONTEXT_BUCKET_IDS = [
  "system-prompt",
  "system-tools",
  "skills",
  "messages",
] as const;

export type ContextBucketId = (typeof CONTEXT_BUCKET_IDS)[number];

export interface ContextCompositionLeafCount {
  id: string;
  localTokens: number;
  tokens: number | null;
  percent: number | null;
}

export interface ContextCompositionBucket {
  id: ContextBucketId;
  leaves: ContextCompositionLeafCount[];
  localTokens: number;
  tokens: number | null;
  percent: number | null;
}

export const TOP_TOOL_RESULTS = 5;

export interface ContextToolResultEntry {
  id: string;
  toolCallId: string | null;
  toolName: string;
  input: Record<string, unknown> | null;
  localTokens: number;
  tokens: number | null;
}

export interface ContextComposition {
  buckets: ContextCompositionBucket[];
  topToolResults: ContextToolResultEntry[];
  localTotal: number;
  anchoredTotalTokens: number | null;
}

export interface ContextToolSchema {
  name?: string | null;
  description?: string | null;
  parameters?: unknown;
}

export interface ContextMessage {
  role?: string | null;
  content?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
  command?: unknown;
  output?: unknown;
  excludeFromContext?: boolean;
  summary?: unknown;
}

export interface ContextCompositionInput {
  systemPrompt?: string | null;
  tools?: readonly ContextToolSchema[] | null;
  messages?: readonly ContextMessage[] | null;
  anchoredTotalTokens: number | null;
  countTokens: (text: string) => number;
}

interface RawLeaf {
  id: string;
  localTokens: number;
}

interface RawBucket {
  id: ContextBucketId;
  leaves: RawLeaf[];
}

const IMAGE_TOKEN_EQUIVALENT = 1200;

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

function usableAnchor(anchoredTotalTokens: number | null | undefined): number | null {
  if (typeof anchoredTotalTokens !== "number" || !Number.isFinite(anchoredTotalTokens)) return null;
  return anchoredTotalTokens > 0 ? anchoredTotalTokens : null;
}

function countLeaf(text: string, countTokens: (text: string) => number): number {
  const raw = countTokens(text);
  return Number.isFinite(raw) ? Math.max(0, raw) : 0;
}

function serializeParameters(parameters: unknown): string {
  if (parameters === undefined || parameters === null) return "";
  try {
    return JSON.stringify(parameters) ?? "";
  } catch {
    return "";
  }
}

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
      default:
        break;
    }
  }

  return MESSAGE_COMPOSITION_LEAF_IDS.map((id) => ({ id, localTokens: totals.get(id) ?? 0 }));
}

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

function buildRawBuckets(input: ContextCompositionInput): RawBucket[] {
  const { prompt, skills } = systemPromptBuckets(input.systemPrompt, input.countTokens);
  return [
    { id: "system-prompt", leaves: prompt },
    { id: "system-tools", leaves: toolBuckets(input.tools, input.countTokens) },
    { id: "skills", leaves: skills },
    { id: "messages", leaves: messageBuckets(input.messages, input.countTokens) },
  ];
}

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

export function computeContextComposition(input: ContextCompositionInput): ContextComposition {
  const rawBuckets = buildRawBuckets(input);
  const toolResults = collectTopToolResults(input.messages, input.countTokens);
  const localTotal = rawBuckets.reduce(
    (sum, bucket) => sum + bucket.leaves.reduce((bucketSum, leaf) => bucketSum + leaf.localTokens, 0),
    0,
  );
  const anchoredTotalTokens = usableAnchor(input.anchoredTotalTokens);

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
    topToolResults: toolResults.map((entry) => ({
      ...entry,
      tokens: Math.round(entry.localTokens * (anchoredTotalTokens / localTotal)),
    })),
    localTotal,
    anchoredTotalTokens,
  };
}

export function formatCompositionPercent(percent: number): string {
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(1);
}

export function formatEstimatedTokens(tokens: number): string {
  return `≈ ${formatContextTokensK(tokens)}`;
}
