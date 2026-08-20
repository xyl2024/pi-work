// Inbox message center + Settings → Inbox Test preview tool.

export const inbox = {
  // Inbox panel
  "Inbox": "消息中心",
  "Open inbox": "打开消息中心",
  "No messages": "暂无消息",
  "{n} messages": "{n} 条消息",
  "Auto-refresh every 5s": "每 5 秒自动刷新",
  "Clear older than 7 days": "清空 7 天前的消息",
  "Clear all messages?": "清空全部消息？",
  "This will permanently delete all inbox messages.": "这将永久删除全部收件箱消息。",
  "Clear messages from {source}?": "清空来自 {source} 的消息？",
  "This will permanently delete all messages from this source.": "这将永久删除来自该来源的全部消息。",
  "Clear messages older than 7 days?": "清空 7 天前的消息？",
  "This will permanently delete old messages.": "这将永久删除旧消息。",

  // Settings → Inbox Test
  "Inbox Test": "消息中心测试",
  "Push a synthetic message into the Inbox to preview the bell badge, list, and source chip. Real RSS / scheduler pushes are unchanged.": "向消息中心推送一条模拟消息，用于预览铃铛 badge、列表、来源 chip。真实的 RSS / 定时任务推送不受影响。",
  "Test source": "来源",
  "Test level": "级别",
  "Test title": "标题",
  "Test body": "正文",
  "Test link URL": "链接 URL",
  "Test optional hint": "可选",
  "Test optional body hint": "可选，在 Inbox 列表中显示在标题下方的较长文本。",
  "Test must be a valid URL": "必须是合法的 URL",
  "Test sending": "发送中…",
  "Test send": "发送",
  "Test message sent": "测试消息已发送",
  "Test title placeholder": "Hello world",
} as const;
