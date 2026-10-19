import {
  ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, effect, input, output, signal, viewChild,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { JourneyAxisEvent, clampZoom, journeyAxisModel } from './journey-axis';

/**
 * `pf-journey-axis` — the patient journey's proportional time axis (lifted out
 * of pf-patient-timeline, same look and behaviour): date pills on lanes over a
 * hairline, month / day / year ticks, horizontal scroll, zoom by the host's
 * −/+ buttons (`zoomBy`) or a pinch / ctrl+wheel focused on the pointer.
 * Theme tokens only (light + dark). The host owns WHICH dates show (filters)
 * and what selecting one means.
 */
@Component({
  selector: 'pf-journey-axis',
  standalone: true,
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ja__scroll" #scrollRef [style.padding-inline.px]="gutter()">
      <div class="ja__axis" [class.ja__axis--tight]="tight()" #axisRef [style.height.px]="railHeight()" [style.width.%]="zoom() * 100" [style.min-width.px]="minWidth()">
        @for (e of model().events; track e.key) {
          <button type="button" class="ja__ev" [class.ja__ev--on]="selectedKey() === e.key"
                  [style.left.%]="e.x"
                  [attr.aria-pressed]="selectedKey() === e.key"
                  (click)="select.emit(e.key)" [title]="e.title || (e.date | date:'MMM d, y')"
                  [attr.aria-label]="e.title || (e.date | date:'d MMM y')">
            <span class="ja__card">
              @if (e.type !== 'today') {
                <span class="ja__ico" [attr.data-type]="e.type" aria-hidden="true">
                  @switch (e.type) {
                    @case ('opd') { <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3v6a4 4 0 0 0 8 0V3"/><path d="M8 15a5 5 0 0 0 5 5h1a4 4 0 0 0 4-4v-2"/><circle cx="19" cy="10" r="2"/></svg> }
                    @case ('ipd') { <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v-2a2 2 0 0 1 2-2h3v4"/></svg> }
                    @case ('pharmacy') { <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 20.5a5 5 0 0 1-7-7l6-6a5 5 0 0 1 7 7z"/><path d="m8.5 8.5 7 7"/></svg> }
                    @case ('doc') { <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg> }
                    @default { <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6M10 3v6l-4.5 8.5A2 2 0 0 0 7.3 21h9.4a2 2 0 0 0 1.8-3.5L14 9V3"/></svg> }
                  }
                </span>
              }
              <span class="ja__lbl">{{ e.label || (e.date | date:'MMM d') }}</span>
              @if (e.alert) { <span class="ja__alert" aria-label="Has results outside the normal range"></span> }
            </span>
            <span class="ja__stem" [style.height.px]="stemBase() + e.lane * laneGap()"></span>
            <span class="ja__dot" [attr.data-type]="e.type" [class.abn]="e.alert"></span>
          </button>
        }
        <div class="ja__line"></div>
        @for (t of model().ticks; track t.key) {
          <div class="ja__tick" [style.left.%]="t.x">
            <span class="ja__tick-mark"></span>
            <span class="ja__tick-lbl">{{ t.label }}</span>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .ja__scroll { display: flex; align-items: flex-end; overflow-x: auto; overflow-y: hidden; touch-action: pan-x;
      scrollbar-width: thin; scrollbar-color: var(--scrollbar-thumb, rgba(168, 85, 247, 0.32)) transparent; }
    /* flex: 0 0 auto → the axis keeps its (zoom-scaled) width instead of being
       shrunk to fit the flex scroll container, so horizontal zoom + scroll work. */
    .ja__axis { position: relative; margin-top: 10px; flex: 0 0 auto; }
    .ja__axis--tight { margin-top: 0; }
    /* Geometry: the hairline sits 26px up (over the 24px ticks); a date is a
       column (pill · stem · 11px dot) whose height is its content, anchored
       21px up so the dot's centre lands on the line. Nothing overflows the
       axis box, so a host's padding really contains it. */
    .ja__line { position: absolute; left: 0; right: 0; bottom: 26px; height: 1px; background: var(--glass-border, var(--pf-line)); }
    .ja__tick { position: absolute; bottom: 0; height: 24px; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 4px; }
    .ja__tick-mark { width: 1px; height: 6px; background: var(--glass-border, var(--pf-line)); }
    .ja__tick-lbl { font-size: 10px; color: var(--text-tertiary); white-space: nowrap; font-variant-numeric: tabular-nums; }
    .ja__ev { position: absolute; bottom: 21px; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; background: none; border: 0; padding: 0; cursor: pointer; z-index: 1; }
    /* The new design's light theme tints any button[class*=--on] (styles.scss);
       a date is only its pill + stem + dot, never a tinted box. */
    .ja__ev, .ja__ev.ja__ev--on { background: none !important; box-shadow: none !important; }
    .ja__ev:hover { z-index: 2; }
    .ja__ev:focus-visible { outline: none; }
    .ja__ev:focus-visible .ja__card { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    .ja__card { display: inline-flex; align-items: center; gap: 5px; padding: 4px 9px; border-radius: 8px; background: var(--bg-card-solid, var(--pf-card-bg)); border: 1px solid var(--glass-border, var(--pf-line)); font-size: 11px; font-weight: 600; color: var(--text-secondary); white-space: nowrap; box-shadow: 0 3px 10px rgba(0,0,0,0.28); transition: transform .1s, border-color .12s; font-variant-numeric: tabular-nums; }
    .ja__ev:hover .ja__card { transform: translateY(-1px); border-color: rgba(168,85,247,0.45); color: var(--text-primary); }
    .ja__ico { display: inline-flex; color: #a855f7; }
    .ja__ico[data-type="opd"] { color: var(--green-text); }
    .ja__ico[data-type="ipd"] { color: var(--amber-text); }
    .ja__ico[data-type="pharmacy"] { color: var(--pink-text); }
    .ja__ico[data-type="doc"] { color: var(--sky-text); }
    .ja__stem { width: 1px; flex: none; background: var(--glass-border, var(--pf-line)); }
    .ja__dot { width: 11px; height: 11px; border-radius: 50%; flex-shrink: 0; background: var(--bg-card-solid, var(--pf-card-bg)); border: 2.5px solid #a855f7; }
    .ja__dot[data-type="opd"] { border-color: #34d399; }
    .ja__dot[data-type="ipd"] { border-color: #fbbf24; }
    .ja__dot[data-type="pharmacy"] { border-color: #f472b6; }
    .ja__dot[data-type="doc"] { border-color: #38bdf8; }
    .ja__dot[data-type="today"] { border: 0; background: linear-gradient(135deg, #7c3aed, #ec4899); }
    .ja__dot.abn { border-color: #fb7185; }
    .ja__ev--on .ja__dot.abn { background: #fb7185; box-shadow: 0 0 0 4px rgba(251,113,133,0.25); }
    .ja__alert { width: 6px; height: 6px; border-radius: 50%; background: #fb7185; box-shadow: 0 0 0 3px rgba(251,113,133,0.2); }
    .ja__ev--on .ja__card { background: linear-gradient(135deg, #7c3aed, #a855f7); border-color: transparent; color: #fff; box-shadow: 0 4px 14px rgba(124,58,237,0.4); }
    .ja__ev--on .ja__ico { color: #fff; }
    .ja__ev--on .ja__stem { background: rgba(168,85,247,0.7); }
    .ja__ev--on .ja__dot { background: #a855f7; box-shadow: 0 0 0 4px rgba(168,85,247,0.22); }
    @media (prefers-reduced-motion: reduce) { .ja__card { transition: none; } }
  `],
})
export class JourneyAxisComponent implements OnDestroy {
  readonly events = input<JourneyAxisEvent[]>([]);
  readonly selectedKey = input<string | null | undefined>(null);
  /** How many lanes may stack (the host knows its height). */
  readonly maxLanes = input(4);
  /** Rail height for one lane, and the extra per stacked lane (px). */
  readonly railBase = input(88);
  readonly laneGap = input(34);
  /** Stem length of a first-lane pill (px). */
  readonly stemBase = input(30);
  readonly minWidth = input(560);
  readonly gutter = input(20);
  /** No top margin (the journey dock keeps its height ≤ ~120px). */
  readonly tight = input(false);
  readonly select = output<string>();

  readonly zoom = signal(1);
  readonly model = computed(() => journeyAxisModel(this.events(), this.zoom(), this.maxLanes()));
  readonly railHeight = computed(() => this.railBase() + Math.max(0, this.model().lanes - 1) * this.laneGap());

  private readonly scrollRef = viewChild<ElementRef<HTMLDivElement>>('scrollRef');
  private readonly axisRef = viewChild<ElementRef<HTMLDivElement>>('axisRef');
  private bound = false;

  constructor() {
    // Non-passive zoom listeners on the scroller (so ctrl+wheel / pinch can
    // preventDefault and not zoom the whole page).
    effect(() => {
      const el = this.scrollRef()?.nativeElement;
      if (!el || this.bound) return;
      this.bound = true;
      el.addEventListener('wheel', this.onWheel, { passive: false });
      el.addEventListener('touchstart', this.onTouchStart, { passive: false });
      el.addEventListener('touchmove', this.onTouchMove, { passive: false });
      el.addEventListener('touchend', this.onTouchEnd, { passive: false });
    });
  }

  /** Zoom keeping the axis point under `clientX` stationary. Width is applied
   *  imperatively so the following scrollLeft write reflows against the new
   *  width — deterministic, no rAF timing race. */
  zoomAt(nz: number, clientX: number) {
    nz = clampZoom(nz);
    const scroll = this.scrollRef()?.nativeElement;
    const axis = this.axisRef()?.nativeElement;
    const old = this.zoom();
    if (!scroll || !axis) { this.zoom.set(nz); return; }
    if (nz === old) return;
    const rect = scroll.getBoundingClientRect();
    const pointerX = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const contentX = scroll.scrollLeft + pointerX;
    this.zoom.set(nz);
    axis.style.width = `${nz * 100}%`;
    scroll.scrollLeft = contentX * (nz / old) - pointerX;
  }
  /** The host's −/+ buttons: zoom around the middle of the visible axis. */
  zoomBy(f: number) {
    const rect = this.scrollRef()?.nativeElement?.getBoundingClientRect();
    this.zoomAt(this.zoom() * f, rect ? rect.left + rect.width / 2 : 0);
  }
  /** Bring a date into view (e.g. the selected visit after a zoom). */
  reveal(key: string) {
    const scroll = this.scrollRef()?.nativeElement;
    const ev = this.model().events.find(e => e.key === key);
    if (!scroll || !ev) return;
    const axisW = this.axisRef()?.nativeElement?.offsetWidth ?? 0;
    const x = (ev.x / 100) * axisW;
    if (x < scroll.scrollLeft || x > scroll.scrollLeft + scroll.clientWidth) scroll.scrollLeft = Math.max(0, x - scroll.clientWidth / 2);
  }

  private pinchDist = 0; private pinchZoom = 1;
  private readonly onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey) return;               // trackpad-pinch / ctrl+wheel only
    e.preventDefault();
    this.zoomAt(this.zoom() * (e.deltaY < 0 ? 1.08 : 1 / 1.08), e.clientX);
  };
  private readonly onTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 2) { this.pinchDist = this.dist(e); this.pinchZoom = this.zoom(); }
  };
  private readonly onTouchMove = (e: TouchEvent) => {
    if (e.touches.length === 2 && this.pinchDist) {
      e.preventDefault();
      const mid = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      this.zoomAt(this.pinchZoom * (this.dist(e) / this.pinchDist), mid);
    }
  };
  private readonly onTouchEnd = () => { this.pinchDist = 0; };
  private dist(e: TouchEvent): number {
    const a = e.touches[0], b = e.touches[1];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }

  ngOnDestroy() {
    const el = this.scrollRef()?.nativeElement;
    if (el && this.bound) {
      el.removeEventListener('wheel', this.onWheel);
      el.removeEventListener('touchstart', this.onTouchStart);
      el.removeEventListener('touchmove', this.onTouchMove);
      el.removeEventListener('touchend', this.onTouchEnd);
    }
  }
}
