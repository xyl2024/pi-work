import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

beforeEach(() => {
  process.env.DEEPSEEK_API_KEY = "route-key-1234";
  fetchMock = vi.fn(async () => audioResponse());
  globalThis.fetch = fetchMock as unknown as typeof fetch;
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

  it("sends only the shaped readable text upstream", async () => {
    const response = await POST(
      post({ text: "朗读这句。\n\n```js\nconst skipped = 1;\n```\n\n见 [文档](https://example.dev)。" }),
    );

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).text).toBe("朗读这句。\n\n见 文档。");
  });

  it("applies the billing ceiling to the shaped text", async () => {
    const text = `汉`.repeat(READ_ALOUD_MAX_BILLING_CHARS / 2) + "\n\n```\n" + "x".repeat(50) + "\n```";

    const response = await POST(post({ text }));

    expect(response.status).toBe(200);
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
});
