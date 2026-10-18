import path from "path";
import { dataPath } from "./data-dir";

declare global {
  var __piAllowedRootsCache: { roots: Set<string>; expiresAt: number } | undefined;
  /** A scan in flight, shared by every concurrent miss (see `getAllowedRoots`). */
  var __piAllowedRootsPromise: Promise<Set<string>> | undefined;
  /** Bumped by invalidation; a scan that started before it must not fill the cache. */
  var __piAllowedRootsGeneration: number | undefined;
  var __piCreatedSpaceRoots: Set<string> | undefined;
}

// Long enough that opening a panel in a fresh session does not pay for a full
// session scan, short enough that a newly created working directory is allowed
// soon after. Longer TTL is the fail-closed direction: a new root waits for the
// window (or an explicit invalidation), it is never allowed early.
const ALLOWED_ROOTS_TTL_MS = 30_000;
const WINDOWS_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/;

export function normalizeSlashes(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function isWindowsAbsolutePath(filePath: string): boolean {
  return WINDOWS_ABSOLUTE_RE.test(filePath) || filePath.startsWith("\\\\") || filePath.startsWith("//");
}

export function filePathFromSegments(segments: string[]): string {
  const joined = segments.join("/");
  const slashJoined = normalizeSlashes(joined);
  if (isWindowsAbsolutePath(slashJoined)) return slashJoined;
  return "/" + joined.replace(/^\/+/, "");
}

export function invalidateAllowedRootsCache(): void {
  globalThis.__piAllowedRootsCache = undefined;
  // Drop an in-flight scan too: after a write that changes the answer, the next
  // caller must not receive the pre-write result the shared promise resolves to.
  globalThis.__piAllowedRootsPromise = undefined;
  // The dropped scan may still be running; the generation stops it from writing
  // its (now stale) roots into the cache when it settles.
  globalThis.__piAllowedRootsGeneration = (globalThis.__piAllowedRootsGeneration ?? 0) + 1;
}

export async function getAllowedRoots(): Promise<Set<string>> {
  const now = Date.now();
  const cached = globalThis.__piAllowedRootsCache;
  if (cached && cached.expiresAt > now) return cached.roots;

  // Concurrent misses (a panel firing several requests at once) share one scan
  // instead of each listing every session. The promise is cleared once it
  // settles, so a later miss still pays for a fresh scan rather than reusing a
  // stale in-flight result.
  if (globalThis.__piAllowedRootsPromise) return globalThis.__piAllowedRootsPromise;
  const generation = globalThis.__piAllowedRootsGeneration ?? 0;
  const promise = computeAllowedRoots();
  globalThis.__piAllowedRootsPromise = promise;
  try {
    const roots = await promise;
    // If the cache was invalidated while this scan ran, it answered an
    // out-of-date question — return it to this caller, but do not store it.
    if ((globalThis.__piAllowedRootsGeneration ?? 0) === generation) {
      globalThis.__piAllowedRootsCache = { roots, expiresAt: Date.now() + ALLOWED_ROOTS_TTL_MS };
    }
    return roots;
  } finally {
    if (globalThis.__piAllowedRootsPromise === promise) globalThis.__piAllowedRootsPromise = undefined;
  }
}

async function computeAllowedRoots(): Promise<Set<string>> {
  const { listAllSessionsHeaderOnly } = await import("./session-reader");
  const sessions = await listAllSessionsHeaderOnly();
  const roots = new Set<string>();
  for (const s of sessions) {
    if (s.cwd) roots.add(s.cwd);
  }
  for (const root of globalThis.__piCreatedSpaceRoots ?? []) {
    roots.add(root);
  }
  // Also allow <data root>/workspace/pi-cwd-* directories created by the
  // default-cwd endpoint
  const { readdirSync } = await import("fs");
  const workspace = dataPath("workspace");
  try {
    for (const name of readdirSync(workspace)) {
      if (/^pi-cwd-(\d{8}|default)$/.test(name)) {
        roots.add(path.join(workspace, name));
      }
    }
  } catch {
    // ignore if workspace has not been created yet
  }

  return roots;
}

export function isPathAllowed(target: string, allowedRoots: Set<string>): boolean {
  for (const root of allowedRoots) {
    const useWindowsRules = isWindowsAbsolutePath(target) || isWindowsAbsolutePath(root);
    const resolver = useWindowsRules ? path.win32 : path;
    const sep = useWindowsRules ? "\\" : path.sep;
    const normalized = resolver.resolve(target);
    const normalizedRoot = resolver.resolve(root);
    const comparable = useWindowsRules ? normalized.toLowerCase() : normalized;
    const comparableRoot = useWindowsRules ? normalizedRoot.toLowerCase() : normalizedRoot;
    const rootWithSep = comparableRoot.endsWith(sep) ? comparableRoot : comparableRoot + sep;
    if (comparable === comparableRoot || comparable.startsWith(rootWithSep)) {
      return true;
    }
  }
  return false;
}

export async function ensurePathAllowed(target: string): Promise<boolean> {
  const roots = await getAllowedRoots();
  return isPathAllowed(target, roots);
}