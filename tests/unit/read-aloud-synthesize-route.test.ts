import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SYNTHESIS_CACHE_DIRECTORY,
  SYNTHESIS_CACHE_MAX_ENTRY_BYTES,
  synthesisCacheKey,
} from "@/lib/server/synthesis-cache";
import { DEEPSEEK_TTS_PATH } from "@/lib/shared/deepseek";
import {
  READ_ALOUD_DEFAULT_VOICE_ID,
  READ_ALOUD_MAX_BILLING_CHARS,
} from "@/lib/shared/read-aloud";

const root = mkdtempSync(join(tmpdir(), "pi-work-read-aloud-route-"));
const originalFetch = globalThis.fetch;
const WAV = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0]);

let POST: typeof import("@/app/api/read-aloud/synthesize/route")["POST"];
let fetchMock: ReturnType<typeof vi.fn>;

function post(payload: unknown): Request {
  return new Request("http://localhost/api/read-aloud/synthesize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

function audioResponse(bytes = WAV): Response {
  return new Response(bytes, {
    status: 200,
    headers: { "Content-Type": "audio/wav" },
  });
}

function errorResponse(status: number, detail = "secret upstream detail"): Response {
  return new Response(JSON.stringify({ error: detail }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function brokenAudioResponse(): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([82, 73]));
      controller.error(new Error("connection reset"));
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "audio/wav" } });
}

beforeAll(async () => {
  process.env.PI_WORK_DATA_DIR = root;
  process.env.DEEPSEEK_BASE_URL = "http://deepseek.test";
  vi.resetModules();
  ({ POST } = await import("@/app/api/read-aloud/synthesize/route"));
});

const cacheDir = join(root, SYNTHESIS_CACHE_DIRECTORY);

beforeEach(() => {
  process.env.DEEPSEEK_API_KEY = "route-key-1234";
  fetchMock = vi.fn(async () => audioResponse());
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  rmSync(cacheDir, { recursive: true, force: true });
});

afterAll(() => {
  delete process.env.PI_WORK_DATA_DIR;
  delete process.env.DEEPSEEK_BASE_URL;
  delete process.env.DEEPSEEK_API_KEY;
  globalThis.fetch = originalFetch;
  rmSync(root, { recursive: true, force: true });
});

