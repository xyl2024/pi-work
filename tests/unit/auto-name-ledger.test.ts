import { describe, expect, it } from "vitest";
import { claimAutoNamedSession } from "@/lib/client/auto-name-ledger";

// Distinct session ids per test so the module-level ledger stays the only
// shared state under test.
describe("auto-name ledger", () => {
  it("claims a session once — a reopened tab does not claim it again", () => {
    expect(claimAutoNamedSession("ledger-test-once")).toBe(true);
    expect(claimAutoNamedSession("ledger-test-once")).toBe(false);
    expect(claimAutoNamedSession("ledger-test-once")).toBe(false);
  });

  it("keys the ledger by session, so other sessions still claim", () => {
    expect(claimAutoNamedSession("ledger-test-a")).toBe(true);
    expect(claimAutoNamedSession("ledger-test-b")).toBe(true);
    expect(claimAutoNamedSession("ledger-test-a")).toBe(false);
    expect(claimAutoNamedSession("ledger-test-b")).toBe(false);
  });
});
