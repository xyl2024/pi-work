import { describe, expect, it } from "vitest";
import { readConfig } from "@/lib/server/config";
import { GET as getSettings, PUT as putSettings } from "@/app/api/settings/route";
import { createSandbox } from "./sandbox";

function sandbox(): void {
  createSandbox("pi-work-assistant-settings-");
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

describe("assistant settings", () => {
  it("hides the sidebar entry by default", async () => {
    sandbox();

    const body = await (await getSettings()).json();

    expect(body.assistant).toEqual({ sidebar_entry: false });
  });

  it("shows the sidebar entry when enabled through the settings route", async () => {
    sandbox();

    const response = await put({ assistant: { sidebar_entry: true } });
    expect(response.status).toBe(200);

    expect(readConfig().assistant).toEqual({ sidebar_entry: true });
    expect((await (await getSettings()).json()).assistant).toEqual({ sidebar_entry: true });
  });

  it("rejects a non-boolean sidebar_entry without writing", async () => {
    sandbox();

    const response = await put({ assistant: { sidebar_entry: "yes" } });

    expect(response.status).toBe(400);
    expect(readConfig().assistant).toEqual({ sidebar_entry: false });
  });

  it("rejects a non-object assistant value", async () => {
    sandbox();

    const response = await put({ assistant: true });

    expect(response.status).toBe(400);
    expect(readConfig().assistant).toEqual({ sidebar_entry: false });
  });

  it("keeps other config keys when the flag flips", async () => {
    sandbox();
    await put({ load_pi_docs: false });

    await put({ assistant: { sidebar_entry: true } });

    expect(readConfig().load_pi_docs).toBe(false);
    expect(readConfig().assistant).toEqual({ sidebar_entry: true });
  });
});
