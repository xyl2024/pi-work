import { unlink } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { ContextComposition } from "@/lib/shared/context-composition";
import { contextBucketRows } from "@/lib/shared/context-composition-rows";
import { api, expectOk } from "./helpers";

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

      expect(prompt.localTokens).toBeGreaterThan(0);
      expect(tools.localTokens).toBeGreaterThan(0);
      expect(tools.leaves.length).toBeGreaterThan(0);
      expect(messages.localTokens).toBe(0);
      expect(composition!.localTotal).toBe(
        composition!.buckets.reduce((sum, bucket) => sum + bucket.localTokens, 0),
      );

      expect(composition!.anchoredTotalTokens).toBeNull();
      expect(composition!.topToolResults).toEqual([]);
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

  it("projects a real prompt into rows that add up to their bucket", async () => {
    await withFreshSession((state) => {
      const composition = state.contextComposition!;
      const prompt = composition.buckets.find((bucket) => bucket.id === "system-prompt")!;
      const rows = contextBucketRows(prompt);

      expect(rows.map((row) => row.id)).toContain("cwd");
      expect(rows.reduce((sum, row) => sum + row.localTokens, 0)).toBe(prompt.localTokens);
      const base = rows.find((row) => row.id === "base");
      expect(base?.children.map((child) => child.id)).toContain("available-tools");
      expect(base?.children.reduce((sum, child) => sum + child.localTokens, 0)).toBe(base?.localTokens);
    });
  }, 60_000);
});
