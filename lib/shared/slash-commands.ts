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
 * Ranks slash resources against a typed query so the menu favors items whose
 * command / name matches before falling back to description-only matches.
 * Lower scores are better; ties keep the caller's order (with shorter
 * commands first, so `/skill:implement` beats `/skill:implement-spec` when
 * both share a prefix). An empty query keeps the input order intact.
 */
export function rankSlashResources(resources: readonly SlashResource[], query: string): SlashResource[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...resources];

  const ranked: { item: SlashResource; score: number; order: number }[] = [];
  resources.forEach((item, order) => {
    const score = slashMatchScore(item, q);
    if (score !== null) ranked.push({ item, score, order });
  });

  ranked.sort(
    (a, b) =>
      a.score - b.score ||
      a.item.command.length - b.item.command.length ||
      a.order - b.order,
  );
  return ranked.map((entry) => entry.item);
}

/**
 * 0: command starts with the query (e.g. `/spec` → `spec-report`)
 * 1: name starts with the query
 * 2: command matches at a word boundary (`implement-spec` for `spec`)
 * 3: command / name contains the query anywhere else
 * 4: only the description contains the query
 * `null` means the resource doesn't match at all.
 */
function slashMatchScore(item: SlashResource, q: string): number | null {
  const command = item.command.toLowerCase();
  const name = item.name.toLowerCase();
  const commandIndex = command.indexOf(q);

  if (commandIndex === 0) return 0;
  if (name.startsWith(q)) return 1;
  if (commandIndex > 0) {
    const separator = command[commandIndex - 1];
    return /[^a-z0-9]/.test(separator) ? 2 : 3;
  }
  if (name.includes(q)) return 3;
  if (item.description.toLowerCase().includes(q)) return 4;
  return null;
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
