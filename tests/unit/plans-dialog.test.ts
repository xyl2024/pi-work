import { describe, expect, it } from "vitest";
import { planConflictSurface, planDialogLayout } from "@/lib/client/plans";

/**
 * The plan detail dialog (#51) makes two decisions that are worth pinning down
 * without rendering anything: where a refused write's 「覆盖 / 重载」 banner has
 * to appear, and whether the dialog can afford two columns. Both are pure
 * functions on `lib/client/plans`, next to the `planWriteFailure` classifier
 * they refine.
 */

describe("planConflictSurface", () => {
  it("shows a refused note save inside the detail dialog that asked for it", () => {
    expect(planConflictSurface({ kind: "note" })).toBe("dialog");
  });

  it("keeps a refused completion toggle on the row, never in the dialog", () => {
    // The dialog can only edit the note, so dragging the user into it would
    // lose what they actually clicked.
    expect(planConflictSurface({ kind: "done", done: true })).toBe("row");
  });

  it("keeps a refused re-schedule on the row", () => {
    expect(
      planConflictSurface({ kind: "anchor", anchor: { kind: "inbox" } }),
    ).toBe("row");
  });

  it("keeps a refused rename on the row", () => {
    // The rename input lives in the row, and the dialog cannot rename — so the
    // 「覆盖 / 重载」 answer must appear where the new name was typed.
    expect(planConflictSurface({ kind: "rename", title: "新名字" })).toBe("row");
  });
});

describe("planDialogLayout", () => {
  it("splits edit and preview at 700px and above", () => {
    expect(planDialogLayout(900)).toBe("split");
    expect(planDialogLayout(700)).toBe("split");
  });

  it("falls back to the 编辑 / 预览 tab switch below 700px", () => {
    expect(planDialogLayout(699)).toBe("tabs");
    expect(planDialogLayout(360)).toBe("tabs");
  });

  it("starts on tabs before the dialog has been measured", () => {
    // The first render happens with no width yet; a split that collapses into
    // two slivers for one frame is worse than a tab switch for one frame.
    expect(planDialogLayout(0)).toBe("tabs");
  });
});
