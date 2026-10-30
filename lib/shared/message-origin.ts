export const MESSAGE_ORIGIN_ENTRY_TYPE = "pi_work_message_origin";

export interface MessageOriginEntryData {
  origin: MessageOrigin;
  timestamp: number;
  messagePrefix: string;
}

export const MESSAGE_ORIGIN_ICONS = {
  channel: "MessageCircle",
  "scheduled-task": "CalendarClock",
  "subagent-session": "Bot",
} as const;

export interface MessageOriginDisplay {
  icon: string | undefined;
  label: string | undefined;
  hover: { key: string; params: Record<string, string> } | undefined;
}

export function normalizeMessageOrigin(value: unknown): MessageOrigin {
  if (isMessageOrigin(value)) return value;
  return { kind: "web" };
}

export function isMessageOrigin(value: unknown): value is MessageOrigin {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  switch (o.kind) {
    case "web":
      return true;
    case "channel":
      return (
        typeof o.channelId === "string" && o.channelId !== "" &&
        typeof o.provider === "string" && o.provider !== "" &&
        typeof o.name === "string" && o.name !== ""
      );
    case "scheduled-task":
      return (
        typeof o.taskId === "string" && o.taskId !== "" &&
        typeof o.name === "string" && o.name !== ""
      );
    case "subagent-session":
      return (
        typeof o.parentSessionId === "string" && o.parentSessionId !== "" &&
        typeof o.parentSessionTitle === "string" && o.parentSessionTitle !== "" &&
        typeof o.childSessionId === "string" && o.childSessionId !== ""
      );
    default:
      return false;
  }
}

export function isMessageOriginEntryData(value: unknown): value is MessageOriginEntryData {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  return (
    isMessageOrigin(o.origin) &&
    typeof o.timestamp === "number" && Number.isFinite(o.timestamp) &&
    typeof o.messagePrefix === "string"
  );
}

export function buildMessageOriginEntryData(
  prompt: string,
  origin: MessageOrigin,
  timestamp: number = Date.now(),
  prefixLength: number = 80,
): MessageOriginEntryData {
  const messagePrefix = [...String(prompt).slice(0, prefixLength * 2)].slice(0, prefixLength).join("");
  return { origin, timestamp, messagePrefix };
}

export function messageOriginDisplay(origin: MessageOrigin | undefined | unknown): MessageOriginDisplay {
  const resolved = normalizeMessageOrigin(origin);
  if (resolved.kind === "web") return { icon: undefined, label: undefined, hover: undefined };
  if (resolved.kind === "channel") {
    return {
      icon: MESSAGE_ORIGIN_ICONS.channel,
      label: resolved.name,
      hover: { key: "Message from channel {channel}", params: { channel: resolved.name } },
    };
  }
  if (resolved.kind === "scheduled-task") {
    return {
      icon: MESSAGE_ORIGIN_ICONS["scheduled-task"],
      label: resolved.name,
      hover: { key: "Message from scheduled task {task}", params: { task: resolved.name } },
    };
  }
  return {
    icon: MESSAGE_ORIGIN_ICONS["subagent-session"],
    label: resolved.parentSessionTitle,
    hover: { key: "Message from session {session}", params: { session: resolved.parentSessionTitle } },
  };
}

export type MessageOrigin =
  | { kind: "web" }
  | { kind: "channel"; channelId: string; provider: string; name: string }
  | { kind: "scheduled-task"; taskId: string; name: string }
  | {
      kind: "subagent-session";
      parentSessionId: string;
      parentSessionTitle: string;
      childSessionId: string;
    };
