import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { UploadsService } from '../../../core/services/uploads.service';

/** One analyzer graph on a tube (an instrument-routed attachment). */
export interface AnalyzerGraph {
  /** Stable key: line id + image code. */
  key: string;
  lineId: string;
  attachmentId: string;
  code: string;
  label: string;
  url: string;
  show: boolean;
}

/**
 * "Analyzer graphs" — the histograms / scattergrams an analyzer sent for this
 * tube (owner 2026-10-02: a proper strip per sample with real thumbnails and
 * human labels, not raw "instrument:12053" chips under each row). Thumbnails
 * load through the authenticated uploads fetch (UploadsService — never a
 * public URL). Tap one to enlarge: a lightbox with previous / next, arrow
 * keys, swipe, Esc. Each graph keeps its "prints on the report" eye — the
 * same `show` flag the attachment always had. Tech-captured attachments
 * stay where they were (their chips under the line).
 */
@Component({
  selector: 'pf-analyzer-graphs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-card pf-ag" aria-label="Analyzer graphs">
      <header class="pf-card__head">
        <span class="pf-card__icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h18"/><path d="M4 19c3-1 4-12 7-12s3 9 5 9 3-3 4-3"/></svg>
        </span>
        <span class="pf-card__label">Analyzer graphs</span>
        @if (source()) {
          <span class="pf-chip pf-chip--static pf-ag__src pf-num">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>
            {{ source() }}
          </span>
        }
        <span class="pf-ag__count pf-num">{{ graphs().length }}</span>
      </header>
      <div class="pf-card__body">
        <ul class="pf-ag__grid">
          @for (g of graphs(); track g.key; let i = $index) {
            <li class="pf-ag__item" [class.pf-ag__item--off]="!g.show">
              <button type="button" class="pf-ag__thumb" (click)="open(i)" [attr.aria-label]="'Enlarge ' + g.label">
                @if (src(g); as s) { <img [src]="s" [alt]="g.label" /> }
                @else if (missing(g)) { <span class="pf-ag__ph">File no longer available</span> }
                @else { <span class="pf-ag__ph pf-ag__ph--load" aria-label="Loading"></span> }
              </button>
              <div class="pf-ag__meta">
                <span class="pf-ag__name">{{ g.label }}</span>
                <span class="pf-ag__code pf-num">Code {{ g.code }}</span>
              </div>
              @if (!readOnly()) {
                <button type="button" class="pf-ag__eye" [attr.aria-pressed]="g.show"
                        [attr.aria-label]="g.show ? g.label + ' prints on the report — hide it' : g.label + ' is hidden from the report — print it'"
                        [title]="g.show ? 'Prints on the report — tap to hide' : 'Hidden from the report — tap to print'"
                        (click)="toggleShow.emit(g)">
                  @if (g.show) {
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8Z"/><circle cx="12" cy="12" r="3"/></svg>
                  } @else {
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 8 10 8a9.74 9.74 0 0 0 5.39-1.61"/><path d="M2 2l20 20"/></svg>
                  }
                </button>
              }
            </li>
          }
        </ul>
      </div>
    </section>

    @if (current(); as g) {
      <div class="pf-ag-lb" role="dialog" aria-modal="true" [attr.aria-label]="g.label" data-pf-esc
           tabindex="-1" #lightbox (keydown)="onKey($event)"
           (pointerdown)="onDown($event)" (pointerup)="onUp($event)">
        <div class="pf-ag-lb__bar">
          <span class="pf-ag-lb__title">{{ g.label }} <span class="pf-ag-lb__sub pf-num">· Code {{ g.code }} · {{ (openIndex() ?? 0) + 1 }} / {{ graphs().length }}</span></span>
          <button type="button" class="pf-btn pf-btn--icon pf-ag-lb__close" (click)="close()" aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="pf-ag-lb__stage">
          @if (graphs().length > 1) {
            <button type="button" class="pf-btn pf-btn--icon pf-ag-lb__nav pf-ag-lb__nav--prev" (click)="step(-1)" aria-label="Previous graph">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
            </button>
          }
          <div class="pf-ag-lb__paper">
            @if (src(g); as s) { <img [src]="s" [alt]="g.label" draggable="false" /> }
          </div>
          @if (graphs().length > 1) {
            <button type="button" class="pf-btn pf-btn--icon pf-ag-lb__nav pf-ag-lb__nav--next" (click)="step(1)" aria-label="Next graph">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
            </button>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .pf-ag__src { display: inline-flex; align-items: center; gap: 6px; margin-left: 4px; font-size: 12px; }
    .pf-ag__src svg { color: var(--color-violet-600, #7c3aed); }
    .pf-ag__count { margin-left: auto; font-size: 12px; color: var(--text-tertiary); }
    .pf-ag__grid { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
    @media (min-width: 900px) { .pf-ag__grid { grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); } }
    .pf-ag__item { position: relative; display: flex; flex-direction: column; gap: 6px; padding: 8px;
      border: 1px solid var(--pf-line); border-radius: var(--pf-radius-sm, 10px); background: var(--pf-card-bg); }
    .pf-ag__item--off .pf-ag__thumb img { opacity: .45; }
    .pf-ag__thumb { display: flex; align-items: center; justify-content: center; aspect-ratio: 156 / 111; padding: 4px;
      border: 1px solid #e2e8f0; border-radius: 6px; background: #fff; cursor: zoom-in; overflow: hidden; }
    .pf-ag__thumb:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    .pf-ag__thumb img { max-width: 100%; max-height: 100%; object-fit: contain; image-rendering: auto; }
    .pf-ag__ph { font-size: 11.5px; color: #64748b; text-align: center; }
    .pf-ag__ph--load { width: 60%; height: 40%; border-radius: 6px; background: linear-gradient(90deg, #eef0f4 0%, #f6f7fa 50%, #eef0f4 100%);
      background-size: 200% 100%; animation: pf-ag-shimmer 1.2s ease-in-out infinite; }
    @keyframes pf-ag-shimmer { to { background-position: -200% 0; } }
    .pf-ag__meta { display: flex; flex-direction: column; gap: 1px; padding-right: 40px; min-height: 34px; }
    .pf-ag__name { font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .pf-ag__code { font-size: 11.5px; color: var(--text-tertiary); }
    .pf-ag__eye { position: absolute; right: 6px; bottom: 6px; width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center;
      border: 1px solid var(--pf-line); border-radius: 999px; background: var(--pf-card-bg); color: var(--text-tertiary); cursor: pointer; }
    .pf-ag__eye[aria-pressed="true"] { color: var(--color-violet-600, #7c3aed); border-color: color-mix(in srgb, #7c3aed 40%, transparent); }
    @media (pointer: coarse) { .pf-ag__eye { width: 44px; height: 44px; } }

    .pf-ag-lb { position: fixed; inset: 0; z-index: 1000; display: flex; flex-direction: column; outline: none;
      background: rgba(15, 23, 42, .86); touch-action: pan-y; animation: pf-ag-in var(--pf-dur, 320ms) var(--pf-spring, ease); }
    @keyframes pf-ag-in { from { opacity: 0; } }
    .pf-ag-lb__bar { display: flex; align-items: center; gap: 12px; padding: 12px 16px; padding-top: max(12px, env(safe-area-inset-top)); color: #fff; }
    .pf-ag-lb__title { flex: 1 1 auto; font-size: 15px; font-weight: 600; }
    .pf-ag-lb__sub { font-weight: 400; color: rgba(255,255,255,.7); font-size: 13px; }
    .pf-ag-lb__close, .pf-ag-lb__nav { color: #fff; background: rgba(255,255,255,.12); border-color: transparent; width: 44px; height: 44px; }
    .pf-ag-lb__stage { flex: 1 1 auto; display: flex; align-items: center; justify-content: center; gap: 12px; padding: 8px 16px 24px; min-height: 0; }
    .pf-ag-lb__paper { flex: 0 1 auto; max-width: min(92vw, 900px); max-height: 100%; padding: 16px; border-radius: 10px; background: #fff;
      display: flex; align-items: center; justify-content: center; }
    .pf-ag-lb__paper img { width: min(80vw, 820px); max-height: 72vh; object-fit: contain; image-rendering: pixelated; user-select: none; }
    @media (max-width: 640px) { .pf-ag-lb__nav { position: absolute; bottom: 20px; } .pf-ag-lb__nav--prev { left: 20px; } .pf-ag-lb__nav--next { right: 20px; } }
    @media (prefers-reduced-motion: reduce) { .pf-ag-lb { animation: none; } .pf-ag__ph--load { animation: none; } }
    :host-context(.dark) .pf-ag__thumb, :host-context([data-theme='dark']) .pf-ag__thumb { border-color: rgba(148, 163, 184, .35); }
  `],
})
export class AnalyzerGraphsComponent {
  private readonly uploads = inject(UploadsService);
  readonly graphs = input.required<AnalyzerGraph[]>();
  /** "From Arun CBC · 5:02 PM" — the run the graphs came with. */
  readonly source = input<string | null>(null);
  readonly readOnly = input<boolean>(false);
  readonly toggleShow = output<AnalyzerGraph>();

  readonly openIndex = signal<number | null>(null);
  readonly current = computed(() => {
    const i = this.openIndex();
    return i == null ? null : this.graphs()[i] ?? null;
  });
  private readonly lightbox = viewChild<ElementRef<HTMLElement>>('lightbox');
  private returnFocus: HTMLElement | null = null;
  private downX: number | null = null;

  src(g: AnalyzerGraph): string { return this.uploads.src(g.url); }
  missing(g: AnalyzerGraph): boolean { return this.uploads.isMissing(g.url); }

  open(i: number): void {
    this.returnFocus = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLElement | null;
    this.openIndex.set(i);
    queueMicrotask(() => this.lightbox()?.nativeElement.focus());
  }
  close(): void {
    this.openIndex.set(null);
    this.returnFocus?.focus?.();
  }
  step(d: number): void {
    const n = this.graphs().length, i = this.openIndex();
    if (i == null || n === 0) return;
    this.openIndex.set((i + d + n) % n);
  }
  onKey(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); this.close(); }
    else if (ev.key === 'ArrowRight') { ev.preventDefault(); this.step(1); }
    else if (ev.key === 'ArrowLeft') { ev.preventDefault(); this.step(-1); }
  }
  onDown(ev: PointerEvent): void { this.downX = ev.clientX; }
  /** Swipe left / right (≥ 50 px) steps; a tap on the dark backdrop closes. */
  onUp(ev: PointerEvent): void {
    const x0 = this.downX; this.downX = null;
    if (x0 == null) return;
    const dx = ev.clientX - x0;
    if (Math.abs(dx) >= 50) { this.step(dx < 0 ? 1 : -1); return; }
    const t = ev.target as HTMLElement | null;
    if (t?.classList?.contains('pf-ag-lb__stage') || t?.classList?.contains('pf-ag-lb')) this.close();
  }
}
