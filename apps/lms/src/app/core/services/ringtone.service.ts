import { Injectable, OnDestroy, signal } from '@angular/core';

type Tone = 'ringback' | 'ringtone';

const MUTE_STORAGE_KEY = 'pf.chat.sounds.muted';

/**
 * Tiny Web Audio service for call cues + chat pings. No asset files —
 * every sound is synthesised on the fly so the bundle stays lean and
 * the build never depends on external mp3/ogg files.
 *
 * Sounds:
 *   - ringtone  (callee-side incoming-call ring)
 *       4-note rising arpeggio (E maj7: E5 → G#5 → B5 → D#6) layered
 *       with a soft sine pad. ~1.2s pattern, ~1.8s silence, loops.
 *       Distinctive enough to recognise across a noisy floor without
 *       being the cliché telephone bell.
 *
 *   - ringback  (caller-side "calling…" tone)
 *       Single warm sine pulse at A4 (440Hz) with a slow attack/decay.
 *       0.8s on / 1.6s off. Quieter than the ringtone — it's a status
 *       cue, not an alert.
 *
 *   - ping       (new-message notification, one-shot)
 *       Two-note chime C6 → G6 with overlapping bell envelopes. ~280ms.
 *       Modeled on Slack/Teams: short, pleasant, clearly "incoming
 *       message" without breaking concentration.
 *
 * Browsers require a user gesture before AudioContext starts. play()
 * is idempotent; calling play() before a gesture lazily creates the
 * ctx, which then unlocks on the next gesture (Accept Call, Send, etc.).
 */
@Injectable({ providedIn: 'root' })
export class RingtoneService implements OnDestroy {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private active: { stop: () => void; tone: Tone } | null = null;

  /**
   * User-controlled mute. When true, both play() and playPing() are
   * no-ops. Visual notifications (browser Notification, title flash)
   * are unaffected — those live in ChatNotifyService. Persisted across
   * reloads via localStorage so a quiet ward stays quiet.
   */
  readonly muted = signal<boolean>(this.loadMuted());

  toggleMute(): void { this.setMuted(!this.muted()); }
  setMuted(next: boolean): void {
    this.muted.set(next);
    try { localStorage.setItem(MUTE_STORAGE_KEY, next ? '1' : '0'); } catch { /* private mode */ }
    if (next) this.stop();
  }
  private loadMuted(): boolean {
    try { return localStorage.getItem(MUTE_STORAGE_KEY) === '1'; }
    catch { return false; }
  }

  /** Start a looping tone. Idempotent on the same tone. No-op when muted. */
  play(tone: Tone): void {
    if (this.muted()) return;
    if (this.active?.tone === tone) return;
    this.stop();
    this.ensureCtx();
    if (!this.ctx || !this.master) return;

    let cancelled = false;
    const cycleMs = tone === 'ringtone' ? 3000 : 2400;
    const start = () => {
      if (cancelled) return;
      const t0 = this.ctx!.currentTime + 0.02;
      if (tone === 'ringtone') this.scheduleRingtoneCycle(t0);
      else this.scheduleRingbackCycle(t0);
      setTimeout(start, cycleMs);
    };
    start();

    this.active = { tone, stop: () => { cancelled = true; } };
  }

  /** Short one-shot chime for new chat messages. ~280ms. No-op when muted. */
  playPing(): void {
    if (this.muted()) return;
    this.ensureCtx();
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + 0.01;
    // C6 (1047) → G6 (1568), bell envelopes overlapping ~120ms apart.
    this.scheduleBellNote(1046.5, t0,         0.30, 0.20);
    this.scheduleBellNote(1567.98, t0 + 0.12, 0.28, 0.22);
  }

  stop(): void {
    if (!this.active) return;
    this.active.stop();
    this.active = null;
  }

  // ── Pattern schedulers ─────────────────────────────────────────────

  /** 4-note rising motif (E major-ish), layered with a soft pad. */
  private scheduleRingtoneCycle(t0: number): void {
    // E5, G#5, B5, D#6 — bright open-voicing major-7 feel.
    const motif = [659.25, 830.61, 987.77, 1244.51];
    const noteSpacing = 0.16;       // sec between attacks
    const noteDuration = 0.40;
    motif.forEach((freq, i) => {
      const t = t0 + i * noteSpacing;
      this.scheduleBellNote(freq, t, noteDuration, 0.16);
    });
    // Brief sub-pad underneath for warmth (low fifth, slow attack).
    this.schedulePadNote(164.81 /* E3 */, t0 + 0.04, noteSpacing * motif.length + 0.25, 0.08);
  }

  /** Single soft pulse at A4 — calm "calling…" cue. */
  private scheduleRingbackCycle(t0: number): void {
    this.schedulePadNote(440, t0, 0.80, 0.12);
  }

  // ── Voice helpers ──────────────────────────────────────────────────

  /**
   * Bell-like note: sine fundamental + sine octave (mixed quieter) +
   * fast attack, exponential decay. Creates a pleasing pluck without
   * sounding metallic.
   */
  private scheduleBellNote(freq: number, t: number, dur: number, peakGain: number): void {
    const ctx = this.ctx!;
    const out = this.master!;

    // Fundamental
    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = freq;

    // Octave above, quieter — gives sparkle, no chord clash.
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freq * 2;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peakGain, t + 0.012);          // fast attack
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);              // exponential decay

    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.exponentialRampToValueAtTime(peakGain * 0.35, t + 0.012);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.7);       // octave decays faster

    osc1.connect(g);  g.connect(out);
    osc2.connect(g2); g2.connect(out);
    osc1.start(t); osc2.start(t);
    osc1.stop(t + dur + 0.05);
    osc2.stop(t + dur + 0.05);
  }

  /**
   * Pad note: triangle wave with slow attack & slow release. Used as
   * the ringback main voice and as the sub-pad under the ringtone.
   */
  private schedulePadNote(freq: number, t: number, dur: number, peakGain: number): void {
    const ctx = this.ctx!;
    const out = this.master!;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peakGain, t + 0.08);           // slow attack
    g.gain.setValueAtTime(peakGain, t + dur - 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);              // slow release

    osc.connect(g); g.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // ── Context lifecycle ──────────────────────────────────────────────

  private ensureCtx(): void {
    if (this.ctx) return;
    try {
      const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx!.createGain();
      // Master is intentionally below 1.0 so layered notes don't clip.
      this.master.gain.value = 0.7;
      this.master.connect(this.ctx!.destination);
      // Browsers may park the ctx in 'suspended' until a user gesture.
      // resume() succeeds when called inside the gesture handler that
      // invoked play(); otherwise it'll unlock on the next gesture.
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
