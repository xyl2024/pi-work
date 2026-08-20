// Command palette — titles for ⌘K commands (commands.tsx).
// "Command palette" itself is here because the palette dialog title lives
// in components/CommandPalette.tsx, not the chat layer.

export const commands = {
  "Theme: Default": "主题：默认",
  "Theme: Midnight": "主题：夜晚",
  "Theme: Synthwave": "主题：霓虹",
  "Theme: Forest": "主题：森林",
  "Theme: Sepia": "主题：复古",
  "Thinking: Auto": "推理：自动",
  "Thinking: Off": "推理：关闭",
  "Thinking: Minimal": "推理：最少",
  "Thinking: Low": "推理：低",
  "Thinking: Medium": "推理：中",
  "Thinking: High": "推理：高",
  "Thinking: Extra High": "推理：最高",
  "Thinking: Maximum": "推理：最大",
  "Tools: None": "工具：无",
  "Tools: Full": "工具：全部",
  "Toggle sidebar": "切换侧边栏",
  "Toggle right panel": "切换右面板",
  "Open tool calls": "打开工具调用",
  "Open HTTP debug": "打开 HTTP 调试",
  "Open JSON formatter": "打开 JSON 格式化",
  "Open models config": "打开模型配置",
  "Open skills": "打开技能",
  "Open prompts": "打开提示词",
  "Language: English": "语言：English",
  "Language: Chinese": "语言：中文",
  "Command palette": "命令面板",
} as const;
