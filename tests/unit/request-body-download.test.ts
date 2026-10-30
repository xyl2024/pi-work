import { describe, expect, it } from "vitest";
import { parseAttachmentFileName } from "@/lib/client/request-body-download";

describe("parseAttachmentFileName", () => {
  it("reads a quoted filename", () => {
    expect(
      parseAttachmentFileName('attachment; filename="request-body-deepseek-chat-20231114T221320Z.json"'),
    ).toBe("request-body-deepseek-chat-20231114T221320Z.json");
  });

  it("reads an unquoted filename", () => {
    expect(parseAttachmentFileName("attachment; filename=body.json")).toBe("body.json");
  });

  it("prefers the RFC 5987 encoded name when both are present", () => {
    expect(
      parseAttachmentFileName(
        `attachment; filename="fallback.json"; filename*=UTF-8''request%2Dbody%2Dgpt.json`,
      ),
    ).toBe("request-body-gpt.json");
  });

  it("returns null when the header carries no name", () => {
    expect(parseAttachmentFileName(null)).toBeNull();
    expect(parseAttachmentFileName("attachment")).toBeNull();
  });

  it("never lets a server-supplied name escape the download directory", () => {
    expect(parseAttachmentFileName('attachment; filename="../../etc/passwd"')).toBe("passwd");
  });
});
