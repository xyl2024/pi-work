export interface AdvancedSettingEntry {
  key: string;
  value: string;
}

export function advancedSettingValueText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function parseAdvancedSettingValue(text: string): unknown {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function advancedSettingEntries(
  record: Record<string, unknown> | undefined,
): AdvancedSettingEntry[] {
  if (!record) return [];
  return Object.keys(record)
    .sort()
    .map((key) => ({ key, value: advancedSettingValueText(record[key]) }));
}

export function withAdvancedSettingValue<T extends Record<string, unknown>>(
  record: T | undefined,
  key: string,
  text: string,
): T | undefined {
  const next: Record<string, unknown> = { ...(record ?? {}) };
  const value = parseAdvancedSettingValue(text);
  if (value === undefined) delete next[key];
  else next[key] = value;
  return Object.keys(next).length > 0 ? (next as T) : undefined;
}
