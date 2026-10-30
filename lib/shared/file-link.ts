import { getFileName, normalizeFilePathSlashes } from "./file-paths";

const WINDOWS_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/;
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

export interface FileLinkTarget {
  path: string;
  name: string;
}

function normalizeJoinedPath(path: string): string {
  const normalized = normalizeFilePathSlashes(path);
  const isAbsolute = normalized.startsWith("/");
  const out: string[] = [];
  for (const segment of normalized.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else if (!isAbsolute) out.push("..");
      continue;
    }
    out.push(segment);
  }
  const joined = out.join("/");
  return isAbsolute ? `/${joined}` : joined;
}

function decodePath(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function resolveFileLink(
  href: string | null | undefined,
  cwd?: string | null,
): FileLinkTarget | null {
  const raw = href?.trim();
  if (!raw) return null;
  if (raw.startsWith("#") || raw.startsWith("?") || raw.startsWith("//")) return null;

  const withoutFragment = raw.split("#", 1)[0];
  if (!withoutFragment) return null;

  const isWindowsAbsolute = WINDOWS_ABSOLUTE_RE.test(withoutFragment);
  if (!isWindowsAbsolute && SCHEME_RE.test(withoutFragment)) return null;

  const decoded = decodePath(withoutFragment);
  let path: string;
  if (isWindowsAbsolute || decoded.startsWith("/")) {
    path = normalizeJoinedPath(decoded);
  } else {
    if (!cwd) return null;
    path = normalizeJoinedPath(`${normalizeFilePathSlashes(cwd).replace(/\/+$/, "")}/${decoded}`);
  }
  if (!path) return null;

  return { path, name: getFileName(path) };
}
