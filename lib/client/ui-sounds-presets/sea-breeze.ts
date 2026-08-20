import type { SoundPatch } from "@/lib/client/ui-sounds";

// 海风
export const SEA_BREEZE: SoundPatch = {
  layers: [
    {
      source: { type: "sine", frequency: 172.4647612452229 },
      envelope: { attack: 0.000303578331655822, decay: 0.14981760481348255, sustain: 0, release: 0.004, curve: "ramp" },
      gain: 0.157,
      effects: [{ type: "delay", delay: 0.091, feedback: 0.279, wet: 0.125, lowpass: 2818 }],
    },
    {
      source: { type: "triangle", frequency: 150 },
      envelope: { attack: 0.002209221753593769, decay: 0.13697877998253302, sustain: 0, release: 0.004, curve: "ramp" },
      gain: 0.096,
      delay: 0.11363929983964999,
      effects: [{ type: "delay", delay: 0.091, feedback: 0.279, wet: 0.125, lowpass: 2818 }],
    },
    {
      source: { type: "sine", frequency: 262.70735352627815 },
      envelope: { attack: 0.001885297271651985, decay: 0.0333420360407271, sustain: 0, release: 0.004, curve: "ramp" },
      gain: 0.121,
      delay: 0.22911149161219757,
      effects: [{ type: "delay", delay: 0.091, feedback: 0.279, wet: 0.125, lowpass: 2818 }],
    },
    {
      source: {
        type: "sine",
        frequency: 525.4137387532304,
        fm: { depth: 34.944554093806026, ratio: 1.996814675024488 },
      },
      envelope: { attack: 0.00043616428605649734, decay: 0.20297851065525568, sustain: 0, release: 0.004, curve: "ramp" },
      gain: 0.059,
      delay: 0.25,
      effects: [{ type: "delay", delay: 0.091, feedback: 0.279, wet: 0.125, lowpass: 2818 }],
    },
  ],
};