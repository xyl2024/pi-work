"use client";

/**
 * Module-scoped holder for the skills *panel view*.
 *
 * The panel card only renders the active tab's body, so switching panel tabs
 * unmounts the view. Three things the user would notice losing therefore have
 * to live outside that mount: the page-stack position, the list already read
 * for the selected session's working directory, and the install in flight.
 * Keeping the list here is also what stops a tab switch from flashing a
 * loading state that was already paid for; keeping the install here is what
 * lets its log keep growing while the panel is collapsed, and what feeds the
 * right-bar "installing" badge (the shell reads the same phase). Closing the
 * tab (`releaseSkillsState`) is the only thing that drops any of it, so
 * reopening the tab reads disk again instead of resurrecting a stale list.
 *
 * The rules stay pure and live in `lib/shared/skills-pages.ts` (page stack),
 * `lib/shared/skills.ts` (grouping) and `lib/shared/skills-close.ts` (the
 * install phase the close guard reads). This file is only the wiring —
 * requests, the `useSyncExternalStore` subscription, the "first open per cwd
 * loads, later mounts reuse" policy, and the install stream.
 *
 * Enable / disable is deliberately *not* a draft: the toggle writes through
 * immediately (no save bar, no unsaved-changes marker), unlike the models
 * config store next door.
 */

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

/**
 * The install slot: the attempt in flight, or the last one's outcome. It is
 * one slot rather than a queue because the add page only ever runs one install
 * at a time — a second package waits for the first to settle.
 */
export interface SkillsInstallState {
  /** idle → running → done | error. Only `running` makes a close lossy — see
   *  `selectSkillsCloseConfirm` in lib/shared/skills-close.ts. */
  phase: SkillInstallPhase;
  /** The request being run; Retry re-runs it verbatim, same scope and cwd. */
  request: SkillInstallRequest | null;
  /** CLI output lines in arrival order. */
  logs: string[];
  /** The server's message while `phase === "error"`. */
  error: string | null;
  /** Packages installed while this tab has been open; a search hit for one of
   *  them reads "Installed" instead of offering another install. */
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

/**
 * The install phase, for the close guard at confirm time (non-reactive — the
 * shell's tab × asks once, it does not render from it).
 */
export function getSkillInstallPhase(): SkillInstallPhase {
  return state.install.phase;
}

/**
 * Whether an install is streaming. Subscribed to by the shell, not by the
 * panel, so the right-bar badge stays lit while the panel is collapsed; a
 * boolean snapshot keeps the shell from re-rendering on every log line.
 */
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
  // An install started from this tab may still be streaming. Invalidate it and
  // stop reading, so the late callbacks cannot repopulate the state we are
  // dropping (the server's npx still finishes on its own).
  installGeneration += 1;
  installAbort?.abort();
  installAbort = null;
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

// ── Installing (module-owned, so it outlives the panel mount) ────────────

/** The abort handle for the stream in flight; null when nothing is running. */
let installAbort: AbortController | null = null;
/**
 * Bumped when the tab closes (or an install is cancelled). Each run captures
 * its own generation and drops every late callback that no longer matches, so
 * a stream outliving the tab cannot write into the state that replaced it.
 */
let installGeneration = 0;

/**
 * Run one install, streaming its log into the store.
 *
 * The stream lives here rather than in the add page because the page unmounts
 * on every tab switch: keeping the phase and the log in the store is what lets
 * an install keep running with the panel collapsed (the badge shows it) and
 * what makes the log still be there on the way back. On success the store also
 * draws the panel back to the grid and re-reads the list, so the new skill is
 * already in place wherever the user went meanwhile — unless they moved on to
 * a skill's detail page, which is a deliberate move and is left alone rather
 * than yanked away.
 *
 * `onSuccess` is the one hook back into React (the add page's success toast);
 * failures are already on screen through the install slot. The toast provider
 * outlives the page, so a completion that lands after the page unmounted still
 * notifies.
 */
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
      // The convergence rule for a successful install: the add page goes back
      // to the grid. The list is re-read too when there is a cwd to read (with
      // none there is no list to refresh, but the panel still has to leave the
      // add page). A detail page the user moved on to is deliberate, so it is
      // left alone rather than yanked back to the grid.
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

/**
 * Drop the install in flight. Called when the user confirms closing the tab:
 * the client stops reading the stream and the log goes with the tab. The
 * server's `npx` keeps running — the install route never watches the client
 * connection — so the confirmation copy promises the log, not the install.
 */
export function cancelSkillInstall(): void {
  if (state.install.phase !== "running") return;
  installGeneration += 1;
  installAbort?.abort();
  installAbort = null;
  patch({ install: { ...IDLE_INSTALL, installed: state.install.installed } });
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
