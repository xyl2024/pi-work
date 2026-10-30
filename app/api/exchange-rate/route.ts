import { createLogger } from "@/lib/server/logger";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const UPSTREAM_URL = "https://open.er-api.com/v6/latest/USD";
const FETCH_TIMEOUT_MS = 10_000;

const log = createLogger("api/exchange-rate");

interface CacheEntry {
  rate: number;
  fetchedAt: number;
}

interface ExchangeRateState {
  entry: CacheEntry | null;
  inflight: Promise<CacheEntry | null> | null;
}
const globalCache = globalThis as unknown as { __piWorkExchangeRate?: ExchangeRateState };

function getState(): ExchangeRateState {
  if (!globalCache.__piWorkExchangeRate) {
    globalCache.__piWorkExchangeRate = { entry: null, inflight: null };
  }
  return globalCache.__piWorkExchangeRate;
}

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
    stale: now - refreshed.fetchedAt >= CACHE_TTL_MS,
  });
}