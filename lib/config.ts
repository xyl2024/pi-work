import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { load, dump } from "js-yaml";
import { createLogger } from "./logger";
import type { Locale } from "./i18n-dict";
import {
  DEFAULT_TYPEWRITER_PHRASES,
  parseTypewriterPhrases,
} from "./typewriter-phrases";
import {
  FILE_VIEWER_LIMITS,
  FILE_VIEWER_KINDS,
  FILE_VIEWER_DEFAULT_MAX_SIZE_MB,
  type FileViewerConfig,
  type FileViewerKind,
  type FileViewerMaxSizeMb,
} from "./file-viewer-limits";

// Re-export so existing server-side callers (the /api/files route
// handler, /api/settings PUT validator) can keep importing these
// symbols from "@/lib/config" without changing their import paths.
export {
  FILE_VIEWER_LIMITS,
  FILE_VIEWER_KINDS,
  FILE_VIEWER_DEFAULT_MAX_SIZE_MB,
  type FileViewerConfig,
  type FileViewerKind,
  type FileViewerMaxSizeMb,
};

const log = createLogger("config");

export interface DangerousPatternRule {
  name: string;
  pattern: string;
}

export interface DangerousPatternsConfig {
  rules: DangerousPatternRule[];
  timeout_ms: number;
}

export interface BuiltinExtensionConfig {
  enabled: boolean;
}

export interface ExtensionsConfig {
  clawd_on_desk: BuiltinExtensionConfig;
}

// ── Right-side button bar visibility ──────────────────────────────────────
// Types and helpers live in `lib/right-bar.ts` (client-safe). They're
// re-exported from here so server-side callers can continue to import
// them from `@/lib/config` without a second import path. Client-side
// 'use client' components should import from `@/lib/right-bar` directly
// to avoid pulling this server-only module (fs/js-yaml/logger) into the
// client bundle.

// Re-export the client-safe right-bar types/helpers for backward compat.
// 'use client' components should import directly from "@/lib/right-bar"
// instead — importing through here drags in fs/js-yaml/logger.
import type { RightBarButtonId, RightSideBarConfig } from "./right-bar";
import { isRightBarButtonVisible } from "./right-bar";
export { isRightBarButtonVisible };
export type { RightBarButtonId, RightSideBarConfig };

// ── Custom tools enabled by `customTools` on createAgentSession ───────────
// Names match the tool names registered in lib/rpc-manager.ts. The two
// built-in user-side todo tools (`user_todos_list`, `user_todo_description`)
// live in lib/todo-tools-config.ts and are NOT listed here — they are gated
// by ~/.pi-work/todo-tools.json for historical reasons. Adding a new tool
// to `customTools` in rpc-manager.ts requires adding it here too, or the
// validator will silently drop it (fail-open default still applies, but
// the user setting is lost).

export type AgentCustomToolName = "agent_todo" | "show_media" | "show_file" | "ask_user_questions";

export const AGENT_CUSTOM_TOOL_NAMES: readonly AgentCustomToolName[] = [
  "agent_todo",
  "show_media",
  // Legacy alias — kept for backward compatibility with ~/.pi-work/config.yaml
  // entries that still say `show_file`. The runtime registers `show_media`
  // regardless of which key the user has enabled.
  "show_file",
  "ask_user_questions",
] as const;

export interface CustomToolsConfig {
  enabled: AgentCustomToolName[];
}

// ── APPEND_SYSTEM.md loader toggle ───────────────────────────────────────
// pi's DefaultResourceLoader auto-loads ~/.pi/agent/APPEND_SYSTEM.md on
// every session. Disabling here passes `appendSystemPrompt: []` to the
// loader, which short-circuits `discoverAppendSystemPromptFile()` — the
// file is left untouched on disk so re-enabling just flips the flag.
export interface AppendSystemConfig {
  enabled: boolean;
}

// ── Chat input typewriter phrases ─────────────────────────────────────────
// Cycled randomly when the chat input is empty. Edited via the Settings
// modal (per-locale textareas, one phrase per line) and persisted under
// `typewriter_phrases` in ~/.pi-work/config.yaml. Shape mirrors the
// i18n Locale type so the chat input can pick the right list without
// any extra lookup. Falls back to bundled defaults on any parse failure
// (see lib/typewriter-phrases.ts for the fail-open rules).
export type TypewriterPhrases = Record<Locale, string[]>;

// ── Chat input typewriter effect master toggle ───────────────────────────
// When `enabled` is false, the chat input drops the cycling typewriter
// placeholder in favor of a plain static prompt (per i18n). Editable
// from the Settings modal as an immediate-apply switch next to the
// per-locale phrase textareas. Defaults to true to preserve the
// pre-toggle behavior; the parser fails open to the same value so a
// hand-edited YAML that omits the field doesn't silently disable the
// effect.
export interface TypewriterEffectConfig {
  enabled: boolean;
}

