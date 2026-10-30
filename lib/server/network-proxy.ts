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

const PROXY_PROTOCOLS = new Set(["http:", "https:"]);

const DIRECT_KEY = "direct";

export const DEFAULT_PROBE_URL = "https://www.google.com/generate_204";
const PROBE_TIMEOUT_MS = 10_000;

interface NetworkProxyState {
  key: string | null;
  baseline: Dispatcher | undefined;
  captured: boolean;
  installed: Dispatcher | undefined;
}

function state(): NetworkProxyState {
  const host = globalThis as typeof globalThis & { __piWorkNetworkProxy?: NetworkProxyState };
  if (!host.__piWorkNetworkProxy) {
    host.__piWorkNetworkProxy = { key: null, baseline: undefined, captured: false, installed: undefined };
  }
  return host.__piWorkNetworkProxy;
}

export type ProxyUrlCheck = { ok: true; url: string } | { ok: false; error: string };

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

function buildDispatcher(proxy: NetworkProxyConfig): Dispatcher {
  const url = proxy.url.trim();
  return new EnvHttpProxyAgent({
    httpProxy: url,
    httpsProxy: url,
    noProxy: buildNoProxyList(proxy.no_proxy),
    allowH2: false,
  });
}

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
    void Promise.resolve(dispatcher.close()).catch(() => {});
  } catch {
  }
}

export function refreshNetworkProxy(): void {
  applyNetworkProxy(readConfig().network_proxy);
}

export function bootstrap(): void {
  refreshNetworkProxy();
}

export interface ProxyProbeResult {
  ok: boolean;
  status?: number;
  durationMs: number;
  error?: string;
}

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
    await response.body?.cancel().catch(() => {});
    return { ok: true, status: response.status, durationMs: Date.now() - startedAt };
  } catch (error) {
    return { ok: false, durationMs: Date.now() - startedAt, error: describeFetchError(error) };
  } finally {
    closeQuietly(dispatcher);
  }
}

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
