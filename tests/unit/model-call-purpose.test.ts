import { describe, expect, it } from "vitest";
import { summarizationPurpose } from "@/lib/shared/model-call-purpose";

/**
 * Pure rule tests for the SDK summarization request classifier. The acceptance
 * tests in `model-call-metrics-compaction.test.ts` drive the real SDK entries;
 * these cases pin the request-shape edge cases they cannot cheaply construct.
 */

const SUMMARIZATION_SYSTEM =
  "You are a context summarization assistant. Your task is to read a conversation between a user and an AI assistant, then produce a structured summary following the exact format specified.\n\nDo NOT continue the conversation.";
const ORDINARY_SYSTEM = "You are a coding assistant.";

function textBlock(text: string) {
  return [{ type: "text", text }];
}

function normalized(systemPrompt: string, userText: string) {
  return {
    messages: [
      { role: "system", content: textBlock(systemPrompt) },
      { role: "user", content: textBlock(userText) },
    ],
  };
}

const COMPACTION_INSTRUCTIONS =
  "The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.";
const BRANCH_SUMMARY_INSTRUCTIONS =
  "Create a structured summary of this conversation branch for context when returning later.\n\n## Goal\n...";

function conversation(body: string): string {
  return `<conversation>\n${body}\n</conversation>`;
}

describe("summarizationPurpose", () => {
  it("classifies a compaction summary request", () => {
    expect(
      summarizationPurpose(
        normalized(SUMMARIZATION_SYSTEM, `${conversation("user: hi")}\n\n${COMPACTION_INSTRUCTIONS}`),
      ),
    ).toBe("compaction");
  });

  it("classifies a branch summary request, including appended custom focus", () => {
    expect(
      summarizationPurpose(
        normalized(SUMMARIZATION_SYSTEM, `${conversation("user: hi")}\n\n${BRANCH_SUMMARY_INSTRUCTIONS}`),
      ),
    ).toBe("branch-summary");
    expect(
      summarizationPurpose(
        normalized(
          SUMMARIZATION_SYSTEM,
          `${conversation("user: hi")}\n\n${BRANCH_SUMMARY_INSTRUCTIONS}\n\nAdditional focus: keep file names`,
        ),
      ),
    ).toBe("branch-summary");
  });

  it("does not let the branch marker inside the conversation flip a compaction", () => {
    const body = `user: please explain "${BRANCH_SUMMARY_INSTRUCTIONS.split("\n")[0]}"`;
    expect(
      summarizationPurpose(
        normalized(SUMMARIZATION_SYSTEM, `${conversation(body)}\n\n${COMPACTION_INSTRUCTIONS}`),
      ),
    ).toBe("compaction");
  });

  it("treats the split-turn prefix prompt as compaction", () => {
    expect(
      summarizationPurpose(
        normalized(
          SUMMARIZATION_SYSTEM,
          "# Conversation\nuser: hi\n\n# Instructions\nThe messages above are earlier context from an ongoing conversation.",
        ),
      ),
    ).toBe("compaction");
  });

  it("accepts the raw systemPrompt shape and ignores ordinary chat", () => {
    expect(
      summarizationPurpose({
        systemPrompt: SUMMARIZATION_SYSTEM,
        messages: [{ role: "user", content: textBlock(`${conversation("hi")}\n\n${COMPACTION_INSTRUCTIONS}`) }],
      }),
    ).toBe("compaction");
    expect(
      summarizationPurpose(
        normalized(ORDINARY_SYSTEM, `${conversation("hi")}\n\n${COMPACTION_INSTRUCTIONS}`),
      ),
    ).toBeNull();
  });

  it("falls back to compaction for replaced branch instructions and malformed input", () => {
    expect(
      summarizationPurpose(
        normalized(SUMMARIZATION_SYSTEM, `${conversation("hi")}\n\nCustom replacement instructions`),
      ),
    ).toBe("compaction");
    expect(summarizationPurpose(undefined)).toBeNull();
    expect(summarizationPurpose(null)).toBeNull();
    expect(summarizationPurpose("not a context")).toBeNull();
    expect(summarizationPurpose({ messages: [] })).toBeNull();
  });
});
