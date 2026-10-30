import { getSlashQuery } from "@/lib/shared/composer-queries";
import type { SlashResource } from "@/lib/shared/slash-commands";
import { deleteRange, insertNode } from "./model";
import { projectDocText } from "./offsets";
import type { ComposerState } from "./types";

export function applySlashSelection(
  state: ComposerState,
  item: SlashResource,
  cursorOffset: number,
): ComposerState {
  const logical = projectDocText(state.doc);
  const query = getSlashQuery(logical, cursorOffset);
  const range = query
    ? { start: query.start, end: cursorOffset }
    : { start: cursorOffset, end: cursorOffset };

  if (item.source === "action") return deleteRange(state, range);

  return insertNode(
    state,
    { kind: "skill", source: item.source, name: item.name, command: item.command },
    range,
  );
}

export function shouldOpenSlashMenu(logical: string, cursorOffset: number, open: boolean): boolean {
  if (cursorOffset > 0 && logical.slice(0, cursorOffset).endsWith("/")) return true;
  return Boolean(open && getSlashQuery(logical, cursorOffset));
}
