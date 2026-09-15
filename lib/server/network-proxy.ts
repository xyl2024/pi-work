/**
 * Outbound network proxy for the whole server process.
 *
 * Why a *global dispatcher* and not a fetch wrapper: Node's built-in `fetch`
 * resolves its dispatcher from the well-known global symbol that
 * `undici.setGlobalDispatcher()` writes, so an `undici` dispatcher installed
 * here also drives every `globalThis.fetch` call — including the ones the
 * pi Agent SDK and `lib/server/llm-audit.ts` make. That keeps the audit
 * wrapper (which owns `globalThis.fetch`) completely untouched, and makes the
 * proxy hot-swappable: changing the setting takes effect on the next request
 * without a server restart.
 *
 * State lives on `globalThis` rather than in module scope because Next.js may
 * evaluate this module more than once (instrumentation bundle vs. route
 * handler bundle, dev HMR), and every copy must agree on which dispatcher is
 * currently installed.
 */
import {
  EnvHttpProxyAgent,
  fetch as undiciFetch,
  getGlobalDispatcher,
  setGlobalDispatcher,
  type Dispatcher,
} from "undici";
import { ALWAYS_BYPASS_HOSTS, type NetworkProxyConfig } from "../shared/config-types";
import { readConfig } from "./config";
import { createLogger } from "./logger";

const log = createLogger("lib/network-proxy");

/** Proxy URL schemes we know how to drive. SOCKS is intentionally not supported. */
const PROXY_PROTOCOLS = new Set(["http:", "https:"]);

/** Key used when no proxy is active, so "direct" is a normal cache entry. */
const DIRECT_KEY = "direct";

/** Where the connection test points when the caller doesn't override it. */
export const DEFAULT_PROBE_URL = "https://www.google.com/generate_204";
const PROBE_TIMEOUT_MS = 10_000;

interface NetworkProxyState {
  /** Serialized config the current dispatcher was built from. */
  key: string | null;
  /** Dispatcher that was global before we first took it over. */
  baseline: Dispatcher | undefined;
  /** True once `baseline` has been captured (must never be re-captured). */
  captured: boolean;
  /** Dispatcher we installed, kept only so it can be closed on the next swap. */
  installed: Dispatcher | undefined;
}

function state(): NetworkProxyState {
  const host = globalThis as typeof globalThis & { __piWorkNetworkProxy?: NetworkProxyState };
  if (!host.__piWorkNetworkProxy) {
    host.__piWorkNetworkProxy = { key: null, baseline: undefined, captured: false, installed: undefined };
  }
  return host.__piWorkNetworkProxy;
}

// ── Validation / normalization (shared with the PUT route + the UI) ───────

export type ProxyUrlCheck = { ok: true; url: string } | { ok: false; error: string };

/**
 * Shape-check a user-supplied proxy URL. An empty string is valid and means
 * "no proxy configured" — the caller decides whether that is acceptable
 * (enabling the proxy without a URL is rejected by the PUT route).
 */
export function checkProxyUrl(raw: unknown): ProxyUrlCheck {
  if (typeof raw !== "string") {
    return { ok: false, error: "network_proxy.url must be a string" };
  }
  const url = raw.trim();
  if (!url) return { ok: true, url: "" };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: `network_proxy.url is not a valid URL: ${url}` };
  }
  if (!PROXY_PROTOCOLS.has(parsed.protocol)) {
    return {
      ok: false,
      error: `network_proxy.url must start with http:// or https:// (got ${parsed.protocol})`,
    };
  }
  if (!parsed.hostname) {
    return { ok: false, error: `network_proxy.url has no host: ${url}` };
  }
  return { ok: true, url };
}

/**
 * Merge {@link ALWAYS_BYPASS_HOSTS} with the user's extra bypass entries into
 * one NO_PROXY string. Duplicates are dropped but order is preserved so a
 * hand-inspected config.yaml stays readable.
 */
export function buildNoProxyList(extra: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (entry: string) => {
    const value = entry.trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push(value);
  };
  for (const host of ALWAYS_BYPASS_HOSTS) push(host);
  for (const entry of extra.split(",")) push(entry);
  return out.join(",");
}

// ── Applying the setting ─────────────────────────────────────────────────

function buildDispatcher(proxy: NetworkProxyConfig): Dispatcher {
  const url = proxy.url.trim();
  return new EnvHttpProxyAgent({
    // Explicit options (rather than letting EnvHttpProxyAgent read the
    // environment) so the Settings value always wins over a stray HTTP_PROXY.
    httpProxy: url,
    httpsProxy: url,
    noProxy: buildNoProxyList(proxy.no_proxy),
    // HTTP/2 over a local CONNECT proxy (Clash, mihomo, …) is a common source
    // of silent stalls. pi's own dispatcher forces this off for the same
    // reason; mirrors `core/http-dispatcher.js` in pi-coding-agent.
    allowH2: false,
  });
}

