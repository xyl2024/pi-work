import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/memory/usage/route";
import { createSandbox, type Sandbox } from "./sandbox";

function seed(sandbox: Sandbox, file: string, content: string): void {
  const dir = join(sandbox.dataDir, "memory");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), content, "utf8");
}

describe("memory usage route", () => {
  it("reports empty stores before anything was written", async () => {
    createSandbox("pi-work-memory-usage-route-");

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      memory: { file: "MEMORY.md", status: "missing", used: 0, limit: 2200 },
      user: { file: "USER.md", status: "missing", used: 0, limit: 1375 },
    });
  });

  it("reads live char counts from both stores", async () => {
    const sandbox = createSandbox("pi-work-memory-usage-route-");
    seed(sandbox, "MEMORY.md", "likes terse answers\n§\nworks in WSL2");
    seed(sandbox, "USER.md", "name is Alone");

    const body = await (await GET()).json();

    expect(body.memory).toEqual({
      file: "MEMORY.md",
      status: "ok",
      used: "likes terse answers\n§\nworks in WSL2".length,
      limit: 2200,
    });
    expect(body.user).toEqual({
      file: "USER.md",
      status: "ok",
      used: "name is Alone".length,
      limit: 1375,
    });
  });

  it("sees changes made directly on disk", async () => {
    const sandbox = createSandbox("pi-work-memory-usage-route-");
    seed(sandbox, "USER.md", "name is Alone");

    expect((await (await GET()).json()).user.used).toBe("name is Alone".length);

    seed(sandbox, "USER.md", "name is Alone\n§\nprefers Chinese");
    expect((await (await GET()).json()).user.used).toBe(
      "name is Alone\n§\nprefers Chinese".length,
    );
  });
});
