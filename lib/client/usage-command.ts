import type { SlashResource } from "@/lib/shared/slash-commands";

export const USAGE_COMMAND_PROMPT = "/skill:usage-check 帮我查询当前订阅模型服务的使用量。";
export const USAGE_SKILL_COMMAND = "skill:usage-check";

export const USAGE_COMMAND_ERRORS = {
  defaultCwd: "获取默认工作目录失败",
  skillUnavailable: "未安装或未启用 usage-check 技能",
} as const;

export interface UsageCommandTab {
  tabId: string;
  kind: "session" | "draft";
  dirty: boolean;
}

export interface UsageCommandPort {
  requestDefaultCwd(): Promise<string>;
  querySlashResources(cwd: string): Promise<readonly SlashResource[]>;
  readSessionTabs(): readonly UsageCommandTab[];
  ensureDraft(cwd: string): string;
  activate(tabId: string): void;
  setDraftCwd(tabId: string, cwd: string): void;
  scheduleAutoSend(tabId: string, prompt: string): void;
  showErrorToast(message: string): void;
}

export interface UsageCommandController {
  run(): Promise<void>;
  takePendingSend(tabId: string): string | null;
  restorePendingSend(tabId: string, prompt: string): void;
}

export function createUsageCommandController(port: UsageCommandPort): UsageCommandController {
  const pendingByTab = new Map<string, string>();
  const claimedTabIds = new Set<string>();
  let preparing = false;

  const findReusableDraft = (): UsageCommandTab | undefined =>
    port.readSessionTabs().find(
      (tab) => tab.kind === "draft" && !tab.dirty && !claimedTabIds.has(tab.tabId),
    );

  const takePendingSend = (tabId: string): string | null => {
    const prompt = pendingByTab.get(tabId);
    if (prompt === undefined) return null;
    pendingByTab.delete(tabId);
    return prompt;
  };

  const restorePendingSend = (tabId: string, prompt: string): void => {
    claimedTabIds.add(tabId);
    pendingByTab.set(tabId, prompt);
  };

  const run = async (): Promise<void> => {
    if (preparing) return;
    preparing = true;
    try {
      let cwd: string;
      try {
        cwd = await port.requestDefaultCwd();
      } catch {
        port.showErrorToast(USAGE_COMMAND_ERRORS.defaultCwd);
        return;
      }

      let resources: readonly SlashResource[];
      try {
        resources = await port.querySlashResources(cwd);
      } catch {
        port.showErrorToast(USAGE_COMMAND_ERRORS.skillUnavailable);
        return;
      }
      if (!resources.some((resource) => resource.command === USAGE_SKILL_COMMAND)) {
        port.showErrorToast(USAGE_COMMAND_ERRORS.skillUnavailable);
        return;
      }

      const reusable = findReusableDraft();
      const tabId = reusable ? reusable.tabId : port.ensureDraft(cwd);
      if (reusable) port.setDraftCwd(tabId, cwd);
      claimedTabIds.add(tabId);
      port.activate(tabId);
      pendingByTab.set(tabId, USAGE_COMMAND_PROMPT);
      port.scheduleAutoSend(tabId, USAGE_COMMAND_PROMPT);
    } finally {
      preparing = false;
    }
  };

  return { run, takePendingSend, restorePendingSend };
}
