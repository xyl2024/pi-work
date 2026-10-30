const WEB_PROTOCOLS = new Set(["http:", "https:"]);

export function opensNewContext(target?: string | null): boolean {
  const value = target?.trim().toLowerCase();
  if (!value) return false;
  return value === "_blank" || !value.startsWith("_");
}

export function resolveNewTabUrl(input: {
  href?: string | null;
  target?: string | null;
  download?: boolean;
  baseUrl: string;
}): string | null {
  const href = input.href?.trim();
  if (!href) return null;
  if (href.startsWith("#")) return null;
  if (input.download) return null;
  if (opensNewContext(input.target)) return null;

  let url: URL;
  let base: URL;
  try {
    url = new URL(href, input.baseUrl);
    base = new URL(input.baseUrl);
  } catch {
    return null;
  }
  if (!WEB_PROTOCOLS.has(url.protocol)) return null;
  if (url.origin === base.origin) return null;
  return url.href;
}
