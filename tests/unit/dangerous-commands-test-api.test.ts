import { describe, expect, it } from "vitest";
import { api } from "./helpers";

describe("dangerous command test api", () => {
  it("reports a command self-protection would hard-block", async () => {
    const { status, body } = await api("/api/dangerous-commands/test", {
      method: "POST",
      body: JSON.stringify({ command: "pkill node" }),
    });

    expect(status).toBe(200);
    expect(body.kind).toBe("self_protected");
    expect(body.reason).toEqual(expect.any(String));
  });

  it("reports no match for a command no rule catches", async () => {
    const { status, body } = await api("/api/dangerous-commands/test", {
      method: "POST",
      body: JSON.stringify({ command: "ls -la" }),
    });

    expect(status).toBe(200);
    expect(body).toEqual({ kind: "none" });
  });
});
