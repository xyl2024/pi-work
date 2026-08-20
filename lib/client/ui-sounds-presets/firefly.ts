import type { SoundPatch } from "@/lib/client/ui-sounds";

// 萤火
export const FIREFLY: SoundPatch = {
  layers: [
    {
      source: { type: "noise", color: "pink" },
      envelope: { attack: 0.001, decay: 0.01556000781931544, sustain: 0, release: 0.004, curve: "ramp" },
      gain: 0.053,
      filter: { type: "bandpass", frequency: 930.4340475677665, Q: 1.264 },
      effects: [{ type: "delay", delay: 0.084, feedback: 0.197, wet: 0.155, lowpass: 3340 }],
    },
    {
      source: {
        type: "sine",
        frequency: 651.1684945820488,
        fm: { depth: 48.054349882648516, ratio: 1.96563354821886 },
      },
      envelope: { attack: 0.004, decay: 0.13949348692762947, sustain: 0, release: 0.004, curve: "ramp" },
      gain: 0.127,
      effects: [{ type: "delay", delay: 0.084, feedback: 0.197, wet: 0.155, lowpass: 3340 }],
    },
    {
      source: {
        type: "sine",
        frequency: 516.8326949875654,
        fm: { depth: 51.4266219041526, ratio: 2.0339133747732023 },
      },
      envelope: { attack: 0.004, decay: 0.26672689692072277, sustain: 0, release: 0.004, curve: "ramp" },
      gain: 0.137,
      delay: 0.11765180939513532,
      effects: [{ type: "delay", delay: 0.084, feedback: 0.197, wet: 0.155, lowpass: 3340 }],
    },
  ],
};