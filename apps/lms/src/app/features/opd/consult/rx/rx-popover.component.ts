import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, computed, input, output, signal, viewChildren,
} from '@angular/core';

/** One choice in a value popover. `group: 'grid'` renders as a chip, else a row. */
export interface RxPopOption { id: string; label: string; hint?: string; group?: 'grid' | 'list'; }

/** How a popover closed: a pick, Esc / outside click, or Tab (move to the next value). */
export type RxPopClose = { kind: 'pick'; id: string } | { kind: 'dismiss' } | { kind: 'tab'; back: boolean };

/**
 * The small value popover of an Rx line (Agent C). Only THAT value's options —
 * never a form. Custom (no native select): anchored under the tapped value
 * with fixed positioning (flips above when there is no room), keyboard-first:
 *   ↑ ↓ ← → move · Enter / Space pick · Esc close (focus returns to the value)
 *   · Tab / Shift+Tab close and move to the next / previous value on the line.
 * Motion: a 140 ms fade-scale, none under prefers-reduced-motion.
 */
@Component({
  selector: 'pf-rx-popover',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rxp" tabindex="-1" [attr.role]="flat().length ? 'listbox' : 'dialog'" [attr.aria-label]="title()" [style.top.px]="pos().top" [style.left.px]="pos().left"
         [style.min-width.px]="minWidth()" (keydown)="onKey($event)">
      @if (title()) { <div class="rxp__title">{{ title() }}</div> }
      @if (gridOpts().length) {
        <div class="rxp__grid">
          @for (o of gridOpts(); track o.id) {
            <button #opt type="button" class="rxp__chip" role="option" [attr.aria-selected]="o.id === selected()"
                    [class.on]="o.id === selected()" [class.act]="flatIndex(o) === active()"
                    (click)="pick(o.id)" (mouseenter)="active.set(flatIndex(o))">{{ o.label }}</button>
          }
        </div>
      }
      @if (gridOpts().length && listOpts().length) { <div class="rxp__sep"></div> }
      @for (o of listOpts(); track o.id) {
        <button #opt type="button" class="rxp__row" role="option" [attr.aria-selected]="o.id === selected()"
                [class.on]="o.id === selected()" [class.act]="flatIndex(o) === active()"
                (click)="pick(o.id)" (mouseenter)="active.set(flatIndex(o))">
          <span>{{ o.label }}</span>@if (o.hint) { <em>{{ o.hint }}</em> }
        </button>
      }
      <ng-content></ng-content>
    </div>
  `,
  styles: [`
    :host { position: fixed; inset: 0; z-index: 1200; }
    .rxp { outline: none; position: fixed; max-width: min(360px, calc(100vw - 24px)); max-height: min(420px, 70dvh); overflow-y: auto;
      padding: 10px; border-radius: 14px; background: var(--nd-card-bg, #fff); border: 1px solid var(--nd-line);
      box-shadow: 0 18px 44px rgba(15, 23, 42, 0.22); animation: rxp-in 140ms var(--nd-spring, ease) both; }
    :host-context(html.dark) .rxp { box-shadow: 0 18px 44px rgba(0, 0, 0, 0.55); }
    @keyframes rxp-in { from { opacity: 0; transform: translateY(-4px) scale(0.98); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .rxp { animation: none; } }
    .rxp__title { padding: 2px 6px 8px; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-tertiary); }
    .rxp__grid { display: flex; flex-wrap: wrap; gap: 6px; }
    .rxp__chip { min-height: 40px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--nd-line); background: var(--nd-card-bg);
      color: var(--text-primary); font: inherit; font-size: 13px; font-weight: 500; font-variant-numeric: tabular-nums; cursor: pointer; }
    .rxp__row { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 12px; min-height: 40px; padding: 0 10px;
      border: 0; border-radius: 10px; background: transparent; color: var(--text-primary); font: inherit; font-size: 13.5px; text-align: left; cursor: pointer; }
    .rxp__row em { font-style: normal; font-size: 12px; color: var(--text-tertiary); }
    .rxp__chip.act, .rxp__row.act { background: var(--nd-chip-bg); }
    .rxp__chip.on, .rxp__row.on { background: var(--nd-in-tint); border-color: var(--nd-sel-border); color: var(--violet-text, #6d28d9); font-weight: 600; }
    .rxp__chip:focus-visible, .rxp__row:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 1px; }
    .rxp__sep { height: 1px; margin: 8px 2px; background: var(--nd-line); }
    @media (pointer: coarse) { .rxp__chip, .rxp__row { min-height: 44px; } }
  `],
})
export class RxPopoverComponent implements AfterViewInit, OnDestroy {
  readonly anchor = input.required<HTMLElement>();
  readonly options = input<RxPopOption[]>([]);
  readonly selected = input<string | null>(null);
  readonly title = input<string>('');
  readonly minWidth = input<number>(180);
  readonly closed = output<RxPopClose>();

  readonly active = signal(0);
  readonly pos = signal({ top: 0, left: 0 });
  private readonly optEls = viewChildren<ElementRef<HTMLButtonElement>>('opt');

  readonly gridOpts = computed(() => this.options().filter(o => o.group === 'grid'));
  readonly listOpts = computed(() => this.options().filter(o => o.group !== 'grid'));
  /** Keyboard order = grid chips first, then list rows (the DOM order). */
  readonly flat = computed(() => [...this.gridOpts(), ...this.listOpts()]);

  constructor(private readonly host: ElementRef<HTMLElement>) {}

  flatIndex(o: RxPopOption) { return this.flat().indexOf(o); }

  ngAfterViewInit() {
    const i = Math.max(0, this.flat().findIndex(o => o.id === this.selected()));
    this.active.set(i);
    this.place();
    queueMicrotask(() => this.focusActive());
  }

  ngOnDestroy() { /* nothing global to undo */ }

  /** Anchor under the value; flip above / clamp inside the viewport. */
  place() {
    const r = this.anchor().getBoundingClientRect();
    const pop = this.host.nativeElement.querySelector('.rxp') as HTMLElement | null;
    const w = pop?.offsetWidth || this.minWidth();
    const h = pop?.offsetHeight || 240;
    const vw = window.innerWidth, vh = window.innerHeight;
    let top = r.bottom + 6;
    if (top + h > vh - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
    const left = Math.min(Math.max(8, r.left), Math.max(8, vw - w - 12));
    this.pos.set({ top: Math.max(8, top), left });
  }

  private focusActive() {
    const el = this.optEls()[this.active()]?.nativeElement
      ?? (this.host.nativeElement.querySelector('.rxp') as HTMLElement | null);
    el?.focus({ preventScroll: true });
  }

  pick(id: string) { this.closed.emit({ kind: 'pick', id }); }

  onKey(e: KeyboardEvent) {
    const n = this.flat().length;
    if (!n && e.key !== 'Escape' && e.key !== 'Tab') return;
    switch (e.key) {
      case 'ArrowDown': case 'ArrowRight': this.active.set((this.active() + 1) % n); this.focusActive(); e.preventDefault(); break;
      case 'ArrowUp': case 'ArrowLeft': this.active.set((this.active() - 1 + n) % n); this.focusActive(); e.preventDefault(); break;
      case 'Home': this.active.set(0); this.focusActive(); e.preventDefault(); break;
      case 'End': this.active.set(n - 1); this.focusActive(); e.preventDefault(); break;
      case 'Enter': case ' ': { const o = this.flat()[this.active()]; if (o) this.pick(o.id); e.preventDefault(); break; }
      case 'Escape': this.closed.emit({ kind: 'dismiss' }); e.preventDefault(); e.stopPropagation(); break;
      case 'Tab': this.closed.emit({ kind: 'tab', back: e.shiftKey }); e.preventDefault(); break;
    }
  }

  /** A press outside the panel dismisses (the host covers the viewport). */
  @HostListener('pointerdown', ['$event'])
  onBackdrop(e: PointerEvent) {
    const panel = this.host.nativeElement.querySelector('.rxp');
    if (panel && !panel.contains(e.target as Node)) this.closed.emit({ kind: 'dismiss' });
  }

  @HostListener('window:resize') onResize() { this.place(); }
}
