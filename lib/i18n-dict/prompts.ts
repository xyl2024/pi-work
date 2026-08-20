// Slash-command prompt templates (PromptsConfig modal).
// "Select a prompt" / "No prompts found" already live in models.ts
// because they're co-located with the SkillsConfig panel chrome.

export const prompts = {
  "New Prompt": "新建提示词",
  "Edit Prompt": "编辑提示词",
  "Delete prompt": "删除提示词",
  "Delete prompt?": "删除提示词？",
  "This will delete the prompt file: {path}": "这将删除提示词文件：{path}",
} as const;
