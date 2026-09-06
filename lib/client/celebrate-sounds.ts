import type { SoundPatch } from "@/lib/client/ui-sounds";

/**
 * Celebration SFX (data recipe for the procedural player).
 *
 * Played directly by `components/effects/CelebrationOverlay.tsx` when a show
 * starts: one cannon boom, whatever the visual style. Honors the global
 * sounds toggle and master volume via `playUiSoundEffect`, but is not a
 * user-mappable event.
 */

/** 礼炮：正弦低频下坠 + 棕噪声推进药爆响 + 白噪声脆壳，混响拖尾更满。 */
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
      // 出膛脆壳：短促高频冲击，让炮声更「炸」。
      source: { type: "noise", color: "white" },
      envelope: { attack: 0.001, decay: 0.12, curve: "ramp" },
      gain: 0.14,
      filter: { type: "highpass", frequency: 1800 },
    },
  ],
};
