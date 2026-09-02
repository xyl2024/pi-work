import type { AgentMessage } from "@/lib/shared/types";
import type { AgentPhase } from "@/hooks/useAgentSession";
import { joinFilePath } from "@/lib/shared/file-paths";
import { splitFinalAssistantBlocks } from "@/lib/shared/message-display";

/** Common tool-arg keys that carry a file path. */
const FILE_PATH_ARG_KEYS = ["path", "file_path", "filePath", "notebook_path", "notebookPath"] as const;

function extractFileBasename(args: Record<string, unknown> | undefined): string | null {
  if (!args) return null;
  for (const key of FILE_PATH_ARG_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value.length > 0) {
      const basename = value.split(/[\\/]/).pop();
      if (basename) return basename;
    }
  }
  return null;
}

function singleToolLabel(tool: { name: string; args?: Record<string, unknown> }, t: (key: string, params?: Record<string, string | number>) => string): string {
  const name = tool.name;
  if (name === "bash") return t("Running bash command...");
  const file = extractFileBasename(tool.args);
  if (name === "edit" || name === "write") return file ? t("Editing file {name}", { name: file }) : t("Running tool {name}", { name });
  if (name === "read" || name === "grep") return file ? t("Reading file {name}", { name: file }) : t("Running tool {name}", { name });
  return t("Running tool {name}", { name });
}

export function phaseLabel(phase: AgentPhase, t: (key: string, params?: Record<string, string | number>) => string): string {
  if (phase?.kind === "running_tools") {
    const tools = phase.tools;
    if (tools.length === 0) return t("Running tool...");
    // Show the most recently started tool; mention the rest as a count.
    const latest = tools[tools.length - 1];
    const label = singleToolLabel(latest, t);
    if (tools.length > 1) return `${label} (+${tools.length - 1})`;
    return label;
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
