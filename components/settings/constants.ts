// Display data shared by SettingsModal.tsx and its sections. Split out so
// each section file only imports the bits it actually needs.
import type { AgentCustomToolName } from "@/lib/config";
import type { FileViewerKind } from "@/lib/file-viewer-limits";

// Display order for the "Custom Tools" section checkboxes. Tools are
// registered on `createAgentSession` (see lib/rpc-manager.ts) and the
// enabled subset is sourced from `custom_tools.enabled` in
// ~/.pi-work/config.yaml. Toggling here writes the full PiWorkConfig back
// via /api/settings — same immediate-apply pattern as Right-side buttons.
export const CUSTOM_TOOLS_UI: Array<{ id: AgentCustomToolName; labelKey: string }> = [
  { id: "agent_todo", labelKey: "Agent Todo" },
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

// Sidebar nav entries for the modal body. The id is the value of
// `data-settings-section` on each section's wrapper div; clicking an entry
// scrolls the body to that section. Order here is the display order in
// the sidebar (same as the body's top-to-bottom order) — keep them in
// sync if you reorder sections.
export const NAV_ITEMS: Array<{ id: string; labelKey: string }> = [
  { id: "settings-section-profile",       labelKey: "Profile" },
  { id: "settings-section-appearance",    labelKey: "Appearance" },
  { id: "settings-section-wechat",        labelKey: "WeChat Connection" },
  { id: "settings-section-append-system", labelKey: "Append System Prompt" },
  { id: "settings-section-custom-tools",  labelKey: "Custom Tools" },
  { id: "settings-section-right-bar",     labelKey: "Right-side buttons" },
  { id: "settings-section-inbox-test",    labelKey: "Inbox Test" },
  { id: "settings-section-file-preview",  labelKey: "File preview limits" },
  { id: "settings-section-typewriter-effect", labelKey: "Typewriter effect" },
  { id: "settings-section-typewriter",    labelKey: "Typewriter phrases" },
  { id: "settings-section-retry",         labelKey: "Agent retry" },
];