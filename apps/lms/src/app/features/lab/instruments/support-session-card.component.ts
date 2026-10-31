import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import {
  DEFAULT_SUPPORT_MINUTES, SUPPORT_DURATIONS, SupportSessionService, countdownText, endedText, spacedCode,
} from '../../../shared/instruments/support-session.service';
import { SupportLogEntry } from '../../../shared/instruments/instrument.models';

/** The tag after a log line, in words (never colour alone). */
export function outcomeWord(o: string): string | null {
  switch (o) {
    case 'approved': return 'Allowed';
    case 'denied': return 'Denied';
    case 'refused': return 'Refused';
    case 'failed': return 'Didn’t work';
    default: return null;
  }
}

/**
 * Instruments → "Prefrontal support" card (beta `support`). Desktop app only:
 * the lab starts a session, reads the 6-digit code to Prefrontal support,
 * watches every action live and can Stop at any time. Changes are asked in
 * the PC's own dialog (main), never here — this card only says so. On the
 * web it explains that support runs in the desktop app.
 */
@Component({
  selector: 'pf-support-session-card',
  standalone: true,
  imports: [SelectComponent, BusyDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (svc.visible()) {
      <section class="pf-card pf-sup" aria-labelledby="pf-sup-title" data-testid="support-card">
        <header class="pf-card__head">
          <span class="pf-card__icon" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/><path d="M19 20a4 4 0 0 1-4 3h-2"/></svg>
          </span>
          <h2 class="pf-card__label" id="pf-sup-title">Prefrontal support</h2>
          @if (st().active) {
            <span class="pf-card__spacer"></span>
            <span class="pf-sup__live"><span class="pf-sup__dot" aria-hidden="true"></span>{{ st().supportJoined ? 'Connected' : 'Waiting' }}</span>
          }
        </header>

        <div class="pf-card__body pf-sup__body">
          @if (!svc.desktop) {
            <p class="pf-sup__lead">Remote support is available in the desktop app. Open Prefrontal on the PC the analyzer is cabled to, then come back to Lab settings → Instruments.</p>
          } @else if (!st().active) {
            <p class="pf-sup__lead">On the phone with Prefrontal support? Let them look at this PC’s network, firewall and analyzer connections.</p>
            <ul class="pf-sup__points">
              <li>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Z"/></svg>
                <span>Nothing opens on this PC — the app calls Prefrontal, only while the session runs.</span>
              </li>
              <li>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                <span>Every change asks you on this PC first. You can stop at any time.</span>
              </li>
            </ul>
            <div class="pf-field">
              <span class="pf-field__lbl" id="pf-sup-dur">For how long</span>
              <pf-select [options]="durations" [value]="minutes()" (valueChange)="minutes.set($event)" aria-labelledby="pf-sup-dur"></pf-select>
            </div>
            @if (ended()) { <p class="pf-field__hint">{{ ended() }}</p> }
            @if (error()) { <p class="pf-sup__err" role="alert">{{ error() }}</p> }
          } @else {
            <div class="pf-sup__codebox">
              <span class="pf-sup__k">Support code</span>
              <span class="pf-sup__code pf-num" data-testid="support-code">{{ code() }}</span>
              <span class="pf-sup__hint">Read this code to Prefrontal support.</span>
            </div>
            <dl class="pf-sup__facts">
              <div class="pf-sup__fact"><dt>Status</dt><dd class="pf-sup__who" data-testid="support-status">{{ statusText() }}</dd></div>
              <div class="pf-sup__fact"><dt>Ends in</dt><dd class="pf-num" data-testid="support-countdown">{{ countdown() }}</dd></div>
            </dl>
            @if (st().approval) {
              <div class="pf-sup__ask" role="alert" data-testid="support-approval">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Z"/><path d="M12 9v4M12 16h.01"/></svg>
                <div>
                  <p class="pf-sup__ask-title">Your answer is needed on this PC</p>
                  <p class="pf-sup__ask-body">{{ st().approval!.message }} Choose Allow or Deny in the window that opened.</p>
                </div>
              </div>
            }
            @if (st().signedOut) {
              <p class="pf-sup__err" role="status">Prefrontal can’t confirm your sign-in. Keep the app open and signed in, or the session ends in a few minutes.</p>
            }
            <h3 class="pf-sup__sec">Activity</h3>
            @if (log().length) {
              <ol class="pf-sup__log" aria-live="polite" data-testid="support-log">
                @for (l of log(); track $index) {
                  <li class="pf-sup__row">
                    <span class="pf-sup__time pf-num">{{ time(l.at) }}</span>
                    <span class="pf-sup__text">{{ l.text }}</span>
                    @if (outcomeWord(l.outcome)) {
                      <span class="pf-sup__tag" [attr.data-outcome]="l.outcome">{{ outcomeWord(l.outcome) }}</span>
                    }
                  </li>
                }
              </ol>
            } @else {
              <p class="pf-field__hint">Nothing yet. Every look and change shows here.</p>
            }
          }
        </div>

        @if (svc.desktop) {
          <div class="pf-card__foot">
            @if (!st().active) {
              <button type="button" class="pf-btn pf-btn--secondary pf-span press" data-testid="support-start"
                      [disabled]="busy()" [pfBusy]="busy()" pfBusyLabel="Starting…" (click)="start()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/></svg>
                Allow Prefrontal support
              </button>
            } @else {
              <button type="button" class="pf-btn pf-btn--danger pf-span press" data-testid="support-stop"
                      [disabled]="busy()" [pfBusy]="busy()" pfBusyLabel="Stopping…" (click)="stop()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                Stop support session
              </button>
            }
          </div>
        }
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .pf-sup__body { gap: 12px; }
    .pf-sup__lead { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-secondary); text-wrap: pretty; }
    .pf-sup__points { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; font-size: 12.5px; line-height: 1.45; color: var(--text-secondary); }
    .pf-sup__points li { display: flex; align-items: flex-start; gap: 8px; }
    .pf-sup__points svg { flex: none; margin-top: 1px; color: var(--violet-text, #7c3aed); }
    .pf-sup__live { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--violet-text, #7c3aed); white-space: nowrap; }
    .pf-sup__dot { width: 7px; height: 7px; border-radius: 999px; background: currentColor; }
    @media (prefers-reduced-motion: no-preference) { .pf-sup__dot { animation: pf-sup-pulse 1.6s ease-in-out infinite; } }
    @keyframes pf-sup-pulse { 50% { opacity: .35; } }
    .pf-sup__codebox { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 14px 12px; border-radius: 12px;
      border: 1px solid var(--pf-line); background: var(--pf-chip-bg, transparent); }
    .pf-sup__k { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-sup__code { font-size: 34px; line-height: 1.1; font-weight: 700; letter-spacing: .08em; color: var(--text-primary); font-variant-numeric: tabular-nums; }
    .pf-sup__hint { font-size: 12.5px; color: var(--text-secondary); text-align: center; }
    .pf-sup__facts { margin: 0; display: grid; }
    .pf-sup__fact { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 8px 2px; border-bottom: 1px solid var(--pf-line); }
    .pf-sup__fact dt { font-size: 12.5px; color: var(--text-tertiary); flex: none; }
    .pf-sup__fact dd { margin: 0; font-size: 13px; font-weight: 500; color: var(--text-primary); text-align: right; min-width: 0; overflow-wrap: anywhere; }
    .pf-sup__ask { display: flex; align-items: flex-start; gap: 10px; padding: 12px; border-radius: 12px;
      border: 1px solid color-mix(in srgb, var(--violet-text, #7c3aed) 40%, var(--pf-line)); background: color-mix(in srgb, var(--violet-text, #7c3aed) 8%, transparent); }
    .pf-sup__ask svg { flex: none; margin-top: 1px; color: var(--violet-text, #7c3aed); }
    .pf-sup__ask-title { margin: 0 0 2px; font-size: 13.5px; font-weight: 600; color: var(--text-primary); }
    .pf-sup__ask-body { margin: 0; font-size: 12.5px; line-height: 1.45; color: var(--text-secondary); text-wrap: pretty; }
    .pf-sup__err { margin: 0; font-size: 12.5px; line-height: 1.45; color: var(--red-text, #b91c1c); }
    .pf-sup__sec { margin: 4px 0 0; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-sup__log { list-style: none; margin: 0; padding: 0; display: grid; max-height: 240px; overflow-y: auto; }
    .pf-sup__row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px; align-items: baseline; padding: 7px 2px; border-bottom: 1px solid var(--pf-line); font-size: 12.5px; line-height: 1.4; }
    .pf-sup__time { color: var(--text-tertiary); font-size: 11.5px; }
    .pf-sup__text { color: var(--text-primary); overflow-wrap: anywhere; }
    .pf-sup__tag { font-size: 11px; font-weight: 600; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--pf-line); color: var(--text-secondary); white-space: nowrap; }
    .pf-sup__tag[data-outcome='approved'] { color: var(--violet-text, #7c3aed); border-color: color-mix(in srgb, var(--violet-text, #7c3aed) 35%, var(--pf-line)); }
    .pf-sup__tag[data-outcome='denied'], .pf-sup__tag[data-outcome='failed'], .pf-sup__tag[data-outcome='refused'] { color: var(--red-text, #b91c1c); }
    /* ND §12: card labels stay 12px on phones — beat the global phone heading cap. */
    @media (max-width: 640px) {
      .pf-card__label { font-size: 12px !important; line-height: 1.3 !important; }
      .pf-sup__sec { font-size: 11px !important; line-height: 1.3 !important; }
    }
  `],
})
export class SupportSessionCardComponent {
  protected readonly svc = inject(SupportSessionService);
  protected readonly durations: PfSelectOption<number>[] = SUPPORT_DURATIONS.map((d) => ({ value: d.value, label: d.label }));
  protected readonly outcomeWord = outcomeWord;

  readonly minutes = signal(DEFAULT_SUPPORT_MINUTES);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  private readonly now = signal(Date.now());

  readonly st = this.svc.state;
  readonly code = computed(() => spacedCode(this.st().code));
  readonly countdown = computed(() => countdownText(this.st().expiresAt, this.now()));
  readonly log = computed<SupportLogEntry[]>(() => this.st().log ?? []);
  readonly statusText = computed(() => {
    const s = this.st();
    if (!s.supportJoined) return 'Waiting for support to join';
    return s.joinedBy ? `Support joined: ${s.joinedBy}` : 'Prefrontal support is connected';
  });
  readonly ended = computed(() => (this.st().status === 'ended' ? endedText(this.st().endedReason) : null));

  constructor() {
    // A one-second tick only while a session runs (the countdown).
    let timer: ReturnType<typeof setInterval> | null = null;
    effect(() => {
      const on = this.st().active;
      if (on && !timer) timer = setInterval(() => this.now.set(Date.now()), 1000);
      if (!on && timer) { clearInterval(timer); timer = null; }
    });
    inject(DestroyRef).onDestroy(() => { if (timer) clearInterval(timer); });
  }

  protected time(at: string): string {
    const d = new Date(at);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  }

  async start(): Promise<void> {
    if (this.busy()) return;
    this.error.set(null);
    this.busy.set(true);
    try {
      const err = await this.svc.start(this.minutes());
      if (err) this.error.set(err);
    } finally {
      this.busy.set(false);
    }
  }

  async stop(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try { await this.svc.stop(); } finally { this.busy.set(false); }
  }
}
