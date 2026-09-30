import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import type { ConsultVitals } from './consult.api';
import { RxPopoverComponent } from './rx/rx-popover.component';

export type VitalKey = 'pulse' | 'bp' | 'temp' | 'spo2' | 'rr' | 'weight' | 'bmi';

/** In-room sanity bands — a flag (colour + arrow), never a block. */
export function vitalFlag(key: VitalKey, v: ConsultVitals | null | undefined): 'high' | 'low' | null {
  if (!v) return null;
  switch (key) {
    case 'pulse': return v.pulse == null ? null : v.pulse > 100 ? 'high' : v.pulse < 60 ? 'low' : null;
    case 'bp': return v.bpSys == null ? null : (v.bpSys >= 140 || (v.bpDia ?? 0) >= 90) ? 'high' : v.bpSys < 90 ? 'low' : null;
    case 'temp': return v.tempF == null ? null : +v.tempF > 99 ? 'high' : +v.tempF < 96.5 ? 'low' : null;
    case 'spo2': return v.spo2 == null ? null : v.spo2 < 94 ? 'low' : null;
    case 'rr': return v.respRate == null ? null : v.respRate > 20 ? 'high' : v.respRate < 12 ? 'low' : null;
    case 'bmi': { const b = bmiOf(v); return b == null ? null : b >= 25 ? 'high' : b < 18.5 ? 'low' : null; }
    default: return null;
  }
}

export function bmiOf(v: ConsultVitals | null | undefined): number | null {
  if (!v?.weightKg || !v?.heightCm) return null;
  const m = +v.heightCm / 100;
  return Math.round((+v.weightKg / (m * m)) * 10) / 10;
}

/** The numeric value of a vital (BP → systolic) for trends. */
export function vitalValue(key: VitalKey, v: ConsultVitals): number | null {
  switch (key) {
    case 'pulse': return v.pulse ?? null;
    case 'bp': return v.bpSys ?? null;
    case 'temp': return v.tempF != null ? +v.tempF : null;
    case 'spo2': return v.spo2 ?? null;
    case 'rr': return v.respRate ?? null;
    case 'weight': return v.weightKg != null ? +v.weightKg : null;
    case 'bmi': return bmiOf(v);
  }
}

export function vitalText(key: VitalKey, v: ConsultVitals | null | undefined): string {
  if (!v) return '—';
  switch (key) {
    case 'bp': return v.bpSys != null ? `${v.bpSys}/${v.bpDia ?? '—'}` : '—';
    case 'temp': return v.tempF != null ? String(+v.tempF) : '—';
    default: { const n = vitalValue(key, v); return n == null ? '—' : String(n); }
  }
}

const LABEL: Record<VitalKey, [string, string]> = {
  pulse: ['Pulse', 'bpm'], bp: ['BP', 'mmHg'], temp: ['Temp', '°F'], spo2: ['SpO₂', '%'], rr: ['RR', '/min'], weight: ['Weight', 'kg'], bmi: ['BMI', ''],
};

/**
 * The consult header's vitals strip (Agent C). The pulse heart beats at the
 * patient's REAL rate (animation period = 60 / BPM s) beside a small ECG
 * trace; SpO₂ is a ring; out-of-band values are flagged with colour + arrow.
 * Tapping a vital shows the previous visit's value and the trend over the
 * last visits. prefers-reduced-motion: static heart and trace.
 */
