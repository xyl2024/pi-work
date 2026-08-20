// Public surface for the useAgentSession module.
//
// External callers should import from "@/hooks/useAgentSession" only —
// the internal files (hook.ts, events.ts, data.ts, transport.ts, types.ts,
// utils.ts) are not part of the public API and may be reorganized without
// notice.

export { useAgentSession } from "./hook";

export type {
  AgentPhase,
  AttachedImage,
  ChatInputHandle,
  SessionData,
  ThinkingLevelOption,
  UseAgentSessionOptions,
} from "./types";