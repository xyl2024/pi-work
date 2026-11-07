export type IconPickerOption =
  | { readonly kind: "auto" }
  | { readonly kind: "icon"; readonly id: string };

export type IconPickerMove = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Home" | "End";

const ICON_PICKER_MOVES: readonly IconPickerMove[] = [
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
];

export function isIconPickerMove(key: string): key is IconPickerMove {
  return (ICON_PICKER_MOVES as readonly string[]).includes(key);
}

export function iconPickerOptions(iconIds: readonly string[]): readonly IconPickerOption[] {
  const seen = new Set<string>();
  const options: IconPickerOption[] = [{ kind: "auto" }];
  for (const id of iconIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    options.push({ kind: "icon", id });
  }
  return options;
}

export function moveIconPickerIndex(
  index: number,
  move: IconPickerMove,
  count: number,
  columns: number,
): number {
  if (count <= 0) return 0;
  if (move === "Home") return 0;
  if (move === "End") return count - 1;
  const span = move === "ArrowLeft" || move === "ArrowRight" ? 1 : Math.max(1, columns);
  const step = move === "ArrowLeft" || move === "ArrowUp" ? -span : span;
  return ((index + step) % count + count) % count;
}
