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

/**
 * A human-readable per-channel lifecycle event surfaced in the channel
 * details UI (the "recent activity" feed). Structured so the frontend can
 * render it through i18n rather than shipping pre-baked strings.
 */
export interface ChannelActivity {
  ts: string;
  /** Machine kind; the UI maps it to an i18n key `channels.act.<kind>`. */
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
  /** User message text / reply text preview. */
  text?: string;
  fromUserId?: string;
  sessionId?: string;
  /** For `agent_done`: how long the agent run took, ms. */
  durationMs?: number;
  /** Optional human detail (e.g. error text). */
  detail?: string;
}
