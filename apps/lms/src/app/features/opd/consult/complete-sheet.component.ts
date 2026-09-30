import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import type { OpdDiagnosis } from '../shared/opd.models';
import { lineShort } from '../shared/rx-schedule';
import type { ConsultInvestigationItem } from './consult.api';
import type { ConsultRxLine } from './rx/rx-model';

/** Follow-up quick picks (days; null = none). */
export const FOLLOW_UP_PICKS: readonly { days: number | null; label: string }[] = [
  { days: 5, label: '5 days' }, { days: 7, label: '1 week' }, { days: 14, label: '2 weeks' }, { days: null, label: 'None' },
];

/** The follow-up fee sentence for a pick under the service's rule. */
export function followUpFeeText(days: number | null, rule: { withinDays: number; fee?: number | null } | null): string {
  if (days == null) return 'No follow-up booked.';
  if (!rule) return 'Booked as a new visit — this service has no follow-up rule, the usual fee applies.';
  if (days <= rule.withinDays) return `Within the ${rule.withinDays}-day follow-up window — ${rule.fee ? '₹' + rule.fee : 'free'}.`;
  return `Outside the ${rule.withinDays}-day follow-up window — the usual fee applies.`;
}

/** yyyy-MM-dd of `start` + days (local calendar). */
export function addDaysIso(start: Date, days: number): string {
  const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * "Complete consult" — the summary of everything the consult sends out
 * (Agent C): diagnosis, pharmacy lines, lab tests + price, follow-up (quick
 * picks + the fee rule), an unresolved-allergy warning (blocks sending), and
 * the next-phase outputs shown as not built yet. A right-side sheet on
 * desktop, a bottom sheet on phones.
 */
@Component({
  selector: 'pf-consult-complete-sheet',
  standalone: true,
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cs-back" (click)="cancel.emit()" aria-hidden="true"></div>
    <aside class="cs" role="dialog" aria-modal="true" aria-labelledby="cs-title" (keydown.escape)="cancel.emit()">
      <span class="cs__handle" aria-hidden="true"></span>
      <header class="cs__head">
        <div>
          <h2 id="cs-title" class="cs__t">Complete consult</h2>
          <p class="cs__s">{{ patientName() }} · Token {{ token() }}</p>
        </div>
        <button type="button" class="cs__x" (click)="cancel.emit()" aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </header>

      <div class="cs__body">
        @if (unresolved() > 0) {
          <div class="cs__warn" role="alert">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>
            <span>{{ unresolved() }} medicine{{ unresolved() === 1 ? '' : 's' }} conflict{{ unresolved() === 1 ? 's' : '' }} with a recorded allergy. Swap it or mark it "Keep, reviewed" on the prescription first.</span>
          </div>
        }

        <section class="cs__row">
          <span class="cs__ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3v6a4 4 0 0 0 8 0V3"/><path d="M8 15a5 5 0 0 0 5 5h1a4 4 0 0 0 4-4v-2"/><circle cx="19" cy="10" r="2"/></svg></span>
          <div class="cs__c">
            <span class="cs__k">Diagnosis</span>
            @if (diagnoses().length) { <b>{{ dxText() }}</b><span class="cs__m">On the prescription and today's visit</span> }
            @else { <span class="cs__m">No diagnosis entered.</span> }
          </div>
        </section>

        <section class="cs__row">
          <span class="cs__ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 20.5a5 5 0 0 1-7-7l6-6a5 5 0 0 1 7 7z"/><path d="m8.5 8.5 7 7"/></svg></span>
          <div class="cs__c">
            <span class="cs__k">Pharmacy</span>
            @if (lines().length) {
              <b>{{ lines().length }} medicine{{ lines().length === 1 ? '' : 's' }}</b>
              @for (l of lines(); track l.key) { <span class="cs__line"><b>{{ l.drug.name }}</b> · {{ short(l) }}</span> }
              <span class="cs__m">Goes to the pharmacy queue with plain-language instructions.</span>
            } @else { <span class="cs__m">No medicines.</span> }
          </div>
        </section>

        <section class="cs__row">
          <span class="cs__ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6M10 3v6l-4.5 8.5A2 2 0 0 0 7.3 21h9.4a2 2 0 0 0 1.8-3.5L14 9V3"/></svg></span>
          <div class="cs__c">
            <span class="cs__k">Lab</span>
            @if (tests().length) {
              <b>{{ testNames() }}</b>
              <span class="cs__m">@if (testTotal() > 0) { ₹{{ testTotal() }} · }a normal lab order — billed at the desk, then Collect</span>
            } @else { <span class="cs__m">No tests.</span> }
          </div>
        </section>

        <section class="cs__row">
          <span class="cs__ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg></span>
          <div class="cs__c">
            <span class="cs__k">Follow-up</span>
            <div class="nd-seg cs__seg" role="radiogroup" aria-label="Follow-up">
              @for (p of picks; track p.label) {
                <button type="button" role="radio" class="nd-chip cs__pick" [class.on]="p.days === followUpDays()" [attr.aria-checked]="p.days === followUpDays()"
                        (click)="followUpDaysChange.emit(p.days)">{{ p.label }}</button>
              }
            </div>
            @if (followUpDays() != null) { <span class="cs__m">{{ followUpDate() | date:'EEE, MMM d' }} · {{ feeText() }}</span> }
            @else { <span class="cs__m">{{ feeText() }}</span> }
          </div>
        </section>

        <section class="cs__row cs__row--later">
          <span class="cs__ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span>
          <div class="cs__c">
            <span class="cs__k">Next phase</span>
            <span class="cs__m">Procedure note · Referral · IPD admission · Certificate · Consent — not built yet.</span>
          </div>
        </section>
      </div>

      <footer class="cs__foot">
        <button type="button" class="nd-btn nd-btn--secondary" (click)="cancel.emit()">Keep editing</button>
        <button type="button" class="nd-btn nd-btn--primary" [disabled]="busy() || unresolved() > 0" (click)="confirm.emit()">
          {{ busy() ? 'Sending…' : 'Complete & send' }}
        </button>
      </footer>
    </aside>
  `,
  styles: [`
    :host { position: fixed; inset: 0; z-index: 1100; }
    .cs-back { position: absolute; inset: 0; background: rgba(15, 23, 42, 0.32); animation: cs-fade 200ms ease both; }
    .cs { position: absolute; top: 12px; right: 12px; bottom: 12px; width: min(440px, calc(100vw - 24px)); display: flex; flex-direction: column;
      border-radius: 18px; background: var(--nd-card-bg); border: 1px solid var(--nd-line); box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
      animation: cs-in 240ms var(--nd-spring, ease) both; }
    :host-context(html.dark) .cs { box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6); }
    @keyframes cs-in { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: none; } }
    @keyframes cs-fade { from { opacity: 0; } to { opacity: 1; } }
    .cs__handle { display: none; }
    .cs__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 16px 16px 12px; border-bottom: 1px solid var(--nd-line); }
    .cs__t { margin: 0; font-size: 17px; font-weight: 600; color: var(--text-primary); }
    .cs__s { margin: 2px 0 0; font-size: 13px; color: var(--text-tertiary); }
    .cs__x { width: 40px; height: 40px; border: 0; border-radius: 10px; background: transparent; color: var(--text-secondary); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
    .cs__body { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 16px; }
    .cs__warn { display: flex; gap: 10px; align-items: flex-start; margin: 12px 0 4px; padding: 12px; border-radius: 12px; font-size: 13px; line-height: 1.45;
      background: color-mix(in srgb, var(--red-text, #dc2626) 8%, var(--nd-card-bg)); border: 1px solid color-mix(in srgb, var(--red-text, #dc2626) 30%, transparent); color: var(--text-primary); }
    .cs__warn svg { color: var(--red-text, #dc2626); flex: none; }
    .cs__row { display: flex; gap: 12px; padding: 14px 0; border-bottom: 1px solid var(--nd-line); }
    .cs__row:last-child { border-bottom: 0; }
    .cs__row--later { opacity: 0.75; }
    .cs__ico { flex: none; width: 32px; height: 32px; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center;
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 12%, transparent); color: var(--violet-text, #6d28d9); }
    .cs__c { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; font-size: 13.5px; color: var(--text-primary); }
    .cs__c > b { font-size: 15px; font-weight: 600; }
    .cs__k { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-tertiary); }
    .cs__m { font-size: 12.5px; color: var(--text-tertiary); line-height: 1.45; }
    .cs__line { font-size: 13px; line-height: 1.45; color: var(--text-secondary); }
    .cs__line b { color: var(--text-primary); font-weight: 600; }
    .cs__seg { display: flex; width: 100%; margin: 4px 0 2px; }
    .cs__pick { flex: 1; justify-content: center; min-height: 40px; border: 0; background: transparent; }
    .cs__pick.on { background: var(--nd-card-bg); box-shadow: var(--nd-shadow-sm); font-weight: 600; color: var(--text-primary); }
    .cs__foot { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 12px 16px 16px; border-top: 1px solid var(--nd-line); }
    @media (max-width: 640px) {
      .cs { top: auto; left: 0; right: 0; bottom: 0; width: auto; max-height: 92dvh; border-radius: 20px 20px 0 0;
        animation-name: cs-up; padding-bottom: env(safe-area-inset-bottom); }
      @keyframes cs-up { from { transform: translateY(40px); opacity: 0; } to { transform: none; opacity: 1; } }
      .cs__handle { display: block; width: 40px; height: 5px; margin: 8px auto 0; border-radius: 999px; background: var(--nd-line); }
    }
    @media (prefers-reduced-motion: reduce) { .cs, .cs-back { animation: none; } }
  `],
})
export class ConsultCompleteSheetComponent {
  readonly patientName = input('');
  /** The desk's doctor-prefixed token label ("E5") — never the bare number. */
  readonly token = input('');
  readonly diagnoses = input<OpdDiagnosis[]>([]);
  readonly lines = input<ConsultRxLine[]>([]);
  readonly tests = input<ConsultInvestigationItem[]>([]);
  readonly followUpDays = input<number | null>(null);
  readonly followUpRule = input<{ withinDays: number; fee?: number | null } | null>(null);
  readonly visitDate = input<Date>(new Date());
  readonly unresolved = input(0);
  readonly busy = input(false);

  readonly followUpDaysChange = output<number | null>();
  readonly confirm = output<void>();
  readonly cancel = output<void>();

  readonly picks = FOLLOW_UP_PICKS;
  readonly dxText = computed(() => this.diagnoses().map(d => d.label).join(', '));
  readonly testNames = computed(() => this.tests().map(t => t.name).join(', '));
  readonly testTotal = computed(() => this.tests().reduce((a, t) => a + (Number(t.price) || 0), 0));
  readonly feeText = computed(() => followUpFeeText(this.followUpDays(), this.followUpRule()));
  readonly followUpDate = computed(() => { const d = this.followUpDays(); return d == null ? null : addDaysIso(this.visitDate(), d); });
  short(l: ConsultRxLine) { return lineShort(l.line, l.drug); }
}
