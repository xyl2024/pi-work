export interface BaseInfo {
  channel_version: string;
  bot_agent: string;
}

export interface QrCodeResponse {
  qrcode: string;
  qrcode_img_content: string;
}

export type QrStatus =
  | "wait"
  | "scaned"
  | "need_verifycode"
  | "verify_code_blocked"
  | "scaned_but_redirect"
  | "expired"
  | "confirmed"
  | "binded_redirect";

export interface QrStatusResponse {
  status: QrStatus;
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
  redirect_host?: string;
}

export interface SendMessageReq {
  msg: {
    from_user_id: string;
    to_user_id: string;
    client_id: string;
    message_type: number;
    message_state: number;
    item_list?: Array<{
      type: number;
      text_item?: { text: string };
    }>;
    context_token?: string;
  };
}

export interface SendMessageResp {
  ret?: number;
  errmsg?: string;
}

export interface GetConfigResp {
  ret?: number;
  errmsg?: string;
  typing_ticket?: string;
}

export interface GetUpdatesResp {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

export interface WeixinMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  create_time_ms?: number;
  message_type?: number;
  message_state?: number;
  item_list?: Array<{
    type?: number;
    text_item?: { text?: string };
    image_item?: unknown;
    voice_item?: unknown;
    file_item?: unknown;
    video_item?: unknown;
  }>;
  context_token?: string;
}

export interface WeChatContact {
  userId: string;
  firstSeen: string;
  lastSeen: string;
  messageCount: number;
  lastMessagePreview: string;
  contextToken?: string;
}

export interface NotifyResp {
  ret?: number;
  errmsg?: string;
}

export interface WeChatAccount {
  accountId: string;
  token: string;
  baseUrl: string;
  userId?: string;
  savedAt: string;
}

export type LoginPhase =
  | "waiting"
  | "scanned"
  | "verifying"
  | "verify_blocked"
  | "redirected"
  | "confirmed"
  | "already_bound"
  | "expired"
  | "error";

export interface LoginSession {
  channelId?: string;
  sessionKey: string;
  qrcodeUrl: string;
  qrcode: string;
  baseUrl: string;
  botType: string;
  startedAt: number;
  phase: LoginPhase;
  pendingVerifyCode?: string;
  message?: string;
  account?: WeChatAccount;
}
