import { Type, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';

/**
 * Renders a routed Lab settings page at `/page?tab=…` with a stub API (GET →
 * `getFor(url)` or [], writes → {}) and the new design on. Pages read their
 * category from the URL, so this goes through the real router.
 */
export async function renderLabPage(page: Type<unknown>, url: string, opts: {
  getFor?: (url: string) => unknown;
  providers?: unknown[];
  auth?: Record<string, unknown>;
} = {}) {
  (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  document.documentElement.classList.add('design-new');
  const api = {
    get: vi.fn((u: string) => of(opts.getFor?.(u) ?? [])),
    post: vi.fn(() => of({})),
    put: vi.fn(() => of({})),
    patch: vi.fn(() => of({})),
    delete: vi.fn(() => of({})),
  };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'page', component: page as Type<unknown> }]),
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: toasts },
      { provide: DialogService, useValue: { confirm: vi.fn(async () => false), prompt: vi.fn(async () => null) } },
      {
        provide: AuthService,
        useValue: {
          user: () => ({ tenantName: 'Micro World', firstName: 'Admin', branchId: 'b1', branchName: 'Main Lab', permissions: [] }),
          activeBranch: () => ({ id: 'b1', name: 'Anna Nagar' }),
          activeBranchId: () => 'b1',
          hasPermission: () => true,
          hasAnyPermission: () => true,
          isAuthenticated: () => true,
          waitForAuth: async () => undefined,
          ...(opts.auth ?? {}),
        },
      },
      { provide: TenantStateService, useValue: { tenant: () => null, ensureLoaded: vi.fn(), update: vi.fn() } },
      { provide: BranchLabConfigService, useValue: { collectionMode: signal('front_desk'), billingMode: signal('front_desk'), ensureLoaded: vi.fn(), update: vi.fn() } },
      { provide: TenantEntitlementsService, useValue: { moduleEnabled: () => true, ensureLoaded: vi.fn() } },
      ...((opts.providers ?? []) as any[]),
    ],
  });
  const harness = await RouterTestingHarness.create();
  const cmp = await harness.navigateByUrl(url, page as Type<unknown>);
  harness.detectChanges();
  // Group cards render their rows a turn later; let the first-load hold (600 ms minimum) settle too.
  await new Promise((r) => setTimeout(r, 650));
  harness.detectChanges();
  const el = harness.routeNativeElement as HTMLElement;
  return { harness, cmp: cmp as any, el, api, toasts };
}

export const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
export const cardTitles = (el: HTMLElement) => Array.from(el.querySelectorAll('.pf-card__label')).map(h => text(h));
/** Group card labels (one compact card per group, DESIGN-V2). */
export const groupLabels = (el: HTMLElement) => Array.from(el.querySelectorAll('pf-setting-group .pf-sgroup__label')).map(h => text(h));
/** Row labels (pf-setting-row). */
export const rowLabels = (el: HTMLElement) => Array.from(el.querySelectorAll('pf-setting-row .pf-srow__label')).map(h => text(h));
/** The options of a segmented control (by its aria-label on the radiogroup). */
export const segButtons = (el: HTMLElement, aria: string) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>(`[role="radiogroup"][aria-label="${aria}"] [role="radio"]`));
export const pillLabels = (el: HTMLElement) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>('pf-hero-band pf-segmented button')).map(b => b.getAttribute('aria-label'));
