import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { renderBandPage } from '../admin/admin-band.spec-helpers';
import { BetaFeaturesService } from '../../core/services/beta-features.service';
import { AssistantApiService } from '../../shared/assistant/assistant-api.service';
import { INSTRUMENT_BRIDGE_SOURCE } from '../../shared/instruments/instrument-bridge.service';
import { InsightsBuilderApiService } from './builder/insights-builder-api.service';
import { InsightsComponent } from './insights.component';

/**
 * "My dashboards" sits behind the ONE beta gate (BetaFeaturesService
 * `assistant`) — structural, never CSS — and never changes the fixed sections.
 */
function render(betaOn: boolean) {
  const builder = {
    list: vi.fn(() => of([
      { id: 'd1', title: 'Morning view', status: 'published', visibility: 'lab', version: 2, updatedAt: null, canEdit: true },
      { id: 'd2', title: 'Dues', status: 'draft', visibility: 'private', version: 1, updatedAt: null, canEdit: true },
    ])),
    metrics: vi.fn(() => of([])),
    preview: vi.fn(() => of({ widgets: [], notes: [] })),
    get: vi.fn(() => of({ id: 'd1', title: 'Morning view', status: 'published', visibility: 'lab', version: 2, updatedAt: null, canEdit: true, roleIds: [], recipe: { version: 1, title: 'Morning view', widgets: [] } })),
    roles: vi.fn(() => of([])),
  };
  const p = renderBandPage(InsightsComponent, {
    getFor: (url) => (url.startsWith('/api/analytics/overview') ? { patients: 1, tests: 2, testsPerPatient: 2, outsourcedPct: 0 } : null),
    providers: [
      { provide: BetaFeaturesService, useValue: { enabled: (k: string) => betaOn && k === 'assistant', ensureLoaded: async () => undefined, loaded: () => true } },
      { provide: InsightsBuilderApiService, useValue: builder },
      { provide: AssistantApiService, useValue: { providers: vi.fn(() => of([])), chat: vi.fn() } },
      { provide: INSTRUMENT_BRIDGE_SOURCE, useValue: () => undefined },
    ],
  });
  p.f.detectChanges();
  return { ...p, builder };
}

describe('Insights — My dashboards beta gate', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('beta off: no "My dashboards" group, no dashboard request; fixed sections unchanged', () => {
    const p = render(false);
    const nav = p.el.querySelector('.pf-ins-nav__body')!;
    expect(nav.textContent).not.toContain('My dashboards');
    expect(nav.textContent).not.toContain('New dashboard');
    expect(p.builder.list).not.toHaveBeenCalled();
    expect(nav.textContent).toContain('Overview');
    expect(p.el.querySelector('pf-ins-dashboard')).toBeNull();
    p.f.destroy();
  });

  it('beta off: a dashboard URL id falls back to Overview', () => {
    const p = render(false);
    p.cmp.go('dash:d1');
    p.f.detectChanges();
    p.f.detectChanges();
    // The effect sends it back once the gate is known to be off.
    expect(p.cmp.nav()).toBe('overview');
    expect(p.el.querySelector('pf-ins-dashboard')).toBeNull();
    p.f.destroy();
  });

  it('beta on: the group lists saved dashboards (+ Draft tag) and "New dashboard"', () => {
    const p = render(true);
    const nav = p.el.querySelector('.pf-ins-nav__body')!;
    expect(nav.textContent).toContain('My dashboards');
    expect(p.builder.list).toHaveBeenCalled();
    const items = Array.from(nav.querySelectorAll('.pf-ins-nav__list--dash .pf-ins-nav__item')).map((b) =>
      Array.from(b.querySelectorAll('span:not(.pf-ins-nav__dot)')).map((x) => x.textContent!.trim()).join(' '));
    expect(items).toEqual(['Morning view', 'Dues Draft', 'New dashboard']);
    p.f.destroy();
  });

  it('beta on: picking a dashboard shows it in place of the section (band period gets "Each chart’s own")', () => {
    const p = render(true);
    const btn = Array.from(p.el.querySelectorAll<HTMLButtonElement>('.pf-ins-nav__list--dash .pf-ins-nav__item')).find((b) => b.textContent!.includes('Morning view'))!;
    btn.click();
    p.f.detectChanges();
    expect(p.el.querySelector('pf-ins-dashboard')).toBeTruthy();
    expect(p.el.querySelector('.pf-ins-main')).toBeNull();
    expect(p.el.querySelector('.pf-ins-ctx')).toBeNull();
    expect(p.builder.get).toHaveBeenCalledWith('d1');
    expect(p.cmp.dashBand()).toMatchObject({ period: 'own' });
    // Back to a fixed section: everything as before.
    p.cmp.go('overview');
    p.f.detectChanges();
    expect(p.el.querySelector('pf-ins-dashboard')).toBeNull();
    expect(p.el.querySelector('.pf-ins-main')).toBeTruthy();
    p.f.destroy();
  });
});
