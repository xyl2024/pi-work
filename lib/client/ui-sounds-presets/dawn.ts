import type { SoundPatch } from "@/lib/client/ui-sounds";

// 破晓
export const DAWN: SoundPatch = {
  layers: [
    {
      source: { type: "noise", color: "white" },
      envelope: { attack: 0.0005, decay: 0.01, sustain: 0, release: 0.004 },
      gain: 0.17,
      filter: { type: "bandpass", frequency: 1888.658283157932, Q: 2 },
    },
    {
      source: { type: "sine", frequency: { start: 2672.6416863723084, end: 1832.6689490639433 } },
      envelope: { attack: 0, decay: 0.053240630940169585, sustain: 0, release: 0.004 },
      gain: 0.18,
      filter: { type: "bandpass", frequency: 3500, Q: 1.8 },
    },
  ],
};