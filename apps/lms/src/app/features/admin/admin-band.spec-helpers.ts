import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { TenantStateService } from '../../core/services/tenant-state.service';
import { ToastService } from '../../core/services/toast.service';
import { DialogService } from '../../core/services/dialog.service';

/**
 * Shared harness for the admin "band pill everywhere" specs: renders a routed
 * admin page with a stub API (GET → `getFor(url)` or [], writes → {}), the
 * NEW design on, and returns handy DOM probes for the band wiring.
 */
export function renderBandPage(cmp: Type<unknown>, opts: {
  getFor?: (url: string) => unknown;
  providers?: unknown[];
  /** Component inputs, set BEFORE the first change detection (ngOnInit sees them). */
  inputs?: Record<string, unknown>;
} = {}) {
  // Always install the stub (never 'only if missing'): another spec in the same
  // worker may have left a phone / fine-pointer matchMedia behind (order-dependent flake).
  (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  document.documentElement.classList.add('design-new');
  const api = {
    get: vi.fn((url: string) => of(opts.getFor?.(url) ?? [])),
    post: vi.fn(() => of({})),
    put: vi.fn(() => of({})),
    patch: vi.fn(() => of({})),
    delete: vi.fn(() => of({})),
  };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  TestBed.configureTestingModule({
    imports: [cmp],
    providers: [
      provideRouter([]),
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: toasts },
      { provide: DialogService, useValue: { confirm: vi.fn(async () => false), prompt: vi.fn(async () => null) } },
      {
        provide: AuthService,
        useValue: {
          user: () => ({ tenantName: 'Micro World', firstName: 'Admin', permissions: [] }),
          hasPermission: () => true,
          hasAnyPermission: () => true,
          isAuthenticated: () => true,
          waitForAuth: async () => undefined,
        },
      },
      { provide: TenantStateService, useValue: { tenant: () => null, ensureLoaded: () => undefined, update: () => undefined } },
      ...((opts.providers ?? []) as any[]),
    ],
  });
  const f = TestBed.createComponent(cmp);
  for (const [k, v] of Object.entries(opts.inputs ?? {})) f.componentRef.setInput(k, v);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const band = () => el.querySelector('pf-hero-band');
  const bandInput = () => el.querySelector<HTMLInputElement>('pf-hero-band .pf-hb__input');
  const type = (text: string) => {
    const i = bandInput();
    if (!i) throw new Error('band search input missing');
    i.value = text;
    i.dispatchEvent(new Event('input'));
    f.detectChanges();
  };
  return {
    f, el, api, toasts, cmp: f.componentInstance as any,
    band, bandInput, type,
    /** Buttons projected into the band's top-right actions. */
    /** The page's actions: the band's (Test Master and other work pages) or, in Settings, the pane's (card head `.pf-sg-act`). */
    actions: () => Array.from(el.querySelectorAll<HTMLElement>('pf-hero-band .pf-hb__actions button, pf-hero-band .pf-hb__actions a, .pf-sg-act')),
    /** Controls projected INSIDE the pill (after the divider). */
    tools: () => el.querySelector<HTMLElement>('pf-hero-band .pf-hb__tools'),
    body: () => el.querySelector<HTMLElement>('.pf-band-page > .pf-band-body'),
    /** The classic header must be classic-only (hidden in the new design). */
    headerIsClassicOnly: () => {
      const h = el.querySelector('pf-screen-header');
      return !h || h.classList.contains('pf-classic-only');
    },
  };
}
