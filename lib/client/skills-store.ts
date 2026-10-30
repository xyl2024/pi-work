"use client";

import { useSyncExternalStore } from "react";
import { isContentEqual } from "./shallowEqual";
import { fetchSkills, installSkill, patchSkillInvocation } from "./skills-io";
import type { Skill, SkillInstallPhase, SkillInstallRequest } from "@/lib/shared/skills";
import {
  backSkillsPage,
  createSkillsPageStack,
  currentSkillsPage,
  isSkillsRootPage,
  openSkillsPage,
  type SkillsPage,
} from "@/lib/shared/skills-pages";

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

export interface SkillsStoreState {
  cwd: string | null;
  loading: boolean;
  loaded: boolean;
  loadError: string | null;
  skills: Skill[];
  pages: SkillsPage[];
  toggleBusy: string[];
  install: SkillsInstallState;
}

const INITIAL: SkillsStoreState = {
  cwd: null,
  loading: false,
  loaded: false,
  loadError: null,
  skills: [],
  pages: createSkillsPageStack(),
  toggleBusy: [],
  install: IDLE_INSTALL,
};

let state: SkillsStoreState = INITIAL;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function patch(partial: Partial<SkillsStoreState>): void {
  let changed = false;
  for (const key of Object.keys(partial) as (keyof SkillsStoreState)[]) {
    if (!isContentEqual(partial[key], state[key])) {
      changed = true;
      break;
    }
  }
  if (!changed) return;
  state = { ...state, ...partial };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): SkillsStoreState {
  return state;
}

function getServerSnapshot(): SkillsStoreState {
  return INITIAL;
}

export function useSkillsStore(): SkillsStoreState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function getSkillInstallPhase(): SkillInstallPhase {
  return state.install.phase;
}

export function useSkillInstallRunning(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => state.install.phase === "running",
    () => false,
  );
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function load(cwd: string): Promise<void> {
  patch({
    cwd,
    loading: true,
    loaded: false,
    loadError: null,
    skills: [],
    pages: createSkillsPageStack(),
    toggleBusy: [],
  });
  try {
    const skills = await fetchSkills(cwd);
    if (state.cwd !== cwd) return;
    patch({ loading: false, loaded: true, skills });
  } catch (e) {
    if (state.cwd !== cwd) return;
    patch({ loading: false, loaded: false, loadError: errorMessage(e) });
  }
}

export function ensureSkillsLoaded(cwd: string | null): void {
  if (cwd === null) {
    if (state.cwd !== null || state.skills.length > 0 || state.loaded || state.loadError !== null) {
      patch({
        cwd: null,
        loading: false,
        loaded: false,
        loadError: null,
        skills: [],
        pages: createSkillsPageStack(),
        toggleBusy: [],
      });
    }
    return;
  }
  if (state.cwd === cwd) return;
  void load(cwd);
}

export function reloadSkills(): void {
  if (state.cwd === null) return;
  void load(state.cwd);
}

export function releaseSkillsState(): void {
  if (state === INITIAL) return;
  installGeneration += 1;
  installAbort?.abort();
  installAbort = null;
  state = INITIAL;
  emit();
}

export async function toggleSkillInvocation(
  filePath: string,
  disableModelInvocation: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const cwd = state.cwd;
  if (cwd === null) return { ok: false };
  if (state.toggleBusy.includes(filePath)) return { ok: false };
  patch({ toggleBusy: [...state.toggleBusy, filePath] });
  try {
    await patchSkillInvocation({ cwd, filePath, disableModelInvocation });
    patch({
      skills: state.skills.map((skill) =>
        skill.filePath === filePath ? { ...skill, disableModelInvocation } : skill,
      ),
      toggleBusy: state.toggleBusy.filter((busy) => busy !== filePath),
    });
    return { ok: true };
  } catch (e) {
    patch({ toggleBusy: state.toggleBusy.filter((busy) => busy !== filePath) });
    return { ok: false, error: errorMessage(e) };
  }
}

let installAbort: AbortController | null = null;
let installGeneration = 0;

export function startSkillInstall(
  request: SkillInstallRequest,
  onSuccess?: () => void,
): void {
  if (state.install.phase === "running") return;
  const generation = ++installGeneration;
  const abort = new AbortController();
  installAbort = abort;
  patch({
    install: { phase: "running", request, logs: [], error: null, installed: state.install.installed },
  });

  void installSkill(
    request,
    {
      onLog: (line) => {
        if (generation !== installGeneration) return;
        patch({ install: { ...state.install, logs: [...state.install.logs, line] } });
      },
    },
    abort.signal,
  )
    .then(() => {
      if (generation !== installGeneration) return;
      installAbort = null;
      const installed = state.install.installed;
      patch({
        install: {
          ...state.install,
          phase: "done",
          error: null,
          installed: installed.includes(request.package)
            ? installed
            : [...installed, request.package],
        },
      });
      if (currentSkillsPage(state.pages).kind !== "detail") {
        patch({ pages: createSkillsPageStack() });
        reloadSkills();
      }
      onSuccess?.();
    })
    .catch((e: unknown) => {
      if (generation !== installGeneration) return;
      installAbort = null;
      patch({ install: { ...state.install, phase: "error", error: errorMessage(e) } });
    });
}

export function cancelSkillInstall(): void {
  if (state.install.phase !== "running") return;
  installGeneration += 1;
  installAbort?.abort();
  installAbort = null;
  patch({ install: { ...IDLE_INSTALL, installed: state.install.installed } });
}

export function openSkillsDetail(filePath: string): void {
  patch({ pages: openSkillsPage({ kind: "detail", filePath }) });
}

export function openSkillsAdd(): void {
  patch({ pages: openSkillsPage({ kind: "add" }) });
}

export function skillsBack(): void {
  patch({ pages: backSkillsPage(state.pages) });
}

export function escapeSkills(): { closePanel: boolean } {
  if (isSkillsRootPage(state.pages)) return { closePanel: true };
  patch({ pages: backSkillsPage(state.pages) });
  return { closePanel: false };
}
