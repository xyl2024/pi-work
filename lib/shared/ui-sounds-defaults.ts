/*
 * Default UI sound mappings. Mirrored by the server-side parser so a fresh
 * config.yaml (or one written before this feature existed) produces the same
 * values as the "Restore defaults" button in SoundSettingsSection.
 *
 * Toast events default to silent on purpose: most users want toasts visible
 * but not noisier than the visual cue they already provide.
 */

import type { UiSoundEventId } from "./config-types";

export const DEFAULT_UI_SOUND_EVENTS: Record<UiSoundEventId, string> = {
  toast_success: "",
  toast_error: "",
  toast_info: "",
  agent_success: "ink",
  agent_failure: "sea-breeze",
  inbox_new: "tipsy",
  rss_new: "weightless",
  // The celebration overlay plays its own cannon-boom SFX (see
  // lib/client/celebrate-sounds.ts), so this event defaults to
  // silent; users can map an extra named sound here if they want a fanfare.
  celebrate: "",
};