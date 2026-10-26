import { describe, expect, it } from "vitest";
import { api } from "./helpers";

/**
 * `POST /api/dangerous-commands/test` over the real HTTP path: the verdict the
 * settings page's command tester shows, reached through auth, JSON parsing and
 * the server-side evaluator the `tool_call` gate also calls.
 *
 * The three-outcome detail (including a user-rule match, which needs a rule in
 * `config.yaml`) is driven at the route level in
 * `dangerous-commands-test-route.test.ts`; the read/write faces of this
 * endpoint's route live in `dangerous-commands-api.test.ts`. This file only
 * pins that the endpoint is reachable and answers with the contract shape.
 */
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

  it("rejects a body without a command string", async () => {
    const { status } = await api("/api/dangerous-commands/test", {
      method: "POST",
      body: JSON.stringify({ command: 42 }),
    });

    expect(status).toBe(400);
  });
});
