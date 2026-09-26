// Display data shared by SettingsModal.tsx and its sections. Split out so
// each section file only imports the bits it actually needs.
import type { AgentCustomToolName } from "@/lib/shared/config-types";
import type { FileViewerKind } from "@/lib/shared/file-viewer-limits";

// Display order for the "Custom Tools" section checkboxes. Tools are
// registered on `createAgentSession` (see lib/rpc-manager.ts) and the
// enabled subset is sourced from `custom_tools.enabled` in
// ~/.pi-work/config.yaml. Toggling here writes the full PiWorkConfig back
// via /api/settings — same immediate-apply pattern as Right-side buttons.
export const CUSTOM_TOOLS_UI: Array<{ id: AgentCustomToolName; labelKey: string }> = [
  { id: "show_media", labelKey: "Show Media" },
  { id: "ask_user_questions", labelKey: "Ask User Questions" },
];

// Display order for the "File preview limits" section number inputs. The
// ranges mirror lib/config.ts#FILE_VIEWER_LIMITS — duplicated here so the
// UI can render per-kind `min` / `max` HTML attributes without a second
// round-trip to the server. Keep these in sync if FILE_VIEWER_LIMITS
// changes.
export const FILE_VIEWER_UI: Array<{ kind: FileViewerKind; labelKey: string }> = [
  { kind: "text",  labelKey: "Max size for text / code files" },
  { kind: "image", labelKey: "Max size for image files" },
  { kind: "pdf",   labelKey: "Max size for PDF files" },
];