export function modelDisplayName(
  names: Record<string, string> | undefined,
  provider: string | undefined,
  modelId: string,
): string {
  if (!names) return modelId;
  if (provider) return names[`${provider}:${modelId}`] ?? names[modelId] ?? modelId;
  return names[modelId] ?? modelId;
}
