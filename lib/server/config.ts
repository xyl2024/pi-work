import { readFileSync, statSync, writeFileSync, mkdirSync } from "fs";
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
  type McpConfig,
  type UiSoundEventId,
  type UiSoundsConfig,
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

declare global {
  var __piWorkConfigCache: { config: PiWorkConfig; mtimeMs: number; size: number } | undefined;
}

import type { RightBarButtonId, RightSideBarConfig } from "../shared/right-bar";
import { resolveSessionBoundAlignment } from "../shared/right-bar";
import { PANEL_TAB_SPEC_BY_KIND } from "../shared/panelTabs";

const DEFAULT_DANGEROUS_PATTERNS: DangerousPatternsConfig = {
  rules: [],
  timeout_ms: 300_000,
};

const CONFIGURABLE_BUTTON_IDS: readonly RightBarButtonId[] = Object.keys(
  PANEL_TAB_SPEC_BY_KIND,
) as RightBarButtonId[];

function defaultRightSideBar(): RightSideBarConfig {
  const out: RightSideBarConfig = { session_bound_alignment: "bottom" };
  for (const id of CONFIGURABLE_BUTTON_IDS) out[id] = true;
  return out;
}

const DEFAULT_RIGHT_SIDE_BAR: RightSideBarConfig = defaultRightSideBar();

const DEFAULT_MCP: McpConfig = {
  project_servers: false,
  startup_wait_ms: 3000,
};

function parseMcp(raw: unknown): McpConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_MCP };
  const obj = raw as Record<string, unknown>;
  const startup = obj.startup_wait_ms;
  return {
    project_servers: obj.project_servers === true,
    startup_wait_ms:
      typeof startup === "number" && Number.isFinite(startup) && startup >= 0
        ? Math.min(Math.floor(startup), 120_000)
        : DEFAULT_MCP.startup_wait_ms,
  };
}

const DEFAULT_CONFIG: PiWorkConfig = {
  dangerous_patterns: DEFAULT_DANGEROUS_PATTERNS,
  right_side_bar: { ...DEFAULT_RIGHT_SIDE_BAR },
  append_system: { enabled: true },
  load_pi_docs: true,
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
  network_proxy: { enabled: false, url: "", no_proxy: "" },
  mcp: { ...DEFAULT_MCP },
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
  for (const id of CONFIGURABLE_BUTTON_IDS) {
    const v = obj[id];
    if (typeof v === "boolean") out[id] = v;
  }
  if (Array.isArray(obj.order)) {
    const arr: RightBarButtonId[] = [];
    for (const item of obj.order) {
      if (typeof item === "string") arr.push(item as RightBarButtonId);
    }
    if (arr.length > 0) out.order = arr;
  }
  if (typeof obj.session_bound_alignment === "string") {
    out.session_bound_alignment = resolveSessionBoundAlignment(obj.session_bound_alignment);
  }
  return out;
}

function parseAppendSystem(raw: unknown): AppendSystemConfig {
  if (!raw || typeof raw !== "object") return { enabled: true };
  const obj = raw as Record<string, unknown>;
  return { enabled: obj.enabled !== false };
}

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
  return cacheConfig({ ...DEFAULT_CONFIG }, statConfig());
}

function statConfig(): { mtimeMs: number; size: number } | null {
  try {
    const stat = statSync(CONFIG_PATH);
    return { mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    return null;
  }
}

function cacheConfig(config: PiWorkConfig, stat: { mtimeMs: number; size: number } | null): PiWorkConfig {
  globalThis.__piWorkConfigCache = stat ? { config, ...stat } : undefined;
  return config;
}

export function readConfig(): PiWorkConfig {
  const stat = statConfig();
  const cached = globalThis.__piWorkConfigCache;
  if (stat && cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.config;
  }
  try {
    const raw = readFileSync(CONFIG_PATH, "utf8");
    const parsed = load(raw);

    if (!parsed || typeof parsed !== "object") {
      log.warn("config yaml parsed to non-object, resetting to defaults");
      return writeDefaultConfig();
    }

    const cfg = parsed as Record<string, unknown>;

    return cacheConfig(
      {
        dangerous_patterns: parseDangerousPatterns(cfg.dangerous_patterns),
        right_side_bar: parseRightSideBar(cfg.right_side_bar),
        append_system: parseAppendSystem(cfg.append_system),
        load_pi_docs: typeof cfg.load_pi_docs === "boolean" ? cfg.load_pi_docs : true,
        file_viewer: parseFileViewer(cfg.file_viewer),
        ui_sounds: parseUiSounds(cfg.ui_sounds),
        cwd_icons: parseCwdIcons(cfg.cwd_icons),
        cwd_aliases: parseCwdAliases(cfg.cwd_aliases),
        disabled_skills: parseDisabledSkills(cfg.disabled_skills),
        network_proxy: parseNetworkProxy(cfg.network_proxy),
        mcp: parseMcp(cfg.mcp),
      },
      statConfig(),
    );
  } catch (err) {
    log.warn("failed to read config, resetting to defaults", { error: String(err) });
    return writeDefaultConfig();
  }
}

export function writeConfig(config: PiWorkConfig): PiWorkConfig {
  ensureConfigDir();
  writeFileSync(CONFIG_PATH, dump(config), "utf8");
  log.info("config written", { path: CONFIG_PATH });
  globalThis.__piWorkConfigCache = undefined;
  return config;
}
