import type { SoundPatch } from "@/lib/client/ui-sounds";

// 欢庆 — C 大调上行号角：一声礼炮脆响，四个音依次升起，收在一片闪光的泛音上。
export const CELEBRATION: SoundPatch = {
  layers: [
    // 礼炮「砰」
    {
      source: { type: "noise", color: "white" },
      envelope: { attack: 0.001, decay: 0.09, curve: "ramp" },
      gain: 0.16,
      filter: { type: "bandpass", frequency: 1400, Q: 0.8 },
    },
    // C5
    {
      source: { type: "sawtooth", frequency: 523.25 },
      envelope: { attack: 0.008, decay: 0.5, curve: "ramp" },
      gain: 0.11,
      filter: { type: "lowpass", frequency: 1800, Q: 0.7 },
      effects: [{ type: "reverb", decay: 1.1, roomSize: 0.9, mix: 0.35 }],
    },
    // E5
    {
      source: { type: "sawtooth", frequency: 659.25 },
      envelope: { attack: 0.008, decay: 0.5, curve: "ramp" },
      gain: 0.1,
      delay: 0.1,
      filter: { type: "lowpass", frequency: 1800, Q: 0.7 },
      effects: [{ type: "reverb", decay: 1.1, roomSize: 0.9, mix: 0.35 }],
    },
    // G5
    {
      source: { type: "sawtooth", frequency: 783.99 },
      envelope: { attack: 0.008, decay: 0.55, curve: "ramp" },
      gain: 0.1,
      delay: 0.2,
      filter: { type: "lowpass", frequency: 2000, Q: 0.7 },
      effects: [{ type: "reverb", decay: 1.2, roomSize: 0.9, mix: 0.35 }],
    },
    // C6 落点
    {
      source: { type: "triangle", frequency: 1046.5 },
      envelope: { attack: 0.006, decay: 0.8, curve: "ramp" },
      gain: 0.12,
      delay: 0.3,
      effects: [{ type: "reverb", decay: 1.4, roomSize: 1, mix: 0.4 }],
    },
    // 高频闪光
    {
      source: { type: "sine", frequency: 2093, fm: { ratio: 2.5, depth: 60 } },
      envelope: { attack: 0.01, decay: 0.9, curve: "ramp" },
      gain: 0.06,
      delay: 0.42,
      effects: [{ type: "delay", delay: 0.11, feedback: 0.3, wet: 0.3, lowpass: 5000 }],
    },
  ],
};
