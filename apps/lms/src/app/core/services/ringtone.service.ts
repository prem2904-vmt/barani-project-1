import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { SessionScopeService } from '../auth/session-scope.service';

type Tone = 'ringback' | 'ringtone';

const MUTE_STORAGE_KEY = 'pf.chat.sounds.muted';

/**
 * Tiny Web Audio service for call cues + chat pings. No asset files —
 * every sound is synthesised on the fly so the bundle stays lean and
 * the build never depends on external mp3/ogg files.
 *
 * Sounds (deliberately soft — this is a lab floor, not a call centre):
 *   - ringtone  (callee-side incoming-call ring)
 *       Warm two-note chime motif: G5 (784Hz) then E5 (659Hz), each with
 *       a ~10ms attack and a long exponential decay, doubled one octave
 *       below at low gain for warmth and rounded off with a gentle
 *       lowpass. The motif plays twice ~350ms apart, then rests ~2.2s
 *       before the cycle repeats. Peak gain stays at or below 0.18 —
 *       noticeably softer than a phone ring.
 *
 *   - ringback  (caller-side "calling…" tone)
 *       Even softer: a single mellow 440Hz sine that fades in and out
 *       over ~300ms each side, about 1s on, repeating every 3s. Peak
 *       gain at or below 0.1 — a status cue, not an alert.
 *
 *   - ping       (new-message notification, one-shot)
 *       A single soft high chime at E6 with a ~150ms decay, gain at or
 *       below 0.12. Short and pleasant without breaking concentration.
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

  /** Minimum value for exponential ramps — never ramp to a true 0. */
  private static readonly SILENT = 0.0001;

  private readonly scope = inject(SessionScopeService);

  /**
   * "Message sounds" mute (the sounds toggle on /messages). Silences the
   * message ping + soft tick ONLY — an incoming CALL still rings: a call
   * needs answering, and the old behaviour (the chat toggle silencing calls,
   * even killing a live ring) produced silent missed calls. Busy / DND
   * presence is what blocks calls (server-side). Persisted PER ACCOUNT
   * (`pf.chat.sounds.muted:<tenant>:<user>`) — one person muting a shared
   * machine no longer silences the next.
   */
  readonly muted = signal<boolean>(this.loadMuted());

  constructor() {
    // Account switch: that account's own preference.
    this.scope.onChange(() => { this.stop(); this.muted.set(this.loadMuted()); });
    this.armUnlock();
  }

  toggleMute(): void { this.setMuted(!this.muted()); }
  setMuted(next: boolean): void {
    this.muted.set(next);
    if (!this.scope.identity()) return;
    try { localStorage.setItem(this.scope.storageKey(MUTE_STORAGE_KEY), next ? '1' : '0'); } catch { /* private mode */ }
  }
  private loadMuted(): boolean {
    if (!this.scope.identity()) return false;
    try {
      const key = this.scope.storageKey(MUTE_STORAGE_KEY);
      // One-time move of the old device-wide flag to the first account.
      const legacy = localStorage.getItem(MUTE_STORAGE_KEY);
      if (legacy !== null) {
        if (localStorage.getItem(key) === null) localStorage.setItem(key, legacy);
        localStorage.removeItem(MUTE_STORAGE_KEY);
      }
      return localStorage.getItem(key) === '1';
    } catch { return false; }
  }

  /**
   * Autoplay unlock. A context created before any user gesture is born
   * 'suspended' and nothing ever resumed it — so if the first ping arrived
   * before a click, message sounds stayed silent all session. Resume on
   * every gesture until the context is running.
   */
  private armUnlock(): void {
    if (typeof document === 'undefined') return;
    const events = ['pointerdown', 'keydown', 'touchstart'] as const;
    const unlock = () => {
      this.ensureCtx();
      const ctx = this.ctx;
      if (!ctx) return;
      if (ctx.state === 'running') { events.forEach(e => document.removeEventListener(e, unlock, true)); return; }
      void ctx.resume().then(() => {
        if (ctx.state === 'running') events.forEach(e => document.removeEventListener(e, unlock, true));
      }).catch(() => undefined);
    };
    events.forEach(e => document.addEventListener(e, unlock, { capture: true, passive: true }));
  }

  /** Last ping time — bursts (a pasted multi-line, 5 quick messages) make ONE sound. */
  private lastPingAt = 0;
  private static readonly PING_GAP_MS = 1200;
  private burstGuard(): boolean {
    const now = Date.now();
    if (now - this.lastPingAt < RingtoneService.PING_GAP_MS) return false;
    this.lastPingAt = now;
    return true;
  }

  /** Start a looping call tone. Idempotent on the same tone. NOT affected
   *  by the message-sounds mute (see `muted`). */
  play(tone: Tone): void {
    if (this.active?.tone === tone) return;
    this.stop();
    this.ensureCtx();
    if (!this.ctx || !this.master) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);

    let cancelled = false;
    // ringtone: two motif plays (~1.2s) + ~2.2s rest. ringback: 1s tone
    // every 3s. Nodes are created fresh per cycle and self-release on
    // stop, so long calls never accumulate audio-graph garbage.
    const cycleMs = tone === 'ringtone' ? 4200 : 3000;
    const start = () => {
      if (cancelled || !this.ctx) return;
      const t0 = this.ctx.currentTime + 0.02;
      if (tone === 'ringtone') this.scheduleRingtoneCycle(t0);
      else this.scheduleRingbackCycle(t0);
      timer = setTimeout(start, cycleMs);
    };
    let timer: ReturnType<typeof setTimeout> | null = null;
    start();

    this.active = { tone, stop: () => { cancelled = true; if (timer) clearTimeout(timer); } };
  }

  /** Soft one-shot chime for a new message you are NOT looking at. ~200ms.
   *  No-op when muted; one per burst. */
  playPing(): void {
    if (this.muted() || !this.burstGuard()) return;
    this.ensureCtx();
    if (!this.ctx || !this.master) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    const t0 = this.ctx.currentTime + 0.01;
    // Single gentle E6 chime — quick attack, ~150ms decay, quiet.
    this.scheduleChimeNote(1318.51 /* E6 */, t0, 0.16, 0.10);
  }

  /** Quieter, shorter tick for a message in the thread you have OPEN
   *  (Messenger-style "it arrived" cue; no pop-up). Same mute + burst rule. */
  playSoft(): void {
    if (this.muted() || !this.burstGuard()) return;
    this.ensureCtx();
    if (!this.ctx || !this.master) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    this.scheduleChimeNote(1046.5 /* C6 */, this.ctx.currentTime + 0.01, 0.09, 0.045);
  }

  /** Which looping tone is playing (tests / the ring controller). */
  activeTone(): Tone | null { return this.active?.tone ?? null; }

  stop(): void {
    if (!this.active) return;
    this.active.stop();
    this.active = null;
  }

  // ── Pattern schedulers ─────────────────────────────────────────────

  /** Warm two-note motif (G5 → E5), played twice, then silence. */
  private scheduleRingtoneCycle(t0: number): void {
    const motif = (t: number) => {
      this.scheduleChimeNote(783.99 /* G5 */, t,        0.62, 0.16);
      this.scheduleChimeNote(659.25 /* E5 */, t + 0.28, 0.66, 0.14);
    };
    motif(t0);
    motif(t0 + 0.28 + 0.66 + 0.35); // second play ~350ms after the first fades
  }

  /** Single mellow 440Hz sine — slow 300ms fade-in/out, ~1s on. */
  private scheduleRingbackCycle(t0: number): void {
    const ctx = this.ctx!;
    const out = this.master!;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 440;

    const g = ctx.createGain();
    const S = RingtoneService.SILENT;
    g.gain.setValueAtTime(S, t0);
    g.gain.exponentialRampToValueAtTime(0.09, t0 + 0.30);   // slow fade-in
    g.gain.setValueAtTime(0.09, t0 + 0.70);                 // ~1s on overall
    g.gain.exponentialRampToValueAtTime(S, t0 + 1.00);      // slow fade-out

    osc.connect(g); g.connect(out);
    osc.start(t0);
    osc.stop(t0 + 1.05);
    osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch { /* already gone */ } };
  }

  // ── Voice helpers ──────────────────────────────────────────────────

  /**
   * Soft chime voice: a lightly-detuned triangle fundamental plus a sine
   * one octave BELOW at low gain for warmth, both rolled off through a
   * gentle lowpass. Fast (~10ms) attack, long exponential decay. All
   * nodes are per-note and disconnect themselves when the note ends.
   */
  private scheduleChimeNote(freq: number, t: number, decay: number, peakGain: number): void {
    const ctx = this.ctx!;
    const out = this.master!;
    const S = RingtoneService.SILENT;

    // Fundamental — triangle for a rounder, mellower body than sine+octave.
    const osc1 = ctx.createOscillator();
    osc1.type = 'triangle';
    osc1.frequency.value = freq;
    osc1.detune.value = 4;               // light detune → gentle shimmer

    // One octave below, quiet — adds warmth without ringing.
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freq / 2;

    const g1 = ctx.createGain();
    g1.gain.setValueAtTime(S, t);
    g1.gain.exponentialRampToValueAtTime(peakGain, t + 0.01);       // ~10ms attack
    g1.gain.exponentialRampToValueAtTime(S, t + decay);             // long exp decay

    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(S, t);
    g2.gain.exponentialRampToValueAtTime(peakGain * 0.35, t + 0.012);
    g2.gain.exponentialRampToValueAtTime(S, t + decay * 0.85);

    // Gentle lowpass takes the edge off the triangle's upper harmonics.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(freq * 3.2, 4200);
    lp.Q.value = 0.5;

    osc1.connect(g1); g1.connect(lp);
    osc2.connect(g2); g2.connect(lp);
    lp.connect(out);

    osc1.start(t); osc2.start(t);
    osc1.stop(t + decay + 0.05);
    osc2.stop(t + decay + 0.05);
    osc1.onended = () => {
      try {
        osc1.disconnect(); osc2.disconnect();
        g1.disconnect(); g2.disconnect(); lp.disconnect();
      } catch { /* already gone */ }
    };
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
