import { getAllowedRoots } from "./file-access";

/**
 * Warm the allowed-roots cache once at server start.
 *
 * The first request that needs the allowed roots pays for a full session scan
 * (see `getAllowedRoots`). Firing it during boot moves that cost off the first
 * panel open: the scan runs in the background while the server is already
 * serving, and the result lands in the cache.
 *
 * Non-blocking by construction: `bootstrap` returns immediately and a failed
 * scan is swallowed (the next `getAllowedRoots` caller just retries). Calling
 * it more than once is idempotent — the second scan is served by the cache or
 * the in-flight promise.
 */
export function bootstrap(): void {
  void getAllowedRoots().catch(() => {});
}
