import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
  selector: 'pf-barcode-display',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rounded-lg border border-slate-200 bg-white p-3 inline-flex flex-col items-center gap-1">
      <div class="flex items-end gap-[2px] h-12">
        @for (bar of bars; track $index) {
          <span class="bg-slate-900" [style.width.px]="bar.w" [style.height.%]="bar.h"></span>
        }
      </div>
      <div class="font-mono text-xs text-slate-700 tracking-wider">{{ code }}</div>
    </div>
  `
})
export class BarcodeDisplayComponent {
  @Input() code = '';

  get bars(): { w: number; h: number }[] {
    const rng = this.seed(this.code || 'PF');
    const arr: { w: number; h: number }[] = [];
    for (let i = 0; i < 40; i++) {
      arr.push({ w: rng() > 0.5 ? 3 : 1, h: 70 + Math.floor(rng() * 30) });
    }
    return arr;
  }

  private seed(str: string): () => number {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return () => {
      h = Math.imul(h ^ (h >>> 15), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      const r = ((h ^= h >>> 16) >>> 0) / 4294967296;
      return r;
    };
  }
}
