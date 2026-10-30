import { describe, expect, it } from "vitest";

import { parseSkillBlock, parseSkillCommand } from "@/lib/shared/skill-block";

const block = (name: string, location: string, body: string, tail?: string) =>
  `<skill name="${name}" location="${location}">\nReferences are relative to /base.\n\n${body}\n</skill>` +
  (tail !== undefined ? `\n\n${tail}` : "");

describe("parseSkillCommand", () => {
  it("recognizes a skill immediately, preserving multiline user arguments", () => {
    expect(parseSkillCommand("/skill:tdd")).toEqual({ name: "tdd", userMessage: undefined });
    expect(parseSkillCommand("/skill:tdd fix this\nwith tests ")).toEqual({
      name: "tdd",
      userMessage: "fix this\nwith tests",
    });
  });

  it.each(["", "ordinary text", "/skill:", "/skills:tdd", "use /skill:tdd", "/other tdd", " /skill:tdd", "/skill:tdd\narguments", "/skill:tdd\targuments"])(
    "does not treat %s as a skill invocation",
    (text) => expect(parseSkillCommand(text)).toBeNull(),
  );
});

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
