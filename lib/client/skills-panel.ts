"use client";

import {
  createPanelViewStore,
  type PanelViewAdapter,
  type PanelViewStore,
} from "./panel-view-store";
import { fetchSkills, patchSkillInvocation } from "./skills-io";
import { errorMessage } from "@/lib/shared/error-message";
import type { Skill, SkillsPage } from "@/lib/shared/skills";

export interface SkillsViewState {
  cwd: string | null;
  loading: boolean;
  loaded: boolean;
  loadError: string | null;
  skills: Skill[];
  toggleBusy: string[];
  query: string;
  selectedFilePath: string | null;
}

const INITIAL: SkillsViewState = {
  cwd: null,
  loading: false,
  loaded: false,
  loadError: null,
  skills: [],
  toggleBusy: [],
  query: "",
  selectedFilePath: null,
};

const ROOT_PAGE: SkillsPage = { kind: "browse" };

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

export function selectSkill(filePath: string): void {
  skillsPanel.patch({ selectedFilePath: filePath });
}

export function clearSkillSelection(): void {
  skillsPanel.patch({ selectedFilePath: null });
}

export function setSkillsQuery(query: string): void {
  skillsPanel.patch({ query });
}

const skillsAdapter: PanelViewAdapter<SkillsViewState, SkillsPage, string | null, string | null> = {
  kind: "skills",
  initial: INITIAL,
  rootPage: ROOT_PAGE,
  loadPolicy: "once",
  key: (cwd) => cwd,
  release() {},
  async load(cwd, { get, patch, signal, resetPages }) {
    if (cwd === null) {
      resetPages();
      patch({ cwd: null, loading: false, loaded: false, loadError: null, skills: [], toggleBusy: [] });
      return;
    }
    if (get().cwd !== cwd) {
      resetPages();
      patch({ toggleBusy: [], selectedFilePath: null });
    }
    patch({ cwd, loading: true, loaded: false, loadError: null, skills: [] });
    try {
      const skills = await fetchSkills(cwd, signal);
      patch({ loading: false, loaded: true, skills });
    } catch (e) {
      patch({ loading: false, loaded: false, loadError: errorMessage(e) });
    }
  },
};

export const skillsPanel: PanelViewStore<SkillsViewState, SkillsPage, string | null> =
  createPanelViewStore(skillsAdapter);

export function useSkillsPanel() {
  return skillsPanel.useSnapshot();
}
