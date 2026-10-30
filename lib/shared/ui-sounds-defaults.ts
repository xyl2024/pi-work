import type { UiSoundEventId } from "./config-types";

export const DEFAULT_UI_SOUND_EVENTS: Record<UiSoundEventId, string> = {
  toast_success: "",
  toast_error: "",
  toast_info: "",
  agent_success: "ink",
  agent_failure: "sea-breeze",
  ask_user_questions: "weightless",
  permission_request: "dawn",
  celebrate: "",
};