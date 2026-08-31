import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { load, dump } from "js-yaml";
import { createLogger } from "./logger";
import { dataPath } from "./data-dir";
import {
  UI_SOUND_EVENT_IDS,
  type AppendSystemConfig,
  type DangerousPatternRule,
  type DangerousPatternsConfig,
  type PiWorkConfig,
  type UiSoundEventId,
  type UiSoundsConfig,
} from "../shared/config-types";
import { DEFAULT_UI_SOUND_EVENTS } from "../shared/ui-sounds-defaults";
import {
  FILE_VIEWER_LIMITS,
  FILE_VIEWER_KINDS,
  FILE_VIEWER_DEFAULT_MAX_SIZE_MB,
  type FileViewerConfig,
  type FileViewerMaxSizeMb,
} from "../shared/file-viewer-limits";

const log = createLogger("config");

import type { RightBarButtonId, RightSideBarConfig } from "../shared/right-bar";
import { resolveSessionBoundAlignment } from "../shared/right-bar";

// ── Custom tools enabled by `customTools` on createAgentSession ───────────
// Names match the tool names registered in lib/rpc-manager.ts. The two
// built-in user-side todo tools (`user_todos_list`, `user_todo_description`)
// live in lib/todo-tools-config.ts and are NOT listed here — they are gated
// by ~/.pi-work/todo-tools.json for historical reasons. Adding a new tool
// to `customTools` in rpc-manager.ts requires adding it here too, or the
// validator will silently drop it (fail-open default still applies, but
// the user setting is lost).

// ── APPEND_SYSTEM.md loader toggle ───────────────────────────────────────
// pi's DefaultResourceLoader auto-loads ~/.pi/agent/APPEND_SYSTEM.md on
// every session. Disabling here passes `appendSystemPrompt: []` to the
// loader, which short-circuits `discoverAppendSystemPromptFile()` — the
// file is left untouched on disk so re-enabling just flips the flag.
const DEFAULT_DANGEROUS_PATTERNS: DangerousPatternsConfig = {
  rules: [],
  timeout_ms: 300_000,
};

const DEFAULT_RIGHT_SIDE_BAR: RightSideBarConfig = {
  todos: true,
  canvas: true,
  translate: true,
  json: true,
  rss: true,
  favorites: true,
  tokens: true,
  toolCalls: true,
  gitDiff: true,
  conversationTree: true,
  context: true,
  // Session-bound group (context / toolCalls / conversationTree / gitDiff /
  // llmAudit) pins to the bottom by default — they're meaningful only when
  // a session is active and become empty on the new-session page.
  session_bound_alignment: "bottom",
};

const DEFAULT_CONFIG: PiWorkConfig = {
  dangerous_patterns: DEFAULT_DANGEROUS_PATTERNS,
  right_side_bar: { ...DEFAULT_RIGHT_SIDE_BAR },
  // Preserve pre-existing behavior: append file loads by default.
  append_system: { enabled: true },
  // Preserves pre-feature behavior: same hardcoded limits the route used
  // before the value became user-configurable.
  file_viewer: {
    max_size_mb: { ...FILE_VIEWER_DEFAULT_MAX_SIZE_MB },
  },
  ui_sounds: {
    enabled: true,
    masterVolume: 0.45,
    events: { ...DEFAULT_UI_SOUND_EVENTS },
  },
  cwd_icons: {},
  disabled_skills: {},
};

function parseDangerousPatterns(raw: unknown): DangerousPatternsConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_DANGEROUS_PATTERNS };
  const obj = raw as Record<string, unknown>;
  const rulesRaw = Array.isArray(obj.rules) ? obj.rules : [];
  const rules: DangerousPatternRule[] = [];
  for (const r of rulesRaw) {
    if (!r || typeof r !== "object") continue;
    const rule = r as Record<string, unknown>;
    if (typeof rule.name === "string" && typeof rule.pattern === "string") {
      rules.push({ name: rule.name, pattern: rule.pattern });
    }
  }
  const timeoutRaw = obj.timeout_ms;
  const timeout_ms = typeof timeoutRaw === "number" && Number.isFinite(timeoutRaw) && timeoutRaw > 0
    ? timeoutRaw
    : DEFAULT_DANGEROUS_PATTERNS.timeout_ms;
  return { rules, timeout_ms };
}

function parseRightSideBar(raw: unknown): RightSideBarConfig {
  const out: RightSideBarConfig = { ...DEFAULT_RIGHT_SIDE_BAR };
  if (!raw || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(out)) {
    if (key === "order" || key === "session_bound_alignment") continue;
    const v = obj[key];
    if (typeof v === "boolean") out[key] = v;
    // missing or non-boolean → keep default (true)
  }
  // `order` is parsed at the consumer side (lib/config doesn't import
  // RIGHT_BAR_BUTTON_IDS — the descriptor module owns the canonical id
  // set, and any stale/unknown entries are filtered there). Here we
  // just hand the raw array through when it's structurally valid.
  if (Array.isArray(obj.order)) {
    const arr: RightBarButtonId[] = [];
    for (const item of obj.order) {
      if (typeof item === "string") arr.push(item as RightBarButtonId);
    }
    if (arr.length > 0) out.order = arr;
  }
  // `session_bound_alignment` — tolerant enum. Anything other than the
  // three documented values falls back to "bottom" (the on-disk default).
  if (typeof obj.session_bound_alignment === "string") {
    out.session_bound_alignment = resolveSessionBoundAlignment(obj.session_bound_alignment);
  }
  return out;
}

// Fail-open for the missing/garbled case (keep the on-by-default behavior
// so an old config.yaml doesn't silently turn the append off). An explicit
// `enabled: false` is honored — the user pushed the button, we trust them.
function parseAppendSystem(raw: unknown): AppendSystemConfig {
  if (!raw || typeof raw !== "object") return { enabled: true };
  const obj = raw as Record<string, unknown>;
  return { enabled: obj.enabled !== false };
}

