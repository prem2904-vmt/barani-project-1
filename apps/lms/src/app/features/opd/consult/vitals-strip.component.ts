import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, effect, inject, input, signal, viewChild,
} from '@angular/core';
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
 * The consult band's vitals (consult v6): compact chips in the one-row
 * patient band — "BP 60/59 mmHg · Low" — amber when out of range. Chips that
 * don't fit fold into a "+N" chip whose popover lists every vital; on tablet
 * / phone (`scroll`) the row scrolls instead. Tapping a chip shows the
 * previous visit's value and the trend over the last visits.
 */
@Component({
  selector: 'pf-consult-vitals',
  standalone: true,
  imports: [DatePipe, RxPopoverComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (vitals(); as v) {
      <div class="vc" #box role="list" aria-label="Today's vitals" [class.vc--scroll]="scroll()">
        @for (k of keys(); track k; let i = $index) {
          @let f = flag(k);
          <button type="button" class="vc__chip" role="listitem" [attr.data-flag]="f" [hidden]="i >= shown()" (click)="openTrend($event, k)"
                  [attr.aria-label]="label(k)[0] + ' ' + text(k) + ' ' + label(k)[1] + (f ? ', ' + f : '') + '. Show trend'">
            <span class="vc__k">{{ label(k)[0] }}</span>
            <b class="nd-num">{{ text(k) }}</b>
            @if (label(k)[1]) { <span class="vc__u">{{ label(k)[1] }}</span> }
            @if (f) { <span class="vc__w">· {{ f === 'high' ? 'High' : 'Low' }}</span> }
          </button>
        }
        @if (shown() < keys().length) {
          <button type="button" class="vc__chip vc__more nd-num" (click)="openAll($event)" [attr.aria-label]="'Show all ' + keys().length + ' vitals'">+{{ keys().length - shown() }}</button>
        }
      </div>
    } @else {
      <div class="vc vc--none">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h4l3-7 4 14 3-7h4"/></svg>
        <span>No vitals taken for this visit yet.</span>
      </div>
    }

    @if (all(); as a) {
      <pf-rx-popover [anchor]="a" title="Today's vitals" [minWidth]="260" (closed)="all.set(null)">
        <div class="vt">
          @for (k of keys(); track k) {
            <div class="vt__row" [attr.data-flag]="flag(k)"><span>{{ label(k)[0] }}</span><b class="nd-num">{{ text(k) }} {{ label(k)[1] }}@if (flag(k); as f) { · {{ f === 'high' ? 'High' : 'Low' }} }</b></div>
          }
          @if (vitals()?.recordedAt) { <p class="vt__prev">{{ vitals()?.recordedByName || 'Recorded' }} · {{ vitals()?.recordedAt | date:'h:mm a' }}</p> }
        </div>
      </pf-rx-popover>
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
    :host { display: block; min-width: 0; --vc-warn: #b45309; --vc-warn-bg: color-mix(in srgb, #f59e0b 12%, var(--nd-card-bg)); --vc-warn-line: color-mix(in srgb, #f59e0b 45%, transparent); }
    :host-context(html.dark), :host-context([data-theme='dark']) { --vc-warn: #fbbf24; --vc-warn-bg: color-mix(in srgb, #f59e0b 12%, transparent); }
    .vc { display: flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden; }
    .vc--scroll { overflow-x: auto; scrollbar-width: none; }
    .vc--scroll::-webkit-scrollbar { display: none; }
    .vc__chip { flex: none; height: 28px; display: inline-flex; align-items: center; gap: 5px; padding: 0 10px; border-radius: var(--nd-radius-chip, 8px);
      border: 1px solid transparent; background: color-mix(in srgb, var(--color-primary, #7c3aed) 6%, transparent);
      font: inherit; font-size: 12px; color: var(--text-tertiary); white-space: nowrap; cursor: pointer; }
    .vc__chip[hidden] { display: none; }
    .vc__chip b { font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .vc__u { color: var(--text-tertiary); opacity: .8; }
    .vc__chip:hover { border-color: color-mix(in srgb, var(--color-primary, #7c3aed) 35%, transparent); }
    .vc__chip:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    .vc__chip[data-flag] { background: var(--vc-warn-bg); border-color: var(--vc-warn-line); color: var(--vc-warn); }
    .vc__chip[data-flag] b, .vc__chip[data-flag] .vc__w { color: var(--vc-warn); font-weight: 600; }
    .vc__more { border: 1px dashed var(--nd-line); background: none; color: var(--text-secondary); font-weight: 600; }
    .vc--none { gap: 8px; min-height: 28px; font-size: 12.5px; color: var(--text-tertiary); }
    .vt { display: flex; flex-direction: column; gap: 8px; padding: 0 4px 4px; color: var(--violet-text, #6d28d9); }
    .vt__row { display: flex; justify-content: space-between; gap: 16px; font-size: 13px; color: var(--text-tertiary); }
    .vt__row b { color: var(--text-primary); font-weight: 600; }
    .vt__row[data-flag] b { color: var(--vc-warn); }
    .vt__prev { margin: 0; font-size: 13px; color: var(--text-secondary); }
    .vt__prev b { color: var(--text-primary); font-weight: 600; }
    .vt__vals { display: flex; flex-direction: column; gap: 2px; font-size: 12.5px; color: var(--text-secondary); }
    .vt__vals b { color: var(--text-primary); font-variant-numeric: tabular-nums; }
    @media (pointer: coarse) { .vc__chip { height: 36px; } }
  `],
})
export class ConsultVitalsComponent implements AfterViewInit, OnDestroy {
  readonly vitals = input<ConsultVitals | null>(null);
  /** The patient's recent captures across visits (newest first, incl. today's). */
  readonly history = input<ConsultVitals[]>([]);
  /** Tablet / phone: the chips scroll instead of folding into "+N". */
  readonly scroll = input(false);

  readonly trend = signal<{ key: VitalKey; anchor: HTMLElement } | null>(null);
  readonly all = signal<HTMLElement | null>(null);
  /** How many chips fit (the rest fold into "+N"). */
  readonly shown = signal(99);
  private readonly box = viewChild<ElementRef<HTMLElement>>('box');
  private ro: ResizeObserver | null = null;

  readonly keys = computed<VitalKey[]>(() => {
    const v = this.vitals();
    const all: VitalKey[] = ['bp', 'pulse', 'temp', 'spo2', 'rr', 'weight', 'bmi'];
    return all.filter(k => (k === 'bmi' ? bmiOf(v) != null : vitalText(k, v) !== '—'));
  });

  constructor() {
    effect(() => { this.keys(); this.scroll(); queueMicrotask(() => this.fit()); });
  }
  ngAfterViewInit() {
    if (typeof ResizeObserver === 'function') {
      this.ro = new ResizeObserver(() => this.fit());
      const host = this.host.nativeElement as HTMLElement;
      this.ro.observe(host);
    }
  }
  ngOnDestroy() { this.ro?.disconnect(); }
  private readonly host = inject(ElementRef<HTMLElement>);

  /** Fold the trailing chips that don't fit into "+N" (never when scrolling). */
  fit() {
    const box = this.box()?.nativeElement;
    const n = this.keys().length;
    if (!box || this.scroll() || !box.clientWidth) { this.shown.set(n); return; }
    const chips = Array.from(box.querySelectorAll<HTMLElement>('.vc__chip:not(.vc__more)'));
    chips.forEach(c => (c.hidden = false));
    const widths = chips.map(c => c.offsetWidth);
    const gap = 6, more = 44, avail = box.clientWidth;
    const total = widths.reduce((a, w) => a + w + gap, -gap);
    if (total <= avail) { this.shown.set(n); return; }
    let used = 0, k = 0;
    for (; k < widths.length; k++) { if (used + widths[k] + gap + more > avail) break; used += widths[k] + gap; }
    this.shown.set(Math.max(1, k));
  }

  label(k: VitalKey) { return LABEL[k]; }
  text(k: VitalKey) { return vitalText(k, this.vitals()); }
  vtext(k: VitalKey, v: ConsultVitals) { return vitalText(k, v); }
  flag(k: VitalKey) { return vitalFlag(k, this.vitals()); }
  delta(k: VitalKey) { return vitalDelta(k, this.vitals(), this.previous(k)); }

  openTrend(e: Event, key: VitalKey) { this.trend.set({ key, anchor: e.currentTarget as HTMLElement }); }
  openAll(e: Event) { this.all.set(e.currentTarget as HTMLElement); }

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
