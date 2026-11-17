import { ChangeDetectionStrategy, Component, DestroyRef, afterNextRender, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { ToastService } from '../../../core/services/toast.service';
import { WorkEventsService } from '../../../core/services/work-events.service';
import { BridgeNearbyService } from '../../bridges/bridge-nearby.service';
import { listenForBridgeLinks } from '../../bridges/bridge-link';

/**
 * Shell hooks for Prefrontal Bridges (bridge-api v1, D.2), mounted once:
 *  - "New Bridge found nearby — Add?" — a small non-modal banner, ONE offer at
 *    a time, only for users with `manage_bridges` (server nearby path, so it
 *    works on the plain web). "Not now" hides that Bridge for 24 h.
 *  - a toast when a Bridge reports an analyzer it doesn't know
 *    (WorkEvent `bridge.source_detected`, no PHI);
 *  - native deep links to the QR URL (`…/b#1.S.C.P.F`) → the add screen.
 * ND: the banner's ONE primary is "Add"; "Not now" is secondary.
 */
@Component({
  selector: 'pf-bridge-nearby-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible(); as n) {
      <div class="pf-bnb" role="status" aria-live="polite">
        <span class="pf-card__icon pf-bnb__icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 17h.01M8 9a6 6 0 0 1 8 0M5.5 6.5a10 10 0 0 1 13 0"/></svg>
        </span>
        <span class="pf-bnb__text">
          <span class="pf-bnb__title">New Bridge found nearby — add it?</span>
          <span class="pf-bnb__note">Prefrontal Bridge <span class="pf-num">{{ n.serialShort }}</span> is on the same network as you.</span>
        </span>
        <span class="pf-bnb__actions">
          <button type="button" class="pf-btn pf-btn--secondary press" (click)="notNow(n.announcementId)">Not now</button>
          <button type="button" class="pf-btn pf-btn--primary press" (click)="add(n.announcementId)">Add</button>
        </span>
      </div>
    }
  `,
  styles: [`
    .pf-bnb {
      /* Above the app nav from its MEASURED footprint (--pf-nav-h, safe area
         included; layout/shell/nav-insets.ts) — the old --pf-nav-h never
         existed, so the banner covered the docked bar's bell / avatar. */
      position: fixed; z-index: 64; right: 16px;
      bottom: max(calc(var(--pf-nav-h, 0px) + 16px), calc(env(safe-area-inset-bottom, 0px) + 16px));
      display: flex; align-items: center; gap: 12px; max-width: min(520px, calc(100vw - 32px));
      padding: 10px 12px; border-radius: var(--pf-radius, 14px);
      background: var(--pf-card-bg, #fff); border: 1px solid var(--pf-line, #e5e7eb); box-shadow: 0 10px 32px rgba(15, 23, 42, 0.18);
      animation: pf-bnb-in var(--pf-dur, 320ms) var(--pf-spring, cubic-bezier(0.32, 0.72, 0, 1)) both;
    }
    .pf-bnb__icon { flex: none; }
    .pf-bnb__text { display: flex; flex-direction: column; min-width: 0; gap: 2px; }
    .pf-bnb__title { font-size: 13.5px; font-weight: 600; color: var(--text-primary); }
    .pf-bnb__note { font-size: 12.5px; color: var(--text-secondary); }
    .pf-bnb__actions { display: flex; gap: 8px; flex: none; }
    @keyframes pf-bnb-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .pf-bnb { animation: none; } }
    @media (max-width: 640px) {
      .pf-bnb { left: 16px; right: 16px; max-width: none; flex-wrap: wrap; }
      .pf-bnb__text { flex: 1 1 calc(100% - 48px); }
      .pf-bnb__actions { width: 100%; }
      .pf-bnb__actions .pf-btn { flex: 1 1 0; min-height: 44px; }
    }
  `],
})
export class BridgeNearbyBannerComponent {
  private readonly nearby = inject(BridgeNearbyService);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly url = signal(this.router.url);

  /** Never over the Bridges screens themselves (the offers are listed there). */
  readonly visible = computed(() => (this.url().startsWith('/admin/bridges') ? null : this.nearby.current()));

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd), takeUntilDestroyed())
      .subscribe((e) => this.url.set(e.urlAfterRedirects));
    afterNextRender(() => {
      this.nearby.start();
      const stop = listenForBridgeLinks(this.router);
      destroyRef.onDestroy(() => { this.nearby.stop(); stop(); });
    });
    inject(WorkEventsService).ofType('bridge.source_detected').pipe(takeUntilDestroyed()).subscribe(() => {
      if (!this.nearby.canManage()) return;
      this.toasts.info('A Bridge found a new analyzer. Open Lab settings → Bridges to link it.', 6000);
    });
  }

  notNow(id: string): void { this.nearby.snooze(id); }

  add(id: string): void {
    void this.router.navigate(['/admin/bridges', 'add'], { queryParams: { nearby: id } });
  }
}
