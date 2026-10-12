import { DestroyRef, Directive, ElementRef, afterNextRender, booleanAttribute, computed, inject, input, signal } from '@angular/core';

/** Work-queue tile grid breakpoints — by the LIST's own width, never the
 *  window (Lab Intake / side panes can be pinned, so the same window gives
 *  the queue very different room). ≥1100px → 3, ≥640px → 2, else 1. */
export const TILE_GRID_BREAKPOINTS = { three: 1100, two: 640 } as const;

export function tileColumns(width: number): 1 | 2 | 3 {
  if (width >= TILE_GRID_BREAKPOINTS.three) return 3;
  if (width >= TILE_GRID_BREAKPOINTS.two) return 2;
  return 1;
}

/** `<ul pfTileGrid>` — the pf-kit adaptive tile grid (3 / 2 / 1 columns by
 *  container width). Adds `.pf-tilegrid` + `.pf-tilegrid--c{n}`; the kit
 *  CSS does the layout. ResizeObserver keeps it live as panes open/close. */
@Directive({
  selector: '[pfTileGrid]',
  standalone: true,
  host: {
    '[class.pf-tilegrid]': 'enabled()',
    '[class.pf-tilegrid--c1]': 'active() === 1',
    '[class.pf-tilegrid--c2]': 'active() === 2',
    '[class.pf-tilegrid--c3]': 'active() === 3',
    '[attr.data-cols]': 'active()',
  },
})
export class TileGridDirective {
  private readonly el = inject(ElementRef<HTMLElement>);
  /** `[pfTileGrid]="theme.isNewDesign()"` — off leaves the host untouched
   *  (classic keeps its own layout). Bare `pfTileGrid` = on. */
  readonly enabled = input(true, { alias: 'pfTileGrid', transform: booleanAttribute });
  readonly cols = signal<1 | 2 | 3>(1);
  protected readonly active = computed(() => (this.enabled() ? this.cols() : null));

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const host = this.el.nativeElement as HTMLElement;
      this.measure(host.getBoundingClientRect().width);
      if (typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(entries => {
        const e = entries[0];
        if (e) this.measure(e.contentRect.width);
      });
      ro.observe(host);
      destroyRef.onDestroy(() => ro.disconnect());
    });
  }

  /** Public so a test (or a caller that already knows the width) can drive it. */
  measure(width: number): void {
    const next = tileColumns(width);
    if (next !== this.cols()) this.cols.set(next);
  }
}
