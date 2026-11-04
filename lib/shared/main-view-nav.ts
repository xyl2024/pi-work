import type { MainViewKind } from "./mainView";

export interface MainViewNavInput {
  kinds: readonly MainViewKind[];
  active: MainViewKind | null;
  availableRows: number;
}

export interface MainViewNavLayout {
  visible: MainViewKind[];
  overflow: MainViewKind[];
  expandedActive: MainViewKind | null;
}

export function resolveMainViewNav(input: MainViewNavInput): MainViewNavLayout {
  const ordered = unique(input.kinds);
  const rows = Math.max(0, Math.min(input.availableRows, ordered.length));
  const active = input.active !== null && ordered.includes(input.active) ? input.active : null;

  if (rows === ordered.length) {
    return { visible: ordered, overflow: [], expandedActive: null };
  }

  if (rows === 0) {
    return { visible: [], overflow: ordered, expandedActive: active };
  }

  if (active !== null && !ordered.slice(0, rows).includes(active)) {
    const visible = [...ordered.slice(0, rows - 1), active];
    return {
      visible,
      overflow: ordered.filter((kind) => !visible.includes(kind)),
      expandedActive: active,
    };
  }

  return {
    visible: ordered.slice(0, rows),
    overflow: ordered.slice(rows),
    expandedActive: null,
  };
}

function unique(kinds: readonly MainViewKind[]): MainViewKind[] {
  return [...new Set(kinds)];
}
