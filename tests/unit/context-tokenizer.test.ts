import { describe, expect, it } from "vitest";
import { getContextTokenCounter } from "@/lib/server/context-tokenizer";

describe("context tokenizer (server adapter)", () => {
  it("loads o200k_base and counts the same input identically", async () => {
    const counter = await getContextTokenCounter();
    const once = counter("The quick brown fox jumps over the lazy dog.");
    const twice = counter("The quick brown fox jumps over the lazy dog.");

    expect(once).toBeGreaterThan(0);
    expect(twice).toBe(once);
  });

  it("memoizes the dynamic import", async () => {
    const [first, second] = await Promise.all([getContextTokenCounter(), getContextTokenCounter()]);
    expect(first).toBe(second);
    expect(await getContextTokenCounter()).toBe(first);
  });

  it("never reports fewer tokens for longer text", async () => {
    const counter = await getContextTokenCounter();
    const short = counter("系统提示");
    const long = counter("系统提示".repeat(50));

    expect(long).toBeGreaterThan(short);
  });
});
