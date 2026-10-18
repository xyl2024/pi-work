/**
 * Pure helpers for parsing / executing slash commands surfaced in the chat
 * input. None of these touch React state — they only operate on the
 * `SlashResource` shape and the buffer text so they can be shared between
 * the chat input and the slash menu. The server-side `/api/slash-commands`
 * route uses a slimmer local type because it only serves `skill`
 * resources (it never sees the client's built-in `action` entries) and
 * never serializes the full client-side shape; the two types are
 * intentionally separate.
 */

export interface SlashResource {
  source: "skill" | "action";
  name: string;
  command: string;
  description: string;
  path: string;
}

/**
 * Returns the active `/query` token at the cursor position, or `null`
 * when the cursor isn't positioned inside a slash-token prefix. Used by
 * the chat input to decide whether to open the slash menu. The token may
 * appear anywhere in the buffer — including mid-word like `abc/def` —
 * as long as the `/` is immediately before the cursor and the token
 * itself contains no whitespace. The only exception is `://` (URL
 * protocol separators), which never opens the menu.
 */
export function getSlashQuery(value: string, cursor: number): { start: number; query: string } | null {
  if (cursor === 0) return null;
  const beforeCursor = value.slice(0, cursor);
  const match = beforeCursor.match(/\/([^\s/]*)$/);
  if (!match) return null;
  const start = match.index!;
  // Skip URL protocol separators like "https://" so pasted links don't
  // pop the menu open.
  if (start >= 2 && value.slice(start - 2, start + 1) === "://") return null;
  return {
    start,
    query: match[1],
  };
}

/**
 * Builds the message body sent to the agent for a slash command:
 *   - `skill` → the native `/skill:<name>` command with trailing args.
 *     pi's AgentSession (prompt / steer / followUp) expands it server-side
 *     into the canonical `<skill name=… location=…>` block (frontmatter
 *     stripped, references resolved against the skill's baseDir), exactly
 *     like the pi TUI — do NOT splice the raw SKILL.md content here.
 *   - `action` is handled inline by the caller (`selectSlashResource`).
 */
export function formatSlashContent(item: SlashResource, argsString = ""): string {
  const args = argsString.trim();
  return args ? `/skill:${item.name} ${args}` : `/skill:${item.name}`;
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
