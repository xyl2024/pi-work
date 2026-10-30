import { describe, expect, it } from "vitest";
import {
  formatRequestBody,
  requestBodyFileName,
  selectRequestAttempt,
  type RequestAttempt,
} from "@/lib/shared/llm-audit-message-body";

function attempt(overrides: Partial<RequestAttempt> = {}): RequestAttempt {
  return {
    id: 1,
    ts: 1_700_000_000_000,
    attempt: 1,
    status: 200,
    modelId: "deepseek-chat",
    requestBody: `{"model":"deepseek-chat"}`,
    ...overrides,
  };
}

describe("selectRequestAttempt", () => {
  it("prefers the attempt that succeeded when an earlier retry failed", () => {
    const failed = attempt({ id: 1, attempt: 1, status: 429, requestBody: `{"retry":1}` });
    const succeeded = attempt({ id: 2, attempt: 2, status: 200, requestBody: `{"retry":2}` });

    expect(selectRequestAttempt([failed, succeeded])).toBe(succeeded);
  });

  it("falls back to the last attempt when every attempt failed", () => {
    const first = attempt({ id: 1, attempt: 1, status: 500, requestBody: `{"retry":1}` });
    const last = attempt({ id: 2, attempt: 2, status: 500, requestBody: `{"retry":2}` });

    expect(selectRequestAttempt([first, last])).toBe(last);
  });

  it("skips attempts whose body was not captured", () => {
    const captured = attempt({ id: 1, status: 200, requestBody: `{"a":1}` });
    const bodyless = attempt({ id: 2, status: 200, requestBody: null });

    expect(selectRequestAttempt([captured, bodyless])).toBe(captured);
  });

  it("returns null when nothing was captured for the message", () => {
    expect(selectRequestAttempt([])).toBeNull();
    expect(selectRequestAttempt([attempt({ requestBody: null })])).toBeNull();
  });
});

describe("formatRequestBody", () => {
  it("re-indents captured JSON so the downloaded file is readable", () => {
    expect(formatRequestBody(`{"model":"deepseek-chat","messages":[{"role":"user"}]}`)).toBe(
      [
        "{",
        `  "model": "deepseek-chat",`,
        `  "messages": [`,
        "    {",
        `      "role": "user"`,
        "    }",
        "  ]",
        "}",
      ].join("\n"),
    );
  });

  it("keeps a body that is not JSON as captured", () => {
    expect(formatRequestBody("not json")).toBe("not json");
  });

  it("returns an empty string when there is no body", () => {
    expect(formatRequestBody(null)).toBe("");
  });
});

describe("requestBodyFileName", () => {
  it("names the file after the model and the capture time", () => {
    expect(
      requestBodyFileName(attempt({ modelId: "deepseek-chat", ts: Date.UTC(2024, 0, 2, 3, 4, 5) })),
    ).toBe("request-body-deepseek-chat-20240102T030405Z.json");
  });

  it("strips characters a filesystem would reject", () => {
    expect(requestBodyFileName(attempt({ modelId: "openai/gpt:4o mini" }))).toBe(
      "request-body-openai-gpt-4o-mini-20231114T221320Z.json",
    );
  });

  it("falls back to a neutral segment when the model is unknown", () => {
    expect(requestBodyFileName(attempt({ modelId: null }))).toBe(
      "request-body-unknown-20231114T221320Z.json",
    );
  });
});