// File preview size limits — fail-open like every other parser here:
// missing/garbled field → defaults; out-of-range numbers → clamped with a
// log.warn. Strict validation lives in the PUT route so the SettingsModal
// never lets an invalid value through, but a hand-edited YAML can never
// break the file route.
function parseFileViewerMaxSizeMb(raw: unknown): FileViewerMaxSizeMb {
  const out: FileViewerMaxSizeMb = { ...FILE_VIEWER_DEFAULT_MAX_SIZE_MB };
  if (!raw || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;
  for (const kind of FILE_VIEWER_KINDS) {
    const val = obj[kind];
    if (typeof val !== "number" || !Number.isFinite(val)) continue;
    const { min, max } = FILE_VIEWER_LIMITS[kind];
    const rounded = Math.round(val);
    const clamped = Math.max(min, Math.min(max, rounded));
    if (clamped !== val) {
      log.warn("file_viewer.max_size_mb clamped", {
        kind,
        requested: val,
        applied: clamped,
        min,
        max,
      });
    }
    out[kind] = clamped;
  }
  return out;
}

function parseFileViewer(raw: unknown): FileViewerConfig {
  if (!raw || typeof raw !== "object") {
    return { max_size_mb: { ...FILE_VIEWER_DEFAULT_MAX_SIZE_MB } };
  }
  return { max_size_mb: parseFileViewerMaxSizeMb((raw as Record<string, unknown>).max_size_mb) };
}

// Fail-open for missing/garbled subtrees so an old config.yaml keeps the
// default sound mappings. `enabled: false` and `masterVolume: 0` are honored
// because the user pushed the toggle; unknown event ids and unknown sound ids
// are silently dropped (a stale UI selection should never break the file route).
function parseUiSounds(raw: unknown): UiSoundsConfig {
  const defaults = DEFAULT_CONFIG.ui_sounds;
  if (!raw || typeof raw !== "object") return { ...defaults, events: { ...defaults.events } };
  const obj = raw as Record<string, unknown>;

  const masterRaw = obj.masterVolume;
  let masterVolume = defaults.masterVolume;
  if (typeof masterRaw === "number" && Number.isFinite(masterRaw)) {
    masterVolume = Math.max(0, Math.min(1, masterRaw));
  }

  const events: Partial<Record<UiSoundEventId, string>> = {};
  const rawEvents = obj.events;
  if (rawEvents && typeof rawEvents === "object") {
    for (const id of UI_SOUND_EVENT_IDS) {
      const value = (rawEvents as Record<string, unknown>)[id];
      if (value === null) continue;
      if (typeof value === "string" && value.length > 0) events[id] = value;
    }
  }

  return {
    enabled: obj.enabled !== false,
    masterVolume,
    events: { ...defaults.events, ...events },
  };
}

// Per-cwd custom icon overrides. Missing/garbled entries are silently
// dropped; values are validated against known lucide names at render time
// (client assets), so here we only enforce the shape (string keys → string
// values) to keep a hand-edited YAML from breaking the file route.
function parseCwdIcons(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [cwd, icon] of Object.entries(obj)) {
    if (typeof icon === "string" && icon.length > 0) out[cwd] = icon;
  }
  return out;
}

function parseDisabledSkills(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string[]> = {};
  for (const [cwd, paths] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(paths)) continue;
    const valid = paths.filter((path): path is string => typeof path === "string" && path.length > 0);
    if (valid.length > 0) out[cwd] = [...new Set(valid)];
  }
  return out;
}

const CONFIG_DIR = dataPath();
const CONFIG_PATH = join(CONFIG_DIR, "config.yaml");

function ensureConfigDir(): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
}

function writeDefaultConfig(): PiWorkConfig {
  try {
    ensureConfigDir();
    writeFileSync(CONFIG_PATH, dump(DEFAULT_CONFIG), "utf8");
    log.info("created default config", { path: CONFIG_PATH });
  } catch (err) {
    log.error("failed to write default config", { error: String(err) });
  }
  return { ...DEFAULT_CONFIG };
}

/**
 * Read config from ~/.pi-work/config.yaml.
 * On any error (file missing, corrupt yaml, wrong shape),
 * overwrites with defaults and returns them.
 */
export function readConfig(): PiWorkConfig {
  try {
    const raw = readFileSync(CONFIG_PATH, "utf8");
    const parsed = load(raw);

    if (!parsed || typeof parsed !== "object") {
      log.warn("config yaml parsed to non-object, resetting to defaults");
      return writeDefaultConfig();
    }

    const cfg = parsed as Record<string, unknown>;

    return {
      dangerous_patterns: parseDangerousPatterns(cfg.dangerous_patterns),
      right_side_bar: parseRightSideBar(cfg.right_side_bar),
      append_system: parseAppendSystem(cfg.append_system),
      file_viewer: parseFileViewer(cfg.file_viewer),
      ui_sounds: parseUiSounds(cfg.ui_sounds),
      cwd_icons: parseCwdIcons(cfg.cwd_icons),
      disabled_skills: parseDisabledSkills(cfg.disabled_skills),
    };
  } catch (err) {
    log.warn("failed to read config, resetting to defaults", { error: String(err) });
    return writeDefaultConfig();
  }
}

/**
 * Write config to ~/.pi-work/config.yaml.
 * Returns the written config on success, throws on failure.
 */
export function writeConfig(config: PiWorkConfig): PiWorkConfig {
  ensureConfigDir();
  writeFileSync(CONFIG_PATH, dump(config), "utf8");
  log.info("config written", { path: CONFIG_PATH });
  return config;
}
