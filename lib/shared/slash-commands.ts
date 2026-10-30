export interface SlashResource {
  source: "skill" | "action";
  name: string;
  command: string;
  description: string;
  path: string;
}

export function getSlashQuery(value: string, cursor: number): { start: number; query: string } | null {
  if (cursor === 0) return null;
  const beforeCursor = value.slice(0, cursor);
  const match = beforeCursor.match(/\/([^\s/]*)$/);
  if (!match) return null;
  const start = match.index!;
  if (start >= 2 && value.slice(start - 2, start + 1) === "://") return null;
  return {
    start,
    query: match[1],
  };
}

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

export function formatSlashContent(item: SlashResource, argsString = ""): string {
  const args = argsString.trim();
  return args ? `/skill:${item.name} ${args}` : `/skill:${item.name}`;
}

export function findDirectSlashResource(message: string, resources: SlashResource[]): { item: SlashResource; args: string } | null {
  const match = message.trim().match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;

  const command = match[1];
  const item = resources.find((resource) => resource.command === command);
  if (!item) return null;

  return { item, args: match[2] ?? "" };
}
