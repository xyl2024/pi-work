import type { SoundPatch } from "@/lib/client/ui-sounds";

// 失重
export const WEIGHTLESS: SoundPatch = {
  layers: [
    {
      source: { type: "sine", frequency: 711.1456117271605 },
      envelope: { attack: 0.008, decay: 0.2638540359520533, sustain: 0.04, release: 0.08956773825048218, curve: "ramp" },
      gain: 0.139,
    },
    {
      source: { type: "sine", frequency: 907.0687085395474 },
      envelope: { attack: 0.008, decay: 0.19915089527460272, sustain: 0.03, release: 0.09047199798104143, curve: "ramp" },
      gain: 0.117,
      delay: 0.09765961254526478,
    },
    {
      source: { type: "sine", frequency: 1183.726241822192 },
      envelope: { attack: 0.008, decay: 0.172866084358492, sustain: 0.03, release: 0.1081631637145148, curve: "ramp" },
      gain: 0.095,
      delay: 0.19531922509052957,
    },
  ],
};