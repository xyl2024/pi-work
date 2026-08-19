import type { AgentMessage } from "@/lib/types";
import type { AgentPhase } from "@/hooks/useAgentSession";
import { joinFilePath } from "@/lib/file-paths";
import { splitFinalAssistantBlocks } from "@/lib/message-display";

export function phaseLabel(phase: AgentPhase, t: (key: string) => string): string {
  if (phase?.kind === "running_tools") {
    const names = phase.tools.map((tool) => tool.name);
    if (names.length === 0) return t("Running tool...");
    if (names.length === 1) return `${t("Running")} ${names[0]}...`;
    if (names.length <= 3) return `${t("Running")} ${names.join(", ")}...`;
    return `${t("Running")} ${names.slice(0, 2).join(", ")} (+${names.length - 2})...`;
  }
  if (phase?.kind === "waiting_model") return t("Waiting for model...");
  if (phase?.kind === "compacting") return t("Compacting context...");
  return t("Thinking...");
}

export function phaseLoaderVariant(phase: AgentPhase) {
  if (phase?.kind === "waiting_model") return "domino" as const;
  if (phase?.kind === "running_tools") return "rotor" as const;
  if (phase?.kind === "compacting") return "fold" as const;
  return "spark" as const;
}

export function hasStreamingThinking(message: Partial<AgentMessage> | null): boolean {
  if (!message || message.role !== "assistant" || !Array.isArray(message.content)) return false;
  const currentBlock = message.content[message.content.length - 1];
  return currentBlock?.type === "thinking" &&
    typeof currentBlock.thinking === "string" &&
    currentBlock.thinking.trim().length > 0;
}

/** Resolve a `read` tool's raw path against the session cwd. */
export function resolveReadPath(raw: string, cwd?: string | null): string | null {
  const p = raw.startsWith("@") ? raw.slice(1) : raw;
  if (p.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\\\")) return p;
  if (!cwd) return null;
  return joinFilePath(cwd, p);
}

export function isGroupAnchor(msg: AgentMessage): boolean {
  return msg.role === "user";
}

export function hasFinalAssistantAnswer(msg: AgentMessage): boolean {
  if (msg.role !== "assistant") return false;
  return splitFinalAssistantBlocks(msg).answerBlocks.some(
    (block) => block.type === "image" || (block.type === "text" && block.text.trim().length > 0),
  );
}

export function findFinalAssistantIndex(
  messages: AgentMessage[],
  userIdx: number,
  endIdx: number,
): number {
  for (let i = endIdx - 1; i > userIdx; i--) {
    if (hasFinalAssistantAnswer(messages[i])) return i;
  }
  for (let i = endIdx - 1; i > userIdx; i--) {
    if (messages[i]?.role === "assistant") return i;
  }
  return -1;
}

export function hasDisplayableProcessMessage(msg: AgentMessage): boolean {
  if (msg.role !== "assistant") return false;
  const blocks = msg.content ?? [];
  return blocks.some((block) => block.type === "thinking" || block.type === "toolCall");
}
