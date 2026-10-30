import type { FileViewerConfig } from "./file-viewer-limits";
import type { RightSideBarConfig } from "./right-bar";

export interface DangerousPatternRule {
  name: string;
  pattern: string;
  ignoreCase?: boolean;
}

export interface DangerousPatternsConfig {
  rules: DangerousPatternRule[];
  timeout_ms: number;
}

export interface AppendSystemConfig {
  enabled: boolean;
}

export const ALWAYS_BYPASS_HOSTS = ["localhost", "127.0.0.1", "::1"] as const;

export interface NetworkProxyConfig {
  enabled: boolean;
  url: string;
  no_proxy: string;
}

export interface McpConfig {
  project_servers: boolean;
  startup_wait_ms: number;
}

export interface PiWorkConfig {
  dangerous_patterns: DangerousPatternsConfig;
  right_side_bar: RightSideBarConfig;
  append_system: AppendSystemConfig;
  load_pi_docs: boolean;
  file_viewer: FileViewerConfig;
  ui_sounds: UiSoundsConfig;
  cwd_icons: Record<string, string>;
  cwd_aliases: Record<string, string>;
  disabled_skills: Record<string, string[]>;
  network_proxy: NetworkProxyConfig;
  mcp: McpConfig;
}

export const UI_SOUND_EVENT_IDS = [
  "toast_success",
  "toast_error",
  "toast_info",
  "agent_success",
  "agent_failure",
  "ask_user_questions",
  "permission_request",
  "celebrate",
] as const;

export type UiSoundEventId = (typeof UI_SOUND_EVENT_IDS)[number];

export type SoundId = string;

export interface UiSoundsConfig {
  enabled: boolean;
  masterVolume: number;
  events: Partial<Record<UiSoundEventId, string>>;
}
