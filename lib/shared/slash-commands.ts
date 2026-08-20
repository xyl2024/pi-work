/**
 * Pure helpers for parsing / executing slash commands surfaced in the chat
 * input. None of these touch React state — they only operate on the
 * `SlashResource` shape and the buffer text so they can be shared between
 * the chat input, the slash menu, the search filter, and the server-side
 * substitution in `/api/agent`. The server-side `/api/slash-commands`
 * route uses a slimmer local type because it only sees `prompt`/`skill`
 * resources (no `action`) and never serializes the full client-side
 * shape; the two types are intentionally separate.
 */

export interface SlashResource {
  source: "prompt" | "skill" | "action";
  name: string;
  command: string;
  description: string;
  argumentHint?: string;
  path: string;
  location?: string;
  content: string;
}

/**
 * Returns the active `/query` token at the cursor position, or `null`
 * when the cursor isn't positioned inside a slash-token prefix. Used by
 * the chat input to decide whether to open the slash menu.
 */
export function getSlashQuery(value: string, cursor: number): { start: number; query: string } | null {
  if (cursor === 0 || value[0] !== "/") return null;
  const beforeCursor = value.slice(0, cursor);
  const match = beforeCursor.match(/^\/([^\s/]*)$/);
  if (!match) return null;
  return {
    start: 0,
    query: match[1],
  };
}

/**
 * Tokenises a slash command's argument string into an array, supporting
 * double- and single-quoted positional values (per pi's prompt template
 * semantics). Whitespace separates tokens; quotes allow embedded spaces.
 */
export function parseCommandArgs(argsString: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuote: "\"" | "'" | null = null;

  for (const char of argsString) {
    if (inQuote) {
      if (char === inQuote) inQuote = null;
      else current += char;
    } else if (char === "\"" || char === "'") {
      inQuote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }

  if (current) args.push(current);
  return args;
}

/**
 * Expands `$1`, `$@:N:M`, `$@`, `$ARGUMENTS` placeholders inside a prompt
 * template against the parsed argument list. Mirrors pi's built-in
 * template engine so the user sees the same expansion locally that the
 * backend will perform on the wire.
 */
export function substitutePromptArgs(content: string, args: string[]): string {
  let result = content;
  result = result.replace(/\$(\d+)/g, (_, num: string) => args[parseInt(num, 10) - 1] ?? "");
  result = result.replace(/\$\{@:(\d+)(?::(\d+))?\}/g, (_, startStr: string, lengthStr?: string) => {
    const start = Math.max(0, parseInt(startStr, 10) - 1);
    if (lengthStr) return args.slice(start, start + parseInt(lengthStr, 10)).join(" ");
    return args.slice(start).join(" ");
  });
  const allArgs = args.join(" ");
  result = result.replace(/\$ARGUMENTS/g, allArgs);
  result = result.replace(/\$@/g, allArgs);
  return result;
}

/**
 * True when the prompt template references any of the argument
 * placeholders. Used by `formatSlashContent` to decide whether to
 * append the unused args as a trailing block (only safe when the
 * template doesn't already consume them).
 */
export function hasPromptArgPlaceholder(content: string): boolean {
  return /\$(\d+|@|ARGUMENTS)|\$\{@:\d+(?::\d+)?\}/.test(content);
}

/**
 * Builds the message body sent to the agent for a slash command:
 *   - `prompt` → template expanded with parsed args (plus raw args
 *     appended when the template has no placeholders).
 *   - `skill` → either the raw args (so the agent can read them) or
 *     a `Use this skill: <name>` line that names the skill directly.
 *   - `action` is handled inline by the caller (`selectSlashResource`).
 */
export function formatSlashContent(item: SlashResource, argsString = "", appendUnusedArgs = false): string {
  const content = item.content.trim();
  if (item.source === "prompt") {
    const expanded = substitutePromptArgs(content, parseCommandArgs(argsString));
    const args = argsString.trim();
    if (appendUnusedArgs && args && !hasPromptArgPlaceholder(content)) {
      return `${expanded}\n\n${args}`;
    }
    return expanded;
  }

  const name = item.name.replace(/"/g, "&quot;");
  const skillReference = `Use this skill: ${name}`;
  const args = argsString.trim();
  return args ? `${args}\n\n${skillReference}` : skillReference;
}

/**
 * Recognises a typed `/command` invocation (Enter pressed directly on a
 * bare command without opening the menu). Returns the matching resource
 * and its trailing argument string, or `null` when the buffer isn't a
 * slash command.
 */
export function findDirectSlashResource(message: string, resources: SlashResource[]): { item: SlashResource; args: string } | null {
  const match = message.trim().match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;

  const command = match[1];
  const item = resources.find((resource) => resource.command === command);
  if (!item) return null;

  return { item, args: match[2] ?? "" };
}