/**
 * Install (or clear) the proxy dispatcher. Safe to call on every settings
 * write: an unchanged configuration is a no-op, and an unusable URL falls
 * back to the previous dispatcher instead of breaking outbound traffic.
 */
export function applyNetworkProxy(proxy: NetworkProxyConfig): void {
  const s = state();
  if (!s.captured) {
    s.baseline = getGlobalDispatcher();
    s.captured = true;
  }
  const baseline = s.baseline;

  const url = proxy.url.trim();
  const active = proxy.enabled && url.length > 0;
  const key = active ? `${url}|${buildNoProxyList(proxy.no_proxy)}` : DIRECT_KEY;
  if (key === s.key) return;

  if (!active) {
    if (baseline) setGlobalDispatcher(baseline);
    closeQuietly(s.installed);
    s.installed = undefined;
    s.key = key;
    log.info("network proxy cleared", {
      reason: proxy.enabled ? "no url configured" : "disabled",
    });
    return;
  }

  let dispatcher: Dispatcher;
  try {
    dispatcher = buildDispatcher(proxy);
  } catch (error) {
    log.error("failed to build proxy dispatcher, keeping previous", {
      url,
      error: String(error),
    });
    return;
  }

  setGlobalDispatcher(dispatcher);
  closeQuietly(s.installed);
  s.installed = dispatcher;
  s.key = key;
  log.info("network proxy applied", { url, noProxy: buildNoProxyList(proxy.no_proxy) });
}

function closeQuietly(dispatcher: Dispatcher | undefined): void {
  if (!dispatcher || dispatcher === state().baseline) return;
  try {
    void Promise.resolve(dispatcher.close()).catch(() => { /* already gone */ });
  } catch {
    /* close() on an already-destroyed dispatcher is not an error worth surfacing */
  }
}

/** Re-read ~/.pi-work/config.yaml and apply its `network_proxy` block. */
export function refreshNetworkProxy(): void {
  applyNetworkProxy(readConfig().network_proxy);
}

/** instrumentation.ts entry point — runs once per server process boot. */
export function bootstrap(): void {
  refreshNetworkProxy();
}

// ── Connection test (Settings → Network proxy → Test) ────────────────────

export interface ProxyProbeResult {
  ok: boolean;
  /** HTTP status of the probe response; absent when the request never landed. */
  status?: number;
  durationMs: number;
  error?: string;
}

/**
 * Send one real request through the *candidate* proxy without touching the
 * live dispatcher, so the user can verify an address before saving it.
 * Any HTTP response counts as success: reaching the target through the
 * tunnel is exactly what the test is meant to prove.
 */
export async function probeProxy(
  proxy: NetworkProxyConfig,
  targetUrl: string = DEFAULT_PROBE_URL,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<ProxyProbeResult> {
  const startedAt = Date.now();
  let dispatcher: Dispatcher;
  try {
    dispatcher = buildDispatcher(proxy);
  } catch (error) {
    return { ok: false, durationMs: Date.now() - startedAt, error: describeFetchError(error) };
  }

  try {
    const response = await undiciFetch(targetUrl, {
      dispatcher,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    await response.body?.cancel().catch(() => { /* nothing to drain */ });
    return { ok: true, status: response.status, durationMs: Date.now() - startedAt };
  } catch (error) {
    return { ok: false, durationMs: Date.now() - startedAt, error: describeFetchError(error) };
  } finally {
    closeQuietly(dispatcher);
  }
}

/**
 * Flatten an undici fetch failure into one readable line. The useful detail
 * (ECONNREFUSED, UND_ERR_CONNECT_TIMEOUT, CERT_HAS_EXPIRED, …) always lives
 * in a nested `cause`, and undici throws a bare `TypeError: fetch failed`
 * on top of it.
 */
function describeFetchError(error: unknown): string {
  const parts: string[] = [];
  let cursor: unknown = error;
  for (let depth = 0; depth < 5 && cursor != null; depth += 1) {
    if (!(cursor instanceof Error)) {
      parts.push(String(cursor));
      break;
    }
    const code = (cursor as Error & { code?: unknown }).code;
    const label = typeof code === "string" && code && code !== cursor.message
      ? `${cursor.message} (${code})`
      : cursor.message;
    if (label && !parts.includes(label)) parts.push(label);
    cursor = (cursor as Error & { cause?: unknown }).cause;
  }
  return parts.join(": ") || "unknown error";
}
