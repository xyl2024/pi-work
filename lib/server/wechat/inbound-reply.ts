import type { TurnResult } from "@/lib/server/turn";

export const EMPTY_REPLY_FALLBACK = "（agent 没有产生输出）";

export type InboundTurnResult = Pick<TurnResult, "status" | "text" | "hasReply" | "error">;

export interface InboundReply {
  ok: boolean;
  text: string;
  error: string | null;
}

export function toInboundReply(result: InboundTurnResult, timeoutMs: number): InboundReply {
  if (result.status === "completed") {
    return { ok: true, text: result.hasReply ? result.text : EMPTY_REPLY_FALLBACK, error: null };
  }
  if (result.status === "timeout") {
    return { ok: false, text: "", error: `agent_end timed out after ${timeoutMs}ms` };
  }
  return { ok: false, text: "", error: result.error ?? `turn ${result.status}` };
}
