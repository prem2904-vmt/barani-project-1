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

/** Trend vs the patient's previous visit: which way, and by how much. Pure. */
export function vitalDelta(key: VitalKey, cur: ConsultVitals | null | undefined, prev: ConsultVitals | null | undefined): { dir: 'up' | 'down' | 'same'; text: string } | null {
  if (!cur || !prev) return null;
  const a = vitalValue(key, cur), b = vitalValue(key, prev);
  if (a == null || b == null) return null;
  const d = Math.round((a - b) * 10) / 10;
  if (Math.abs(d) < (key === 'temp' || key === 'bmi' || key === 'weight' ? 0.2 : 1)) return { dir: 'same', text: 'Same as last visit' };
  return { dir: d > 0 ? 'up' : 'down', text: `${d > 0 ? 'Up' : 'Down'} ${Math.abs(d)} since last visit` };
}

/**
 * The consult header's vitals: a row of compact stat tiles — label, the big
 * number, its unit, a state word when out of band (High / Low, the tile
 * tinted) and a small arrow against the previous visit. The pulse heart beats
 * at the patient's REAL rate; SpO₂ carries a ring. Tapping a tile shows the
 * previous visit's value and the trend over the last visits. Reduced motion:
 * a still heart.
 */
@Component({
  selector: 'pf-consult-vitals',
  standalone: true,
  imports: [DatePipe, RxPopoverComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (vitals(); as v) {
      <div class="vs" role="list" aria-label="Today's vitals">
        @for (k of keys(); track k) {
          @let f = flag(k);
          @let d = delta(k);
          <button type="button" class="vs__t" role="listitem" [attr.data-flag]="f" (click)="openTrend($event, k)"
                  [attr.aria-label]="label(k)[0] + ' ' + text(k) + ' ' + label(k)[1] + (f ? ', ' + f : '') + (d ? ', ' + d.text : '') + '. Show trend'">
            <span class="vs__k">
              @if (k === 'pulse') {
                <svg class="vs__heart" [style.animation-duration.s]="beat()" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.5-9.3C1.1 8.3 3.2 4.5 7 4.5c2.1 0 3.6 1.2 5 3 1.4-1.8 2.9-3 5-3 3.8 0 5.9 3.8 4.5 7.2C19.5 16.4 12 21 12 21z"/></svg>
              }
              @if (k === 'spo2') {
                <svg class="vs__ring" width="13" height="13" viewBox="0 0 20 20" aria-hidden="true">
                  <circle cx="10" cy="10" r="7.5" fill="none" stroke="var(--nd-line)" stroke-width="3"/>
                  <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" [attr.stroke-dasharray]="ringDash()" transform="rotate(-90 10 10)"/>
                </svg>
              }
              {{ label(k)[0] }}
            </span>
            <span class="vs__row">
              <span class="vs__v">{{ text(k) }}</span>
              @if (label(k)[1]) { <span class="vs__u">{{ label(k)[1] }}</span> }
            </span>
            <span class="vs__foot">
              @if (f) { <span class="vs__state">{{ f === 'high' ? 'High' : 'Low' }}</span> } @else { <span class="vs__ok">Normal</span> }
              @if (d) {
                <span class="vs__trend" [attr.data-dir]="d.dir" [title]="d.text">
                  @switch (d.dir) {
                    @case ('up') { <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg> }
                    @case ('down') { <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M19 12l-7 7-7-7"/></svg> }
                    @default { <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg> }
                  }
                </span>
              }
            </span>
          </button>
        }
        <span class="vs__who">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>
          <span>{{ v.recordedByName || 'Recorded' }}<br /><span class="vs__when">{{ v.recordedAt | date:'h:mm a' }}</span></span>
        </span>
      </div>
    } @else {
      <div class="vs vs--none">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h4l3-7 4 14 3-7h4"/></svg>
        <span>No vitals taken for this visit yet.</span>
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
    :host { display: block; min-width: 0; --vs-warn: #b45309; --vs-warn-bg: color-mix(in srgb, #f59e0b 12%, var(--nd-card-bg)); --vs-warn-line: color-mix(in srgb, #f59e0b 45%, transparent); }
    :host-context(html.dark), :host-context([data-theme='dark']) { --vs-warn: #fbbf24; --vs-warn-bg: color-mix(in srgb, #f59e0b 14%, var(--nd-card-bg)); }
    .vs { display: flex; align-items: stretch; gap: 8px; overflow-x: auto; scrollbar-width: none; padding: 2px; }
    .vs::-webkit-scrollbar { display: none; }
    .vs__t {
      flex: 0 0 auto; min-width: 104px; display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
      padding: 8px 12px 8px; border-radius: 12px; border: 1px solid var(--nd-line); background: var(--nd-card-bg);
      color: var(--text-primary); font: inherit; text-align: left; cursor: pointer;
      transition: border-color var(--nd-dur-fast, 200ms) ease, transform var(--nd-dur-fast, 200ms) var(--nd-spring, ease);
    }
    .vs__t:hover { border-color: var(--nd-sel-border); }
    .vs__t:active { transform: scale(0.98); }
    .vs__t:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    .vs__t[data-flag] { background: var(--vs-warn-bg); border-color: var(--vs-warn-line); }
    .vs__k { display: inline-flex; align-items: center; gap: 5px; font-size: 10.5px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-tertiary); }
    .vs__row { display: inline-flex; align-items: baseline; gap: 4px; }
    .vs__v { font-size: 20px; font-weight: 600; line-height: 1.15; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
    .vs__u { font-size: 11.5px; color: var(--text-tertiary); }
    .vs__t[data-flag] .vs__v { color: var(--vs-warn); }
    .vs__foot { display: inline-flex; align-items: center; gap: 6px; min-height: 16px; }
    .vs__state { font-size: 11px; font-weight: 600; color: var(--vs-warn); }
    .vs__ok { font-size: 11px; color: var(--text-tertiary); }
    .vs__trend { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%;
      background: var(--nd-chip-bg); color: var(--text-secondary); }
    .vs__heart { color: #e11d48; transform-origin: 50% 55%; animation: vs-beat 0.71s ease-in-out infinite; }
    @keyframes vs-beat { 0%, 60%, 100% { transform: scale(1); } 15% { transform: scale(1.2); } 30% { transform: scale(0.95); } 45% { transform: scale(1.08); } }
    .vs__ring { color: var(--violet-text, #6d28d9); }
    .vs__t[data-flag] .vs__ring { color: var(--vs-warn); }
    .vs__who { flex: none; align-self: center; display: inline-flex; align-items: flex-start; gap: 6px; padding: 0 4px 0 8px; font-size: 12px; line-height: 1.35; color: var(--text-tertiary); white-space: nowrap; }
    .vs__who svg { color: var(--violet-text, #6d28d9); margin-top: 2px; }
    .vs__when { font-variant-numeric: tabular-nums; }
    .vs--none { align-items: center; gap: 8px; min-height: 40px; padding: 0 12px; border-radius: 12px; border: 1px dashed var(--nd-line); color: var(--text-tertiary); font-size: 13px; width: fit-content; }
    .vt { display: flex; flex-direction: column; gap: 8px; padding: 0 4px 4px; color: var(--violet-text, #6d28d9); }
    .vt__prev { margin: 0; font-size: 13px; color: var(--text-secondary); }
    .vt__prev b { color: var(--text-primary); font-weight: 600; }
    .vt__vals { display: flex; flex-direction: column; gap: 2px; font-size: 12.5px; color: var(--text-secondary); }
    .vt__vals b { color: var(--text-primary); font-variant-numeric: tabular-nums; }
    @media (prefers-reduced-motion: reduce) { .vs__heart { animation: none !important; } .vs__t { transition: none; } }
    @media (pointer: coarse) { .vs__t { min-height: 44px; } }
    @media (max-width: 760px) { .vs__t { min-width: 92px; padding: 6px 10px; } .vs__v { font-size: 18px; } .vs__who { display: none; } }
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
  delta(k: VitalKey) { return vitalDelta(k, this.vitals(), this.previous(k)); }

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
