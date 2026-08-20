/*
 * Browser-only player for procedural UI sound recipes.
 *
 * A recipe is data: layers of oscillators/noise, envelopes, optional filters,
 * and delay/reverb effects. Keeping the player here means generated sounds can be
 * added by pasting a recipe without adding audio files or a runtime package.
 *
 * Eight named recipes ship with the product. The user picks which one plays
 * for each event through the Settings UI; see
 * `lib/shared/config-types.ts#UiSoundsConfig` and the SoundSettingsSection.
 *
 * The eight recipes live in `ui-sounds-presets/` so each recipe can be edited
 * and shared in isolation. This module owns the player, the named registry,
 * and the event dispatcher; presets only export typed `SoundPatch` data.
 */

import type { UiSoundEventId, UiSoundsConfig } from "@/lib/shared/config-types";
import { MORNING_LIGHT } from "./ui-sounds-presets/morning-light";
import { LONELY_SHADOW } from "./ui-sounds-presets/lonely-shadow";
import { TIPSY } from "./ui-sounds-presets/tipsy";
import { DAWN } from "./ui-sounds-presets/dawn";
import { INK } from "./ui-sounds-presets/ink";
import { FIREFLY } from "./ui-sounds-presets/firefly";
import { WEIGHTLESS } from "./ui-sounds-presets/weightless";
import { SEA_BREEZE } from "./ui-sounds-presets/sea-breeze";

const SILENCE = 0.0001;
const MIN_SOUND_GAP_MS = 70;

type Waveform = "sine" | "triangle" | "square" | "sawtooth";
type Frequency = number | { start: number; end: number; time?: number };

type SoundSource =
  | {
      type: Waveform;
      frequency: Frequency;
      fm?: { ratio: number; depth: number };
    }
  | {
      type: "noise";
      color?: "white" | "pink" | "brown";
    };

interface SoundEnvelope {
  attack?: number;
  decay: number;
  sustain?: number;
  release?: number;
  curve?: "ramp";
}

interface SoundFilter {
  type: BiquadFilterType;
  frequency: number;
  Q?: number;
  envelope?: { attack?: number; peak: number; decay: number };
}

interface SoundDelay {
  type: "delay";
  delay: number;
  feedback: number;
  wet: number;
  lowpass?: number;
}

interface SoundReverb {
  type: "reverb";
  decay?: number;
  damping?: number;
  mix?: number;
  preDelay?: number;
  roomSize?: number;
}

type SoundEffect = SoundDelay | SoundReverb;

interface SoundLayer {
  source: SoundSource;
  envelope?: SoundEnvelope;
  gain?: number;
  delay?: number;
  filter?: SoundFilter | SoundFilter[];
  effects?: SoundEffect[];
}

export type SoundPatch = SoundLayer | { layers: SoundLayer[] };

/**
 * Stable IDs for the eight built-in sounds. The Settings UI renders these
 * names through i18n so they can be renamed without code changes.
 *
 * Names are kept as lowercase identifiers with hyphens so they read well as
 * object keys and as filenames; the display label is localizable.
 */
export const SOUND_IDS = [
  "morning-light",
  "lonely-shadow",
  "tipsy",
  "dawn",
  "ink",
  "firefly",
  "weightless",
  "sea-breeze",
] as const;

export type SoundId = (typeof SOUND_IDS)[number];

const FALLBACK_MASTER_VOLUME = 0.45;

let audioContext: AudioContext | null = null;
let masterBus: GainNode | null = null;
let lastPlayedAt = 0;
let currentMasterVolume = FALLBACK_MASTER_VOLUME;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;

  const browserWindow = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const AudioContextConstructor = browserWindow.AudioContext ?? browserWindow.webkitAudioContext;
  if (!AudioContextConstructor) return null;

  if (!audioContext || audioContext.state === "closed") {
    try {
      audioContext = new AudioContextConstructor();
      masterBus = null;
    } catch {
      return null;
    }
  }
  return audioContext;
}

function getMasterBus(ctx: AudioContext): GainNode {
  if (!masterBus || masterBus.context !== ctx) {
    masterBus = ctx.createGain();
    masterBus.gain.value = currentMasterVolume;
    masterBus.connect(ctx.destination);
  }
  return masterBus;
}

