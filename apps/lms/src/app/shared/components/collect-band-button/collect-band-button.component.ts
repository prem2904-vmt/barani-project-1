import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { PageOpenService } from '../../../core/navigation/page-open.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { BILLING_COUNTER_SCREEN, areasWithCollection, screenWorkArea } from '../../models/process-workflow.model';

/**
 * Band "Collect" entry point (ND-PATTERN §1). Sample Collection sits only in
 * its fixed slots (Collect / Frontdesk / Lab — owner's final rule): when the
 * Frontdesk or Lab copy is switched ON, that area's screens get this quiet
 * button at the RIGHT of their band actions. The billing counter and custom
 * areas never collect, so they never show it.
 *
 *   • `area`    — the screen's work-area: 'frontdesk', 'billing-counter',
 *                 'lab' or a custom `/w/:id` menu id (see screenWorkArea).
 *   • `orderId` — the order / patient selected on the screen. Set → opens
 *                 collection FOR that order (`/lab/collect?orderId=…`, the
 *                 same deep link FD's row "Collect" and the after-payment
 *                 "Collect sample" use). Unset → the unfiltered collect queue.
 *   • `from`    — where Back returns; defaults to the current URL.
 *   • `inPlace` — the screen already shows collection (My Work's Collection
 *                 companion): the button runs this instead of navigating.
 *
 * Renders only when the area is the Frontdesk / Lab slot with its copy ON AND
 * the user has `collect_sample`. No workflow configured → nothing.
 */
@Component({
  selector: 'pf-collect-band-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <button type="button" class="pf-hb-btn pf-cbb press" (click)="go($event)"
              aria-label="Collect" [title]="title()">
        <span class="pf-collect-nav-icon pf-cbb__icon" aria-hidden="true"></span>
        <span class="pf-cbb__label">Collect</span>
      </button>
    }
  `,
  styles: [`
    :host { display: contents; }
    /* Quiet secondary (never violet — the band's one primary stays the
       screen's own CTA). Neutral slate on the light band, glass on dark. */
    .pf-cbb {
      background: rgba(255, 255, 255, 0.65); color: #334155;
      border-color: rgba(17, 25, 40, 0.14);
      padding: 0 14px; white-space: nowrap; flex-shrink: 0;
    }
    .pf-cbb:hover { background: #ffffff; color: #0f172a; }
    .pf-cbb:focus-visible { outline: 2px solid #64748b; outline-offset: 2px; }
    .pf-cbb__icon { width: 16px; height: 16px; }
    :host-context(.dark) .pf-cbb,
    :host-context([data-theme='dark']) .pf-cbb {
      background: rgba(255, 255, 255, 0.08); color: var(--text-primary, #e5e7eb);
      border-color: var(--glass-border, rgba(255, 255, 255, 0.16));
    }
    :host-context(.dark) .pf-cbb:hover,
    :host-context([data-theme='dark']) .pf-cbb:hover { background: rgba(255, 255, 255, 0.14); }
    /* Phones: icon-only 44px target; the label stays for screen readers
       via aria-label. */
    @media (max-width: 640px) {
      .pf-cbb { width: 44px; height: 44px; padding: 0; justify-content: center; border-radius: 12px; }
      .pf-cbb__icon { width: 18px; height: 18px; }
      .pf-cbb__label { display: none; }
    }
  `],
})
export class CollectBandButtonComponent {
  private readonly router = inject(Router);
  private readonly pageOpen = inject(PageOpenService);
  private readonly auth = inject(AuthService);
  // Optional + duck-typed: host screens' specs stub these services partially,
  // and a missing workflow simply means "no band button".
  private readonly process = inject(ProcessWorkflowService, { optional: true });

  /** The screen's work-area key (see screenWorkArea). */
  readonly area = input.required<string>();
  /** The order selected on the screen (patient-specific collection). */
  readonly orderId = input<string | null | undefined>(null);
  /** Back target; defaults to the current URL. */
  readonly from = input<string | null | undefined>(null);
  /** Set → collection is already on this screen; open/focus it in place. */
  readonly inPlace = input<(() => void) | null | undefined>(null);

  constructor() { try { this.process?.loadActive?.(); } catch { /* no workflow → hidden */ } }

  readonly visible = computed(() => {
    // The billing counter never collects (fixed slots) — even when billing
    // shares the Frontdesk area.
    if (this.area() === BILLING_COUNTER_SCREEN) return false;
    const cfg = this.process?.active?.() ?? null;
    const area = screenWorkArea(this.area(), cfg);
    if (!area || !areasWithCollection(cfg).includes(area)) return false;
    return !!this.auth.hasPermission?.('collect_sample');
  });

  readonly title = computed(() => this.inPlace() ? 'Go to Collection'
    : this.orderId() ? 'Collect samples for this order' : 'Open sample collection');

  /** The navigation this button performs — exposed for tests. */
  target(): { commands: string[]; queryParams: Record<string, string> } {
    const raw = this.from() || this.router.url || '/';
    const from = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
    const oid = this.orderId();
    return { commands: ['/lab/collect'], queryParams: oid ? { orderId: oid, from } : { from } };
  }

  go(ev?: Event): void {
    const local = this.inPlace();
    if (local) { local(); return; }
    // The Collect screen is a lazy route: the pressed button turns "held"
    // the same frame, until the navigation settles (ND-PATTERN "Loading feedback").
    this.pageOpen.markSource(ev?.currentTarget as HTMLElement | null);
    const t = this.target();
    this.router.navigate(t.commands, { queryParams: t.queryParams });
  }
}
