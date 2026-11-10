import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, InjectionToken, inject, signal } from '@angular/core';
// Imported by path: the parent wires the fill contract's exports in the library index.
import type { VoiceInput, VoiceSession } from '@prefrontal/forms-engine';
import { environment } from '../../../../../environments/environment';
import { VoiceUnavailable } from '../cases/case-models';
import { CasesApi } from '../cases/cases-api';
import { RecorderFactory, webAudioFactory } from './wav';

export const VOICE_RECORDER = new InjectionToken<RecorderFactory>('VOICE_RECORDER', {
  providedIn: 'root',
  factory: () => webAudioFactory,
});

/** A clip that could not be typed (provider failed, too many tries): the text field says it in plain words. */
export class VoiceTryAgain extends Error {
  constructor(message = "Couldn't hear that — please try again.") {
    super(message);
  }
}

/**
 * Dictation for text fields (plan §6): tap the mic, speak, tap again; the
 * words come back as text to APPEND. Audio is recorded as 16 kHz WAV,
 * sent once, never stored. `available` false (switched off in /config.json,
 * no microphone support, or the server says voice is not set up) hides
 * every mic.
 */
@Injectable({ providedIn: 'root' })
export class VoiceService implements VoiceInput {
  private readonly api = inject(CasesApi);
  private readonly recorders = inject(VOICE_RECORDER);
  private readonly _available = signal((environment as { features?: Record<string, boolean> }).features?.['voice'] !== false && this.recorders.supported());
  readonly available = this._available.asReadonly();

  constructor() {
    // The server decides (GET /api/casesheets/voice: no provider = no mic). A failed read leaves the mic as it was.
    if (this._available()) {
      void Promise.resolve()
        .then(() => this.api.voiceConfig())
        .then((c) => {
          if (!c.enabled) this._available.set(false);
        })
        .catch(() => undefined);
    }
  }

  async start(context: { label: string; specialty?: string }): Promise<VoiceSession> {
    if (!this._available()) throw new VoiceUnavailable();
    let stopped = false;
    let autoStop: (() => void) | null = null;
    const rec = this.recorders.create(() => autoStop?.());
    await rec.start();
    let result: Promise<string> | null = null;
    const finish = (): Promise<string> => {
      if (result) return result;
      stopped = true;
      result = (async () => {
        const clip = await rec.stop();
        try {
          const text = await this.api.transcribe(clip.wav, { ...context, durationMs: clip.durationMs });
          return text.trim();
        } catch (e) {
          if (e instanceof VoiceUnavailable) {
            this._available.set(false);
            return '';
          }
          if (e instanceof HttpErrorResponse && e.status === 429)
            throw new VoiceTryAgain('Voice typing is busy — please try again in a moment.');
          if (e instanceof HttpErrorResponse && (e.status === 424 || e.status === 413 || e.status === 400))
            throw new VoiceTryAgain();
          throw e;
        }
      })();
      return result;
    };
    // At 60 s the clip stops itself; the field's own stop() then gets the same text.
    autoStop = () => void finish().catch(() => undefined);
    return {
      stop: finish,
      cancel: () => {
        if (!stopped) rec.cancel();
        stopped = true;
      },
    };
  }

  /** For screens / tests: switch the mics off for this session. */
  markUnavailable(): void {
    this._available.set(false);
  }
}
