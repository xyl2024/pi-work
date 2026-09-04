/**
 * `celebrate` — a pure-frontend fun tool.
 *
 * The agent calls it to make the Pi Work UI play a celebration animation
 * (fireworks / confetti / party cannons). The tool itself does nothing on the server: it validates the
 * parameters, attaches structured `details` to the result, and returns
 * immediately. The animation fires when the SSE `tool_execution_end` event
 * reaches the browser (see hooks/useAgentSession/events.ts →
 * lib/client/celebrate-store.ts → components/effects/CelebrationOverlay.tsx).
 *
 * Registered in rpc-manager.ts, gated by ~/.pi-work/tools-market.json
 * (TOOL_MARKET_IDS "celebrate").
 */

import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import {
  CELEBRATE_TOOL_NAME,
  CELEBRATE_DEFAULT_DURATION_MS,
  CELEBRATE_MAX_DURATION_MS,
  type CelebrationStyle,
  type CelebrateDetails,
} from "@/lib/shared/celebrate-tool-types";

const CONCRETE_STYLES = ["fireworks", "confetti", "cannon", "grand"] as const;

const CelebrateParams = Type.Object(
  {
    style: Type.Optional(
      Type.Union(
        ["auto", "fireworks", "confetti", "cannon", "grand"].map((s) => Type.Literal(s)),
        {
          description:
            "Which effect to play. 'fireworks' = rockets bursting in the sky, 'confetti' = confetti rain from the top, 'cannon' = party cannons firing from the bottom corners, 'grand' = all of them at once, 'auto' (default) = pick one at random.",
        },
      ),
    ),
    duration: Type.Optional(
      Type.Number({
        minimum: 1,
        maximum: 15,
        description: "Animation length in seconds. Defaults to 5, capped at 15.",
      }),
    ),
  },
  { additionalProperties: false },
);

function pickRandomStyle(): (typeof CONCRETE_STYLES)[number] {
  return CONCRETE_STYLES[Math.floor(Math.random() * CONCRETE_STYLES.length)];
}

/**
 * Hardcoded, whole-block system-prompt contribution for `pi_work_celebrate`.
 * Appended at the very end of the system prompt via
 * `appendSystemPromptOverride`, gated on the tool being enabled AND part of
 * the session's tool set (same pattern as `agent_todo`). Replaces the flat
 * `promptGuidelines` array that used to live on the tool definition.
 */
export const CELEBRATE_SYSTEM_PROMPT_BLOCK = `\
## Tool pi_work_celebrate guidelines
- Use celebrate when a milestone is reached and it deserves a bit of joy: a big task finished, all tests passing, a successful deployment, a release shipped, or when the user asks to celebrate / 恭喜 / 庆祝.
- Call it once per milestone — do not spam it after every minor step.
- The tool returns instantly and never blocks; continue your reply right after calling it.
`;

export const celebrateTool = defineTool<typeof CelebrateParams, CelebrateDetails>({
  name: CELEBRATE_TOOL_NAME,
  label: "Celebrate 🎉",
  description:
    "Play a celebration animation in the Pi Work UI: fireworks, confetti rain, party cannons, or all at once. Purely visual — call it and keep going; it does not block your work.",
  parameters: CelebrateParams,
  executionMode: "sequential",
  promptSnippet: "Play a fireworks/confetti celebration animation in the UI.",
  // Guidelines moved to CELEBRATE_SYSTEM_PROMPT_BLOCK — injected via
  // appendSystemPromptOverride, gated on the tool being loaded.
  async execute(_toolCallId, params) {
    const style: CelebrationStyle = params.style ?? "auto";
    const resolvedStyle =
      style === "auto" ? pickRandomStyle() : (CONCRETE_STYLES as readonly string[]).includes(style) ? style : pickRandomStyle();
    const rawDuration = typeof params.duration === "number" ? params.duration : CELEBRATE_DEFAULT_DURATION_MS / 1000;
    const durationMs = Math.round(Math.min(Math.max(rawDuration, 1), CELEBRATE_MAX_DURATION_MS / 1000) * 1000);

    const details: CelebrateDetails = { style, resolvedStyle, durationMs };
    const text = [
      `🎉 Celebration launched (${resolvedStyle}, ${(durationMs / 1000).toFixed(1)}s).`,
      "The animation is playing in the user's browser. Continue your reply normally.",
    ].join("\n");

    return { content: [{ type: "text" as const, text }], details };
  },
});
