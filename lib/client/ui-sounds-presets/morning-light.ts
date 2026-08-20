import type { SoundPatch } from "@/lib/client/ui-sounds";

// 晨曦
export const MORNING_LIGHT: SoundPatch = {
  layers: [
    {
      source: { type: "triangle", frequency: 321.765 },
      envelope: { attack: 0.001, decay: 0.219, sustain: 0.03, release: 0.077 },
      gain: 0.142,
      filter: { type: "bandpass", frequency: 322, Q: 8 },
      effects: [{ type: "delay", delay: 0.169, feedback: 0.183, wet: 0.236, lowpass: 1751 }],
    },
    {
      source: { type: "triangle", frequency: 643.53 },
      envelope: { attack: 0.001, decay: 0.479, sustain: 0.03, release: 0.168 },
      gain: 0.126,
      filter: { type: "bandpass", frequency: 644, Q: 8 },
      delay: 0.1,
      effects: [{ type: "delay", delay: 0.169, feedback: 0.183, wet: 0.236, lowpass: 1751 }],
    },
  ],
};