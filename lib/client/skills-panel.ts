"use client";

import {
  createPanelViewStore,
  type PanelViewAdapter,
  type PanelViewCloseGuard,
  type PanelViewStore,
} from "./panel-view-store";
import { fetchSkills, installSkill, patchSkillInvocation } from "./skills-io";
import { errorMessage } from "@/lib/shared/error-message";
import { selectSkillsCloseConfirm } from "@/lib/shared/skills-close";
import type {
  Skill,
  SkillInstallPhase,
  SkillInstallRequest,
  SkillsPage,
} from "@/lib/shared/skills";

export interface SkillsInstallState {
  phase: SkillInstallPhase;
  request: SkillInstallRequest | null;
  logs: string[];
  error: string | null;
  installed: string[];
}

const IDLE_INSTALL: SkillsInstallState = {
  phase: "idle",
  request: null,
  logs: [],
  error: null,
  installed: [],
};

export interface SkillsViewState {
  cwd: string | null;
  loading: boolean;
  loaded: boolean;
  loadError: string | null;
  skills: Skill[];
  toggleBusy: string[];
  install: SkillsInstallState;
}

const INITIAL: SkillsViewState = {
  cwd: null,
  loading: false,
  loaded: false,
  loadError: null,
  skills: [],
  toggleBusy: [],
  install: IDLE_INSTALL,
};

const ROOT_PAGE: SkillsPage = { kind: "root" };

let installAbort: AbortController | null = null;
let installGeneration = 0;

function cancelSkillInstall(): void {
  const scope = skillsPanel.scope();
  if (scope.get().install.phase !== "running") return;
  installGeneration += 1;
  installAbort?.abort();
  installAbort = null;
  scope.patch({ install: { ...IDLE_INSTALL, installed: scope.get().install.installed } });
}

export function startSkillInstall(
  request: SkillInstallRequest,
  onSuccess?: () => void,
): void {
  if (skillsPanel.get().install.phase === "running") return;
  const generation = ++installGeneration;
  const abort = new AbortController();
  installAbort = abort;
  const scope = skillsPanel.scope();
  scope.patch({
    install: {
      phase: "running",
      request,
      logs: [],
      error: null,
      installed: scope.get().install.installed,
    },
  });

  void installSkill(
    request,
    {
      onLog: (line) => {
        if (generation !== installGeneration) return;
        scope.patch({ install: { ...scope.get().install, logs: [...scope.get().install.logs, line] } });
      },
    },
    abort.signal,
  )
    .then(() => {
      if (generation !== installGeneration) return;
      installAbort = null;
      const installed = scope.get().install.installed;
      scope.patch({
        install: {
          ...scope.get().install,
          phase: "done",
          error: null,
          installed: installed.includes(request.package)
            ? installed
            : [...installed, request.package],
        },
      });
      if (skillsPanel.currentPage().kind !== "detail") {
        skillsPanel.resetPages();
        reloadSkills();
      }
      onSuccess?.();
    })
    .catch((e: unknown) => {
      if (generation !== installGeneration) return;
      installAbort = null;
      scope.patch({ install: { ...scope.get().install, phase: "error", error: errorMessage(e) } });
    });
}

export function reloadSkills(): void {
  skillsPanel.reload();
}

export async function toggleSkillInvocation(
  filePath: string,
  disableModelInvocation: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const scope = skillsPanel.scope();
  const cwd = scope.get().cwd;
  if (cwd === null) return { ok: false };
  if (scope.get().toggleBusy.includes(filePath)) return { ok: false };
  scope.patch({ toggleBusy: [...scope.get().toggleBusy, filePath] });
  try {
    await patchSkillInvocation({ cwd, filePath, disableModelInvocation });
    scope.patch({
      skills: scope.get().skills.map((skill) =>
        skill.filePath === filePath ? { ...skill, disableModelInvocation } : skill,
      ),
      toggleBusy: scope.get().toggleBusy.filter((busy) => busy !== filePath),
    });
    return { ok: true };
  } catch (e) {
    scope.patch({ toggleBusy: scope.get().toggleBusy.filter((busy) => busy !== filePath) });
    return { ok: false, error: errorMessage(e) };
  }
}

export function openSkillsDetail(filePath: string): void {
  skillsPanel.openPage({ kind: "detail", filePath });
}

export function openSkillsAdd(): void {
  skillsPanel.openPage({ kind: "add" });
}

const skillsAdapter: PanelViewAdapter<SkillsViewState, SkillsPage, string | null, string | null> = {
  kind: "skills",
  initial: INITIAL,
  rootPage: ROOT_PAGE,
  loadPolicy: "once",
  key: (cwd) => cwd,
  async load(cwd, { get, patch, signal, resetPages }) {
    if (cwd === null) {
      resetPages();
      patch({ cwd: null, loading: false, loaded: false, loadError: null, skills: [], toggleBusy: [] });
      return;
    }
    if (get().cwd !== cwd) {
      resetPages();
      patch({ toggleBusy: [] });
    }
    patch({ cwd, loading: true, loaded: false, loadError: null, skills: [] });
    try {
      const skills = await fetchSkills(cwd, signal);
      patch({ loading: false, loaded: true, skills });
    } catch (e) {
      patch({ loading: false, loaded: false, loadError: errorMessage(e) });
    }
  },
  release() {
    installGeneration += 1;
    installAbort?.abort();
    installAbort = null;
  },
  guard(state): PanelViewCloseGuard | null {
    const confirm = selectSkillsCloseConfirm({ installPhase: state.install.phase });
    if (!confirm) return null;
    return { ...confirm, discard: cancelSkillInstall };
  },
  status(state) {
    return state.install.phase === "running";
  },
  isSiblingPage(next, current) {
    return next.kind !== "root" && current.kind !== "root";
  },
};

export const skillsPanel: PanelViewStore<SkillsViewState, SkillsPage, string | null> =
  createPanelViewStore(skillsAdapter);

export function useSkillsPanel() {
  return skillsPanel.useSnapshot();
}
