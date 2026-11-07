export type AdvancedSettingKind = "boolean" | "number" | "string" | "json";

export type AdvancedSettingValue = string | number | boolean | null | readonly unknown[] | Record<string, unknown>;

export interface AdvancedSettingRow {
  path: string;
  value: AdvancedSettingValue;
  kind: AdvancedSettingKind;
}

export function advancedSettingKind(value: AdvancedSettingValue): AdvancedSettingKind {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  return "json";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collect(source: Record<string, unknown>, prefix: string, rows: AdvancedSettingRow[]): void {
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value) && Object.keys(value).length > 0) {
      collect(value, path, rows);
      continue;
    }
    if (isPlainObject(value)) continue;
    rows.push({ path, value: value as AdvancedSettingValue, kind: advancedSettingKind(value as AdvancedSettingValue) });
  }
}

export function advancedSettingRows(
  source: Record<string, unknown> | undefined,
  prefix = "",
): AdvancedSettingRow[] {
  if (!source) return [];
  const rows: AdvancedSettingRow[] = [];
  collect(source, prefix, rows);
  return rows;
}

function writePath(
  source: Record<string, unknown> | undefined,
  segments: readonly string[],
  value: unknown,
): Record<string, unknown> | undefined {
  const [head, ...rest] = segments;
  const base = { ...(source ?? {}) };
  if (rest.length === 0) {
    if (value === undefined) delete base[head];
    else base[head] = value;
  } else {
    const child = writePath(isPlainObject(base[head]) ? base[head] : undefined, rest, value);
    if (child === undefined) delete base[head];
    else base[head] = child;
  }
  return Object.keys(base).length > 0 ? base : undefined;
}

export function setAdvancedSetting(
  source: Record<string, unknown> | undefined,
  path: string,
  value: unknown,
): Record<string, unknown> | undefined {
  return writePath(source, path.split("."), value);
}

export type ParsedAdvancedSetting =
  | { ok: true; value: AdvancedSettingValue }
  | { ok: false };

export function parseAdvancedSettingInput(text: string, kind: AdvancedSettingKind): ParsedAdvancedSetting {
  const trimmed = text.trim();
  if (kind === "boolean") {
    const lowered = trimmed.toLowerCase();
    if (lowered === "true") return { ok: true, value: true };
    if (lowered === "false") return { ok: true, value: false };
    return { ok: false };
  }
  if (kind === "number") {
    if (!trimmed) return { ok: false };
    const value = Number(trimmed);
    return Number.isFinite(value) ? { ok: true, value } : { ok: false };
  }
  if (kind === "string") {
    return trimmed ? { ok: true, value: text } : { ok: false };
  }
  if (!trimmed) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(trimmed) as AdvancedSettingValue };
  } catch {
    return { ok: false };
  }
}
