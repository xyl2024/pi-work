import type { SoundPatch } from "@/lib/client/ui-sounds";

export const CANNON_BOOM: SoundPatch = {
  layers: [
    {
      source: { type: "sine", frequency: { start: 180, end: 40, time: 0.32 } },
      envelope: { attack: 0.002, decay: 0.7, curve: "ramp" },
      gain: 0.5,
    },
    {
      source: { type: "noise", color: "brown" },
      envelope: { attack: 0.001, decay: 0.36, curve: "ramp" },
      gain: 0.36,
      filter: { type: "lowpass", frequency: 1200, Q: 0.7 },
      effects: [{ type: "reverb", decay: 1.4, roomSize: 0.9, mix: 0.3 }],
    },
    {
      source: { type: "noise", color: "white" },
      envelope: { attack: 0.001, decay: 0.12, curve: "ramp" },
      gain: 0.14,
      filter: { type: "highpass", frequency: 1800 },
    },
  ],
};
