import { ChangeDetectionStrategy, Component, Input, computed, signal } from '@angular/core';
import { TatColorPipe } from '../../pipes/tat-color.pipe';

@Component({
  selector: 'pf-tat-indicator',
  standalone: true,
  imports: [TatColorPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium"
          [class]="level() | tatColor">
      <span class="inline-block h-1.5 w-1.5 rounded-full"
            [class.bg-red-500]="level() === 'urgent'"
            [class.bg-orange-500]="level() === 'high'"
            [class.bg-emerald-500]="level() === 'normal'"></span>
      {{ label() }}
    </span>
  `
})
export class TatIndicatorComponent {
  private readonly _level = signal<'urgent' | 'high' | 'normal'>('normal');
  private readonly _remaining = signal<number | null>(null);

  @Input() set tatLevel(v: string | null | undefined) {
    this._level.set((v === 'urgent' || v === 'high' || v === 'normal') ? v : 'normal');
  }
  @Input() set remainingMinutes(v: number | null | undefined) {
    this._remaining.set(v ?? null);
  }

  readonly level = this._level.asReadonly();
  readonly label = computed(() => {
    const rem = this._remaining();
    const lvl = this._level();
    if (rem == null) return lvl.toUpperCase();
    if (rem <= 0) return `BREACHED ${Math.abs(Math.round(rem))}m`;
    if (rem < 60) return `${Math.round(rem)}m left`;
    return `${Math.round(rem / 60)}h left`;
  });
}
