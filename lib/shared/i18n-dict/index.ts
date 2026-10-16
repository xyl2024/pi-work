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
import { auth } from "./auth";
import { EN_TRANSLATIONS } from "./en";
import { chat } from "./chat";
import { channels } from "./channels";
import { commands } from "./commands";
import { common } from "./common";
import { fileViewer } from "./file-viewer";
import { grokbot } from "./grokbot";
import { mcp } from "./mcp";
import { models } from "./models";
import { permissions } from "./permissions";
import { profile } from "./profile";
import { prompts } from "./prompts";
import { renderers } from "./renderers";
import { rightPanels } from "./right-panels";
import { scheduler } from "./scheduler";
import { sessions } from "./sessions";
import { settings } from "./settings";
import { starterPrompts } from "./starter-prompts";
import { terminal } from "./terminal";
import { toast } from "./toast";
import { wechat } from "./wechat";
import { usefulTips } from "./useful-tips";

export type Locale = "en" | "zh";

export { EN_TRANSLATIONS };

export const ZH_TRANSLATIONS = {
  ...auth,
  ...common,
  ...chat,
  ...channels,
  ...commands,
  ...fileViewer,
  ...grokbot,
  ...mcp,
  ...models,
  ...permissions,
  ...profile,
  ...prompts,
  ...renderers,
  ...rightPanels,
  ...scheduler,
  ...sessions,
  ...settings,
  ...starterPrompts,
  ...terminal,
  ...toast,
  ...wechat,
  ...usefulTips,
  ...askUserQuestions,
} as const;
