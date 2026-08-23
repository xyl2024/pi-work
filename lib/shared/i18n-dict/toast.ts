// Toast notification UI — sidebar label, kind names, and Settings → Toast
// Test preview strings.
//
// Mirrors the English source-key approach used by every other dictionary:
// the key is the English string, the value is the Simplified Chinese
// translation. Missing keys fall back to the literal key (see
// hooks/useI18n.tsx).

export const toast = {
  // Sidebar nav label — appears in Settings.
  "Toast Test": "通知测试",

  // Settings → Toast Test section
  "Preview each toast kind, custom duration, description, and action button directly without firing any backend request.":
    "直接预览每种通知样式、自定义时长、描述和操作按钮，无需后端接口。",
  "Kind": "类型",
  "success": "成功",
  "error": "失败",
  "info": "提示",
  "warning": "警告",
  "Show": "显示",
  "Show without icon": "无图标",
  "Show this toast": "显示一条通知",
  "Show with description": "带描述",
  "Show with description and action": "带描述 + 操作",
  "Show with long message and description": "带超长文本",
  "Show with custom duration": "自定义时长",
  "Show 5 stacked toasts": "连续弹出 5 条",
  "Custom duration (ms)": "自定义时长（毫秒）",
  "Custom message": "自定义文案",
  "Optional description (multi-line)": "描述（可选，支持换行）",
  "Optional action label": "操作按钮文案（可选）",

  // The actual notification copy used by the test buttons. Keeping these
  // short and visually representative of the real-world UI so the preview
  // matches what the user will see in daily use.
  "Test toast (default copy)": "这是一条通知",
  "Saved successfully": "已保存",
  "Failed to save": "保存失败",
  "New update available": "有可用更新",
  "Network is unstable": "网络不太稳定",

  // Status / feedback after a test
  "Toast dispatched": "已发送通知",
  "Action clicked": "已点击操作",
} as const;
