// 技能展开块（skill block）的共享纯函数：与 pi-coding-agent 的
// `parseSkillBlock` / `_expandSkillCommand` 钉住同一正则。命中形状
// （name / location / content / 可选尾随用户附加文字）、非技能文本
// （含未展开的 `/skill:xxx` 原文）返回 null。
import { describe, expect, it } from "vitest";

import { parseSkillBlock } from "@/lib/shared/skill-block";

const block = (name: string, location: string, body: string, tail?: string) =>
  `<skill name="${name}" location="${location}">\nReferences are relative to /base.\n\n${body}\n</skill>` +
  (tail !== undefined ? `\n\n${tail}` : "");

describe("parseSkillBlock", () => {
  it("命中无附加文字的技能块", () => {
    const text = block("tdd", "/skills/tdd/SKILL.md", "Red-green-refactor.");
    expect(parseSkillBlock(text)).toEqual({
      name: "tdd",
      location: "/skills/tdd/SKILL.md",
      content: "References are relative to /base.\n\nRed-green-refactor.",
      userMessage: undefined,
    });
  });

  it("命中带用户附加文字的技能块", () => {
    const text = block("tdd", "/skills/tdd/SKILL.md", "Body.", "请帮我写一个测试");
    expect(parseSkillBlock(text)).toEqual({
      name: "tdd",
      location: "/skills/tdd/SKILL.md",
      content: "References are relative to /base.\n\nBody.",
      userMessage: "请帮我写一个测试",
    });
  });

  it("附加文字保留内部换行", () => {
    const text = block("tdd", "/s/SKILL.md", "Body.", "第一行\n第二行");
    expect(parseSkillBlock(text)?.userMessage).toBe("第一行\n第二行");
  });

  it("普通文本与未展开的 /skill 原文都返回 null", () => {
    expect(parseSkillBlock("你好")).toBeNull();
    expect(parseSkillBlock("/skill:tdd 请帮我写一个测试")).toBeNull();
    expect(parseSkillBlock("")).toBeNull();
  });

  it("块前有额外文本时不算技能块（必须整条占据消息）", () => {
    const text = `前缀\n${block("tdd", "/s/SKILL.md", "Body.")}`;
    expect(parseSkillBlock(text)).toBeNull();
  });
});
