import type { FileViewerConfig } from "./file-viewer-limits";
import type { RightSideBarConfig } from "./right-bar";

/** Browser-safe contract for ~/.pi-work/config.yaml. */
export interface DangerousPatternRule {
  name: string;
  pattern: string;
}

export interface DangerousPatternsConfig {
  rules: DangerousPatternRule[];
  timeout_ms: number;
}

/** Names of custom tools registered when a Pi session starts. */
export type AgentCustomToolName = "agent_todo" | "show_media" | "show_file" | "ask_user_questions";

export const AGENT_CUSTOM_TOOL_NAMES: readonly AgentCustomToolName[] = [
  "agent_todo",
  "show_media",
  // Legacy alias — accepted when parsing older config.yaml files.
  "show_file",
  "ask_user_questions",
] as const;

export interface CustomToolsConfig {
  enabled: AgentCustomToolName[];
}

export interface AppendSystemConfig {
  enabled: boolean;
}


export type SubagentThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface SubagentConfig {
  model?: { provider: string; modelId: string };
  thinking_level: SubagentThinkingLevel;
}

export interface WebAccessConfig {
  enabled: boolean;
  tavily: {
    api_key?: string;
    /** Browser-only masked status; never persisted by the server parser. */
    has_api_key?: boolean;
  };
}

export interface PiWorkConfig {
  dangerous_patterns: DangerousPatternsConfig;
  right_side_bar: RightSideBarConfig;
  append_system: AppendSystemConfig;
  /** Toggle for pi's built-in "Pi documentation" section in new sessions. */
  load_pi_docs: boolean;
  file_viewer: FileViewerConfig;
  ui_sounds: UiSoundsConfig;
  /** Per-cwd custom icon override: absolute cwd path → lucide icon name. */
  cwd_icons: Record<string, string>;
  /** Per-cwd display alias: absolute cwd path → user-set alias (may be empty). */
  cwd_aliases: Record<string, string>;
  /** Per-cwd Skill files excluded from the model prompt (resources are untouched). */
  disabled_skills: Record<string, string[]>;
  web_access: WebAccessConfig;
  subagent: SubagentConfig;
}

/**
 * Event keys the user can attach an UI sound to. The same set is enforced
 * server-side (lib/server/config.ts) and rendered in the SoundSettingsSection.
 */
export const UI_SOUND_EVENT_IDS = [
  "toast_success",
  "toast_error",
  "toast_info",
  "agent_success",
  "agent_failure",
  "inbox_new",
  "rss_new",
  "celebrate",
] as const;

export type UiSoundEventId = (typeof UI_SOUND_EVENT_IDS)[number];

export type SoundId = string;

/**
 * Per-event UI sound mappings. An empty / unknown id means "do not play".
 * `masterVolume` scales every event before it reaches the AudioContext master
 * gain. `enabled` is a global kill-switch that overrides every event choice.
 */
export interface UiSoundsConfig {
  enabled: boolean;
  masterVolume: number;
  events: Partial<Record<UiSoundEventId, string>>;
}
