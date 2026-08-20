import type { SoundPatch } from "@/lib/client/ui-sounds";

// 水墨
export const INK: SoundPatch = {
  layers: [
    {
      source: {
        type: "sine",
        frequency: 709.5198431584679,
        fm: { ratio: 3.056670748618056, depth: 251.86309432327693 },
      },
      envelope: { attack: 0, decay: 0.5496978216768574, sustain: 0.03, release: 0.21295988036354038, curve: "ramp" },
      effects: [{ type: "reverb", decay: 0.7639288194385998, damping: 0.4, mix: 0.10777384001381302 }],
      gain: 0.128,
    },
    {
      source: {
        type: "sine",
        frequency: 894.0219757218803,
        fm: { ratio: 3.265165758581045, depth: 176.36203151420762 },
      },
      envelope: { attack: 0, decay: 0.47194070598958043, sustain: 0.02, release: 0.19314720291305534, curve: "ramp" },
      delay: 0.1168574190186562,
      effects: [{ type: "reverb", decay: 0.757712605596194, damping: 0.4, mix: 0.12965081568105996 }],
      gain: 0.092,
    },
    {
      source: {
        type: "sine",
        frequency: 1063.6013658708746,
        fm: { ratio: 2.7904161919561674, depth: 187.98244923566565 },
      },
      envelope: { attack: 0, decay: 0.35735847789669395, sustain: 0.02, release: 0.14891097161017305, curve: "ramp" },
      delay: 0.2337148380373124,
      effects: [{ type: "reverb", decay: 0.7430479863257146, damping: 0.4, mix: 0.12258431471605286 }],
      gain: 0.101,
    },
  ],
};