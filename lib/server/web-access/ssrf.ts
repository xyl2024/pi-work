import { lookup } from "node:dns/promises";
import net from "node:net";

const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export function isBlockedAddress(address: string): boolean {
  const version = net.isIP(address);
  if (version === 4) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts;
    return parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255) ||
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || a >= 224;
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") ||
      normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") ||
      normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("::ffff:127.");
  }
  return true;
}

export async function validateRemoteUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS URLs can be fetched remotely");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error(`Blocked internal hostname: ${hostname || "missing"}`);
  }
  if (net.isIP(hostname)) {
    if (isBlockedAddress(hostname)) throw new Error(`Blocked internal address: ${hostname}`);
    return url;
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) throw new Error(`Failed to resolve ${hostname}`);
  for (const address of addresses) {
    if (isBlockedAddress(address.address)) throw new Error(`Blocked internal address for ${hostname}: ${address.address}`);
  }
  return url;
}

async function readLimited(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error("Response too large (5MB)");
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new Error("Response too large (5MB)");
    return text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Response too large (5MB)");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8").decode(bytes);
}

export async function fetchRemoteText(rawUrl: string, signal: AbortSignal): Promise<{ url: string; response: Response; text: string }> {
  let current = await validateRemoteUrl(rawUrl);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const response = await fetch(current, {
      redirect: "manual",
      signal,
      headers: { "User-Agent": "Pi-Work-Web-Access/1.0", Accept: "text/html,application/xhtml+xml,text/plain,application/json,application/xml;q=0.9,*/*;q=0.8" },
    });
    const location = response.headers.get("location");
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) {
      return { url: current.toString(), response, text: await readLimited(response) };
    }
    if (redirect === MAX_REDIRECTS) throw new Error(`Too many redirects fetching ${current}`);
    current = await validateRemoteUrl(new URL(location, current).toString());
  }
  throw new Error(`Too many redirects fetching ${rawUrl}`);
}
