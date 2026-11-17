import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { renderBandPage } from '../admin-band.spec-helpers';
import { AuthService } from '../../../core/auth/auth.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { LabSettingsComponent } from './lab-settings.component';

/**
 * Lab settings cleanup (owner 2026-11-01: "sample id and all no longer in use,
 * it's in Branches … overall lot of duplicate").
 *  • "Sample ID — Number width" is GONE: tenant.sampleNumberWidth is read by no
 *    service (sample IDs = space code from Branches + the Organization › Sample
 *    ID format). A pointer card links to those two homes instead.
 *  • "Consolidated abnormal results sheet" has ONE switch, in Report Template:
 *    Lab settings shows a link, never a second switch.
 *  • Every card says where it applies (This branch / All branches).
 *  • Tabs deep-link and stay in the URL.
 */
const providers = [
  {
    provide: AuthService,
    useValue: {
      user: () => ({ tenantName: 'Micro World', firstName: 'Admin', branchId: 'b1', branchName: 'Main Lab', permissions: [] }),
      activeBranch: () => ({ id: 'b1', name: 'Anna Nagar' }),
      activeBranchId: () => 'b1', hasPermission: () => true, hasAnyPermission: () => true,
      isAuthenticated: () => true, waitForAuth: async () => undefined,
    },
  },
  { provide: TenantStateService, useValue: { tenant: () => ({ sampleNumberWidth: 7 }), ensureLoaded: vi.fn(), update: vi.fn() } },
  {
    provide: BranchLabConfigService,
    useValue: { collectionMode: signal('front_desk'), billingMode: signal('front_desk'), ensureLoaded: vi.fn(), update: vi.fn() },
  },
  { provide: TenantEntitlementsService, useValue: { moduleEnabled: () => true, ensureLoaded: vi.fn() } },
];

function make() {
  const p = renderBandPage(LabSettingsComponent, {
    getFor: (url) => url === '/api/tenants/branch-lab-config' ? { labStructure: 'auto' } : [],
    providers,
  });
  return p;
}
const titles = (el: HTMLElement) => Array.from(el.querySelectorAll('.pf-card__label')).map((h) => h.textContent?.trim() ?? '');
const text = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ');

describe('Lab settings — removed settings are gone', () => {
  it('no "Sample ID" number-width editor (dead setting), on any tab', () => {
    const p = make();
    for (const t of ['collection', 'queues', 'rules', 'report'] as const) {
      p.cmp.tab.set(t);
      p.f.detectChanges();
      expect(titles(p.el)).not.toContain('Sample ID');
      expect(text(p.el)).not.toContain('Number width');
      expect(p.el.querySelector('input[type="number"][max="9"]')).toBeNull();
    }
    expect(typeof p.cmp.saveSampleNumberWidth).toBe('undefined');
    // nothing on the page ever writes the dead field
    const writes = [...p.api.patch.mock.calls, ...p.api.post.mock.calls] as unknown as unknown[][];
    expect(writes.some((c) => JSON.stringify(c[1] ?? {}).includes('sampleNumberWidth'))).toBe(false);
  });

  it('a "Sample IDs" pointer links to the two real homes (Organization format, lab-space prefixes)', () => {
    const p = make();
    const nav = vi.spyOn(p.f.debugElement.injector.get(Router), 'navigate').mockResolvedValue(true);
    p.cmp.tab.set('collection');
    p.f.detectChanges();
    const card = p.el.querySelector('[data-testid="ls-sample-ids"]')!;
    expect(card).not.toBeNull();
    expect(card.querySelector('input')).toBeNull();
    const [fmt, branches] = Array.from(card.querySelectorAll<HTMLButtonElement>('button'));
    fmt.click();
    expect(nav).toHaveBeenLastCalledWith(['/admin/organization'], { queryParams: { tab: 'sample' } });
    branches.click();
    expect(nav).toHaveBeenLastCalledWith(['/admin/lab/departments'], { queryParams: { tab: 'spaces' } });
  });

  it('no second abnormal-results switch — a link to its one home in Report Template', () => {
    const p = make();
    const nav = vi.spyOn(p.f.debugElement.injector.get(Router), 'navigate').mockResolvedValue(true);
    p.cmp.tab.set('report');
    p.f.detectChanges();
    expect(p.el.querySelector('button[role="switch"][aria-label="Consolidated abnormal results sheet"]')).toBeNull();
    expect(typeof p.cmp.setAbnormalSummary).toBe('undefined');
    // the page no longer loads / posts the report template
    const gets = p.api.get.mock.calls.map((c: unknown[]) => c[0]);
    expect(gets).not.toContain('/api/config/report-template');
    const link = p.el.querySelector<HTMLElement>('[data-testid="ls-abnormal-link"] button')!;
    link.click();
    expect(nav).toHaveBeenLastCalledWith(['/admin/reports'], { queryParams: { tab: 'table' } });
  });
});

describe('Lab settings — where each card applies', () => {
  it('names the branch, and marks every setting card This branch / All branches', () => {
    const p = make();
    expect(text(p.el.querySelector('[data-testid="ls-scope-note"]')!)).toContain('Anna Nagar');
    for (const t of ['collection', 'queues', 'rules', 'report'] as const) {
      p.cmp.tab.set(t);
      p.f.detectChanges();
      const cards = Array.from(p.el.querySelectorAll('section.pf-card'))
        .filter((c) => c.querySelector('button[role="switch"], [role="radiogroup"], input'));
      for (const c of cards) {
        const chip = c.querySelector('.pf-ls__scope');
        expect(chip, c.querySelector('.pf-card__label')?.textContent ?? '').not.toBeNull();
        expect(['This branch', 'All branches']).toContain(chip!.textContent!.trim());
      }
    }
  });

  it('Specimen label code says it is per branch (it is — branch-lab-config), not organisation-wide', () => {
    const p = make();
    p.cmp.tab.set('collection');
    p.f.detectChanges();
    const card = Array.from(p.el.querySelectorAll('section.pf-card')).find((c) => c.textContent?.includes('Specimen label code'))!;
    expect(card.querySelector('.pf-ls__scope')!.textContent!.trim()).toBe('This branch');
    expect(text(card as HTMLElement)).not.toContain('across the organisation');
  });
});

describe('Lab settings — tabs deep-link and stay in the URL', () => {
  it('picking a tab writes ?tab= with replaceUrl (back / reload return to it)', () => {
    const p = make();
    const nav = vi.spyOn(p.f.debugElement.injector.get(Router), 'navigate').mockResolvedValue(true);
    p.cmp.pickTab('rules');
    expect(p.cmp.tab()).toBe('rules');
    expect(nav).toHaveBeenCalledWith([], { queryParams: { tab: 'rules' }, queryParamsHandling: 'merge', replaceUrl: true });
  });
});
