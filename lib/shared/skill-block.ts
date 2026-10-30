export interface ParsedSkillBlock {
  name: string;
  location: string;
  content: string;
  userMessage?: string;
}

export function parseSkillCommand(text: string): { name: string; userMessage?: string } | null {
  const match = text.match(/^\/skill:([^\s]+)(?: ([\s\S]*))?$/);
  if (!match) return null;
  return { name: match[1], userMessage: match[2]?.trim() || undefined };
}

const SKILL_BLOCK_RE =
  /^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/;

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
