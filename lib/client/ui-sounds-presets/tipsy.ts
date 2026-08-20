import type { SoundPatch } from "@/lib/client/ui-sounds";

// 微醺
export const TIPSY: SoundPatch = {
  source: { type: "sine", frequency: { start: 520.9356514894362, end: 781.4034772341543 } },
  envelope: { attack: 0, decay: 0.1142487415606464, sustain: 0.02, release: 0.047170263844116836 },
  gain: 0.128,
};