// ── File preview size limits ─────────────────────────────────────────────
// Client-safe types and per-kind ranges live in `./file-viewer-limits`
// (imported + re-exported above) so SettingsModal can import the ranges
// without pulling `fs` / `path` into the client bundle. This block is
// just the `PiWorkConfig` integration point.
export interface PiWorkConfig {
  dangerous_patterns: DangerousPatternsConfig;
  extensions: ExtensionsConfig;
  right_side_bar: RightSideBarConfig;
  custom_tools: CustomToolsConfig;
  append_system: AppendSystemConfig;
  typewriter_phrases: TypewriterPhrases;
  typewriter_effect: TypewriterEffectConfig;
  file_viewer: FileViewerConfig;
}

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
};

const DEFAULT_CONFIG: PiWorkConfig = {
  dangerous_patterns: DEFAULT_DANGEROUS_PATTERNS,
  extensions: {
    clawd_on_desk: { enabled: false },
  },
  right_side_bar: { ...DEFAULT_RIGHT_SIDE_BAR },
  custom_tools: {
    enabled: [...AGENT_CUSTOM_TOOL_NAMES],
  },
  // Preserve pre-existing behavior: append file loads by default.
  append_system: { enabled: true },
  // Bundled quote collection — also the fallback for parseTypewriterPhrases
  // when the field is missing, malformed, or partially empty.
  typewriter_phrases: {
    en: [...DEFAULT_TYPEWRITER_PHRASES.en],
    zh: [...DEFAULT_TYPEWRITER_PHRASES.zh],
  },
  // Preserve pre-toggle behavior: typewriter effect on by default.
  typewriter_effect: { enabled: true },
  // Preserves pre-feature behavior: same hardcoded limits the route used
  // before the value became user-configurable.
  file_viewer: {
    max_size_mb: { ...FILE_VIEWER_DEFAULT_MAX_SIZE_MB },
  },
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
    if (key === "order") continue;
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
  return out;
}

// Fail-open only when the field is genuinely missing / unreadable —
// an explicit `enabled: []` MUST be honored as "disable everything"
// (the user pushed the button, we trust them). When the array is
// non-empty but every entry is unknown, fall back to defaults: that's
// almost certainly a typo / schema mismatch and silently disabling
// every tool would be a worse surprise than the typo itself.
function parseCustomTools(raw: unknown): CustomToolsConfig {
  if (!raw || typeof raw !== "object") return { enabled: [...AGENT_CUSTOM_TOOL_NAMES] };
  const obj = raw as Record<string, unknown>;
  const enabledRaw = obj.enabled;
  if (!Array.isArray(enabledRaw)) return { enabled: [...AGENT_CUSTOM_TOOL_NAMES] };
  if (enabledRaw.length === 0) return { enabled: [] };
  const seen = new Set<AgentCustomToolName>();
  for (const item of enabledRaw) {
    if (typeof item !== "string") continue;
    // Normalize the legacy `show_file` spelling to the current `show_media`
    // name, so the Settings UI checkbox (keyed by tool name) and the
    // runtime tool registration always agree. `show_file` remains a legal
    // input so old config.yaml files keep working — it just never survives
    // the parse.
    const name = item === "show_file" ? "show_media" : item;
    if ((AGENT_CUSTOM_TOOL_NAMES as readonly string[]).includes(name)) {
      seen.add(name as AgentCustomToolName);
    }
  }
  if (seen.size === 0) return { enabled: [...AGENT_CUSTOM_TOOL_NAMES] };
  return { enabled: [...seen] };
}

// Fail-open for the missing/garbled case (keep the on-by-default behavior
// so an old config.yaml doesn't silently turn the append off). An explicit
// `enabled: false` is honored — the user pushed the button, we trust them.
function parseAppendSystem(raw: unknown): AppendSystemConfig {
  if (!raw || typeof raw !== "object") return { enabled: true };
  const obj = raw as Record<string, unknown>;
  return { enabled: obj.enabled !== false };
}

// Fail-open for the missing/garbled case (keeps the typewriter visible by
// default so an old config.yaml doesn't silently strip the animation).
// An explicit `enabled: false` is honored — the user pushed the toggle,
// we trust them.
function parseTypewriterEffect(raw: unknown): TypewriterEffectConfig {
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

const CONFIG_DIR = join(homedir(), ".pi-work");
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

    const extObj = (cfg.extensions && typeof cfg.extensions === "object")
      ? cfg.extensions as Record<string, unknown>
      : {};
    const codObj = (extObj.clawd_on_desk && typeof extObj.clawd_on_desk === "object")
      ? extObj.clawd_on_desk as Record<string, unknown>
      : {};
    const clawdOnDeskEnabled = typeof codObj.enabled === "boolean" ? codObj.enabled : false;

    return {
      dangerous_patterns: parseDangerousPatterns(cfg.dangerous_patterns),
      extensions: {
        clawd_on_desk: { enabled: clawdOnDeskEnabled },
      },
      right_side_bar: parseRightSideBar(cfg.right_side_bar),
      custom_tools: parseCustomTools(cfg.custom_tools),
      append_system: parseAppendSystem(cfg.append_system),
      typewriter_phrases: parseTypewriterPhrases(cfg.typewriter_phrases),
      typewriter_effect: parseTypewriterEffect(cfg.typewriter_effect),
      file_viewer: parseFileViewer(cfg.file_viewer),
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