function resumeAudio(ctx: AudioContext): void {
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
}

/** Resume the shared context from a user gesture to satisfy autoplay policy. */
export function unlockUiSounds(): void {
  const ctx = getAudioContext();
  if (ctx) resumeAudio(ctx);
}

/**
 * Update the master volume (0..1) used by every recipe. Survives a single
 * context rebuild: the next `playSound` rebuilds the master gain with the
 * latest value.
 */
export function setUiSoundsMasterVolume(volume: number): void {
  if (!Number.isFinite(volume)) return;
  currentMasterVolume = Math.max(0, Math.min(1, volume));
  if (masterBus) masterBus.gain.value = currentMasterVolume;
}

function layersOf(patch: SoundPatch): SoundLayer[] {
  return "layers" in patch ? patch.layers : [patch];
}

function nonNegative(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function createNoiseBuffer(
  ctx: AudioContext,
  color: "white" | "pink" | "brown" | undefined,
  seconds: number,
): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  if (color === "pink") {
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
  } else if (color === "brown") {
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
  } else {
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  return buffer;
}

function buildSource(
  ctx: AudioContext,
  source: SoundSource,
  start: number,
  duration: number,
): { node: AudioScheduledSourceNode; extras: AudioNode[] } {
  if (source.type === "noise") {
    const node = ctx.createBufferSource();
    node.buffer = createNoiseBuffer(ctx, source.color, duration + 0.1);
    node.start(start);
    node.stop(start + duration + 0.1);
    return { node, extras: [] };
  }

  const node = ctx.createOscillator();
  node.type = source.type;
  if (typeof source.frequency === "number") {
    node.frequency.setValueAtTime(source.frequency, start);
  } else {
    node.frequency.setValueAtTime(source.frequency.start, start);
    node.frequency.exponentialRampToValueAtTime(
      Math.max(1, source.frequency.end),
      start + Math.min(nonNegative(source.frequency.time) || duration, duration),
    );
  }

  const extras: AudioNode[] = [];
  if (source.fm) {
    const carrier = typeof source.frequency === "number" ? source.frequency : source.frequency.start;
    const modulator = ctx.createOscillator();
    modulator.type = "sine";
    modulator.frequency.value = carrier * source.fm.ratio;
    const modulationGain = ctx.createGain();
    modulationGain.gain.value = source.fm.depth;
    modulator.connect(modulationGain);
    modulationGain.connect(node.frequency);
    modulator.start(start);
    modulator.stop(start + duration + 0.1);
    extras.push(modulator, modulationGain);
  }

  node.start(start);
  node.stop(start + duration + 0.1);
  return { node, extras };
}

function buildEnvelope(
  ctx: AudioContext,
  envelope: SoundEnvelope | undefined,
  gain: number,
  start: number,
): { node: GainNode; duration: number } {
  const node = ctx.createGain();
  if (!envelope) {
    node.gain.setValueAtTime(gain, start);
    node.gain.setTargetAtTime(SILENCE, start, 0.15);
    return { node, duration: 0.5 };
  }

  const attack = nonNegative(envelope.attack);
  const decay = nonNegative(envelope.decay);
  const sustain = Math.max(0, envelope.sustain ?? 0);
  const release = nonNegative(envelope.release);
  const decayTime = Math.max(decay / 3, 0.001);
  const releaseTime = Math.max(release / 3, 0.001);
  const peak = Math.max(gain, SILENCE);

  node.gain.setValueAtTime(SILENCE, start);
  if (envelope.curve === "ramp") {
    if (attack > 0) node.gain.exponentialRampToValueAtTime(peak, start + attack);
    else node.gain.setValueAtTime(peak, start);
    node.gain.exponentialRampToValueAtTime(
      SILENCE,
      start + attack + Math.max(decay, 0.001),
    );
  } else {
    if (attack > 0) node.gain.linearRampToValueAtTime(gain, start + attack);
    else node.gain.setValueAtTime(gain, start);

    if (sustain > 0) {
      node.gain.setTargetAtTime(Math.max(sustain * gain, SILENCE), start + attack, decayTime);
      if (release > 0) {
        node.gain.setTargetAtTime(SILENCE, start + attack + decay, releaseTime);
      }
    } else {
      node.gain.setTargetAtTime(SILENCE, start + attack, decayTime);
    }
  }

  return { node, duration: attack + decay + release };
}

interface EffectGraph {
  input: GainNode;
  output: GainNode;
  nodes: AudioNode[];
  tail: number;
}

function createDelayEffect(ctx: AudioContext, effect: SoundDelay): EffectGraph {
  const input = ctx.createGain();
  const output = ctx.createGain();
  input.connect(output);

  const delaySeconds = Math.min(Math.max(0, effect.delay), 0.99);
  const feedback = Math.min(Math.max(0, effect.feedback), 0.95);
  const wet = Math.min(Math.max(0, effect.wet), 1);
  const delay = ctx.createDelay(1);
  delay.delayTime.value = delaySeconds;
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = Math.max(20, effect.lowpass ?? 4000);
  const feedbackGain = ctx.createGain();
  feedbackGain.gain.value = feedback;
  const wetGain = ctx.createGain();
  wetGain.gain.value = wet;

  input.connect(delay);
  delay.connect(lowpass);
  lowpass.connect(feedbackGain);
  feedbackGain.connect(delay);
  lowpass.connect(wetGain);
  wetGain.connect(output);

  const tail = feedback <= 0
    ? delaySeconds
    : delaySeconds * (1 + Math.ceil(Math.log(0.001) / Math.log(feedback)));
  return {
    input,
    output,
    nodes: [input, output, delay, lowpass, feedbackGain, wetGain],
    tail,
  };
}

function createReverbEffect(ctx: AudioContext, effect: SoundReverb): EffectGraph {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const mix = Math.min(Math.max(0, effect.mix ?? 0.3), 1);
  const dry = ctx.createGain();
  dry.gain.value = 1 - mix;
  input.connect(dry);
  dry.connect(output);

  const wet = ctx.createGain();
  wet.gain.value = mix;
  input.connect(wet);
  const wetOutput = ctx.createGain();
  wetOutput.connect(output);

  const decay = Math.min(Math.max(0.05, effect.decay ?? 0.5), 3);
  const roomSize = Math.max(0.1, effect.roomSize ?? 1);
  const effectiveDecay = Math.min(decay * roomSize, 3);
  const length = Math.max(1, Math.ceil(ctx.sampleRate * effectiveDecay));
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  const damping = Math.min(Math.max(0, effect.damping ?? 0), 0.99);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    let previous = 0;
    for (let i = 0; i < data.length; i++) {
      const noise = (Math.random() * 2 - 1) * Math.exp(-i / (length * 0.28));
      previous = noise * (1 - damping) + previous * damping;
      data[i] = previous;
    }
  }

  const convolver = ctx.createConvolver();
  convolver.buffer = impulse;
  const preDelay = Math.min(Math.max(0, effect.preDelay ?? 0), 0.99);
  let reverbInput: AudioNode = wet;
  let preDelayNode: DelayNode | null = null;
  if (preDelay > 0) {
    preDelayNode = ctx.createDelay(1);
    preDelayNode.delayTime.value = preDelay;
    reverbInput.connect(preDelayNode);
    reverbInput = preDelayNode;
  }
  reverbInput.connect(convolver);
  convolver.connect(wetOutput);

  return {
    input,
    output,
    nodes: [input, output, dry, wet, wetOutput, convolver, ...(preDelayNode ? [preDelayNode] : [])],
    tail: effectiveDecay + preDelay,
  };
}

