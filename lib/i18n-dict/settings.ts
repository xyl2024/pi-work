// Settings modal — all of ~/.pi-work/config.yaml sections plus Agent
// retry settings and file preview size limits.

export const settings = {
  // System prompt replacements
  "Settings": "设置",
  "Settings sections": "设置项导航",
  "System Prompt Replacements": "系统提示词替换",
  "Replace literal strings in the system prompt. Changes take effect on new sessions. Existing sessions are unaffected.": "替换系统提示词中的字面量字符串。对新建会话生效，已有会话不受影响。",
  "Enable replacements": "启用替换",
  "Delete rule": "删除规则",
  "+ Add rule": "＋ 添加规则",
  "Failed to load settings": "加载设置失败",
  "Failed to save settings": "保存设置失败",
  "Settings saved": "设置已保存",
  "search": "搜索字符串",
  "replace": "替换为",

  // Append system prompt (~/.pi/agent/APPEND_SYSTEM.md)
  "Append System Prompt": "追加系统提示词",
  "Appended to every new pi session's system prompt. Takes effect on new sessions.": "追加到每个新 pi 会话系统提示词的末尾。对新建会话生效。",
  "Disabled — new sessions will NOT load this file. Edit and save above to keep the content for when you re-enable it.": "已禁用 — 新会话不会加载此文件。仍可在上方编辑保存，以便重新启用时立即生效。",
  "Loading on": "已启用加载",
  "Loading off": "已停用加载",
  "file does not exist yet — saving will create it": "文件尚不存在，保存后将自动创建",
  "Markdown content appended after the built-in system prompt.": "在系统内置提示词之后追加的 Markdown 内容。",
  "Append system prompt saved": "追加系统提示词已保存",
  "Failed to save append system prompt": "保存追加系统提示词失败",

  // Right-side button bar visibility
  "Right-side buttons": "右侧按钮",
  "Choose which buttons appear in the right-side bar. Hidden buttons can still be opened from the command palette. Changes apply immediately.": "选择在右侧按钮栏显示的按钮。隐藏的按钮仍可通过命令面板打开，修改会立即生效。",
  "Button order": "按钮顺序",
  "Reorder the buttons shown in the right-side bar. Up / Down buttons swap adjacent entries; the result is saved immediately.":
    "重新排列右侧按钮的显示顺序。上下按钮交换相邻条目，结果立即保存。",

  // Session-bound button vertical alignment
  "Session-bound button alignment": "会话绑定按钮对齐",
  "Where session-bound buttons sit in the right-side bar. Session-bound buttons (Context, Tool Calls, Conversation Tree, Git Diff, LLM API audit) read from the active session and become empty on the new-session page.":
    "设置会话绑定按钮在右侧按钮列中的纵向对齐方式。会话绑定按钮（Context、Tool Calls、Conversation Tree、Git Diff、LLM API audit）依赖当前会话的数据，在新建会话页面会变成空状态。",
  "Align session-bound buttons to the top": "会话绑定按钮顶部对齐",
  "Align session-bound buttons to the bottom (default)": "会话绑定按钮底部对齐（默认）",
  "Inline with button order (legacy)": "按顺序混排（保留旧行为）",

  // Custom tools enable/disable
  "Custom Tools": "自定义工具",
  "Enable or disable custom pi tools. Changes apply to sessions started after this point; running sessions keep their original tool set.": "启用或禁用自定义 pi 工具。修改只对之后启动的会话生效；已运行的会话保持原有工具集。",
  "Agent Todo": "Agent Todo（智能体任务列表）",
  "Show Media": "Show Media（内联展示多媒体文件）",
  "Ask User Questions": "Ask User Questions（向用户提问）",

  // Chat input typewriter phrases
  "Typewriter phrases": "打字机文案",
  "Custom phrases cycled in the empty chat input. One phrase per line. Empty lines are ignored. Leave both blank to use the bundled defaults.": "在空聊天框中循环显示的文案，每行一条。空行会被忽略；两个都留空则使用内置默认文案。",
  "English phrases": "英文文案",
  "Chinese phrases": "中文文案",
  "Typewriter effect": "打字机效果",
  "Show cycling animated phrases in the empty chat input. Turn off to show a static placeholder instead.": "在空白输入框中循环展示打字机动画文案。关闭后改为显示静态占位文案。",
  "Effect on": "效果开启",
  "Effect off": "效果关闭",

  // Agent Todo tools
  "Pi agent tools": "Pi Agent 工具",
  "Agent tools settings": "设置暴露给 Pi Agent 的待办工具",
  "Tool: user_todos_list": "查看待办",
  "Tool: user_todo_description": "查看待办详情",
  "Applies to new sessions": "将在新会话中生效",

  // File preview size limits (Settings modal + file viewer 413)
  "File preview limits": "文件预览大小",
  "Maximum file size the preview pane will load. Audio and video are streamed with no size limit.": "文件预览面板能加载的最大文件大小。音频和视频是流式播放，不设上限。",
  "Max size for text / code files": "文本 / 代码文件最大大小",
  "Max size for image files": "图片文件最大大小",
  "Max size for PDF files": "PDF 文件最大大小",
  "Range: {min}–{max} MB": "范围：{min}–{max} MB",
  "Must be between {min} and {max}": "必须在 {min}–{max} 之间",
  "Value must not be empty": "值不能为空",
  "File too large: {kind} file is {size} MB, limit is {limit} MB": "文件过大：{kind} 文件 {size} MB，超过 {limit} MB 限制",
  "Image (file kind)": "图片",
  "Text (file kind)": "文本",
  "PDF (file kind)": "PDF",

  // Agent retry settings (~/.pi/agent/settings.json → retry.*)
  // Note: a generic "Retry" key already exists for the HTTP debug panel
  // button. We use "Agent retry" for this section to avoid the
  // object-literal duplicate-key error while keeping the existing
  // button label untouched.
  "Agent retry": "异常重试",
  "Enable retry": "启用重试",
  "Auto-retry on transient LLM errors (overloaded, rate limit, 5xx, stream breaks). Takes effect on new sessions only.":
    "对临时性 LLM 错误（过载、限流、5xx、流中断）自动重试。只对新会话生效。",
  "Max retries": "最大重试次数",
  "Base delay (ms)": "退避基数（毫秒）",
  "Provider retry settings (advanced)": "Provider 层重试（高级）",
  "HTTP request timeout (ms)": "HTTP 请求超时（毫秒）",
  "Provider retries": "Provider 层重试次数",
  "Max server-requested delay (ms)": "Provider 请求延迟上限（毫秒）",
  "Reset to defaults": "恢复默认",
  "Reset retry config": "重试配置已重置为 SDK 默认值",
  "Backoff sequence preview": "退避序列预览",
  "{seconds}s, {seconds2}s, {seconds3}s… (exponential, max {max} retries)": "{seconds}s, {seconds2}s, {seconds3}s…（指数退避，最多 {max} 次）",
  "Applies to new sessions only — active sessions keep their current settings.": "只对新会话生效——当前会话仍使用原有设置。",
} as const;
