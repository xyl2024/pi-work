import { askUserQuestions } from "./ask-user-questions";
import { auth } from "./auth";
import { EN_TRANSLATIONS } from "./en";
import { chat } from "./chat";
import { channels } from "./channels";
import { commands } from "./commands";
import { common } from "./common";
import { fileViewer } from "./file-viewer";
import { grokbot } from "./grokbot";
import { models } from "./models";
import { permissions } from "./permissions";
import { profile } from "./profile";
import { renderers } from "./renderers";
import { rightPanels } from "./right-panels";
import { scheduler } from "./scheduler";
import { sessions } from "./sessions";
import { settings } from "./settings";
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
  ...models,
  ...permissions,
  ...profile,
  ...renderers,
  ...rightPanels,
  ...scheduler,
  ...sessions,
  ...settings,
  ...terminal,
  ...toast,
  ...wechat,
  ...usefulTips,
  ...askUserQuestions,
} as const;
