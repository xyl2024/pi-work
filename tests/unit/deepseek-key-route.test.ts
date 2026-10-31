import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeepSeekApiKeyStatus } from "@/lib/shared/deepseek";

const root = mkdtempSync(join(tmpdir(), "pi-work-deepseek-route-"));

let GET: typeof import("@/app/api/settings/deepseek-key/route")["GET"];
let POST: typeof import("@/app/api/settings/deepseek-key/route")["POST"];
let DELETE: typeof import("@/app/api/settings/deepseek-key/route")["DELETE"];
let deleteDeepSeekApiKey: typeof import("@/lib/server/deepseek/credentials")["deleteDeepSeekApiKey"];

function post(body: unknown): Request {
  return new Request("http://localhost/api/settings/deepseek-key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  process.env.PI_WORK_DATA_DIR = root;
  vi.resetModules();
  ({ GET, POST, DELETE } = await import("@/app/api/settings/deepseek-key/route"));
  ({ deleteDeepSeekApiKey } = await import("@/lib/server/deepseek/credentials"));
});

beforeEach(() => {
  deleteDeepSeekApiKey();
  delete process.env.DEEPSEEK_API_KEY;
});

afterAll(() => {
  delete process.env.PI_WORK_DATA_DIR;
  delete process.env.DEEPSEEK_API_KEY;
  rmSync(root, { recursive: true, force: true });
});

describe("GET /api/settings/deepseek-key", () => {
  it("returns an unconfigured status", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual<DeepSeekApiKeyStatus>({
      configured: false,
      source: null,
      masked: null,
    });
  });

  it("returns a masked status after the key is saved", async () => {
    await POST(post({ apiKey: "sk-route-secret-abcd" }));

    const response = await GET();
    const body = (await response.json()) as DeepSeekApiKeyStatus;

    expect(body).toEqual({ configured: true, source: "file", masked: "••••abcd" });
    expect(JSON.stringify(body)).not.toContain("sk-route-secret-abcd");
  });

  it("reports the environment source without exposing the key", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-env-route-wxyz";

    const body = (await (await GET()).json()) as DeepSeekApiKeyStatus;

    expect(body).toEqual({ configured: true, source: "env", masked: "••••wxyz" });
    expect(JSON.stringify(body)).not.toContain("sk-env-route-wxyz");
  });
});

describe("POST /api/settings/deepseek-key", () => {
  it("rejects a missing or empty key", async () => {
    for (const body of [{}, { apiKey: "" }, { apiKey: "   " }, { apiKey: 123 }]) {
      const response = await POST(post(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "apiKey is required" });
    }
  });

  it("saves the key and writes it to the key file", async () => {
    const response = await POST(post({ apiKey: "  sk-route-secret-abcd  " }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(readFileSync(join(root, "deepseek", "api-key"), "utf8")).toBe("sk-route-secret-abcd");
  });

  it("does not write the key into the logs", async () => {
    const lines: string[] = [];
    for (const level of ["debug", "info", "warn", "error"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      });
    }

    await POST(post({ apiKey: "sk-route-secret-abcd" }));
    await GET();
    await DELETE();

    expect(lines.join("\n")).not.toContain("sk-route-secret-abcd");
    vi.restoreAllMocks();
  });
});

describe("DELETE /api/settings/deepseek-key", () => {
  it("clears a saved key", async () => {
    await POST(post({ apiKey: "sk-route-secret-abcd" }));

    const response = await DELETE();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(await (await GET()).json()).toEqual<DeepSeekApiKeyStatus>({
      configured: false,
      source: null,
      masked: null,
    });
  });

  it("is idempotent when no key is saved", async () => {
    const response = await DELETE();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
  });
});
