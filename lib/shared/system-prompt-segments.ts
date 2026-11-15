export type SystemPromptSegment =
  | { kind: "base"; start: number; end: number; text: string }
  | { kind: "agents"; path: string; start: number; end: number; text: string };

export type BasePromptBlock = {
  anchor: string | null;
  start: number;
  end: number;
  text: string;
};

export type SystemPromptLeafKind = "base" | "skills" | "agents";

export interface SystemPromptLeaf {
  id: string;
  kind: SystemPromptLeafKind;
  start: number;
  end: number;
  text: string;
  path?: string;
}

const SECTION_ANCHORS: Record<string, string> = {
  tools: "available-tools",
  rules: "guidelines",
  docs: "pi-docs",
  addendum: "append",
  memory: "memory",
  skills: "skills",
  cwd: "cwd",
};

const SECTION_RE = /<(tools|rules|docs|addendum|memory|skills|cwd)>\n([\s\S]*?)\n<\/\1>/g;

const NESTED_MEMORY_RE = /<memory>\n([\s\S]*?)\n<\/memory>/;

const PROJECT_CONTEXT_WRAPPER_RE = /<project_context>\n|\n<\/project_context>/g;

const PROJECT_INSTRUCTIONS_RE = /<project_instructions path="([^"]+)">([\s\S]*?)<\/project_instructions>/g;

const PROJECT_CONTEXT_RE = /<project_context>\n([\s\S]*?)\n<\/project_context>/g;

export function splitSystemPrompt(systemPrompt: string): SystemPromptSegment[] {
  const segments: SystemPromptSegment[] = [];
  const pushBase = (start: number, end: number) => {
    if (end <= start) return;
    const last = segments[segments.length - 1];
    if (last && last.kind === "base" && last.end === start) {
      last.end = end;
      last.text = systemPrompt.slice(last.start, end);
      return;
    }
    segments.push({ kind: "base", start, end, text: systemPrompt.slice(start, end) });
  };

  let cursor = 0;
  PROJECT_CONTEXT_RE.lastIndex = 0;
  let section: RegExpExecArray | null;
  while ((section = PROJECT_CONTEXT_RE.exec(systemPrompt)) !== null) {
    const sectionEnd = section.index + section[0].length;
    const contentStart = section.index + "<project_context>\n".length;
    pushBase(cursor, contentStart);

    const content = section[1];
    let innerCursor = contentStart;
    PROJECT_INSTRUCTIONS_RE.lastIndex = 0;
    let inner: RegExpExecArray | null;
    while ((inner = PROJECT_INSTRUCTIONS_RE.exec(content)) !== null) {
      const start = contentStart + inner.index;
      const end = start + inner[0].length;
      pushBase(innerCursor, start);
      segments.push({
        kind: "agents",
        path: inner[1],
        start,
        end,
        text: inner[2].replace(/^\n+|\n+$/g, ""),
      });
      innerCursor = end;
    }
    pushBase(innerCursor, sectionEnd);
    cursor = sectionEnd;
  }
  pushBase(cursor, systemPrompt.length);
  return segments;
}

export function splitBaseBlocks(text: string, offset = 0): BasePromptBlock[] {
  const blocks: BasePromptBlock[] = [];
  const pushFiller = (start: number, end: number) => {
    if (end <= start) return;
    blocks.push({
      anchor: null,
      start: offset + start,
      end: offset + end,
      text: text.slice(start, end).replace(PROJECT_CONTEXT_WRAPPER_RE, ""),
    });
  };

  const pushBlock = (anchor: string | null, start: number, end: number, text: string) => {
    blocks.push({
      anchor,
      start: offset + start,
      end: offset + end,
      text,
    });
  };

  SECTION_RE.lastIndex = 0;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = SECTION_RE.exec(text)) !== null) {
    const start = match.index;
    pushFiller(cursor, start);
    const body = match[2];
    const memory = match[1] === "addendum" ? NESTED_MEMORY_RE.exec(body) : null;
    if (!memory) {
      const anchor = SECTION_ANCHORS[match[1]] ?? null;
      pushBlock(anchor, start, start + match[0].length, body);
      cursor = start + match[0].length;
      continue;
    }
    const bodyStart = start + "<addendum>\n".length;
    const memoryBodyStart = bodyStart + memory.index;
    const memoryBodyEnd = memoryBodyStart + memory[1].length;
    const head = body.slice(0, memory.index);
    const tail = body.slice(memory.index + memory[0].length);
    if (head.trim()) pushBlock("append", bodyStart, memoryBodyStart, head);
    pushBlock("memory", memoryBodyStart, memoryBodyEnd, memory[1]);
    if (tail.trim()) pushBlock("append", memoryBodyEnd, bodyStart + body.length, tail);
    cursor = start + match[0].length;
  }
  pushFiller(cursor, text.length);
  return blocks;
}

export function splitSystemPromptLeaves(systemPrompt: string): SystemPromptLeaf[] {
  const leaves: SystemPromptLeaf[] = [];
  const push = (leaf: SystemPromptLeaf) => {
    if (leaf.end > leaf.start) leaves.push(leaf);
  };

  for (const segment of splitSystemPrompt(systemPrompt)) {
    if (segment.kind === "agents") {
      push({
        id: `agents:${segment.path}`,
        kind: "agents",
        start: segment.start,
        end: segment.end,
        text: segment.text,
        path: segment.path,
      });
      continue;
    }
    for (const block of splitBaseBlocks(segment.text, segment.start)) {
      if (block.anchor === "skills") {
        push({
          id: "skills",
          kind: "skills",
          start: block.start,
          end: block.end,
          text: block.text,
        });
        continue;
      }
      push({
        id: block.anchor ?? `base:${leaves.length}`,
        kind: "base",
        start: block.start,
        end: block.end,
        text: block.text,
      });
    }
  }
  return leaves;
}

function sectionRe(name: string): RegExp {
  return new RegExp(`\\n*<${name}>\\n([\\s\\S]*?)\\n</${name}>`, "g");
}

export function dropSystemPromptSection(prompt: string, name: string): string {
  return prompt.replace(sectionRe(name), "");
}

export function rewriteSystemPromptSection(
  prompt: string,
  name: string,
  render: (body: string) => string,
): string {
  return prompt.replace(sectionRe(name), (_match, body: string) => `\n\n${render(body)}\n`);
}

export function stripDefaultSystemPromptSections(prompt: string): string {
  let out = prompt
    .replace(
      /^You are an expert coding assistant operating inside pi, a coding agent harness\. You help users by reading files, executing commands, editing code, and writing new files\.\s*/,
      "",
    )
    .replace(
      /\nIn addition to the tools above, you may have access to other custom tools depending on the project\./,
      "",
    );
  out = dropSystemPromptSection(out, "docs");
  out = rewriteSystemPromptSection(out, "tools", (body) => `Available tools:\n${body}`);
  out = rewriteSystemPromptSection(out, "rules", (body) => `Guidelines:\n${body}`);
  out = rewriteSystemPromptSection(out, "cwd", (body) => `Current working directory: ${body}`);
  for (const name of ["addendum", "memory", "project_context", "skills"]) {
    out = rewriteSystemPromptSection(out, name, (body) => body);
  }
  return out.trim();
}

export function stripPiDocumentationSection(prompt: string): string {
  return dropSystemPromptSection(prompt, "docs").trimStart();
}
