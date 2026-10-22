import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(), getModel: vi.fn(), getAuth: vi.fn(), streamSimple: vi.fn(),
}));
vi.mock("@earendil-works/pi-coding-agent", () => ({ ModelRuntime: { create: mocks.create } }));
import { redactConnectionDiagnostics, testModelConnection } from "@/lib/server/model-connection-test";
import { POST } from "@/app/api/models-config/test/route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.create.mockResolvedValue(mocks);
  mocks.getModel.mockReturnValue({ provider: "test", id: "model", headers: { "x-custom-auth": "custom-secret" } });
  mocks.getAuth.mockResolvedValue({ auth: { apiKey: "test-secret" } });
});

describe("model connection diagnostics", () => {
  it("redacts nested credentials, known secrets, bearer values and URL tokens", () => {
    const result = redactConnectionDiagnostics({
      headers: { Authorization: "secret", "set-cookie": "session=value" },
      nested: { api_key: "secret", refreshToken: "secret" },
      error: "echo test-secret Bearer abc123 https://example.com?token=abc&foo=bar",
    }, ["test-secret"]);
    expect(result).not.toContain("test-secret");
    expect(result).not.toContain("abc123");
    expect(result).not.toContain("token=abc");
    expect(result).not.toContain("session=value");
    expect(result).toContain("foo=bar");
  });

  it("returns timing, payload, HTTP metadata, raw events and normalized response", async () => {
    mocks.streamSimple.mockImplementation((_model, _context, options) => {
      options.onPayload({ model: "model", prompt: "OK" });
      options.onResponse({ status: 200, headers: { "request-id": "req-123", "set-cookie": "private" } });
      options.onProviderStreamEvent({ delta: "OK" });
      return {
        async *[Symbol.asyncIterator]() { yield { type: "text_delta", delta: "OK" }; },
        result: async () => ({ content: [{ type: "text", text: "OK" }], stopReason: "stop", usage: { input: 10, output: 1 } }),
      };
    });
    const result = await testModelConnection("test", "model", new AbortController().signal);
    expect(result.ok).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.firstEventMs).toBeDefined();
    expect(result.diagnostics).toContain("req-123");
    expect(result.diagnostics).toContain('"usage"');
    expect(result.diagnostics).not.toContain("custom-secret");
    expect(result.diagnostics).not.toContain("private");
    expect(mocks.streamSimple.mock.calls[0][2]).toMatchObject({ maxRetries: 0, maxTokens: 128 });
  });

  it("treats upstream error messages as failure and redacts echoed credentials", async () => {
    mocks.streamSimple.mockReturnValue({
      async *[Symbol.asyncIterator]() { /* no deltas */ },
      result: async () => ({ stopReason: "error", errorMessage: "Rejected test-secret" }),
    });
    const result = await testModelConnection("test", "model", new AbortController().signal);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("REDACTED");
    expect(JSON.stringify(result)).not.toContain("test-secret");
  });

  it("reports setup failure without sending a request", async () => {
    mocks.getModel.mockReturnValue(undefined);
    const result = await testModelConnection("test", "missing", new AbortController().signal);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
    expect(mocks.streamSimple).not.toHaveBeenCalled();
  });

  it("propagates cancellation to the SDK and reports an aborted response", async () => {
    const controller = new AbortController();
    mocks.streamSimple.mockImplementation((_model, _context, options) => ({
      async *[Symbol.asyncIterator]() {
        controller.abort();
        expect(options.signal.aborted).toBe(true);
      },
      result: async () => ({ stopReason: "aborted", errorMessage: "Request aborted" }),
    }));
    const result = await testModelConnection("test", "model", controller.signal);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("aborted");
  });

  it("does not start a stream if the caller already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await testModelConnection("test", "model", controller.signal);
    expect(result.ok).toBe(false);
    expect(mocks.streamSimple).not.toHaveBeenCalled();
  });

  it("bounds returned diagnostics", async () => {
    mocks.streamSimple.mockImplementation((_model, _context, options) => {
      options.onProviderStreamEvent({ delta: "x".repeat(300_000) });
      return {
        async *[Symbol.asyncIterator]() { /* no deltas */ },
        result: async () => ({ stopReason: "stop", content: [{ text: "y".repeat(300_000) }] }),
      };
    });
    const result = await testModelConnection("test", "model", new AbortController().signal);
    expect(result.truncated).toBe(true);
    expect(result.diagnostics.length).toBeLessThanOrEqual(256_000);
  });

  it("rejects malformed route input before loading runtime", async () => {
    for (const body of ["null", "{}", '{"provider":1,"modelId":"x"}', "invalid"]) {
      const response = await POST(new Request("http://localhost/api/models-config/test", { method: "POST", body }));
      expect(response.status).toBe(400);
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
