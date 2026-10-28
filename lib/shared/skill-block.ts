// ============================================================================
// Skill block（用户消息中的技能展开块）——纯文本判别
//
// pi 的 AgentSession 在服务端把 `/skill:<name> [args]` 原地展开成
// `<skill name="…" location="…">\n…\n</skill>`（可选尾随 `\n\n` + 用户附加
// 文字）再写入 user message（见 pi-coding-agent agent-session 的
// `_expandSkillCommand` / `parseSkillBlock`，两者的正则在此钉住同步）。
// 发给 LLM 的就是这条消息本身——本模块只做展示层的折叠判别，
// 不改写、不截断任何消息内容。
//
// 浏览器 / 服务端两侧共用：禁止 Node API、pi SDK 或 React 依赖。
// ============================================================================

export interface ParsedSkillBlock {
  /** 技能名（slash 命令里的 `<name>`）。 */
  name: string;
  /** SKILL.md 的绝对路径。 */
  location: string;
  /** 技能正文（frontmatter 已剥除）。 */
  content: string;
  /** `</skill>` 之后尾随的用户附加文字（无则 undefined）。 */
  userMessage?: string;
}

// 与 pi-coding-agent 的 parseSkillBlock 保持同一个形状：块必须整条占据
// 消息文本（^…$），location 里的 `"` 由 pi 侧的路径集保证不会出现。
const SKILL_BLOCK_RE =
  /^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/;

/**
 * 判别一条用户消息文本是否是技能展开块。非技能消息（含未被展开的
 * `/skill:xxx` 原文）返回 null，调用方继续走普通渲染。
 */
export function parseSkillBlock(text: string): ParsedSkillBlock | null {
  const match = text.match(SKILL_BLOCK_RE);
  if (!match) return null;
  return {
    name: match[1],
    location: match[2],
    content: match[3],
    userMessage: match[4]?.trim() || undefined,
  };
}
