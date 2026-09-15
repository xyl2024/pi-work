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
  "Subagent settings": "子代理设置",
  "Configure the model and thinking level used by new subagent sessions.": "配置新建子代理会话使用的模型和推理强度。",
  "Inherit parent model": "继承父会话模型",
  "Subagent model": "子代理模型",
  "Subagent thinking level": "子代理推理强度",
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

  // Pi documentation loader toggle (~/.pi-work/config.yaml → load_pi_docs)
  "Pi documentation": "Pi 文档",
  "Load Pi documentation": "加载 Pi 文档",
  "Loaded — new sessions include pi's built-in Pi documentation hints. Takes effect on new sessions.": "已启用 — 新建会话会包含 pi 内置的 Pi 文档提示。仅对之后新建的会话生效。",
  "Disabled — new sessions will not include pi's built-in Pi documentation hints. Takes effect on new sessions.": "已禁用 — 新建会话将不包含 pi 内置的 Pi 文档提示。仅对之后新建的会话生效。",

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
  "Show Media": "Show Media（内联展示多媒体文件）",
  "Ask User Questions": "Ask User Questions（向用户提问）",

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

  // UI sounds
  "UI Sounds": "界面音效",
  "Pick one of the built-in recipes for each event, or choose None to stay silent. A master volume scales every event.": "为每个事件选择一种内置音效，或选择 None 静音。主音量调节影响所有事件。",
  "Restore sound defaults": "恢复音效默认",
  "Sound defaults restored": "音效默认已恢复",
  "Master volume": "主音量",
  "Sounds enabled": "启用音效",
  "Built-in sound: {name}": "内置音效：{name}",
  "No sound": "无声",
  "Event: toast success": "事件：Toast 成功",
  "Event: toast error": "事件：Toast 错误",
  "Event: toast info": "事件：Toast 提示",
  "Event: agent success": "事件：Agent 正常完成",
  "Event: agent failure": "事件：Agent 最终失败",
  "Event: inbox new message": "事件：收件箱新消息",
  "Event: RSS new article": "事件：RSS 新文章",
  "Event: ask user questions": "事件：向用户提问",
  "Event: celebration": "事件：庆祝动画",
  "morning-light": "晨曦",
  "lonely-shadow": "孤影",
  "tipsy": "微醺",
  "dawn": "破晓",
  "ink": "水墨",
  "firefly": "萤火",
  "weightless": "失重",
  "sea-breeze": "海风",
  "celebration": "欢庆",

  // Network proxy (~/.pi-work/config.yaml → network_proxy)
  "Network proxy": "网络代理",
  "Route every outbound server request — model calls, RSS, GitHub Trending — through an HTTP proxy. Takes effect immediately, no restart needed.":
    "服务端所有对外请求（模型调用、RSS、GitHub Trending 等）都走这个 HTTP 代理。保存后立即生效，无需重启。",
  "Use proxy": "启用代理",
  "Enter a proxy address first — it is required to enable or test the proxy.":
    "请先填写代理地址 —— 启用和测试都需要它。",
  "Proxy enabled — {url}": "代理已启用 —— {url}",
  "Proxy disabled": "代理未启用",
  "Proxy address": "代理地址",
  "Bypass list (optional)": "绕过列表（可选）",
  "Comma-separated hosts or suffixes. {hosts} are always bypassed.":
    "逗号分隔的主机名或后缀。{hosts} 始终不走代理。",
  "Test connection": "测试连接",
  "Testing…": "测试中…",
  "Proxy reachable — {status} in {ms} ms": "代理可用 — {status}，耗时 {ms} ms",
  "Proxy test failed: {error}": "代理测试失败：{error}",
  "unknown error": "未知错误",
  "The connection test sends one request to {url} through the proxy. Only http:// and https:// proxies are supported.":
    "测试连接会通过该代理向 {url} 发一次真实请求。仅支持 http:// 与 https:// 代理。",
} as const;
