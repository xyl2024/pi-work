export type ChannelProvider = "wechat";
export type ChannelStatus = "pending" | "connected" | "disabled" | "expired";

export interface ChannelRecord {
  id: string;
  name: string;
  provider: ChannelProvider;
  status: ChannelStatus;
  workspaceId: string | null;
  currentSessionId: string | null;
  syncBuf: string;
  accountId: string | null;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelActivity {
  ts: string;
  kind:
    | "message_received"
    | "session_started"
    | "agent_sent"
    | "agent_done"
    | "agent_error"
    | "reply"
    | "reply_failed"
    | "session_reset"
    | "workspace_missing"
    | "workspace_unusable"
    | "token_expired"
    | "worker_started"
    | "worker_stopped";
  text?: string;
  fromUserId?: string;
  sessionId?: string;
  durationMs?: number;
  detail?: string;
}
