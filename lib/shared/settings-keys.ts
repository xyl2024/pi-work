import type {
  AppendSystemConfig,
  NetworkProxyConfig,
  PiWorkConfig,
  UiSoundsConfig,
} from "./config-types";
import type { FileViewerConfig } from "./file-viewer-limits";
import type { RightSideBarConfig } from "./right-bar";

export const SETTINGS_OWNED_KEYS = [
  "right_side_bar",
  "append_system",
  "load_pi_docs",
  "file_viewer",
  "ui_sounds",
  "network_proxy",
] as const satisfies readonly (keyof PiWorkConfig)[];

export type SettingsOwnedKey = (typeof SETTINGS_OWNED_KEYS)[number];

export type SettingsPatch = Partial<{
  right_side_bar: RightSideBarConfig;
  append_system: AppendSystemConfig;
  load_pi_docs: boolean;
  file_viewer: FileViewerConfig;
  ui_sounds: UiSoundsConfig;
  network_proxy: NetworkProxyConfig;
}>;

const OWNED_KEY_SET: ReadonlySet<string> = new Set(SETTINGS_OWNED_KEYS);

export function isSettingsOwnedKey(key: string): key is SettingsOwnedKey {
  return OWNED_KEY_SET.has(key);
}