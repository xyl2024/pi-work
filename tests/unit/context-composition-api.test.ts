import { unlink } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { ContextComposition } from "@/lib/shared/context-composition";
import { api, expectOk } from "./helpers";

/**
 * Interface test for the server half of the context-composition feature: the
 * 2.4MB `o200k_base` tokenizer must actually load inside the *Next.js server
 * runtime* and produce a four-bucket composition on `get_state`. The Node-only
 * test (`context-tokenizer.test.ts`) proves the package loads in plain Node; it
 * says nothing about whether the app's runtime can resolve it — which is
 * exactly the risk this ticket exists to retire.
 *
 * `POST /api/agent/new` boots a real pi session for the cwd and forwards the
 * command in the body to it, so asking for `get_state` (instead of a prompt)
 * goes through the whole path — session boot → dynamic import → local counting
 * → `get_state` — without calling a model. `startRpcSession` creates the
 * session's JSONL up front, so the helper removes it again afterwards.
 */
describe("context composition (agent API)", () => {
  async function withFreshSession<T>(
    run: (state: { contextComposition?: ContextComposition | null; systemPrompt?: string }) => T,
  ): Promise<T> {
    const { status, body } = await api("/api/agent/new", {
      method: "POST",
      body: JSON.stringify({ cwd: process.cwd(), type: "get_state" }),
    });
    expectOk(status, body);
    const state = body.data as { contextComposition?: ContextComposition | null; sessionFile?: string };
    try {
      return run(state);
    } finally {
      if (state.sessionFile) await unlink(state.sessionFile).catch(() => {});
    }
  }

  it("returns a server-computed four-bucket composition from get_state", async () => {
    await withFreshSession((state) => {
      const composition = state.contextComposition;

      // Non-null is the assertion that matters: the refresh swallows a failed
      // tokenizer load, so a null here means the dynamic import didn't work.
      expect(composition).toBeTruthy();
      expect(composition!.buckets.map((bucket) => bucket.id)).toEqual([
        "system-prompt",
        "system-tools",
        "skills",
        "messages",
      ]);

      const prompt = composition!.buckets.find((bucket) => bucket.id === "system-prompt")!;
      const tools = composition!.buckets.find((bucket) => bucket.id === "system-tools")!;
      const messages = composition!.buckets.find((bucket) => bucket.id === "messages")!;

      // A live session always has a system prompt and active tool schemas; the
      // tool bucket is counted locally even though the prompt's one-line tool
      // list lives in the prompt bucket.
      expect(prompt.localTokens).toBeGreaterThan(0);
      expect(tools.localTokens).toBeGreaterThan(0);
      expect(tools.leaves.length).toBeGreaterThan(0);
      expect(messages.localTokens).toBe(0);
      expect(composition!.localTotal).toBe(
        composition!.buckets.reduce((sum, bucket) => sum + bucket.localTokens, 0),
      );

      // A fresh session has no provider usage yet, so there is no anchor: the
      // buckets must degrade to local counts rather than invent percentages.
      expect(composition!.anchoredTotalTokens).toBeNull();
      for (const bucket of composition!.buckets) {
        expect(bucket.tokens).toBeNull();
        expect(bucket.percent).toBeNull();
        expect(Number.isFinite(bucket.localTokens)).toBe(true);
      }
    });
  }, 60_000);

  it("is stable across calls (the encoding is loaded once)", async () => {
    const localTotals = await Promise.all([
      withFreshSession((state) => state.contextComposition?.localTotal),
      withFreshSession((state) => state.contextComposition?.localTotal),
    ]);

    expect(localTotals[0]).toBeGreaterThan(0);
    expect(localTotals[1]).toBe(localTotals[0]);
  }, 60_000);
});
