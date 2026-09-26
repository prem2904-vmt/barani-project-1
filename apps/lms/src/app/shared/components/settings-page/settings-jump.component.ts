import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';

export interface SettingsSection { id: string; label: string }

/**
 * "On this page" — the small sticky section-jump list of a flattened admin
 * settings page (ND-PATTERN "Admin pages"). Desktop only (≥1024px, kit
 * `.nd-setjump`); phones and tablets just scroll the one column. Each item
 * scrolls its section into view and moves focus to it.
 */
@Component({
  selector: 'pf-settings-jump',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nd-setjump' },
  template: `
    <nav aria-label="On this page">
      <p class="nd-setjump__t" aria-hidden="true">On this page</p>
      @for (s of sections(); track s.id) {
        <button type="button" class="nd-setjump__item"
                [attr.aria-current]="active() === s.id ? 'true' : null"
                (click)="go(s.id)">{{ s.label }}</button>
      }
    </nav>
  `,
})
export class SettingsJumpComponent {
  readonly sections = input.required<SettingsSection[]>();
  readonly active = signal<string | null>(null);

  go(id: string): void {
    this.active.set(id);
    const el = typeof document !== 'undefined' ? document.getElementById(id) : null;
    if (!el) return;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.scrollIntoView?.({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    el.focus?.({ preventScroll: true });
  }
}
