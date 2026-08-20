import { createLogger } from "@/lib/server/logger";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const UPSTREAM_URL = "https://open.er-api.com/v6/latest/USD";
const FETCH_TIMEOUT_MS = 10_000;

const log = createLogger("api/exchange-rate");

interface CacheEntry {
  /** CNY per 1 USD. */
  rate: number;
  /** Epoch ms when the rate was last successfully fetched upstream. */
  fetchedAt: number;
}

// Survive Next.js hot reloads: stash the cache on globalThis rather than the
// module scope (which gets a fresh copy on every dev recompile).
interface ExchangeRateState {
  entry: CacheEntry | null;
  /** Single in-flight refresh promise shared across concurrent GETs. */
  inflight: Promise<CacheEntry | null> | null;
}
const globalCache = globalThis as unknown as { __piWorkExchangeRate?: ExchangeRateState };

function getState(): ExchangeRateState {
  if (!globalCache.__piWorkExchangeRate) {
    globalCache.__piWorkExchangeRate = { entry: null, inflight: null };
  }
  return globalCache.__piWorkExchangeRate;
}

/**
 * Fetches a fresh rate from the upstream API. On any failure (HTTP error,
 * malformed payload, network/timeout), falls back to the last known cached
 * entry. Returns `null` only when there is no cache to fall back to AND the
 * upstream is unreachable — the route then responds with 503 so the client
 * can show the original USD value instead.
 */
async function fetchRate(): Promise<CacheEntry | null> {
  const state = getState();
  if (state.inflight) return state.inflight;

  state.inflight = (async () => {
    try {
      const res = await fetch(UPSTREAM_URL, {
        cache: "no-store",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        log.warn(`upstream HTTP ${res.status}`);
        return state.entry;
      }
      const data = (await res.json()) as {
        result?: string;
        rates?: Record<string, number>;
      };
      if (data.result !== "success" || !data.rates || typeof data.rates.CNY !== "number") {
        log.warn(`upstream payload malformed: ${JSON.stringify(data).slice(0, 200)}`);
        return state.entry;
      }
      const entry: CacheEntry = { rate: data.rates.CNY, fetchedAt: Date.now() };
      state.entry = entry;
      log.info(`refreshed USD→CNY rate: ${entry.rate}`);
      return entry;
    } catch (err) {
      log.warn(`upstream fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      return state.entry;
    } finally {
      state.inflight = null;
    }
  })();

  return state.inflight;
}

export async function GET() {
  const state = getState();
  const now = Date.now();

  if (state.entry && now - state.entry.fetchedAt < CACHE_TTL_MS) {
    return Response.json({
      rate: state.entry.rate,
      fetchedAt: state.entry.fetchedAt,
      stale: false,
    });
  }

  const refreshed = await fetchRate();
  if (!refreshed) {
    return Response.json(
      { error: "Exchange rate unavailable", rate: null },
      { status: 503 },
    );
  }

  return Response.json({
    rate: refreshed.rate,
    fetchedAt: refreshed.fetchedAt,
    // Stale when the upstream refresh failed and we fell back to a previous
    // entry that is already past its TTL.
    stale: now - refreshed.fetchedAt >= CACHE_TTL_MS,
  });
}