function createEffect(ctx: AudioContext, effect: SoundEffect): EffectGraph {
  return effect.type === "delay" ? createDelayEffect(ctx, effect) : createReverbEffect(ctx, effect);
}

function renderLayer(ctx: AudioContext, layer: SoundLayer, destination: AudioNode, volume: number): void {
  const start = ctx.currentTime + nonNegative(layer.delay);
  const gain = Math.max(0, layer.gain ?? 0.5) * Math.max(0, volume);
  const envelope = buildEnvelope(ctx, layer.envelope, gain, start);
  const source = buildSource(ctx, layer.source, start, envelope.duration);
  let tail: AudioNode = source.node;
  const nodes: AudioNode[] = [source.node, envelope.node, ...source.extras];

  const filters = layer.filter ? (Array.isArray(layer.filter) ? layer.filter : [layer.filter]) : [];
  for (const filter of filters) {
    const filterNode = ctx.createBiquadFilter();
    filterNode.type = filter.type;
    filterNode.frequency.setValueAtTime(Math.max(20, filter.frequency), start);
    filterNode.Q.value = filter.Q ?? 1;
    if (filter.envelope) {
      const filterAttack = nonNegative(filter.envelope.attack);
      filterNode.frequency.linearRampToValueAtTime(filter.envelope.peak, start + filterAttack);
      filterNode.frequency.exponentialRampToValueAtTime(
        Math.max(20, filter.frequency),
        start + filterAttack + Math.max(0.001, filter.envelope.decay),
      );
    }
    tail.connect(filterNode);
    tail = filterNode;
    nodes.push(filterNode);
  }
  tail.connect(envelope.node);

  let effectTail = 0;
  let output: AudioNode = envelope.node;
  for (const effect of layer.effects ?? []) {
    const graph = createEffect(ctx, effect);
    output.connect(graph.input);
    output = graph.output;
    effectTail = Math.max(effectTail, graph.tail);
    nodes.push(...graph.nodes);
  }
  output.connect(destination);

  const cleanupMs = (nonNegative(layer.delay) + envelope.duration + effectTail + 0.4) * 1000;
  window.setTimeout(() => {
    for (const node of nodes) {
      try {
        node.disconnect();
      } catch {
        // The browser may already have collected or disconnected the node.
      }
    }
  }, cleanupMs);
}

