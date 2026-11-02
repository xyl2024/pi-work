import { describe, expect, it } from "vitest";
import { readConfig } from "@/lib/server/config";
import { GET as getSettings, PUT as putSettings } from "@/app/api/settings/route";
import { createSandbox } from "./sandbox";

function sandbox(): void {
  createSandbox("pi-work-memory-settings-");
}

function put(body: unknown): Promise<Response> {
  return putSettings(
    new Request("http://localhost:30143/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("memory settings", () => {
  it("reports memory off by default", async () => {
    sandbox();

    const body = await (await getSettings()).json();

    expect(body.memory).toEqual({ enabled: false });
  });

  it("flips the global switch through the settings route", async () => {
    sandbox();

    const response = await put({ memory: { enabled: true } });
    expect(response.status).toBe(200);

    expect(readConfig().memory).toEqual({ enabled: true });
    expect((await (await getSettings()).json()).memory).toEqual({ enabled: true });
  });

  it("rejects a non-boolean enabled flag without writing", async () => {
    sandbox();

    const response = await put({ memory: { enabled: "yes" } });

    expect(response.status).toBe(400);
    expect(readConfig().memory).toEqual({ enabled: false });
  });

  it("rejects a non-object memory value", async () => {
    sandbox();

    const response = await put({ memory: true });

    expect(response.status).toBe(400);
    expect(readConfig().memory).toEqual({ enabled: false });
  });

  it("keeps other config keys when the switch flips", async () => {
    sandbox();
    await put({ load_pi_docs: false });

    await put({ memory: { enabled: true } });

    expect(readConfig().load_pi_docs).toBe(false);
    expect(readConfig().memory).toEqual({ enabled: true });
  });
});