@Component({
  selector: 'pf-consult-vitals',
  standalone: true,
  imports: [DatePipe, RxPopoverComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (vitals(); as v) {
      <div class="vs" role="list" aria-label="Vitals">
        @for (k of keys(); track k) {
          <button type="button" class="vs__i" role="listitem" [class.vs__i--flag]="flag(k)" (click)="openTrend($event, k)"
                  [attr.aria-label]="label(k)[0] + ' ' + text(k) + ' ' + label(k)[1] + (flag(k) ? ', ' + flag(k) : '') + '. Show trend'">
            @if (k === 'pulse') {
              <svg class="vs__heart" [style.animation-duration.s]="beat()" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.5-9.3C1.1 8.3 3.2 4.5 7 4.5c2.1 0 3.6 1.2 5 3 1.4-1.8 2.9-3 5-3 3.8 0 5.9 3.8 4.5 7.2C19.5 16.4 12 21 12 21z"/></svg>
            }
            @if (k === 'spo2') {
              <svg class="vs__ring" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                <circle cx="10" cy="10" r="7.5" fill="none" stroke="var(--nd-line)" stroke-width="2.6"/>
                <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"
                        [attr.stroke-dasharray]="ringDash()" transform="rotate(-90 10 10)"/>
              </svg>
            }
            <span class="vs__k">{{ label(k)[0] }}</span>
            <span class="vs__v">{{ text(k) }}</span>
            @if (label(k)[1]) { <span class="vs__u">{{ label(k)[1] }}</span> }
            @if (flag(k) === 'high') { <svg class="vs__arr" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-label="high"><path d="M7 17 17 7M9 7h8v8"/></svg> }
            @if (flag(k) === 'low') { <svg class="vs__arr" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-label="low"><path d="M7 7l10 10M17 9v8H9"/></svg> }
            @if (k === 'pulse') {
              <svg class="vs__ecg" [style.animation-duration.s]="beat() * 2" width="48" height="18" viewBox="0 0 48 18" aria-hidden="true">
                <path d="M0 10h8l2-3 2 3h3l2-9 3 16 2-7h6l2-2 2 2h16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
              </svg>
            }
          </button>
        }
        <span class="vs__who">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>
          {{ v.recordedByName || 'Recorded' }} · {{ v.recordedAt | date:'h:mm a' }}
        </span>
      </div>
    } @else {
      <div class="vs vs--none">
        <span class="vs__none">No vitals recorded for this visit yet.</span>
      </div>
    }

    @if (trend(); as t) {
      <pf-rx-popover [anchor]="t.anchor" [title]="label(t.key)[0] + ' — last visits'" [minWidth]="260" (closed)="trend.set(null)">
        <div class="vt">
          @if (previous(t.key); as p) {
            <p class="vt__prev">Previous visit ({{ p.visitDate | date:'MMM d' }}): <b>{{ vtext(t.key, p) }} {{ label(t.key)[1] }}</b></p>
          } @else { <p class="vt__prev">No earlier value on record.</p> }
          @if (spark(t.key); as s) {
            <svg class="vt__spark" viewBox="0 0 220 56" width="220" height="56" role="img" [attr.aria-label]="label(t.key)[0] + ' trend'">
              <polyline [attr.points]="s.points" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
              @for (d of s.dots; track $index) { <circle [attr.cx]="d.x" [attr.cy]="d.y" r="3" fill="currentColor"/> }
            </svg>
            <div class="vt__vals">@for (h of s.rows; track $index) { <span>{{ h.date | date:'MMM d' }} · <b>{{ h.text }}</b></span> }</div>
          }
        </div>
      </pf-rx-popover>
    }
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .vs { display: flex; align-items: center; gap: 4px 0; overflow-x: auto; scrollbar-width: none; padding: 8px 16px; min-height: 48px; }
    .vs::-webkit-scrollbar { display: none; }
    .vs__i { flex: none; display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 12px; border: 0; background: transparent;
      border-right: 1px solid var(--nd-line); color: var(--text-primary); font: inherit; cursor: pointer; border-radius: 0; }
    .vs__i:hover, .vs__i:focus-visible { background: var(--nd-chip-bg); outline: none; border-radius: 8px; }
    .vs__k { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-tertiary); }
    .vs__v { font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .vs__u { font-size: 12px; color: var(--text-tertiary); }
    .vs__i--flag .vs__v, .vs__i--flag .vs__arr { color: #c2410c; }
    :host-context(html.dark) .vs__i--flag .vs__v, :host-context(html.dark) .vs__i--flag .vs__arr { color: #fb923c; }
    .vs__heart { color: #e11d48; transform-origin: 50% 55%; animation: vs-beat 0.71s ease-in-out infinite; }
    @keyframes vs-beat { 0%, 60%, 100% { transform: scale(1); } 15% { transform: scale(1.18); } 30% { transform: scale(0.96); } 45% { transform: scale(1.08); } }
    .vs__ecg { color: #e11d48; stroke-dasharray: 90; animation: vs-ecg 1.4s linear infinite; }
    @keyframes vs-ecg { from { stroke-dashoffset: 90; } to { stroke-dashoffset: -90; } }
    .vs__ring { color: #0d9488; }
    .vs__i--flag .vs__ring { color: #c2410c; }
    .vs__who { flex: none; margin-left: auto; display: inline-flex; align-items: center; gap: 6px; padding-left: 16px; font-size: 12.5px; color: var(--text-tertiary); white-space: nowrap; }
    .vs__who svg { color: var(--violet-text, #6d28d9); }
    .vs--none { color: var(--text-tertiary); font-size: 13px; }
    .vt { display: flex; flex-direction: column; gap: 8px; padding: 0 4px 4px; color: var(--violet-text, #6d28d9); }
    .vt__prev { margin: 0; font-size: 13px; color: var(--text-secondary); }
    .vt__prev b { color: var(--text-primary); font-weight: 600; }
    .vt__vals { display: flex; flex-direction: column; gap: 2px; font-size: 12.5px; color: var(--text-secondary); }
    .vt__vals b { color: var(--text-primary); font-variant-numeric: tabular-nums; }
    @media (prefers-reduced-motion: reduce) { .vs__heart, .vs__ecg { animation: none !important; stroke-dasharray: none; } }
    @media (pointer: coarse) { .vs__i { min-height: 44px; } }
  `],
})
export class ConsultVitalsComponent {
  readonly vitals = input<ConsultVitals | null>(null);
  /** The patient's recent captures across visits (newest first, incl. today's). */
  readonly history = input<ConsultVitals[]>([]);

  readonly trend = signal<{ key: VitalKey; anchor: HTMLElement } | null>(null);

  readonly keys = computed<VitalKey[]>(() => {
    const v = this.vitals();
    const all: VitalKey[] = ['pulse', 'bp', 'temp', 'spo2', 'rr', 'weight', 'bmi'];
    return all.filter(k => (k === 'bmi' ? bmiOf(v) != null : vitalText(k, v) !== '—'));
  });
  /** One beat's period in seconds at the patient's real rate. */
  readonly beat = computed(() => { const p = this.vitals()?.pulse; return p && p > 20 ? Math.round((60 / p) * 1000) / 1000 : 0.8; });
  readonly ringDash = computed(() => {
    const s = Math.max(0, Math.min(100, this.vitals()?.spo2 ?? 0));
    const c = 2 * Math.PI * 7.5;
    return `${(c * s) / 100} ${c}`;
  });

  label(k: VitalKey) { return LABEL[k]; }
  text(k: VitalKey) { return vitalText(k, this.vitals()); }
  vtext(k: VitalKey, v: ConsultVitals) { return vitalText(k, v); }
  flag(k: VitalKey) { return vitalFlag(k, this.vitals()); }

  openTrend(e: Event, key: VitalKey) { this.trend.set({ key, anchor: e.currentTarget as HTMLElement }); }

  /** Latest capture from a DIFFERENT visit than today's. */
  previous(key: VitalKey): ConsultVitals | null {
    const cur = this.vitals();
    return this.history().find(h => h.visitId !== cur?.visitId && vitalValue(key, h) != null) ?? null;
  }

  spark(key: VitalKey) {
    const pts = this.history().filter(h => vitalValue(key, h) != null).slice(0, 8).reverse();
    if (pts.length < 2) return null;
    const vals = pts.map(p => vitalValue(key, p) as number);
    const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
    const dots = vals.map((v, i) => ({ x: 8 + (i * 204) / (vals.length - 1), y: 48 - ((v - lo) / span) * 40 }));
    return {
      points: dots.map(d => `${d.x.toFixed(1)},${d.y.toFixed(1)}`).join(' '),
      dots,
      rows: pts.slice().reverse().slice(0, 4).map(p => ({ date: p.visitDate || p.recordedAt, text: vitalText(key, p) })),
    };
  }
}
