/**
 * Microphone → 16 kHz mono 16-bit PCM WAV (what the voice provider takes;
 * Chrome's default MediaRecorder webm is not). Pure helpers + a Web Audio
 * recorder. The audio stays in memory and is dropped after the upload.
 */

export const WAV_RATE = 16_000;
export const MAX_CLIP_MS = 60_000;

/** Average-downsample Float32 samples from `from` Hz to `to` Hz. */
export function downsample(samples: Float32Array, from: number, to = WAV_RATE): Float32Array {
  if (from === to) return samples;
  if (from < to) return samples; // never upsample; the header says `from`
  const ratio = from / to;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

/** 16-bit PCM mono WAV bytes. */
export function encodeWav(samples: Float32Array, rate = WAV_RATE): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

export interface Clip {
  wav: Blob;
  durationMs: number;
}

export interface PcmRecorder {
  start(): Promise<void>;
  stop(): Promise<Clip>;
  cancel(): void;
}

export interface RecorderFactory {
  /** Can this browser record at all? */
  supported(): boolean;
  create(onLimit: () => void): PcmRecorder;
}

type Ctx = AudioContext;

/** Web Audio capture (ScriptProcessor: the one path every tablet browser has). */
export class WebAudioRecorder implements PcmRecorder {
  private stream: MediaStream | null = null;
  private ctx: Ctx | null = null;
  private node: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private length = 0;
  private rate = 48_000;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly onLimit: () => void) {}

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true } });
    const AC: typeof AudioContext =
      (globalThis as { AudioContext?: typeof AudioContext }).AudioContext ??
      (globalThis as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.rate = this.ctx.sampleRate;
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.node.onaudioprocess = (e) => {
      const d = new Float32Array(e.inputBuffer.getChannelData(0));
      this.chunks.push(d);
      this.length += d.length;
    };
    src.connect(this.node);
    this.node.connect(this.ctx.destination);
    this.timer = setTimeout(() => this.onLimit(), MAX_CLIP_MS);
  }

  async stop(): Promise<Clip> {
    const all = new Float32Array(this.length);
    let o = 0;
    for (const c of this.chunks) {
      all.set(c, o);
      o += c.length;
    }
    const rate = this.rate;
    this.cancel();
    const pcm = downsample(all, rate);
    const outRate = rate < WAV_RATE ? rate : WAV_RATE;
    return {
      wav: new Blob([encodeWav(pcm, outRate)], { type: 'audio/wav' }),
      durationMs: Math.round((all.length / rate) * 1000),
    };
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      this.node?.disconnect();
    } catch {
      /* already gone */
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => undefined);
    this.node = null;
    this.ctx = null;
    this.stream = null;
    this.chunks = [];
    this.length = 0;
  }
}

export const webAudioFactory: RecorderFactory = {
  supported: () =>
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    !!(
      (globalThis as { AudioContext?: unknown }).AudioContext ??
      (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext
    ),
  create: (onLimit) => new WebAudioRecorder(onLimit),
};
