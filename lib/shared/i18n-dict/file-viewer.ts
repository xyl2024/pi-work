// File viewer — inline search, word-wrap, line numbers, audio player.
// The inline search is reused for any TextViewer/MarkdownViewer render.
// "Wrap", "Fit", "Source / Diff / Code / Preview / Raw" live in common.ts.

export const fileViewer = {
  // Inline search
  "Search file": "在文件中搜索",
  "Search file...": "搜索文件内容…",
  "Match case": "区分大小写",
  "No file matches": "文件内无匹配",
  "Next match": "下一匹配",
  "Previous match": "上一匹配",
  "Close search": "关闭搜索",
  "virtualized": "虚拟滚动",
  "Word wrap is disabled for large files": "大文件已禁用自动换行",
  "unchanged lines": "行未变更",
  "Deleted lines": "已删除的行",
  "Disable word wrap": "关闭自动换行",
  "Enable word wrap": "开启自动换行",
  "Live sync active": "实时同步已开启",
  "Not watching": "未监听",
  "HTML preview": "HTML 预览",
  "Provider API Requests": "模型 API 请求",
  "Request payload": "请求负载",
  "Response headers": "响应头",
  "View API request for this response": "查看本次响应对应的原始 API 请求",
  "API request pending": "请求中…",
  "Copy as cURL": "复制为 cURL",
  "Endpoint": "接口地址",
  "Request body": "请求体",
  "Payload status code": "状态码",
  "Payload duration": "耗时",
  "Payload provider": "服务商",

  // Audio player (vinyl-disc aesthetic, 0.5x–2x speed)
  "Play": "播放",
  "Pause": "暂停",
  "Mute": "静音",
  "Unmute": "取消静音",
  "Volume": "音量",
  "Speed": "速度",
  "Seek": "跳转",
  "Replay": "回放",
  "Close replay": "关闭回放",
  "Step back": "上一条",
  "Step forward": "下一条",

  // Markdown export / share
  "Export as PNG": "导出为 PNG 图片",
  "Share this message card": "分享此消息卡片",
  "Message card exported": "消息卡片已导出",
  "Failed to export image": "导出图片失败",
} as const;
