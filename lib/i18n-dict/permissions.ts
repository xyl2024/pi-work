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
} as const;
