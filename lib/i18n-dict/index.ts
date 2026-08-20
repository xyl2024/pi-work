// Server-safe i18n dictionary + helpers.
//
// Extracted from hooks/useI18n.tsx so route handlers (e.g.
// /api/sessions/[id]/export) can render translated labels without
// pulling in React or crossing the "use client" boundary. Both the
// client (`useI18n`) and the server (`tServer`) read from this single
// source of truth.
//
// The dictionary is split by domain (chat / sessions / settings / ...)
// so each editor can read ~50–200 lines instead of the full 1400+ at
// once. The `index.ts` re-merges every sub-dictionary into the single
// `ZH_TRANSLATIONS` object the rest of the app already imports — all
// existing `import { ZH_TRANSLATIONS } from "@/lib/i18n-dict"` lines
// keep working unchanged.

import { askUserQuestions } from "./ask-user-questions";
import { chat } from "./chat";
import { commands } from "./commands";
import { common } from "./common";
import { fileViewer } from "./file-viewer";
import { grokbot } from "./grokbot";
import { inbox } from "./inbox";
import { mcp } from "./mcp";
import { media } from "./media";
import { models } from "./models";
import { permissions } from "./permissions";
import { profile } from "./profile";
import { prompts } from "./prompts";
import { renderers } from "./renderers";
import { rightPanels } from "./right-panels";
import { rss } from "./rss";
import { scheduler } from "./scheduler";
import { sessions } from "./sessions";
import { settings } from "./settings";
import { starterPrompts } from "./starter-prompts";
import { terminal } from "./terminal";
import { todos } from "./todos";
import { wechat } from "./wechat";

export type Locale = "en" | "zh";

export const ZH_TRANSLATIONS = {
  ...common,
  ...chat,
  ...commands,
  ...fileViewer,
  ...grokbot,
  ...inbox,
  ...mcp,
  ...media,
  ...models,
  ...permissions,
  ...profile,
  ...prompts,
  ...renderers,
  ...rightPanels,
  ...rss,
  ...scheduler,
  ...sessions,
  ...settings,
  ...starterPrompts,
  ...terminal,
  ...todos,
  ...wechat,
  ...askUserQuestions,
} as const;

export function tServer(key: string, locale: Locale): string {
  if (locale === "zh") {
    return ZH_TRANSLATIONS[key as keyof typeof ZH_TRANSLATIONS] ?? key;
  }
  return key;
}
