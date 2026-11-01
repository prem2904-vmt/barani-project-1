import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { SnapGuides } from '../utils/layout-snap';

/**
 * Smart guides overlay — draws what layout-snap.ts returns (guide segments
 * between the aligned items, equal-gap / equal-size marks with the distance
 * in mm). ONE overlay for every layout editor (profile Custom layout designer,
 * report letterhead / footer editor), so they look and read the same.
 *
 * The parent is the positioned page; this fills it and never takes a pointer.
 * `pxPerUnit` + `originX/Y` map the caller's unit (mm or pt) to page px;
 * `mmPerUnit` turns a measure into millimetres for its label.
 */
@Component({
  selector: 'pf-snap-guides',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pf-snap-guides', 'aria-hidden': 'true' },
  template: `
    @for (g of segs(); track $index) {
      <span class="sg-line" [class.sg-line--v]="g.v" [class.sg-line--h]="!g.v"
            [style.left.px]="g.left" [style.top.px]="g.top" [style.width.px]="g.w" [style.height.px]="g.h"></span>
    }
    @for (m of marks(); track $index) {
      <span class="sg-mark" [class.sg-mark--x]="m.x" [class.sg-mark--y]="!m.x" [class.sg-mark--size]="m.size"
            [style.left.px]="m.left" [style.top.px]="m.top" [style.width.px]="m.w" [style.height.px]="m.h">
        <span class="sg-mark__tag pf-num">{{ m.label }}</span>
      </span>
    }
  `,
  styles: [`
    :host { position: absolute; inset: 0; pointer-events: none; z-index: 7; }
    .sg-line { position: absolute; }
    .sg-line--v { width: 0; border-left: 1px solid #7c3aed; }
    .sg-line--h { height: 0; border-top: 1px solid #7c3aed; }
    .sg-mark { position: absolute; display: flex; align-items: center; justify-content: center; }
    .sg-mark--x { height: 0; border-top: 1px solid #db2777; }
    .sg-mark--y { width: 0; border-left: 1px solid #db2777; }
    /* End ticks. */
    .sg-mark--x::before, .sg-mark--x::after { content: ''; position: absolute; top: -4px; height: 7px; border-left: 1px solid #db2777; }
    .sg-mark--x::before { left: 0; } .sg-mark--x::after { right: 0; }
    .sg-mark--y::before, .sg-mark--y::after { content: ''; position: absolute; left: -4px; width: 7px; border-top: 1px solid #db2777; }
    .sg-mark--y::before { top: 0; } .sg-mark--y::after { bottom: 0; }
    .sg-mark__tag { position: relative; padding: 1px 5px; border-radius: 4px; white-space: nowrap; font-size: 10px; font-weight: 600;
      line-height: 1.3; color: #fff; background: #db2777; box-shadow: 0 1px 3px rgba(15, 23, 42, .25); }
    /* The label sits beside its line, never on it (gaps are often narrower than the label). */
    .sg-mark--x .sg-mark__tag { transform: translateY(calc(-50% - 5px)); }
    .sg-mark--y .sg-mark__tag { transform: translateX(calc(50% + 6px)); }
    .sg-mark--size.sg-mark--x, .sg-mark--size.sg-mark--x::before, .sg-mark--size.sg-mark--x::after { border-color: #7c3aed; }
    .sg-mark--size.sg-mark--y, .sg-mark--size.sg-mark--y::before, .sg-mark--size.sg-mark--y::after { border-color: #7c3aed; }
    .sg-mark--size .sg-mark__tag { background: #7c3aed; }
  `],
})
export class SnapGuidesComponent {
  readonly guides = input<SnapGuides | null>(null);
  readonly pxPerUnit = input(1);
  readonly originX = input(0);
  readonly originY = input(0);
  readonly mmPerUnit = input(1);

  /** Equal-size marks sit this far inside the item they measure. */
  private static readonly SIZE_INSET_PX = 8;

  readonly segs = computed(() => {
    const k = this.pxPerUnit(), ox = this.originX(), oy = this.originY();
    return (this.guides()?.lines ?? []).map(g => g.axis === 'v'
      ? { v: true, left: ox + g.pos * k, top: oy + g.from * k, w: 0, h: Math.max(1, (g.to - g.from) * k) }
      : { v: false, left: ox + g.from * k, top: oy + g.pos * k, w: Math.max(1, (g.to - g.from) * k), h: 0 });
  });

  readonly marks = computed(() => {
    const k = this.pxPerUnit(), ox = this.originX(), oy = this.originY(), mm = this.mmPerUnit();
    const inset = SnapGuidesComponent.SIZE_INSET_PX;
    return (this.guides()?.measures ?? []).map(m => {
      const size = m.kind === 'size';
      const label = `${(Math.round(m.size * mm * 10) / 10).toFixed(1)} mm`;
      return m.axis === 'x'
        ? { x: true, size, label, left: ox + m.from * k, top: oy + m.at * k + (size ? inset : 0), w: Math.max(1, (m.to - m.from) * k), h: 0 }
        : { x: false, size, label, left: ox + m.at * k + (size ? inset : 0), top: oy + m.from * k, w: 0, h: Math.max(1, (m.to - m.from) * k) };
    });
  });
}
