// Slash-command prompt templates (PromptsConfig modal).
// "Select a prompt" / "No prompts found" already live in models.ts
// because they're co-located with the SkillsConfig panel chrome.

export const prompts = {
  "New Prompt Template": "新建提示词模板",
  "Edit Prompt Template": "编辑提示词模板",
  "Delete prompt template": "删除提示词模板",
  "Delete prompt template?": "删除提示词模板？",
  "This will delete the prompt template file: {path}": "这将删除提示词模板文件：{path}",
} as const;
