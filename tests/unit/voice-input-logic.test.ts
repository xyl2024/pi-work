import { describe, expect, it } from "vitest";
import {
  encodePcm16Wav,
  VOICE_INPUT_MAX_BYTES,
  VOICE_INPUT_MAX_DURATION_MS,
  VOICE_INPUT_MIN_DURATION_MS,
  VOICE_INPUT_SAMPLE_RATE,
  VOICE_INPUT_TRANSCRIBE_TIMEOUT_MS,
  voiceInputErrorMessageKey,
  type VoiceInputErrorCode,
} from "@/lib/shared/voice-input";

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function uint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function uint16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}

describe("voice input constants", () => {
  it("pins the sampling and upload limits used by the browser encoder", () => {
    expect(VOICE_INPUT_SAMPLE_RATE).toBe(16000);
    expect(VOICE_INPUT_MAX_DURATION_MS).toBe(120_000);
    expect(VOICE_INPUT_MIN_DURATION_MS).toBe(500);
    expect(VOICE_INPUT_TRANSCRIBE_TIMEOUT_MS).toBe(60_000);
    expect(VOICE_INPUT_MAX_BYTES).toBe(8 * 1024 * 1024);
  });
});

describe("encodePcm16Wav", () => {
  it("writes a self-consistent riff header for a single chunk", () => {
    const wav = encodePcm16Wav([Int16Array.from([1, -2, 3])], VOICE_INPUT_SAMPLE_RATE);

    expect(wav.byteLength).toBe(44 + 6);
    expect(ascii(wav, 0, 4)).toBe("RIFF");
    expect(uint32(wav, 4)).toBe(36 + 6);
    expect(ascii(wav, 8, 4)).toBe("WAVE");
    expect(ascii(wav, 12, 4)).toBe("fmt ");
    expect(uint32(wav, 16)).toBe(16);
    expect(uint16(wav, 20)).toBe(1);
    expect(uint16(wav, 22)).toBe(1);
    expect(uint32(wav, 24)).toBe(16000);
    expect(uint32(wav, 28)).toBe(32000);
    expect(uint16(wav, 32)).toBe(2);
    expect(uint16(wav, 34)).toBe(16);
    expect(ascii(wav, 36, 4)).toBe("data");
    expect(uint32(wav, 40)).toBe(6);
  });

  it("concatenates multiple chunks in order", () => {
    const wav = encodePcm16Wav(
      [Int16Array.from([1, 2]), Int16Array.from([3]), Int16Array.from([-1, 32767])],
      VOICE_INPUT_SAMPLE_RATE,
    );

    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(uint32(wav, 4)).toBe(36 + 10);
    expect(uint32(wav, 40)).toBe(10);
    expect(Array.from({ length: 5 }, (_, i) => view.getInt16(44 + i * 2, true))).toEqual([
      1, 2, 3, -1, 32767,
    ]);
  });

  it("produces a valid empty wav for no chunks", () => {
    const wav = encodePcm16Wav([], VOICE_INPUT_SAMPLE_RATE);

    expect(wav.byteLength).toBe(44);
    expect(ascii(wav, 0, 4)).toBe("RIFF");
    expect(uint32(wav, 4)).toBe(36);
    expect(ascii(wav, 36, 4)).toBe("data");
    expect(uint32(wav, 40)).toBe(0);
  });

  it("honours the requested sample rate", () => {
    const wav = encodePcm16Wav([Int16Array.from([0])], 8000);

    expect(uint32(wav, 24)).toBe(8000);
    expect(uint32(wav, 28)).toBe(16000);
  });
});

describe("voiceInputErrorMessageKey", () => {
  const keys: Record<VoiceInputErrorCode, string> = {
    missing_key: "DeepSeek API key is not configured",
    permission_denied: "Microphone access was denied",
    empty_transcript: "Didn't catch that, say it again",
    rate_limited: "Voice input is busy, try again",
    too_large: "Voice input is too long",
    busy: "Voice input is busy, try again",
    timeout: "Voice input timed out",
    invalid_audio: "Voice input failed",
    failed: "Voice input failed",
  };

  it.each(Object.entries(keys))("maps %s to a stable English key", (code, expected) => {
    expect(voiceInputErrorMessageKey(code as VoiceInputErrorCode)).toBe(expected);
  });
});
