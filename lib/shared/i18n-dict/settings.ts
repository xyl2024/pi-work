// Settings modal — all of ~/.pi-work/config.yaml sections plus Agent
// retry settings and file preview size limits.

export const settings = {
  // System prompt replacements
  "Settings": "设置",
  "Settings sections": "设置项导航",
  // Settings modal groups (registry.ts)
  "Personal": "个人",
  "Interface & appearance": "界面与外观",
  "Agent": "Agent",
  "Integrations & network": "集成与网络",
  "Developer": "开发者",
  "System Prompt Replacements": "系统提示词替换",
  "Replace literal strings in the system prompt. Changes take effect on new sessions. Existing sessions are unaffected.": "替换系统提示词中的字面量字符串。对新建会话生效，已有会话不受影响。",
  "Enable replacements": "启用替换",
  "Delete rule": "删除规则",
  "+ Add rule": "＋ 添加规则",
  "Failed to load settings": "加载设置失败",
  "Failed to save settings": "保存设置失败",
  "Settings saved": "设置已保存",
  "Unsaved changes": "有未保存的更改",
  "Discard unsaved changes?": "放弃未保存的更改？",
  "Subagent settings": "子代理设置",
  "Inherit parent model": "继承父会话模型",
  "Subagent thinking level": "子代理推理强度",
  "New subagent": "新建子代理",
  "Edit subagent": "编辑子代理",
  "Built-in": "内置",
  "Delete subagent \"{name}\"?": "删除子代理“{name}”？",
  "Create the agents the spawn_subagent tool can launch. Each has its own prompt, tools, model, Pi Bot and timeout.": "创建 spawn_subagent 工具可以调用的子代理。每个子代理拥有独立的提示词、工具、模型、Pi Bot 形象与超时配置。",
  "No subagents configured yet.": "还没有配置子代理。",
  "The model passes this as subagent_name. Immutable after creation.": "模型通过 subagent_name 传入该名称，创建后不可修改。",
  "Shown to the parent model so it knows when to use this subagent.": "展示给父级模型，用于判断何时使用该子代理。",
  "Timeout (minutes)": "超时（分钟）",
  "The child run is stopped when it exceeds this.": "子代理运行超过该时长后会被停止。",
  "You are now in …": "你现在处于……",
  "The child's working directory is appended automatically at run time.": "运行时会自动追加子代理的当前工作目录。",
  "Pi Bot appearance": "Pi Bot 形象",
  "{n} min": "{n} 分钟",
  "{n} tools": "{n} 个工具",
  "Name must start with a lowercase letter and use only lowercase letters, digits, '_' or '-'.": "名称必须以小写字母开头，只能包含小写字母、数字、下划线或连字符。",
  "Description is required.": "描述不能为空。",
  "System prompt is required.": "系统提示词不能为空。",
  "Timeout must be between {min} and {max} minutes.": "超时时间必须在 {min} 到 {max} 分钟之间。",
  "Failed to save subagent": "保存子代理失败",
  "search": "搜索字符串",
  "replace": "替换为",

  // System prompt: append file (~/.pi/agent/APPEND_SYSTEM.md) + loader toggles
  "System Prompt": "系统提示词",
  "Append System Prompt": "追加系统提示词",
  "Loading on": "已启用加载",
  "Loading off": "已停用加载",
  "file does not exist yet — saving will create it": "文件尚不存在，保存后将自动创建",
  "Markdown content appended after the built-in system prompt.": "在系统内置提示词之后追加的 Markdown 内容。",
  "Append system prompt saved": "追加系统提示词已保存",
  "Failed to save append system prompt": "保存追加系统提示词失败",

  // Pi documentation loader toggle (~/.pi-work/config.yaml → load_pi_docs)
  "Pi documentation": "Pi 文档",

  // Right-side button bar: visibility + order share one list
  "Right-side buttons": "右侧按钮",
  "Button order": "按钮顺序",
  "Enable button": "启用",
  "Disable button": "关闭",
  // Order-list groups (the column stacks session-bound and other buttons)
  "All buttons": "全部按钮",
  "Session-bound buttons": "会话绑定按钮",
  "Other buttons": "其他按钮",
  "top section": "上方",
  "bottom section": "下方",

  // Session-bound button vertical alignment
  "Session-bound button alignment": "会话绑定按钮对齐",
  "Align session-bound buttons to the top": "会话绑定按钮顶部对齐",
  "Align session-bound buttons to the bottom (default)": "会话绑定按钮底部对齐（默认）",
  "Inline with button order (legacy)": "按顺序混排（保留旧行为）",

  "Ask User Questions": "Ask User Questions（向用户提问）",
  "No tools available": "此项目下没有可用工具",

  // File preview size limits (Settings modal + file viewer 413)
  "File preview limits": "文件预览大小",
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
