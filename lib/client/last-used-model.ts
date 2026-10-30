import { getLocalStorage } from "./local-storage";

const LAST_USED_MODEL_KEY = "pi-work:last-used-model";

export interface LastUsedModel {
  provider: string;
  modelId: string;
}

export function readLastUsedModel(): LastUsedModel | null {
  const store = getLocalStorage();
  if (!store) return null;
  let raw: string | null = null;
  try {
    raw = store.getItem(LAST_USED_MODEL_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const v = parsed as Record<string, unknown>;
    if (typeof v.provider !== "string" || typeof v.modelId !== "string") return null;
    return { provider: v.provider, modelId: v.modelId };
  } catch {
    return null;
  }
}

export function writeLastUsedModel(next: LastUsedModel): void {
  const store = getLocalStorage();
  if (!store) return;
  try {
    store.setItem(LAST_USED_MODEL_KEY, JSON.stringify(next));
  } catch (error) {
    if (typeof console !== "undefined") {
      console.warn("[last-used-model] write failed", error);
    }
  }
}