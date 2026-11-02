import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GET, PUT } from "@/app/api/memory/cwd/route";
import { readConfig, writeConfig } from "@/lib/server/config";
import { readMemoryCwdOverrides } from "@/lib/server/memory-cwd-store";
import { createSandbox } from "./sandbox";

function setGlobalMemory(enabled: boolean): void {
  writeConfig({ ...readConfig(), memory: { enabled } });
}

function getRequest(cwd?: string): Request {
  const query = cwd === undefined ? "" : `?cwd=${encodeURIComponent(cwd)}`;
  return new Request(`http://localhost/api/memory/cwd${query}`);
}

function putRequest(body: unknown): Request {
  return new Request("http://localhost/api/memory/cwd", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/memory/cwd", () => {
  it("rejects a missing cwd", async () => {
    createSandbox("pi-work-memory-cwd-route-");

    const response = await GET(getRequest());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "cwd is required" });
  });

  it("reports a cwd enabled while the global switch is on and nothing is recorded", async () => {
    createSandbox("pi-work-memory-cwd-route-");
    setGlobalMemory(true);

    const response = await GET(getRequest("/work/plain"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cwd: "/work/plain", enabled: true, globalEnabled: true });
  });

  it("reports a cwd disabled once it is recorded off", async () => {
    const sandbox = createSandbox("pi-work-memory-cwd-route-");
    setGlobalMemory(true);

    await PUT(putRequest({ cwd: "/work/secret", enabled: false }));
    const response = await GET(getRequest("/work/secret"));

    expect(await response.json()).toEqual({ cwd: "/work/secret", enabled: false, globalEnabled: true });
    expect(readMemoryCwdOverrides()).toEqual({ "/work/secret": false });
    expect(existsSync(join(sandbox.dataDir, "memory-cwd.json"))).toBe(true);
  });

  it("reports every cwd disabled while the global switch is off", async () => {
    createSandbox("pi-work-memory-cwd-route-");
    setGlobalMemory(false);
    await PUT(putRequest({ cwd: "/work/plain", enabled: true }));

    const response = await GET(getRequest("/work/plain"));

    expect(await response.json()).toEqual({ cwd: "/work/plain", enabled: false, globalEnabled: false });
  });
});

describe("PUT /api/memory/cwd", () => {
  it("rejects a missing cwd", async () => {
    createSandbox("pi-work-memory-cwd-route-");
    setGlobalMemory(true);

    const response = await PUT(putRequest({ enabled: false }));

    expect(response.status).toBe(400);
    expect(readMemoryCwdOverrides()).toEqual({});
  });

  it("rejects a non-boolean enabled", async () => {
    createSandbox("pi-work-memory-cwd-route-");
    setGlobalMemory(true);

    for (const enabled of ["off", 0, null, undefined]) {
      const response = await PUT(putRequest({ cwd: "/work/secret", enabled }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "enabled must be a boolean" });
    }
    expect(readMemoryCwdOverrides()).toEqual({});
  });

  it("rejects a body that is not JSON", async () => {
    createSandbox("pi-work-memory-cwd-route-");
    setGlobalMemory(true);

    const response = await PUT(
      new Request("http://localhost/api/memory/cwd", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: "not json",
      }),
    );

    expect(response.status).toBe(400);
    expect(readMemoryCwdOverrides()).toEqual({});
  });

  it("records the cwd off and restores it when turned back on", async () => {
    createSandbox("pi-work-memory-cwd-route-");
    setGlobalMemory(true);

    const off = await PUT(putRequest({ cwd: "/work/secret", enabled: false }));
    expect(off.status).toBe(200);
    expect(await off.json()).toEqual({ cwd: "/work/secret", enabled: false, globalEnabled: true });

    const on = await PUT(putRequest({ cwd: "/work/secret", enabled: true }));
    expect(on.status).toBe(200);
    expect(await on.json()).toEqual({ cwd: "/work/secret", enabled: true, globalEnabled: true });
    expect(readMemoryCwdOverrides()).toEqual({});
  });
});
