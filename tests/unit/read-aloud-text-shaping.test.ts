import { describe, expect, it } from "vitest";
import {
  hasReadableReadAloudText,
  readAloudBillingChars,
  readAloudTextFromMessage,
  shapeReadAloudText,
} from "@/lib/shared/read-aloud";
import type { AssistantMessage } from "@/lib/shared/types";

function assistant(content: AssistantMessage["content"]): AssistantMessage {
  return { role: "assistant", content, timestamp: 1, provider: "deepseek", model: "chat" };
}

describe("shapeReadAloudText", () => {
  it("skips fenced code blocks and keeps the surrounding paragraphs", () => {
    const markdown = [
      "Intro paragraph.",
      "",
      "```ts",
      "const answer = 42;",
      "console.log(answer);",
      "```",
      "",
      "Outro paragraph.",
    ].join("\n");

    expect(shapeReadAloudText(markdown)).toBe("Intro paragraph.\n\nOutro paragraph.");
  });

  it("skips tilde fences and fences with extra backticks", () => {
    expect(shapeReadAloudText("先说。\n\n~~~python\nprint(1)\n~~~\n\n后说。")).toBe("先说。\n\n后说。");
    expect(shapeReadAloudText("前\n\n````md\n```\ninner\n```\n````\n\n后")).toBe("前\n\n后");
  });

  it("skips an unterminated fence to the end of the answer", () => {
    expect(shapeReadAloudText("正文。\n\n```js\nconst half = ")).toBe("正文。");
  });

  it("skips inline code", () => {
    expect(shapeReadAloudText("Run `pnpm test` before pushing.")).toBe("Run before pushing.");
    expect(shapeReadAloudText("用 ``a`b`` 表示代码。")).toBe("用 表示代码。");
  });

  it("skips images but keeps the words around them", () => {
    expect(shapeReadAloudText("Look ![a cat](cat.png) at this.")).toBe("Look at this.");
    expect(shapeReadAloudText("[![badge](badge.svg)](https://ci.example.com)")).toBe("");
  });

  it("keeps link text and drops the address", () => {
    expect(shapeReadAloudText("见 [文档](https://example.dev/a?b=1&c=2) 了解详情。")).toBe("见 文档 了解详情。");
    expect(shapeReadAloudText("See [the guide][guide] first.\n\n[guide]: https://example.com/g")).toBe(
      "See the guide first.",
    );
    expect(shapeReadAloudText("Read <https://example.com/x> now.")).toBe("Read now.");
    expect(shapeReadAloudText("Bookmark https://example.com/y 之后再说。")).toBe("Bookmark 之后再说。");
  });

  it("keeps table cell text and drops the structure marks", () => {
    const table = ["| 名称 | 计费 |", "| --- | ---: |", "| 汉字 | 2 |", "| latin | 1 |"].join("\n");

    expect(shapeReadAloudText(table)).toBe("名称 计费\n汉字 2\nlatin 1");
  });

  it("strips heading, quote, list and emphasis markers", () => {
    const markdown = [
      "## 总结",
      "",
      "> 引用一句",
      "",
      "- 第一点",
      "- 第二点",
      "",
      "1. 步骤一",
      "2. 步骤二",
      "",
      "---",
      "",
      "用 **加粗** 与 ~~删除~~ 收尾。",
    ].join("\n");

    expect(shapeReadAloudText(markdown)).toBe(
      "总结\n\n引用一句\n\n第一点\n第二点\n\n步骤一\n步骤二\n\n用 加粗 与 删除 收尾。",
    );
  });

  it("collapses whitespace and drops blank-line runs", () => {
    expect(shapeReadAloudText("  连续   空白\n\n\n\n段落  \n")).toBe("连续 空白\n\n段落");
  });

  it("keeps Chinese punctuation tight around removed inline code", () => {
    expect(shapeReadAloudText("跑 `vitest`。")).toBe("跑。");
  });

  it("mixes Chinese and English without losing either", () => {
    expect(shapeReadAloudText("用 `pnpm` 跑 **单元测试**，再读 [spec](https://x.dev)。")).toBe(
      "用 跑 单元测试，再读 spec。",
    );
  });

  it("yields nothing for code-only, image-only or blank answers", () => {
    expect(shapeReadAloudText("```js\nconst a = 1;\n```")).toBe("");
    expect(shapeReadAloudText("![only](only.png)")).toBe("");
    expect(shapeReadAloudText("   \n\t\n")).toBe("");
  });

  it("is stable when applied twice", () => {
    const once = shapeReadAloudText("## 标题\n\n用 `x` 与 [链接](https://a.dev)。\n\n| a | b |\n| --- | --- |");
    expect(shapeReadAloudText(once)).toBe(once);
  });
});

describe("read-aloud readability and billing", () => {
  it("treats shaped garbage as unreadable", () => {
    expect(hasReadableReadAloudText(shapeReadAloudText("```\ncode\n```"))).toBe(false);
    expect(hasReadableReadAloudText(shapeReadAloudText("![only](only.png)"))).toBe(false);
    expect(hasReadableReadAloudText(shapeReadAloudText("---\n\n> "))).toBe(false);
    expect(hasReadableReadAloudText(shapeReadAloudText("正式回答。"))).toBe(true);
  });

  it("counts billing characters on the shaped text only", () => {
    const markdown = "汉字。\n\n```js\nconst ignored = 'long code'; \n```";

    expect(readAloudBillingChars(shapeReadAloudText(markdown))).toBe(5);
  });

  it("shapes every final answer block and drops code-only ones", () => {
    const message = assistant([
      { type: "thinking", thinking: "internal plan" },
      { type: "text", text: "## 结论\n\n直接 `pnpm test`。" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" } },
      { type: "text", text: "```bash\nnpm run build\n```" },
      { type: "text", text: "先用 [这份文档](https://example.dev) 再看。" },
    ]);

    expect(readAloudTextFromMessage(message)).toBe("结论\n\n直接。\n\n先用 这份文档 再看。");
  });

  it("returns empty text for a code-only answer", () => {
    const message = assistant([{ type: "text", text: "```ts\nconst only = 'code';\n```" }]);

    expect(readAloudTextFromMessage(message)).toBe("");
    expect(hasReadableReadAloudText(readAloudTextFromMessage(message))).toBe(false);
  });
});
