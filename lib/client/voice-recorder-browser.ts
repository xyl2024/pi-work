import {
  createVoiceRecorder,
  type VoiceRecorder,
  type VoiceRecorderAdapter,
  type VoiceRecorderAdapterHandlers,
} from "./voice-recorder";
import { VOICE_INPUT_SAMPLE_RATE } from "@/lib/shared/voice-input";

const WORKLET_SOURCE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (!channel) return true;
    const pcm = new Int16Array(channel.length);
    let sum = 0;
    for (let i = 0; i < channel.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, channel[i]));
      pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      sum += sample * sample;
    }
    this.port.postMessage({ pcm, level: Math.sqrt(sum / channel.length) });
    return true;
  }
}
registerProcessor("pcm-capture", PcmCaptureProcessor);
`;

export function isVoiceInputSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  return typeof navigator.mediaDevices?.getUserMedia === "function";
}

interface BrowserCapture {
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  node: AudioWorkletNode;
  moduleUrl: string;
}

export function createBrowserVoiceRecorderAdapter(): VoiceRecorderAdapter {
  let capture: BrowserCapture | null = null;

  async function release(): Promise<void> {
    const current = capture;
    capture = null;
    if (!current) return;
    current.node.port.onmessage = null;
    current.node.disconnect();
    current.source.disconnect();
    current.stream.getTracks().forEach((track) => track.stop());
    URL.revokeObjectURL(current.moduleUrl);
    await current.context.close();
  }

  return {
    async open(handlers: VoiceRecorderAdapterHandlers) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
      const context = new AudioContext({ sampleRate: VOICE_INPUT_SAMPLE_RATE });
      const moduleUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
      try {
        await context.audioWorklet.addModule(moduleUrl);
        const source = context.createMediaStreamSource(stream);
        const node = new AudioWorkletNode(context, "pcm-capture");
        node.port.onmessage = (event: MessageEvent<{ pcm: Int16Array; level: number }>) => {
          handlers.onSamples(event.data.pcm);
          handlers.onLevel(event.data.level);
        };
        source.connect(node);
        node.connect(context.destination);
        capture = { stream, context, source, node, moduleUrl };
      } catch (error) {
        stream.getTracks().forEach((track) => track.stop());
        URL.revokeObjectURL(moduleUrl);
        await context.close();
        throw error;
      }
    },
    close: release,
  };
}

export function createBrowserVoiceRecorder(): VoiceRecorder {
  return createVoiceRecorder({ adapter: createBrowserVoiceRecorderAdapter() });
}
