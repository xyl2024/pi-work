import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import {
  CELEBRATE_TOOL_NAME,
  CELEBRATE_DEFAULT_DURATION_MS,
  CELEBRATE_MAX_DURATION_MS,
  type CelebrationStyle,
  type CelebrateDetails,
} from "@/lib/shared/celebrate-tool-types";

const CONCRETE_STYLES = ["confetti", "cannon", "grand"] as const;

const CelebrateParams = Type.Object(
  {
    style: Type.Optional(
      Type.Union(
        ["auto", "confetti", "cannon", "grand"].map((s) => Type.Literal(s)),
        {
          description:
            "Which effect to play. 'confetti' = confetti rain from the top, 'cannon' = party cannons firing from the bottom corners, 'grand' = confetti and cannons at once, 'auto' (default) = pick one at random.",
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

export const celebrateTool = defineTool<typeof CelebrateParams, CelebrateDetails>({
  name: CELEBRATE_TOOL_NAME,
  label: "Celebrate",
  description:
    "Play a celebration animation in the Pi Work UI: confetti rain, party cannons, or both at once. Purely visual — call it and keep going; it does not block your work.",
  parameters: CelebrateParams,
  executionMode: "sequential",
  promptSnippet: "Play a confetti/cannon celebration animation in the UI.",
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
