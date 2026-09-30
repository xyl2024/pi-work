import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The /api/subagents profile handlers, driven directly (no HTTP server): list
 * the seeded built-ins, create / update / delete a profile, and reject invalid
 * input with a 400. The store is pointed at a temp database via
 * `PI_WORK_SUBAGENTS_DB` so nothing touches real user data.
 */

let dir: string;
let GET: typeof import("@/app/api/subagents/route")["GET"];
let POST: typeof import("@/app/api/subagents/route")["POST"];
let PUT: typeof import("@/app/api/subagents/route")["PUT"];
let DELETE: typeof import("@/app/api/subagents/route")["DELETE"];

function resetStoreGlobals(): void {
  delete (globalThis as { __piSubagentsDb?: unknown }).__piSubagentsDb;
  delete (globalThis as { __piSubagentProfilesSeeded?: unknown }).__piSubagentProfilesSeeded;
}

function jsonRequest(method: string, body?: unknown, search = ""): Request {
  return new Request(`http://localhost/api/subagents${search}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const validProfile = {
  name: "api_agent",
  description: "Created through the API.",
  systemPrompt: "Do the thing.",
  tools: ["read", "grep"],
  model: { provider: "anthropic", modelId: "claude" },
  thinkingLevel: "medium",
  bot: { expression: 2, stateKey: "idle", shapeId: "blob", parts: [], accessories: [] },
  timeoutMs: 120_000,
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "pi-work-subagents-api-"));
  process.env.PI_WORK_SUBAGENTS_DB = join(dir, "subagents.db");
  resetStoreGlobals();
  const route = await import("@/app/api/subagents/route");
  GET = route.GET;
  POST = route.POST;
  PUT = route.PUT;
  DELETE = route.DELETE;
});

afterAll(() => {
  resetStoreGlobals();
  delete process.env.PI_WORK_SUBAGENTS_DB;
  rmSync(dir, { recursive: true, force: true });
});

describe("/api/subagents handlers", () => {
  it("lists the seeded built-ins", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json() as { profiles: Array<{ name: string; builtin: boolean }> };
    const names = body.profiles.map((profile) => profile.name);
    expect(names).toContain("codebase_explorer");
    expect(names).toContain("code_reviewer");
    expect(body.profiles.every((profile) => profile.builtin)).toBe(true);
  });

  it("creates, updates and deletes a profile", async () => {
    const created = await POST(jsonRequest("POST", validProfile));
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { profile: { name: string; builtin: boolean } };
    expect(createdBody.profile.name).toBe("api_agent");
    expect(createdBody.profile.builtin).toBe(false);

    // Duplicate name → 409.
    expect((await POST(jsonRequest("POST", validProfile))).status).toBe(409);

    const updated = await PUT(jsonRequest("PUT", { ...validProfile, description: "Changed." }));
    expect(updated.status).toBe(200);
    expect((await updated.json() as { profile: { description: string } }).profile.description).toBe("Changed.");

    // Unknown name on update → 404.
    expect((await PUT(jsonRequest("PUT", { ...validProfile, name: "nope" }))).status).toBe(404);

    expect((await DELETE(jsonRequest("DELETE", undefined, "?name=api_agent"))).status).toBe(200);
    expect((await DELETE(jsonRequest("DELETE", undefined, "?name=api_agent"))).status).toBe(404);

    const after = await GET();
    const names = (await after.json() as { profiles: Array<{ name: string }> }).profiles.map((profile) => profile.name);
    expect(names).not.toContain("api_agent");
  });

  it("rejects invalid input with 400", async () => {
    expect((await POST(jsonRequest("POST", { ...validProfile, name: "Bad Name" }))).status).toBe(400);
    expect((await POST(jsonRequest("POST", { ...validProfile, systemPrompt: "" }))).status).toBe(400);
    expect((await POST(jsonRequest("POST", { ...validProfile, timeoutMs: 1 }))).status).toBe(400);
    expect((await DELETE(jsonRequest("DELETE", undefined, "?name=Bad Name"))).status).toBe(400);
  });
});
