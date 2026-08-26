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
