// Dangerous-command permission flow (PermissionDialog component).
// Esc → deny, Enter → allow once, backdrop-click → deny are the safe
// defaults — see AGENTS.md "Permission defaults are safe".

export const permissions = {
  "Permission required": "需要确认",
  "Rule: {name}": "规则:{name}",
  "Agent wants to run a potentially dangerous command:": "Agent 想执行一条可能危险的命令:",
  "Allow once": "允许一次",
  "Allow similar for this session": "本次会话允许同类",
  "Deny": "拒绝",
  "Permission denied": "已拒绝",
  "Permission timed out": "确认超时,已拒绝",
  // Sidebar row dot (SessionItem): a session is blocked on a command
  // confirmation the user has not answered yet. The dot is the only cue once
  // the user switches to another tab, because the dialog only renders for the
  // focused session.
  "Awaiting command approval": "等待确认命令执行",
  "Failed to send the permission decision": "权限决定发送失败",

  // Session-level permission mode (ADR-0021). These live here rather than in
  // the chat dictionary because this is the same permission semantics the
  // dialog above belongs to — the dialog asks once, the mode says whether it
  // asks at all.
  "Allow full access": "完全访问",
  "Confirm dangerous commands": "确认危险命令",
  "Switch to allow full access": "切换到完全访问",
  "Switch to confirm dangerous commands": "切换到确认危险命令",
  "Dangerous commands in this session run without asking. Self-protection still blocks commands that would kill the Pi Work server.":
    "本会话里的危险命令不再询问,直接执行;自保护仍会拦下会杀掉 Pi Work 服务进程的命令。",
  "Dangerous commands in this session ask for confirmation before they run.":
    "本会话里的危险命令执行前会先征求确认。",
  "This session is in full access": "本会话处于完全访问",
  "Failed to change permission mode": "切换权限模式失败",
} as const;
