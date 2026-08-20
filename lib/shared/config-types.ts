import type { Locale } from "./i18n-dict";
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

export type TypewriterPhrases = Record<Locale, string[]>;

export interface TypewriterEffectConfig {
  enabled: boolean;
}

export interface PiWorkConfig {
  dangerous_patterns: DangerousPatternsConfig;
  right_side_bar: RightSideBarConfig;
  custom_tools: CustomToolsConfig;
  append_system: AppendSystemConfig;
  typewriter_phrases: TypewriterPhrases;
  typewriter_effect: TypewriterEffectConfig;
  file_viewer: FileViewerConfig;
}
