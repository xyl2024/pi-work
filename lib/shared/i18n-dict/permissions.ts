export const permissions = {
  "Permission required": "需要确认",
  "Rule: {name}": "规则:{name}",
  "Agent wants to run a potentially dangerous command:": "Agent 想执行一条可能危险的命令:",
  "Allow once": "允许一次",
  "Allow similar for this session": "本次会话允许同类",
  "Deny": "拒绝",
  "Permission denied": "已拒绝",
  "Permission timed out": "确认超时,已拒绝",
  "Awaiting command approval": "等待确认命令执行",
  "Failed to send the permission decision": "权限决定发送失败",

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
  "Dangerous commands": "危险命令",
  "Auto-deny": "自动拒绝",
  "Full access": "完全访问",
  "Auto-deny dangerous commands": "自动拒绝危险命令",
  "Full access to dangerous commands": "危险命令完全访问",
  "This unattended session denies dangerous commands instead of asking.":
    "这个无人值守会话遇到危险命令时直接拒绝，不会询问。",
  "This background session runs dangerous commands without asking.":
    "这个后台会话里的危险命令不再询问，直接执行。",
} as const;
