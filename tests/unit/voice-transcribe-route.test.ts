import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEEPSEEK_ASR_PATH } from "@/lib/shared/deepseek";
import { VOICE_INPUT_MAX_BYTES } from "@/lib/shared/voice-input";

const root = mkdtempSync(join(tmpdir(), "pi-work-voice-route-"));
const originalFetch = globalThis.fetch;

let POST: typeof import("@/app/api/voice/transcribe/route")["POST"];
let fetchMock: ReturnType<typeof vi.fn>;

function wavFile(size = 6, type = "audio/wav"): File {
  return new File([new Uint8Array(size)], "voice.wav", { type });
}

function post(file?: File): Request {
  const form = new FormData();
  if (file) form.append("file", file);
  return new Request("http://localhost/api/voice/transcribe", { method: "POST", body: form });
}

function upstream(payload: unknown, status = 200): Response {
  return new Response(typeof payload === "string" ? payload : JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeAll(async () => {
  process.env.PI_WORK_DATA_DIR = root;
  process.env.DEEPSEEK_BASE_URL = "http://deepseek.test";
  vi.resetModules();
  ({ POST } = await import("@/app/api/voice/transcribe/route"));
});

beforeEach(() => {
  process.env.DEEPSEEK_API_KEY = "route-key-1234";
  fetchMock = vi.fn(async () =>
    upstream({ request_id: "req-1", text: "hello from speech", duration_ms: 1200 }),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  delete process.env.PI_WORK_DATA_DIR;
  delete process.env.DEEPSEEK_BASE_URL;
  delete process.env.DEEPSEEK_API_KEY;
  globalThis.fetch = originalFetch;
  rmSync(root, { recursive: true, force: true });
});

describe("POST /api/voice/transcribe", () => {
  it("forwards the uploaded audio to DeepSeek and returns the transcript", async () => {
    const response = await POST(post(wavFile()));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "hello from speech" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://deepseek.test${DEEPSEEK_ASR_PATH}`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer route-key-1234");
    expect(init.body).toBeInstanceOf(FormData);
    const sent = init.body as FormData;
    const sentFile = sent.get("file");
    expect(sentFile).toBeInstanceOf(File);
    expect((sentFile as File).type).toBe("audio/wav");
    expect((sentFile as File).size).toBe(6);
    expect(String(init.body)).not.toContain("route-key-1234");
  });

  it("returns an empty transcript as an empty string", async () => {
    fetchMock.mockImplementation(async () => upstream({ request_id: "req-2", text: "", duration_ms: 10 }));

    const response = await POST(post(wavFile()));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "" });
  });

  it("rejects a request without an audio file", async () => {
    const response = await POST(post());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_audio" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a non-audio upload", async () => {
    const response = await POST(post(wavFile(6, "text/plain")));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_audio" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an upload above the size limit", async () => {
    const response = await POST(post(wavFile(VOICE_INPUT_MAX_BYTES + 1)));

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "too_large" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a missing DeepSeek key without calling upstream", async () => {
    delete process.env.DEEPSEEK_API_KEY;

    const response = await POST(post(wavFile()));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "missing_key" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [400, 400, "invalid_audio"],
    [401, 409, "missing_key"],
    [408, 504, "timeout"],
    [413, 413, "too_large"],
    [429, 429, "rate_limited"],
    [503, 503, "busy"],
    [504, 504, "timeout"],
    [500, 502, "failed"],
  ])("maps upstream %i to %i %s", async (upstreamStatus, expectedStatus, expectedCode) => {
    fetchMock.mockImplementation(async () => upstream({ error: { message: "upstream says" } }, upstreamStatus));

    const response = await POST(post(wavFile()));

    expect(response.status).toBe(expectedStatus);
    expect(await response.json()).toEqual({ error: expectedCode });
  });

  it("never echoes the upstream error body", async () => {
    fetchMock.mockImplementation(async () =>
      upstream({ error: { message: "secret upstream detail" } }, 502),
    );

    const response = await POST(post(wavFile()));
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(body).toBe(JSON.stringify({ error: "failed" }));
    expect(body).not.toContain("secret upstream detail");
  });
});
