"use client";

/**
 * Module-scoped holder for the skills *panel view*.
 *
 * The panel card only renders the active tab's body, so switching panel tabs
 * unmounts the view. Two things the user would notice losing therefore have to
 * live outside that mount: the page-stack position and the list already read
 * for the selected session's working directory. Keeping the list here is also
 * what stops a tab switch from flashing a loading state that was already paid
 * for; closing the tab (`releaseSkillsState`) is the only thing that drops it,
 * so reopening the tab reads disk again instead of resurrecting a stale list.
 *
 * The rules stay pure and live in `lib/shared/skills-pages.ts` (page stack) and
 * `lib/shared/skills.ts` (grouping). This file is only the wiring — requests,
 * the `useSyncExternalStore` subscription, the "first open per cwd loads,
 * later mounts reuse" policy.
 *
 * Enable / disable is deliberately *not* a draft: the toggle writes through
 * immediately (no save bar, no unsaved-changes marker), unlike the models
 * config store next door.
 */

import { useSyncExternalStore } from "react";
import { isContentEqual } from "./shallowEqual";
import { fetchSkills, patchSkillInvocation } from "./skills-io";
import type { Skill } from "@/lib/shared/skills";
import {
  backSkillsPage,
  createSkillsPageStack,
  isSkillsRootPage,
  openSkillsPage,
  type SkillsPage,
} from "@/lib/shared/skills-pages";

export interface SkillsStoreState {
  /** The working directory the cached list belongs to; null when unknown. */
  cwd: string | null;
  /** A read is in flight. */
  loading: boolean;
  /** The cached list is real (a read for the current cwd has finished). */
  loaded: boolean;
  /** The last read failed; the grid shows this with a retry affordance. */
  loadError: string | null;
  skills: Skill[];
  pages: SkillsPage[];
  /** filePaths whose toggle write is still in flight. */
  toggleBusy: string[];
}

const INITIAL: SkillsStoreState = {
  cwd: null,
  loading: false,
  loaded: false,
  loadError: null,
  skills: [],
  pages: createSkillsPageStack(),
  toggleBusy: [],
};

let state: SkillsStoreState = INITIAL;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Content-equality guarded write — a no-op patch never re-renders. */
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

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ── Loading ─────────────────────────────────────────────────────────────

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
    // A newer cwd superseded this read; drop the late answer.
    if (state.cwd !== cwd) return;
    patch({ loading: false, loaded: true, skills });
  } catch (e) {
    if (state.cwd !== cwd) return;
    patch({ loading: false, loaded: false, loadError: errorMessage(e) });
  }
}

/**
 * Make sure the list for `cwd` is the one in the store.
 *
 * Reuse covers loaded, in-flight and failed reads: the panel can unmount and
 * remount on a tab switch without flashing a loading state or auto-retrying an
 * error the user has not acknowledged. A different cwd — the selected session
 * changed — reloads and draws the stack back to the grid, because the old
 * skill list (and anything open on top of it) belonged to the old directory.
 */
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

/** Force a fresh read of the current cwd — the grid's retry affordance. */
export function reloadSkills(): void {
  if (state.cwd === null) return;
  void load(state.cwd);
}

/**
 * Drop the cache and the page stack. Called by the shell when the skills tab
 * closes: the tab is the lifetime of the cache, so the next open reads disk
 * again (the collapse / tab-switch case never lands here).
 */
export function releaseSkillsState(): void {
  if (state === INITIAL) return;
  state = INITIAL;
  emit();
}

// ── Enabling / disabling (write-through, no draft) ──────────────────────

/**
 * Flip one skill's invocation flag and write it straight to disk. Resolves
 * `{ ok: false, error }` on failure (e.g. the frontmatter lock) so the caller
 * can surface it; the cached list only changes once the write succeeds.
 */
export async function toggleSkillInvocation(
  filePath: string,
  disableModelInvocation: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const cwd = state.cwd;
  // Unreachable through the grid (there are no cards without a cwd), so this
  // returns no user-facing copy — the callers only toast real errors, which
  // always carry the server's message.
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

// ── Navigation ──────────────────────────────────────────────────────────

/** Open one skill's detail page (replacing any sibling detail page). */
export function openSkillsDetail(filePath: string): void {
  patch({ pages: openSkillsPage({ kind: "detail", filePath }) });
}

/** Open the add page above the grid. */
export function openSkillsAdd(): void {
  patch({ pages: openSkillsPage({ kind: "add" }) });
}

/** Pop one level; the grid is the floor. */
export function skillsBack(): void {
  patch({ pages: backSkillsPage(state.pages) });
}

/**
 * Run Escape against the page stack: pop one level, or — when the grid is
 * already on top — report that the panel tab is free to run its close rules.
 */
export function escapeSkills(): { closePanel: boolean } {
  if (isSkillsRootPage(state.pages)) return { closePanel: true };
  patch({ pages: backSkillsPage(state.pages) });
  return { closePanel: false };
}
