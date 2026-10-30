import { appendFileSync, mkdirSync, existsSync, writeFileSync } from "fs";
import { dataPath } from "../data-dir";

export type SessionLogEvent =
  | { kind: "inbound"; fromUserId: string; text: string; contextToken?: string }
  | { kind: "command"; fromUserId: string; command: string }
  | { kind: "cold_start"; sessionId: string; cwd: string; fromUserId: string }
  | { kind: "send"; sessionId: string; fromUserId: string; text: string }
  | { kind: "typing"; sessionId: string; fromUserId: string }
  | { kind: "agent_end"; sessionId: string; fromUserId: string; durationMs: number; replyText: string }
  | { kind: "agent_error"; sessionId: string; fromUserId: string; error: string }
  | { kind: "reply"; sessionId: string; fromUserId: string; length: number; messageId?: number }
  | { kind: "reply_failed"; sessionId: string; fromUserId: string; error: string };

function logPath(): string {
  return dataPath("wechat", "sessions.log");
}

let initialized = false;
function ensureInit(): void {
  if (initialized) return;
  initialized = true;
  const p = logPath();
  if (!existsSync(p)) {
    try {
      mkdirSync(dataPath("wechat"), { recursive: true });
      writeFileSync(p, "", "utf8");
    } catch {
    }
  }
}

export function logSessionEvent(event: SessionLogEvent): void {
  ensureInit();
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event });
  try {
    appendFileSync(logPath(), line + "\n", "utf8");
  } catch {
  }
}
