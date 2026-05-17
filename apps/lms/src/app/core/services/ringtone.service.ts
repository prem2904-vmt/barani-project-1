import { Injectable, OnDestroy } from '@angular/core';

type Tone = 'ringback' | 'ringtone';

/**
 * Tiny synthesised-tone service for call audio cues. No asset files,
 * no autoplay-policy hoops — uses the Web Audio API to generate
 * dual-frequency tones on demand and loop them with the standard
 * telephone cadences:
 *
 *   ringback (caller-side, "calling…")  — 440 Hz + 480 Hz, 1 s on / 2 s off
 *   ringtone (callee-side, "incoming")  — 440 Hz + 480 Hz, 2 s on / 4 s off
 *                                          (a softer cadence with stereo wobble
 *                                           to mimic a phone ringer)
 *
 * The AudioContext is created lazily on first play() because browsers
 * require a user gesture to instantiate it without warning — by the time
 * we play either tone, the user has either clicked "Call" or seen an
 * incoming-call popup whose gesture (or pre-existing session interaction)
 * satisfies autoplay policy.
 */
@Injectable({ providedIn: 'root' })
export class RingtoneService implements OnDestroy {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private active: { stop: () => void } | null = null;

  /** Start a tone. Idempotent — calling with the same tone is a no-op. */
  play(tone: Tone): void {
    // Already playing the requested tone — leave it alone.
    if (this.active && (this.active as any)._tone === tone) return;
    this.stop();
    this.ensureCtx();
    if (!this.ctx || !this.master) return;

    const ctx = this.ctx;
    const out = this.master;
    let cancelled = false;

    // Cadence: [onSeconds, offSeconds]
    const cadence: [number, number] = tone === 'ringback' ? [1.0, 2.0] : [2.0, 4.0];
    const volume = tone === 'ringback' ? 0.10 : 0.16;

    const loop = (startAt: number) => {
      if (cancelled) return;
      // Two oscillators (440 + 480 Hz) layered → North-American ringer feel.
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const g = ctx.createGain();
      osc1.type = 'sine'; osc2.type = 'sine';
      osc1.frequency.value = 440;
      osc2.frequency.value = 480;
      g.gain.setValueAtTime(0, startAt);
      g.gain.linearRampToValueAtTime(volume, startAt + 0.02);
      g.gain.setValueAtTime(volume, startAt + cadence[0] - 0.02);
      g.gain.linearRampToValueAtTime(0, startAt + cadence[0]);
      osc1.connect(g); osc2.connect(g); g.connect(out);
      osc1.start(startAt); osc2.start(startAt);
      osc1.stop(startAt + cadence[0]);
      osc2.stop(startAt + cadence[0]);
      // Schedule the next on-cycle.
      const nextAt = startAt + cadence[0] + cadence[1];
      const msUntilNext = Math.max(0, (nextAt - ctx.currentTime - 0.05) * 1000);
      setTimeout(() => loop(nextAt), msUntilNext);
    };

    loop(ctx.currentTime + 0.05);
    this.active = { stop: () => { cancelled = true; } };
    (this.active as any)._tone = tone;
  }

  /** Stop whatever's currently playing (idempotent). */
  stop(): void {
    if (!this.active) return;
    this.active.stop();
    this.active = null;
  }

  private ensureCtx(): void {
    if (this.ctx) return;
    try {
      const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx!.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.ctx!.destination);
      // Browsers may start the context in a "suspended" state. resume() is a
      // no-op if it's already running; otherwise it kicks the engine alive
      // (succeeds because a user gesture preceded our first call).
      if (this.ctx!.state === 'suspended') void this.ctx!.resume();
    } catch { /* no audio support → silent fallback */ }
  }

  ngOnDestroy(): void {
    this.stop();
    try { void this.ctx?.close(); } catch { /* ignore */ }
    this.ctx = null;
    this.master = null;
  }
}
