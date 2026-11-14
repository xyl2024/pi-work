"use client";

import type { SlashResource } from "@/lib/shared/slash-commands";

export const SLASH_PAGE_SIZE = 5;

export const BUILTIN_NEW_SESSION: SlashResource = {
  source: "action",
  name: "New session",
  command: "new",
  description: "新建会话",
  path: "",
};

export const BUILTIN_COMPACT: SlashResource = {
  source: "action",
  name: "Compact",
  command: "compact",
  description: "压缩当前会话上下文",
  path: "",
};

export const BUILTIN_MODEL: SlashResource = {
  source: "action",
  name: "Model",
  command: "model",
  description: "切换模型 / Switch model",
  path: "",
};

export const BUILTIN_USAGE: SlashResource = {
  source: "action",
  name: "Usage",
  command: "usage",
  description: "查询订阅模型服务用量",
  path: "",
};

export const BUILTIN_SLASH_ACTIONS: SlashResource[] = [BUILTIN_NEW_SESSION, BUILTIN_COMPACT, BUILTIN_MODEL, BUILTIN_USAGE];
