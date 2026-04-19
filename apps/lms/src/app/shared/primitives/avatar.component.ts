import { ChangeDetectionStrategy, Component, Input, computed, signal } from '@angular/core';

/**
 * Deterministic-colour avatar — hashes the supplied name into one of eight
 * violet/pink/fuchsia palette slots so the same person always lands on the
 * same tile colour across the app.
 */

const PALETTE = [
  'linear-gradient(135deg, #7c3aed, #a855f7)',   // violet
  'linear-gradient(135deg, #9333ea, #d946ef)',   // fuchsia
  'linear-gradient(135deg, #db2777, #f472b6)',   // pink
  'linear-gradient(135deg, #e11d48, #fb7185)',   // rose
  'linear-gradient(135deg, #0891b2, #22d3ee)',   // cyan
  'linear-gradient(135deg, #0d9488, #2dd4bf)',   // teal
  'linear-gradient(135deg, #2563eb, #60a5fa)',   // sky
  'linear-gradient(135deg, #6366f1, #818cf8)'    // indigo
];

@Component({
  selector: 'pf-avatar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="root"
          [style.width.px]="size"
          [style.height.px]="size"
          [style.font-size.px]="fontSize()"
          [style.background]="bg()"
          [attr.aria-label]="name">
      {{ initials() }}
    </span>
  `,
  styles: [`
    :host { display: inline-flex; }
    .root {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 9999px;
      color: #ffffff;
      font-weight: 600;
      letter-spacing: 0.02em;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
      user-select: none;
      flex-shrink: 0;
    }
  `]
})
export class AvatarComponent {
  private readonly _name = signal<string>('?');

  @Input()
  set name(v: string | null | undefined) { this._name.set(v && v.trim() ? v : '?'); }
  get name(): string { return this._name(); }

  @Input() size = 40;

  readonly initials = computed(() =>
    this._name()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(p => p[0])
      .join('')
      .toUpperCase() || '?'
  );

  readonly fontSize = computed(() => Math.round(this.size * 0.4));

  readonly bg = computed(() => {
    const name = this._name();
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash + name.charCodeAt(i)) >>> 0;
    return PALETTE[hash % PALETTE.length];
  });
}
