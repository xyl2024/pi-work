// Smoke test for lib/client/btw-storage.ts. Per handoff §6 this is the
// "minimum viable" coverage for the storage layer:
//   - read/write round-trip with version=1
//   - 7-day silent expiry on next read
//   - 2 MB hard cap throws BtwStorageQuotaError
//   - shape guard rejects corrupt / wrong-version records
//
// Runs via `node --experimental-strip-types scripts/test-btw-storage.mts`
// (Node 22+). Does NOT spin up the Next.js dev server.
//
// Exit code 0 on success; non-zero on any assertion failure.

import assert from "node:assert/strict";

// Build a window.localStorage shim before importing the module under test.
class MemStore {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  keys(): string[] { return [...this.m.keys()]; }
}
(globalThis as unknown as { window: { localStorage: Storage } }).window = {
  localStorage: new MemStore() as unknown as Storage,
};

const btw = await import("../lib/client/btw-storage.ts");

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (error) {
    console.error(`  FAIL ${name}\n       ${error instanceof Error ? error.message : String(error)}`);
    failed++;
  }
}

console.log("btw-storage smoke tests:");

test("readBtw returns null when key is missing", () => {
  const out = btw.readBtw("missing-id");
  assert.equal(out, null);
});

test("writeBtw + readBtw round-trip", () => {
  const id = "round-trip";
  const now = Date.now();
  btw.writeBtw({
    version: 1,
    mainSessionId: id,
    modelSnapshot: { provider: "anthropic", modelId: "claude-opus-4-5" },
    createdAt: now,
    lastUpdated: now,
    messages: [
      { role: "user", content: "hello", timestamp: now },
    ],
  });
  const out = btw.readBtw(id);
  assert.ok(out, "expected record to be readable");
  assert.equal(out!.mainSessionId, id);
  assert.equal(out!.version, 1);
  assert.equal(out!.messages.length, 1);
  assert.equal((out!.messages[0] as { content: string }).content, "hello");
});

test("writeBtw + readBtw is keyed by mainSessionId", () => {
  const id1 = "keyed-1";
  const id2 = "keyed-2";
  const now = Date.now();
  btw.writeBtw({
    version: 1,
    mainSessionId: id1,
    modelSnapshot: { provider: "openai", modelId: "gpt-5" },
    createdAt: now,
    lastUpdated: now,
    messages: [],
  });
  btw.writeBtw({
    version: 1,
    mainSessionId: id2,
    modelSnapshot: { provider: "openai", modelId: "gpt-5" },
    createdAt: now,
    lastUpdated: now,
    messages: [],
  });
  const r1 = btw.readBtw(id1);
  const r2 = btw.readBtw(id2);
  assert.ok(r1, "id1 record should exist");
  assert.ok(r2, "id2 record should exist");
  assert.equal(r1!.mainSessionId, id1);
  assert.equal(r2!.mainSessionId, id2);
});

test("deleteBtw removes the key", () => {
  const id = "delete-me";
  const now = Date.now();
  btw.writeBtw({
    version: 1,
    mainSessionId: id,
    modelSnapshot: { provider: "p", modelId: "m" },
    createdAt: now,
    lastUpdated: now,
    messages: [],
  });
  assert.ok(btw.hasBtw(id), "should exist before delete");
  btw.deleteBtw(id);
  assert.equal(btw.readBtw(id), null, "should be gone after delete");
});

test("hasBtw reflects expiry", () => {
  // Inject a record with lastUpdated = 8 days ago. readBtw must drop
  // it on entry without raising.
  const id = "expired";
  const eightDaysAgoMs = Date.now() - 8 * 86_400_000;
  const store = (globalThis as unknown as { window: { localStorage: MemStore } }).window.localStorage;
  store.setItem(
    `pi-work:btw:${id}`,
    JSON.stringify({
      version: 1,
      mainSessionId: id,
      modelSnapshot: { provider: "p", modelId: "m" },
      createdAt: eightDaysAgoMs,
      lastUpdated: eightDaysAgoMs,
      messages: [],
    }),
  );
  assert.equal(btw.readBtw(id), null, "expired record should return null");
  assert.equal(store.keys().filter((k) => k === `pi-work:btw:${id}`).length, 0, "expired key should be removed");
});

test("2 MB cap throws BtwStorageQuotaError", () => {
  const id = "huge";
  const hugeText = "x".repeat(2 * 1024 * 1024);
  assert.throws(
    () => btw.writeBtw({
      version: 1,
      mainSessionId: id,
      modelSnapshot: { provider: "p", modelId: "m" },
      createdAt: Date.now(),
      lastUpdated: Date.now(),
      messages: [{ role: "user", content: hugeText, timestamp: Date.now() }],
    }),
    (err: unknown) => err instanceof btw.BtwStorageQuotaError,
  );
});

test("readBtw drops corrupt JSON", () => {
  const id = "corrupt";
  const store = (globalThis as unknown as { window: { localStorage: MemStore } }).window.localStorage;
  store.setItem(`pi-work:btw:${id}`, "{not json");
  assert.equal(btw.readBtw(id), null);
});

test("readBtw drops wrong-version records", () => {
  const id = "wrong-version";
  const store = (globalThis as unknown as { window: { localStorage: MemStore } }).window.localStorage;
  store.setItem(
    `pi-work:btw:${id}`,
    JSON.stringify({
      version: 99,
      mainSessionId: id,
      modelSnapshot: { provider: "p", modelId: "m" },
      createdAt: Date.now(),
      lastUpdated: Date.now(),
      messages: [],
    }),
  );
  assert.equal(btw.readBtw(id), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);