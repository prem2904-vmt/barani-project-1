import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type TestOriginKind = 'master' | 'clone' | 'branch' | 'own';

/**
 * Origin badge — indicator showing whether a lab test is:
 * Master (Standard), Customised (Your Copy), Branch, or Own Test.
 */
@Component({
  selector: 'pf-origin-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (kind()) {
      <span [class]="'pf-origin-badge pf-origin-badge--' + kind()"
            role="note" [attr.title]="hint()" [attr.aria-label]="label()">
        <svg class="pf-origin-badge__icon" width="12" height="12" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9"/>
          <path d="M12 8v8M8 12h8"/>
        </svg>
        <span>{{ label() }}</span>
      </span>
    }
  `,
  styles: [`
    :host { display: inline-flex; vertical-align: middle; }
    .pf-origin-badge {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 1px 7px; border-radius: 999px;
      font-size: 11px; font-weight: 600; line-height: 16px;
      background: rgba(148, 163, 184, 0.12);
      color: var(--text-secondary, #475569);
      border: 1px solid var(--border-muted, rgba(148, 163, 184, 0.25));
    }
    .pf-origin-badge--master {
      background: rgba(124, 58, 237, 0.08);
      color: #7c3aed;
      border-color: rgba(124, 58, 237, 0.25);
    }
    .pf-origin-badge--clone {
      background: rgba(14, 165, 233, 0.08);
      color: #0284c7;
      border-color: rgba(14, 165, 233, 0.25);
    }
    .pf-origin-badge--own {
      background: rgba(16, 185, 129, 0.08);
      color: #059669;
      border-color: rgba(16, 185, 129, 0.25);
    }
  `]
})
export class OriginBadgeComponent {
  readonly origin = input<string | null | undefined>('master');
  readonly catalogMode = input<string | null | undefined>(null);

  protected readonly kind = computed<TestOriginKind>(() => {
    const o = (this.origin() ?? '').toLowerCase();
    if (o.includes('clone') || this.catalogMode() === 'clone') return 'clone';
    if (o.includes('own')) return 'own';
    if (o.includes('branch')) return 'branch';
    return 'master';
  });

  protected readonly label = computed(() => {
    switch (this.kind()) {
      case 'clone': return 'Customised';
      case 'own': return 'Own Test';
      case 'branch': return 'Branch';
      default: return 'Master';
    }
  });

  protected readonly hint = computed(() => {
    switch (this.kind()) {
      case 'clone': return 'Customised copy of central master test';
      case 'own': return 'Lab-created test';
      case 'branch': return 'Branch-specific override';
      default: return 'Standard central catalog test';
    }
  });
}