describe("POST /api/read-aloud/synthesize", () => {
  it("synthesizes the text through DeepSeek and returns wav bytes", async () => {
    const response = await POST(post({ text: "请朗读这段话" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("audio/wav");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(WAV);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://deepseek.test${DEEPSEEK_TTS_PATH}`);
    expect(url).not.toContain(encodeURIComponent("请朗读这段话"));
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer route-key-1234");
    expect(JSON.parse(init.body as string)).toMatchObject({
      text: "请朗读这段话",
      voice_id: READ_ALOUD_DEFAULT_VOICE_ID,
      format: "wav",
    });
  });

  it("honours an explicit voice id", async () => {
    const response = await POST(post({ text: "hello", voiceId: "tide" }));

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).voice_id).toBe("tide");
  });

  it("rejects an empty or missing text without calling upstream", async () => {
    for (const payload of [{ text: "   " }, {}, "not json"]) {
      const response = await POST(post(payload));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "blocked" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects text above the billing-character ceiling without calling upstream", async () => {
    const response = await POST(
      post({ text: "汉".repeat(READ_ALOUD_MAX_BILLING_CHARS / 2 + 1) }),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "too_long" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a missing key without calling upstream", async () => {
    delete process.env.DEEPSEEK_API_KEY;

    const response = await POST(post({ text: "hello" }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "missing_key" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [400, 422, "blocked"],
    [401, 409, "missing_key"],
    [408, 504, "timeout"],
    [413, 413, "too_long"],
    [429, 429, "rate_limited"],
    [503, 503, "busy"],
    [504, 504, "timeout"],
    [500, 502, "failed"],
  ])("maps upstream %i to local %i with code %s", async (upstream, local, code) => {
    fetchMock.mockImplementation(async () => errorResponse(upstream));

    const response = await POST(post({ text: "hello" }));

    expect(response.status).toBe(local);
    expect(await response.json()).toEqual({ error: code });
  });

  it("never leaks upstream error text", async () => {
    fetchMock.mockImplementation(async () => errorResponse(503));

    const response = await POST(post({ text: "hello" }));

    expect(JSON.stringify(await response.json())).not.toContain("secret upstream detail");
  });

  it("treats an audio stream that breaks midway as a failure", async () => {
    fetchMock.mockImplementation(async () => brokenAudioResponse());

    const response = await POST(post({ text: "hello" }));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "failed" });
  });

  it("serves a repeated text from the synthesis cache without calling upstream", async () => {
    const text = "重复点播的回答正文";

    const first = await POST(post({ text }));
    const second = await POST(post({ text }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(WAV);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keys the cache by voice as well as text", async () => {
    const text = "同一段文本两个音色";

    await POST(post({ text, voiceId: "stella" }));
    await POST(post({ text, voiceId: "tide" }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readdirSync(cacheDir).sort()).toEqual(
      [
        `${synthesisCacheKey(text, "stella")}.wav`,
        `${synthesisCacheKey(text, "tide")}.wav`,
      ].sort(),
    );
  });

  it("merges concurrent requests for the same text into one upstream call", async () => {
    const text = "并发双击不要花两次钱";
    fetchMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return audioResponse();
    });

    const [first, second] = await Promise.all([POST(post({ text })), POST(post({ text }))]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(WAV);
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(WAV);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("evicts the least recently used entry after a write pushes past the total ceiling", async () => {
    const seeded = ["a", "b", "c"].map((prefix) => ({
      name: `${prefix.repeat(64).slice(0, 64)}.wav`,
      size: 50 * 1024 * 1024,
    }));
    mkdirSync(cacheDir, { recursive: true });
    const nowMs = Date.now();
    seeded.forEach((entry, index) => {
      const path = join(cacheDir, entry.name);
      writeFileSync(path, "");
      truncateSync(path, entry.size);
      const usedAt = new Date(nowMs - (seeded.length - index) * 60_000);
      utimesSync(path, usedAt, usedAt);
    });

    const text = "淘汰最久未用";
    const response = await POST(post({ text }));

    expect(response.status).toBe(200);
    const names = readdirSync(cacheDir);
    expect(names).not.toContain(seeded[0].name);
    expect(names).toContain(seeded[1].name);
    expect(names).toContain(seeded[2].name);
    expect(names).toContain(`${synthesisCacheKey(text, READ_ALOUD_DEFAULT_VOICE_ID)}.wav`);
  });

  it("refreshes the access time on a hit so eviction spares the reread entry", async () => {
    const hitText = "刚被读过的那一条";
    const untouchedText = "很久没被读过的那一条";
    const hitKey = synthesisCacheKey(hitText, READ_ALOUD_DEFAULT_VOICE_ID);
    const untouchedKey = synthesisCacheKey(untouchedText, READ_ALOUD_DEFAULT_VOICE_ID);
    mkdirSync(cacheDir, { recursive: true });
    const hitPath = join(cacheDir, `${hitKey}.wav`);
    const untouchedPath = join(cacheDir, `${untouchedKey}.wav`);
    const nowMs = Date.now();
    for (const [path, size, ageMs] of [
      [hitPath, 8 * 1024 * 1024, 120_000],
      [untouchedPath, 125 * 1024 * 1024, 240_000],
    ] as const) {
      writeFileSync(path, "");
      truncateSync(path, size);
      const usedAt = new Date(nowMs - ageMs);
      utimesSync(path, usedAt, usedAt);
    }

    const hit = await POST(post({ text: hitText }));
    expect(hit.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(statSync(hitPath).atimeMs).toBeGreaterThan(nowMs);

    const written = await POST(post({ text: "写入后触发淘汰" }));

    expect(written.status).toBe(200);
    expect(existsSync(untouchedPath)).toBe(false);
    expect(existsSync(hitPath)).toBe(true);
  });

  it("returns audio above the cache entry ceiling without persisting it", async () => {
    const text = "超大的音频只返回这一次";
    const oversized = new Uint8Array(SYNTHESIS_CACHE_MAX_ENTRY_BYTES + 1024 * 1024);
    oversized.set(WAV);
    fetchMock.mockImplementation(async () => audioResponse(oversized));

    const first = await POST(post({ text }));
    const second = await POST(post({ text }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await first.arrayBuffer()).byteLength).toBe(oversized.byteLength);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(existsSync(cacheDir) ? readdirSync(cacheDir) : []).toEqual([]);
  });
});
