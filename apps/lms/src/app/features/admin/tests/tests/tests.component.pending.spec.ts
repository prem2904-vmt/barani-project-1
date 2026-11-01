import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { TestsComponent } from './tests.component';
import { BusyDirective } from '../../../../shared/directives/busy.directive';
import { ApiService } from '../../../../core/services/api.service';
import { ToastService } from '../../../../core/services/toast.service';
import { ThemeService } from '../../../../core/services/theme.service';
import { DialogService } from '../../../../core/services/dialog.service';
import { TestPricingService } from '../../../../core/services/test-pricing.service';
import { AuthService } from '../../../../core/auth/auth.service';
import { BetaFeaturesService } from '../../../../core/services/beta-features.service';
import { TmProposalsService } from '../../../../core/services/tm-proposals.service';

/**
 * Test Master band: "Pending (N)" is a view of the band's switch — shown ONLY
 * with beta `assistant` on (pf.assistant(), server flag, dev) and a Test
 * Master or pricing permission; the count is the open suggested changes and
 * the view replaces the grid with the pending panel. Beta off: no option, no
 * request to /api/tm-proposals at all.
 */
function render(opts: { beta?: boolean; perms?: string[]; query?: Record<string, string>; count?: number } = {}) {
  (window as any).matchMedia = (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const api = {
    get: vi.fn((url: string) => of(url.startsWith('/api/tests') ? [] : url.startsWith('/api/catalog-proposals') ? [] : [])),
    patch: vi.fn(() => of({})), post: vi.fn(() => of({})),
  };
  const tm = { openCount: vi.fn(() => of(opts.count ?? 7)), list: vi.fn(() => of({ items: [], total: 0, openCount: 0 })) };
  const perms = opts.perms ?? ['*'];
  TestBed.configureTestingModule({
    imports: [TestsComponent],
    providers: [
      { provide: ApiService, useValue: api },
      { provide: TestPricingService, useValue: { save: vi.fn(() => of({})), ensureLoaded: vi.fn(), isolationOn: () => false, priceFor: () => null } },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
      { provide: ThemeService, useValue: { isDark: () => false, isNewDesign: () => true } },
      { provide: DialogService, useValue: { confirm: vi.fn(async () => false) } },
      { provide: AuthService, useValue: { user: () => ({ id: 'u1' }), hasAnyPermission: (c: string[]) => perms.includes('*') || c.some(x => perms.includes(x)), hasPermission: (c: string) => perms.includes('*') || perms.includes(c) } },
      { provide: BetaFeaturesService, useValue: { enabled: (k: string) => !!opts.beta && k === 'assistant', ensureLoaded: async () => undefined, loaded: () => true } },
      { provide: TmProposalsService, useValue: tm },
      { provide: Router, useValue: { navigate: vi.fn() } },
      { provide: ActivatedRoute, useValue: { queryParams: of(opts.query ?? {}) } },
    ],
  });
  TestBed.overrideComponent(TestsComponent, {
    set: { imports: [FormsModule, NgTemplateOutlet, BusyDirective], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
  });
  const f = TestBed.createComponent(TestsComponent);
  f.detectChanges();
  return { f, c: f.componentInstance as any, el: f.nativeElement as HTMLElement, api, tm };
}
const flush = () => new Promise(r => setTimeout(r, 0));

describe('TestsComponent — Pending (N) view (beta assistant)', () => {
  it('beta off: no Pending option and no request to /api/tm-proposals', async () => {
    const { c, tm, api } = render({ beta: false });
    await flush();
    expect(c.viewOptions().some((o: any) => o.value === 'pending')).toBe(false);
    expect(tm.openCount).not.toHaveBeenCalled();
    expect(api.get.mock.calls.some((x: any[]) => String(x[0]).includes('tm-proposals'))).toBe(false);
    c.setView('pending');
    expect(c.pendingView()).toBe(false);
  });

  it('beta on: "Pending" with the open count; choosing it swaps the grid for the panel', async () => {
    const { f, c, el, tm } = render({ beta: true, count: 7 });
    await flush();
    f.detectChanges();
    expect(tm.openCount).toHaveBeenCalled();
    const opt = c.viewOptions().find((o: any) => o.value === 'pending');
    expect(opt).toMatchObject({ label: 'Pending', count: 7 });
    c.setView('pending');
    f.detectChanges();
    expect(c.view()).toBe('pending');
    expect(c.gridView()).toBe(false);
    expect(el.querySelector('pf-tm-pending-panel')).not.toBeNull();
    expect(el.querySelector('.pf-tm-main')).toBeNull();
    // The panel's count after an action updates the band.
    c.pendingCount.set(6);
    expect(c.viewOptions().find((o: any) => o.value === 'pending').count).toBe(6);
    // The band's Create steps down: the review card's Approve is the one primary.
    expect(c.bandPrimaryElsewhere()).toBe(true);
    // Leaving the view brings the grid back.
    c.setView('individual');
    f.detectChanges();
    expect(el.querySelector('pf-tm-pending-panel')).toBeNull();
  });

  it('pricing-only role still sees Pending (price changes); no Test Master or pricing permission → hidden', async () => {
    let t = render({ beta: true, perms: ['manage_test_pricing'] });
    await flush();
    expect(t.c.pendingOn()).toBe(true);
    TestBed.resetTestingModule();
    t = render({ beta: true, perms: ['view_reports'] });
    await flush();
    expect(t.c.pendingOn()).toBe(false);
    expect(t.tm.openCount).not.toHaveBeenCalled();
  });

  it('?view=pending deep link opens the view once beta answers', async () => {
    const { c } = render({ beta: true, query: { view: 'pending' } });
    await flush();
    expect(c.pendingView()).toBe(true);
  });
});
