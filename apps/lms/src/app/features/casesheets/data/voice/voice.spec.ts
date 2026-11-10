import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../../../environments/environment';
import { VoiceUnavailable } from '../cases/case-models';
import { CasesApi } from '../cases/cases-api';
import { VOICE_RECORDER, VoiceService, VoiceTryAgain } from './voice.service';
import { Clip, RecorderFactory, downsample, encodeWav } from './wav';

class FakeRecorders implements RecorderFactory {
  ok = true;
  started = 0;
  cancelled = 0;
  limit: (() => void) | null = null;
  supported = () => this.ok;
  create = (onLimit: () => void) => {
    this.limit = onLimit;
    return {
      start: async () => void this.started++,
      stop: async (): Promise<Clip> => ({ wav: new Blob(['RIFF'], { type: 'audio/wav' }), durationMs: 1500 }),
      cancel: () => void this.cancelled++,
    };
  };
}

function setup(transcribe: (b: Blob, c: unknown) => Promise<string>, features: Record<string, boolean> = {}) {
  (environment as { features?: Record<string, boolean> }).features = features;
  const rec = new FakeRecorders();
  const calls: unknown[] = [];
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: VOICE_RECORDER, useValue: rec },
      {
        provide: CasesApi,
        useValue: {
          transcribe: (b: Blob, c: unknown) => {
            calls.push([b.type, c]);
            return transcribe(b, c);
          },
        },
      },
    ],
  });
  return { voice: TestBed.inject(VoiceService), rec, calls };
}

describe('VoiceService', () => {
  afterEach(() => ((environment as { features?: Record<string, boolean> }).features = {}));

  it('records, sends the WAV with the field label, returns trimmed text', async () => {
    const { voice, calls } = setup(async () => '  worse at night ');
    expect(voice.available()).toBe(true);
    const s = await voice.start({ label: 'Notes', specialty: 'ENT' });
    expect(await s.stop()).toBe('worse at night');
    expect(calls).toEqual([['audio/wav', { label: 'Notes', specialty: 'ENT', durationMs: 1500 }]]);
  });

  it('switched off in /config.json → no mics', () => {
    const { voice } = setup(async () => '', { voice: false });
    expect(voice.available()).toBe(false);
  });

  it('no microphone support → no mics', () => {
    (environment as { features?: Record<string, boolean> }).features = {};
    TestBed.resetTestingModule();
    const rec = new FakeRecorders();
    rec.ok = false;
    TestBed.configureTestingModule({
      providers: [
        { provide: VOICE_RECORDER, useValue: rec },
        { provide: CasesApi, useValue: {} },
      ],
    });
    expect(TestBed.inject(VoiceService).available()).toBe(false);
  });

  it('the server says voice is not set up (501) → the mics hide, nothing is appended', async () => {
    const { voice } = setup(async () => {
      throw new VoiceUnavailable();
    });
    const s = await voice.start({ label: 'Notes' });
    expect(await s.stop()).toBe('');
    expect(voice.available()).toBe(false);
    await expect(voice.start({ label: 'Notes' })).rejects.toBeInstanceOf(VoiceUnavailable);
  });

  it('provider trouble (424) and too many tries (429) become a plain "try again"', async () => {
    for (const status of [424, 429]) {
      const { voice } = setup(async () => {
        throw new HttpErrorResponse({ status });
      });
      const s = await voice.start({ label: 'Notes' });
      const e = (await s.stop().catch((x: unknown) => x)) as Error;
      expect(e).toBeInstanceOf(VoiceTryAgain);
      expect(String(e.message)).toMatch(/try again/);
      expect(voice.available()).toBe(true);
    }
  });

  it('auto-stops at the limit; stop() then answers the same text once', async () => {
    let n = 0;
    const { voice, rec } = setup(async () => `clip ${++n}`);
    const s = await voice.start({ label: 'Notes' });
    rec.limit!();
    expect(await s.stop()).toBe('clip 1');
    expect(n).toBe(1);
  });

  it('cancel stops the microphone', async () => {
    const { voice, rec } = setup(async () => 'x');
    const s = await voice.start({ label: 'Notes' });
    s.cancel();
    expect(rec.cancelled).toBe(1);
  });
});

describe('WAV encoding', () => {
  it('downsamples 48 kHz to 16 kHz by averaging', () => {
    const src = new Float32Array([0, 0.3, 0.6, 1, 1, 1]);
    expect([...downsample(src, 48_000)].map((x) => Math.round(x * 10) / 10)).toEqual([0.3, 1]);
    expect(downsample(src, 16_000)).toBe(src);
  });

  it('writes a 16-bit mono PCM header', () => {
    const buf = encodeWav(new Float32Array([0, 1, -1]));
    const v = new DataView(buf);
    const s = (o: number) => String.fromCharCode(...new Uint8Array(buf, o, 4));
    expect(s(0)).toBe('RIFF');
    expect(s(8)).toBe('WAVE');
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(16_000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(6);
    expect(v.getInt16(46, true)).toBe(32767);
    expect(v.getInt16(48, true)).toBe(-32768);
  });
});
