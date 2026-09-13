import { describe, expect, it } from "vitest";
import {
  decideAutoNameApply,
  decideAutoNameStart,
  shouldConfirmAutoName,
  type AutoNameMode,
  type AutoNameStartInput,
} from "@/lib/shared/auto-naming";

/** Baseline: a settled session with a first user message and no name yet. */
const base: AutoNameStartInput = {
  mode: "manual",
  sessionId: "01a01ffa-023",
  isAutoNaming: false,
  agentRunning: false,
  firstUserMessageText: "Add a dark mode toggle",
  currentSessionName: null,
};

const start = (overrides: Partial<AutoNameStartInput> = {}) => decideAutoNameStart({ ...base, ...overrides });

/** The reason a start decision abandoned, or "proceed". */
function startOutcome(input: Partial<AutoNameStartInput> = {}): string {
  const decision = start(input);
  return decision.kind === "proceed" ? "proceed" : decision.reason;
}

describe.each<AutoNameMode>(["manual", "auto"])("decideAutoNameStart (%s mode)", (mode) => {
  it("proceeds for a settled session with a first user message", () => {
    const decision = start({ mode });
    expect(decision).toEqual({ kind: "proceed", sessionId: base.sessionId });
  });

  it("abandons when there is no session id", () => {
    expect(startOutcome({ mode, sessionId: null })).toBe("no-session");
    expect(startOutcome({ mode, sessionId: undefined })).toBe("no-session");
    expect(startOutcome({ mode, sessionId: "" })).toBe("no-session");
  });

  it("abandons while an auto-name request is already in flight", () => {
    expect(startOutcome({ mode, isAutoNaming: true })).toBe("already-running");
  });

  it("abandons without a usable first user message", () => {
    expect(startOutcome({ mode, firstUserMessageText: null })).toBe("no-first-user-message");
    expect(startOutcome({ mode, firstUserMessageText: "" })).toBe("no-first-user-message");
    expect(startOutcome({ mode, firstUserMessageText: "   \n  " })).toBe("no-first-user-message");
  });
});

describe("decideAutoNameStart: the agent-running guard is manual-only", () => {
  it("abandons a manual run while the agent is busy", () => {
    expect(startOutcome({ mode: "manual", agentRunning: true })).toBe("agent-running");
  });

  it("lets the silent auto run piggyback on the in-flight first turn", () => {
    expect(startOutcome({ mode: "auto", agentRunning: true })).toBe("proceed");
  });
});

describe("decideAutoNameStart: the name-already-set check is auto-only", () => {
  it("proceeds for manual naming even when a name exists (the confirm dialog handles it)", () => {
    expect(startOutcome({ mode: "manual", currentSessionName: "My session" })).toBe("proceed");
  });

  it("treats a whitespace-only name as no name", () => {
    expect(startOutcome({ mode: "auto", currentSessionName: "   " })).toBe("proceed");
  });

  // Race rule 1: a rename inside the 1s window before the LLM call wins.
  it("abandons the silent auto run when the user renamed inside the window (race rule 1)", () => {
    expect(startOutcome({ mode: "auto", currentSessionName: "Renamed by hand" })).toBe("name-already-set");
  });
});

describe("decideAutoNameStart: decision priority", () => {
  it("reports no-session before any other condition", () => {
    expect(
      startOutcome({
        mode: "manual",
        sessionId: null,
        isAutoNaming: true,
        agentRunning: true,
        firstUserMessageText: null,
        currentSessionName: "Hitler",
      }),
    ).toBe("no-session");
  });

  it("reports an in-flight request before the agent-running guard", () => {
    expect(startOutcome({ mode: "manual", isAutoNaming: true, agentRunning: true })).toBe("already-running");
  });
});

describe("shouldConfirmAutoName", () => {
  it("asks before a manual rename that would overwrite a name", () => {
    expect(shouldConfirmAutoName({ mode: "manual", currentSessionName: "My session" })).toBe(true);
  });

  it("does not ask for a manual rename of an unnamed session", () => {
    expect(shouldConfirmAutoName({ mode: "manual", currentSessionName: null })).toBe(false);
    expect(shouldConfirmAutoName({ mode: "manual", currentSessionName: "" })).toBe(false);
    expect(shouldConfirmAutoName({ mode: "manual", currentSessionName: "   " })).toBe(false);
  });

  it("never asks for the silent auto mode", () => {
    expect(shouldConfirmAutoName({ mode: "auto", currentSessionName: "My session" })).toBe(false);
    expect(shouldConfirmAutoName({ mode: "auto", currentSessionName: null })).toBe(false);
  });
});

describe("decideAutoNameApply", () => {
  it("applies the trimmed name", () => {
    expect(decideAutoNameApply({ mode: "manual", suggestedName: "  Dark mode toggle \n", currentSessionName: null }))
      .toEqual({ kind: "apply", name: "Dark mode toggle" });
  });

  it("abandons an empty answer in both modes", () => {
    expect(decideAutoNameApply({ mode: "manual", suggestedName: "", currentSessionName: null }))
      .toEqual({ kind: "abandon", reason: "empty-name" });
    expect(decideAutoNameApply({ mode: "auto", suggestedName: "   ", currentSessionName: null }))
      .toEqual({ kind: "abandon", reason: "empty-name" });
    expect(decideAutoNameApply({ mode: "auto", suggestedName: null, currentSessionName: null }))
      .toEqual({ kind: "abandon", reason: "empty-name" });
    expect(decideAutoNameApply({ mode: "auto", suggestedName: undefined, currentSessionName: null }))
      .toEqual({ kind: "abandon", reason: "empty-name" });
  });

  it("still applies a manual name that overwrites an existing one", () => {
    expect(decideAutoNameApply({ mode: "manual", suggestedName: "Fresh name", currentSessionName: "Old name" }))
      .toEqual({ kind: "apply", name: "Fresh name" });
  });

  // Race rule 2: a rename during the LLM call wins — silent skip.
  it("abandons the silent auto write when a name appeared during the LLM call (race rule 2)", () => {
    expect(decideAutoNameApply({ mode: "auto", suggestedName: "Fresh name", currentSessionName: "Renamed by hand" }))
      .toEqual({ kind: "abandon", reason: "name-already-set" });
  });

  it("treats a whitespace-only current name as no name", () => {
    expect(decideAutoNameApply({ mode: "auto", suggestedName: "Fresh name", currentSessionName: "  " }))
      .toEqual({ kind: "apply", name: "Fresh name" });
  });
});