/** Play one generated recipe. Safe to call from any UI path. */
export function playSound(patch: SoundPatch, options?: { volume?: number }): void {
  const now = typeof performance === "undefined" ? Date.now() : performance.now();
  if (now - lastPlayedAt < MIN_SOUND_GAP_MS) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    resumeAudio(ctx);
    const destination = getMasterBus(ctx);
    for (const layer of layersOf(patch)) {
      renderLayer(ctx, layer, destination, options?.volume ?? 1);
    }
    lastPlayedAt = now;
  } catch {
    // Audio is an enhancement. A browser/device audio failure must not affect UI actions.
  }
}

/** Play one of the eight built-in named sounds. Unknown ids are silent. */
export function playNamedSound(id: string, options?: { volume?: number }): void {
  if (typeof id !== "string") return;
  const patch = (NAMED_SOUND_PATCHES as Record<string, SoundPatch | undefined>)[id];
  if (patch) playSound(patch, options);
}

/* ── The eight built-in recipes. ──
 *
 * See the import block at the top of the file for the per-recipe modules.
 * This map is the single registry consulted by `playNamedSound`.
 */

export const NAMED_SOUND_PATCHES: Record<SoundId, SoundPatch> = {
  "morning-light": MORNING_LIGHT,
  "lonely-shadow": LONELY_SHADOW,
  tipsy: TIPSY,
  dawn: DAWN,
  ink: INK,
  firefly: FIREFLY,
  weightless: WEIGHTLESS,
  "sea-breeze": SEA_BREEZE,
};

/* ── Event dispatcher (reads ui_sounds from the settings snapshot). ──── */

let currentUiSounds: UiSoundsConfig | null = null;

export function setUiSoundsConfig(config: UiSoundsConfig | null): void {
  currentUiSounds = config;
  if (config) setUiSoundsMasterVolume(config.masterVolume);
}

/**
 * Fire the sound attached to `eventId`. Honors the global `enabled` switch,
 * an empty/unknown per-event id (silent), and the volume from settings.
 */
export function playUiSoundEvent(eventId: UiSoundEventId): void {
  if (!currentUiSounds || !currentUiSounds.enabled) return;
  const id = currentUiSounds.events[eventId];
  if (typeof id !== "string" || id.length === 0) return;
  playNamedSound(id);
}
