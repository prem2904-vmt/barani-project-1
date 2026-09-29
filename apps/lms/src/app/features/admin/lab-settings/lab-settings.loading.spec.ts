import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, Subject, of } from 'rxjs';
import { vi } from 'vitest';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { LabSettingsComponent } from './lab-settings.component';

/**
 * Lab settings — LOADING FEEDBACK (ND-PATTERN "Loading feedback"). The page
 * autosaves every change, so there is no Save button to turn busy: the
 * band's save state reads "Saving…" (kit dots) while a change is on its way,
 * after 150ms so a fast answer never flickers. The first load draws the
 * section cards' shape instead of default switches that flip a moment later.
 */
function render(opts: { cfg$?: Subject<unknown>; patch$?: Subject<unknown> } = {}) {
  (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  document.documentElement.classList.add('design-new');
  const api = {
    get: vi.fn((url: string): Observable<unknown> => {
      if (url === '/api/tenants/branch-lab-config') return opts.cfg$ ?? of({ labStructure: 'auto' });
      return of([]);
    }),
    post: vi.fn(() => of({})), put: vi.fn(() => of({})), delete: vi.fn(() => of({})),
    patch: vi.fn(() => opts.patch$ ?? of({})),
  };
  TestBed.configureTestingModule({
    imports: [LabSettingsComponent],
    providers: [
      provideRouter([]),
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
      { provide: DialogService, useValue: { confirm: vi.fn(async () => false) } },
      {
        provide: AuthService,
        useValue: {
          user: () => ({ tenantName: 'Micro World', firstName: 'Admin', branchId: null, permissions: [] }),
          activeBranchId: () => null, hasPermission: () => true, hasAnyPermission: () => true,
          isAuthenticated: () => true, waitForAuth: async () => undefined,
        },
      },
      { provide: TenantStateService, useValue: { tenant: () => null, ensureLoaded: vi.fn(), update: vi.fn() } },
      {
        provide: BranchLabConfigService,
        useValue: { collectionMode: signal('front_desk'), billingMode: signal('front_desk'), ensureLoaded: vi.fn(), update: vi.fn() },
      },
      { provide: TenantEntitlementsService, useValue: { moduleEnabled: () => true, ensureLoaded: vi.fn() } },
    ],
  });
  const f = TestBed.createComponent(LabSettingsComponent);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const state = () => el.querySelector<HTMLElement>('pf-hero-band .pf-ls__savestate')!;
  return { f, el, c: f.componentInstance as any, api, state };
}

describe('Lab settings — loading feedback', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); TestBed.resetTestingModule(); });

  it('first render = skeleton cards (no default switches that flip later), then the real cards', async () => {
    const cfg$ = new Subject<unknown>();
    const { f, el } = render({ cfg$ });
    expect(el.querySelector('.pf-ls__skel pf-skeleton-card[aria-busy="true"]')).not.toBeNull();
    expect(el.querySelector('.pf-ls__card')).toBeNull();
    await Promise.resolve();
    cfg$.next({ labStructure: 'auto', requireValidationForAllResults: true }); cfg$.complete();
    f.detectChanges();
    expect(el.querySelector('.pf-ls__skel')).not.toBeNull();          // held — no flash
    vi.advanceTimersByTime(600);
    f.detectChanges();
    expect(el.querySelector('.pf-ls__skel')).toBeNull();
    expect(el.querySelector('.pf-ls__card')).not.toBeNull();
  });

  it('a config already there (synchronous) shows no skeleton', () => {
    const { el } = render();
    expect(el.querySelector('.pf-ls__skel')).toBeNull();
    expect(el.querySelector('.pf-ls__card')).not.toBeNull();
  });

  it('an autosave in flight: the band reads "Saving…" after 150ms (not before), back to "saved" once it answers', () => {
    const patch$ = new Subject<unknown>();
    const { f, c, state } = render({ patch$ });
    expect(state().textContent).toContain('Changes save automatically');
    c.setRequireValidation(true);
    f.detectChanges();
    expect(state().textContent).toContain('Changes save automatically');   // a fast answer never flickers
    vi.advanceTimersByTime(150);
    f.detectChanges();
    expect(state().textContent).toContain('Saving…');
    expect(state().getAttribute('aria-busy')).toBe('true');
    expect(state().querySelector('pf-busy')).not.toBeNull();
    patch$.next({}); patch$.complete();
    vi.advanceTimersByTime(300);
    f.detectChanges();
    expect(state().textContent).toContain('Changes save automatically');
    expect(state().getAttribute('aria-busy')).toBeNull();
  });
});
