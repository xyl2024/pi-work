import type {
  AppendSystemConfig,
  NetworkProxyConfig,
  PiWorkConfig,
  SubagentConfig,
  UiSoundsConfig,
  WebAccessConfig,
} from "./config-types";
import type { FileViewerConfig } from "./file-viewer-limits";
import type { RightSideBarConfig } from "./right-bar";

/**
 * The top-level `config.yaml` keys `PUT /api/settings` owns.
 *
 * The route is a patch endpoint scoped to exactly this set: a body carrying
 * any other key (`cwd_aliases`, `cwd_icons`, `disabled_skills`, …) has those
 * keys ignored, not rejected. That is what makes a stale full-config snapshot
 * submitted by an old client harmless — it can no longer express "set the keys
 * another feature owns back to what I remember".
 *
 * The client writer derives its outbound patch from this same list, so the two
 * sides cannot drift.
 */
export const SETTINGS_OWNED_KEYS = [
  "right_side_bar",
  "append_system",
  "load_pi_docs",
  "file_viewer",
  "ui_sounds",
  "web_access",
  "subagent",
  "network_proxy",
] as const satisfies readonly (keyof PiWorkConfig)[];

export type SettingsOwnedKey = (typeof SETTINGS_OWNED_KEYS)[number];

/**
 * A patch for the settings route. Each owned key carries its full value; the
 * server replaces that key on disk (except `web_access`, whose Tavily sub-tree
 * is merged so a key can be set or explicitly cleared).
 */
export type SettingsPatch = Partial<{
  right_side_bar: RightSideBarConfig;
  append_system: AppendSystemConfig;
  load_pi_docs: boolean;
  file_viewer: FileViewerConfig;
  ui_sounds: UiSoundsConfig;
  web_access: {
    enabled?: boolean;
    tavily?: Partial<Omit<WebAccessConfig["tavily"], "api_key">> & {
      api_key?: string;
      clear_api_key?: boolean;
    };
  };
  subagent: SubagentConfig;
  network_proxy: NetworkProxyConfig;
}>;

const OWNED_KEY_SET: ReadonlySet<string> = new Set(SETTINGS_OWNED_KEYS);

/** True when the settings route owns this top-level config key. */
export function isSettingsOwnedKey(key: string): key is SettingsOwnedKey {
  return OWNED_KEY_SET.has(key);
}