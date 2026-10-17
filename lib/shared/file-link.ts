// ============================================================================
// File links in chat markdown (pure)
//
// Assistant messages routinely link to files the way the model sees them —
// `[app/page.tsx](/home/me/proj/app/page.tsx)` or a cwd-relative
// `[src/a.ts](src/a.ts)`. A plain left-click on those should open the file in
// the right panel instead of trying to navigate the browser to a route that
// does not exist. Deciding *whether* an href is a file link (and what absolute
// path it names) is a rule, not wiring, so it lives here and is pinned down
// without a browser.
//
//   - only bare paths count: absolute (`/…`, `C:\…`) or relative to the
//     session cwd. A scheme (`http:`, `https:`, `mailto:`, `data:`, `blob:`,
//     `file:`, …), a protocol-relative `//host`, a fragment `#…` and a
//     query-only `?…` are all links/routes, not files;
//   - a relative href with no cwd to anchor it is not openable — return null;
//   - `./` / `../` segments are folded so the same file always yields the same
//     tab id, and `%20`-style escapes are decoded.
//
// Like `external-link`, `chat-timeline` and `panelTabs` (ADR-0003) this module
// may not import React, the DOM, a client hook, or anything from `lib/server`.
// ============================================================================

import { getFileName, normalizeFilePathSlashes } from "./file-paths";

const WINDOWS_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/;
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

export interface FileLinkTarget {
  /** Absolute path, normalized (forward slashes, no `.` / `..` segments). */
  path: string;
  /** Last path segment, used as the panel tab label. */
  name: string;
}

/** Fold `.` / `..` segments and forward-slashes without touching the disk. */
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

/**
 * The file this href points at, or `null` when the click must be left to the
 * browser (external scheme, fragment, protocol-relative, or a relative href
 * with no cwd to resolve against).
 */
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
