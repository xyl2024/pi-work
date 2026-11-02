import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import {
  MEMORY_ENTRY_SEPARATOR,
  MEMORY_TARGET_FILES,
  formatMemoryUsage,
  type MemoryTarget,
} from "@/lib/shared/memory";
import { MEMORY_TOOL_NAME, type MemoryToolDetails } from "@/lib/shared/memory-tool-types";
import {
  applyMemoryOperations,
  type MemoryOperation,
  type MemoryWriteFailure,
} from "./memory-store";

const MemoryOperationParams = Type.Object(
  {
    action: Type.Union([Type.Literal("add"), Type.Literal("patch"), Type.Literal("remove")], {
      description:
        "add = append a new entry; patch = replace old_text inside an entry with content; remove = delete the entry containing old_text.",
    }),
    content: Type.Optional(
      Type.String({
        description:
          "Entry text for add, replacement text for patch. Required for add and patch. Must be self-contained: future sessions see it without any surrounding conversation.",
      }),
    ),
    old_text: Type.Optional(
      Type.String({
        description:
          "Span to locate for patch/remove. Must appear exactly once across the target store; quote it from the entry as shown in the injected block. Required for patch and remove.",
      }),
    ),
  },
  { additionalProperties: false },
);

const MemoryParams = Type.Object(
  {
    target: Type.Union([Type.Literal("memory"), Type.Literal("user")], {
      description:
        "memory = your own notes about the environment, conventions and lessons; user = the user profile (identity, language, style, preferences).",
    }),
    operations: Type.Array(MemoryOperationParams, {
      minItems: 1,
      description:
        "Applied in order as one atomic batch: if any operation fails, nothing is written. Budget is checked against the final state only, so remove stale entries and add new ones in the same call.",
    }),
  },
  { additionalProperties: false },
);

const MEMORY_TOOL_DESCRIPTION = [
  "Maintain the cross-session memory that is injected into every future session's system prompt.",
  "",
  "WHEN to write:",
  "- Durable facts about the user: identity, role, language, reply style, recurring constraints and preferences.",
  "- Durable facts about the environment: OS/shell, package manager, proxy, tool quirks, project-independent conventions, hard-won lessons.",
  "- Corrections: patch the stale entry instead of adding a near-duplicate.",
  "- Consolidation: when the store nears its budget, remove stale entries and add merged ones in one batch.",
  "",
  "SKIP:",
  "- Project-specific facts — those belong in the project's AGENTS.md.",
  "- Procedural knowledge and how-to workflows — those belong in skills.",
  "- Trivia, one-off details, and anything derivable by reading the repository.",
  "- Raw data dumps, logs, file contents, secrets, credentials or tokens.",
  "",
  "The injected memory is a frozen snapshot: a successful write is persisted immediately but this session's system prompt does not change; it takes effect in the next session.",
].join("\n");

function textResult(text: string, details: MemoryToolDetails) {
  return { content: [{ type: "text" as const, text }], details };
}

function toOperation(
  raw: { action: "add" | "patch" | "remove"; content?: string; old_text?: string },
  index: number,
): { operation: MemoryOperation } | { error: string } {
  if (raw.content?.includes(MEMORY_ENTRY_SEPARATOR)) {
    return { error: `第 ${index + 1} 个操作：content 不能包含 § 分隔符。` };
  }
  if (raw.action === "add") {
    if (typeof raw.content !== "string") return { error: `第 ${index + 1} 个操作：add 需要 content。` };
    return { operation: { action: "add", content: raw.content } };
  }
  if (typeof raw.old_text !== "string" || raw.old_text.trim() === "") {
    return { error: `第 ${index + 1} 个操作：${raw.action} 需要 old_text。` };
  }
  if (raw.action === "remove") {
    return { operation: { action: "remove", old_text: raw.old_text } };
  }
  if (typeof raw.content !== "string") return { error: `第 ${index + 1} 个操作：patch 需要 content。` };
  return { operation: { action: "patch", old_text: raw.old_text, content: raw.content } };
}

function failureText(target: MemoryTarget, failure: MemoryWriteFailure, operationCount: number): string {
  const lines = [
    `写入 ${MEMORY_TARGET_FILES[target]} 失败（第 ${failure.operationIndex + 1}/${operationCount} 个操作）：${failure.message}`,
  ];
  if (failure.code === "ambiguous" && failure.candidates && failure.candidates.length > 0) {
    lines.push("命中多个条目，请给出更精确的 old_text：");
    lines.push(...failure.candidates.map((candidate) => `- ${candidate.replaceAll("\n", " ")}`));
  }
  if (failure.code === "no_match" && failure.nearest) {
    lines.push(`最接近的条目：${failure.nearest.replaceAll("\n", " ")}`);
  }
  if (failure.code === "budget") {
    lines.push(
      `写入后为 ${formatMemoryUsage({ used: failure.attemptedUsed ?? failure.used, limit: failure.limit })}。当前条目：`,
    );
    lines.push(...failure.entries.map((entry) => `- ${entry.replaceAll("\n", " ")}`));
    lines.push("请用一次批量操作删旧加新，把最终用量降回预算内。");
  }
  return lines.join("\n");
}

export const memoryTool = defineTool<typeof MemoryParams, MemoryToolDetails>({
  name: MEMORY_TOOL_NAME,
  label: "Memory",
  description: MEMORY_TOOL_DESCRIPTION,
  parameters: MemoryParams,
  executionMode: "sequential",
  promptSnippet: "Read and write cross-session memory about the user and the environment.",
  async execute(_toolCallId, params) {
    const target = params.target as MemoryTarget;
    const operations: MemoryOperation[] = [];
    for (let index = 0; index < params.operations.length; index += 1) {
      const converted = toOperation(params.operations[index]!, index);
      if ("error" in converted) {
        return textResult(converted.error, {
          ok: false,
          target,
          entryCount: 0,
          used: 0,
          limit: 0,
        });
      }
      operations.push(converted.operation);
    }

    const result = await applyMemoryOperations(target, operations);
    if (!result.ok) {
      return textResult(failureText(target, result, operations.length), {
        ok: false,
        target,
        entryCount: result.entries.length,
        used: result.used,
        limit: result.limit,
        code: result.code,
      });
    }
    const usage = formatMemoryUsage(result);
    const text = [
      `已保存到 ${MEMORY_TARGET_FILES[target]}：${result.entries.length} 条条目，${usage}。`,
      "已保存，本会话提示词不刷新；此快照在下个会话生效。",
    ].join("\n");
    return textResult(text, {
      ok: true,
      target,
      entryCount: result.entries.length,
      used: result.used,
      limit: result.limit,
    });
  },
});
