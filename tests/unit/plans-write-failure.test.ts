import { describe, expect, it } from "vitest";
import { PlanConflictError, planWriteFailure } from "@/lib/client/plans";

/**
 * The panel answers a refused write in one of three ways, and which one is
 * decided by `planWriteFailure`. It is the branch the panel used to repeat at
 * every write site, so the classification itself is what is worth pinning
 * down — the toasts and the retry bookkeeping above it are rendering.
 */

describe("planWriteFailure", () => {
  it("classifies a name collision as name-taken, with the occupied path", () => {
    const failure = planWriteFailure(
      new PlanConflictError("name-taken", "A plan already exists there", null, "2026-10/2026-10-02-x.md"),
    );
    expect(failure).toEqual({
      kind: "name-taken",
      target: "2026-10/2026-10-02-x.md",
      message: "A plan already exists there",
    });
  });

  it("classifies a modified file as a conflict the user must answer", () => {
    const failure = planWriteFailure(
      new PlanConflictError("modified", "changed on disk", null),
    );
    expect(failure).toEqual({
      kind: "conflict",
      code: "modified",
      movedTo: null,
      message: "changed on disk",
    });
  });

  it("carries the server's guess at the new path for a moved file", () => {
    const failure = planWriteFailure(
      new PlanConflictError("missing", "gone", "2026-10/2026-10-02-x.md"),
    );
    expect(failure.kind).toBe("conflict");
    expect(failure).toMatchObject({ code: "missing", movedTo: "2026-10/2026-10-02-x.md" });
  });

  it("falls back to a plain error for anything that is not a 409", () => {
    expect(planWriteFailure(new Error("network down"))).toEqual({
      kind: "error",
      message: "network down",
    });
  });

  it("still produces an error message when a non-Error is thrown", () => {
    expect(planWriteFailure("boom")).toEqual({ kind: "error", message: "boom" });
  });
});
