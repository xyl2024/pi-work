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
  type SubagentConfig,
  type SubagentThinkingLevel,
  type UiSoundEventId,
  type UiSoundsConfig,
  type WebAccessConfig,
} from "../shared/config-types";
import { DEFAULT_UI_SOUND_EVENTS } from "../shared/ui-sounds-defaults";
import type { NetworkProxyConfig } from "../shared/config-types";
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
import { PANEL_TAB_SPEC_BY_KIND } from "../shared/panelTabs";

// ── Custom tools enabled by `customTools` on createAgentSession ───────────
// Names match the tool names registered in lib/rpc-manager.ts. Adding a new
// tool to `customTools` in rpc-manager.ts requires adding it here too, or
// the validator will silently drop it (fail-open default still applies, but
// the user setting is lost).

// ── APPEND_SYSTEM.md loader toggle ───────────────────────────────────────
// pi's DefaultResourceLoader auto-loads ~/.pi/agent/APPEND_SYSTEM.md on
// every session. Disabling here passes `appendSystemPrompt: []` to the
// loader, which short-circuits `discoverAppendSystemPromptFile()` — the
// file is left untouched on disk so re-enabling just flips the flag.

// ── Dangerous-command confirmation rules ────────────────────────────────
// Empty `rules` means "no user rules": the built-in bash / PowerShell sets in
// `lib/shared/dangerous-commands.ts` are always enforced underneath, so the
// confirmation gate is never silently off (a Windows box has no user bash
// rule that could match a PowerShell command).
const DEFAULT_DANGEROUS_PATTERNS: DangerousPatternsConfig = {
  rules: [],
  timeout_ms: 300_000,
};

/**
 * Configurable right-bar button ids, in panel-registry order. Derived from
 * the panel registry (its keys *are* the button ids) so that adding a panel
 * view needs no change here, and removing one (canvas, json) leaves no key
 * in `config.yaml`.
 */
const CONFIGURABLE_BUTTON_IDS: readonly RightBarButtonId[] = Object.keys(
  PANEL_TAB_SPEC_BY_KIND,
) as RightBarButtonId[];

/**
 * Every panel view visible by default. Session-bound buttons (context /
 * toolCalls / conversationTree / gitDiff / llmAudit) pin to the bottom —
 * they're meaningful only when a session is active and become empty on the
 * new-session page.
 */
function defaultRightSideBar(): RightSideBarConfig {
  const out: RightSideBarConfig = { session_bound_alignment: "bottom" };
  for (const id of CONFIGURABLE_BUTTON_IDS) out[id] = true;
  return out;
}

const DEFAULT_RIGHT_SIDE_BAR: RightSideBarConfig = defaultRightSideBar();

const DEFAULT_SUBAGENT: SubagentConfig = { thinking_level: "off" };
const SUBAGENT_THINKING_LEVELS: readonly SubagentThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

function parseSubagent(raw: unknown): SubagentConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SUBAGENT };
  const obj = raw as Record<string, unknown>;
  const model = obj.model && typeof obj.model === "object" ? obj.model as Record<string, unknown> : null;
  const configuredModel = model && typeof model.provider === "string" && typeof model.modelId === "string"
    ? { provider: model.provider, modelId: model.modelId } : undefined;
  const thinking_level = typeof obj.thinking_level === "string" && SUBAGENT_THINKING_LEVELS.includes(obj.thinking_level as SubagentThinkingLevel)
    ? obj.thinking_level as SubagentThinkingLevel : DEFAULT_SUBAGENT.thinking_level;
  return { thinking_level, ...(configuredModel ? { model: configuredModel } : {}) };
}

const DEFAULT_CONFIG: PiWorkConfig = {
  dangerous_patterns: DEFAULT_DANGEROUS_PATTERNS,
  right_side_bar: { ...DEFAULT_RIGHT_SIDE_BAR },
  // Preserve pre-existing behavior: append file loads by default.
  append_system: { enabled: true },
  // Preserve pre-existing behavior: pi's built-in Pi documentation section
  // stays in new sessions' system prompts by default.
  load_pi_docs: true,
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
  cwd_aliases: {},
  disabled_skills: {},
  web_access: {
    enabled: true,
    tavily: {},
  },
  subagent: { ...DEFAULT_SUBAGENT },
  // Off by default: never silently route traffic through a proxy the user
  // did not ask for. `url` is required for the proxy to take effect.
  network_proxy: { enabled: false, url: "", no_proxy: "" },
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
      rules.push({
        name: rule.name,
        pattern: rule.pattern,
        ...(typeof rule.ignoreCase === "boolean" ? { ignoreCase: rule.ignoreCase } : {}),
      });
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
  // Iterate the registry, not the file: a key that no panel view owns any
  // more (canvas, json) is ignored instead of resurrected, and a `false` for
  // any registered view round-trips — the defaults enumerate every view, so
  // nothing is silently dropped on read.
  for (const id of CONFIGURABLE_BUTTON_IDS) {
    const v = obj[id];
    if (typeof v === "boolean") out[id] = v;
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

function parseCwdAliases(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [cwd, alias] of Object.entries(obj)) {
    if (typeof alias === "string" && alias.trim().length > 0) out[cwd] = alias;
  }
  return out;
}

function parseWebAccess(raw: unknown): WebAccessConfig {
  const defaults = DEFAULT_CONFIG.web_access;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { enabled: defaults.enabled, tavily: {} };
  const obj = raw as Record<string, unknown>;
  const tavilyRaw = obj.tavily;
  const tavily = tavilyRaw && typeof tavilyRaw === "object" && !Array.isArray(tavilyRaw)
    ? (tavilyRaw as Record<string, unknown>)
    : {};
  const apiKey = typeof tavily.api_key === "string" && tavily.api_key.trim().length > 0
    ? tavily.api_key.trim()
    : undefined;
  return { enabled: obj.enabled !== false, tavily: apiKey ? { api_key: apiKey } : {} };
}

// Network proxy (Settings → Network proxy). Fail-open: a missing / garbled
// block means "no proxy", which is the pre-feature behavior. The URL is
// shape-checked at the PUT boundary (app/api/settings) so the UI can't
// persist garbage; here we only keep strings and let the applier ignore an
// unusable URL rather than throwing during readConfig.
function parseNetworkProxy(raw: unknown): NetworkProxyConfig {
  const defaults = DEFAULT_CONFIG.network_proxy;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...defaults };
  const obj = raw as Record<string, unknown>;
  return {
    enabled: obj.enabled === true,
    url: typeof obj.url === "string" ? obj.url.trim() : "",
    no_proxy: typeof obj.no_proxy === "string" ? obj.no_proxy.trim() : "",
  };
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
      load_pi_docs: typeof cfg.load_pi_docs === "boolean" ? cfg.load_pi_docs : true,
      file_viewer: parseFileViewer(cfg.file_viewer),
      ui_sounds: parseUiSounds(cfg.ui_sounds),
      cwd_icons: parseCwdIcons(cfg.cwd_icons),
      cwd_aliases: parseCwdAliases(cfg.cwd_aliases),
      disabled_skills: parseDisabledSkills(cfg.disabled_skills),
      web_access: parseWebAccess(cfg.web_access),
      subagent: parseSubagent(cfg.subagent),
      network_proxy: parseNetworkProxy(cfg.network_proxy),
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
