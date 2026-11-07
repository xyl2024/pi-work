export interface ModelTableModel {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: readonly string[];
  api?: string;
  contextWindow?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; tiers?: unknown[] };
}

export interface ModelTableRowView {
  title: string;
  subtitle: string | null;
  capabilities: string[];
  context: string;
  inputPrice: string;
  outputPrice: string;
}

export const UNKNOWN_MODEL_VALUE = "—";

export const MODEL_CAPABILITY_LABELS = {
  reasoning: "Reasoning",
  imageInput: "Image input",
  apiOverride: "API override",
} as const;

function decimal(value: number): string {
  return String(Math.round(value * 10) / 10);
}

export function formatContextWindow(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return UNKNOWN_MODEL_VALUE;
  if (value >= 1_000_000) return `${decimal(value / 1_000_000)}M`;
  if (value >= 1_000) return `${decimal(value / 1_000)}K`;
  return String(value);
}

export function formatModelPrice(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return UNKNOWN_MODEL_VALUE;
  return `$${String(Number(value.toFixed(4)))}`;
}

export function modelCapabilities(model: ModelTableModel): string[] {
  const capabilities: string[] = [];
  if (model.reasoning) capabilities.push(MODEL_CAPABILITY_LABELS.reasoning);
  if (model.input?.includes("image")) capabilities.push(MODEL_CAPABILITY_LABELS.imageInput);
  if (model.api?.trim()) capabilities.push(MODEL_CAPABILITY_LABELS.apiOverride);
  return capabilities;
}

export function modelTableRow(model: ModelTableModel): ModelTableRowView {
  const name = model.name?.trim() ?? "";
  const id = model.id.trim();
  const title = name || id;
  return {
    title,
    subtitle: name && id && name !== id ? id : null,
    capabilities: modelCapabilities(model),
    context: formatContextWindow(model.contextWindow),
    inputPrice: formatModelPrice(model.cost?.input),
    outputPrice: formatModelPrice(model.cost?.output),
  };
}
