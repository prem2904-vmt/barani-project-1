import { signal } from '@angular/core';
import { vi } from 'vitest';
import { renderBandPage } from '../admin-band.spec-helpers';
import { AuthService } from '../../../core/auth/auth.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { Router } from '@angular/router';
import { LAB_SPACES_PATH, LAB_SPACES_QUERY } from '../../../shared/utils/lab-settings-pages';
import { LabSettingsComponent } from './lab-settings.component';

/**
 * Lab settings cleanup (owner 2026-11-01: "sample id and all no longer in use,
 * it's in Branches … overall lot of duplicate").
 *  • "Sample ID — Number width" is GONE: tenant.sampleNumberWidth is read by no
 *    service (sample IDs = space code + the Lab › Sample numbers format).
 *  • "Consolidated abnormal results sheet" has ONE switch, in Report Template —
 *    never a second switch here.
 *  • Every card says where it applies (This branch / All branches).
 *  • (Settings re-home) it is a card host: pages pick cards through [cards].
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
const titles = (el: HTMLElement) => Array.from(el.querySelectorAll('.pf-sgroup__label')).map((h) => h.textContent?.trim() ?? '');
const text = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ');

const ALL = ['counters', 'scan-mode', 'queue-focus', 'lab-structure', 'calc-constants', 'no-scan', 'label-code', 'require-validation', 'tech-notes', 'auto-assign'];
const show = (p: ReturnType<typeof make>, cards: string[] | null) => { p.f.componentRef.setInput('cards', cards); p.f.detectChanges(); };

describe('Lab settings — removed settings are gone', () => {
  it('no "Sample ID" number-width editor (dead setting), in any card set', () => {
    const p = make();
    for (const c of [null, ...ALL.map(x => [x])]) {
      show(p, c as string[] | null);
      expect(titles(p.el)).not.toContain('Sample ID');
      expect(text(p.el)).not.toContain('Number width');
      expect(p.el.querySelector('input[type="number"][max="9"]')).toBeNull();
    }
    expect(typeof p.cmp.saveSampleNumberWidth).toBe('undefined');
    // nothing on the page ever writes the dead field
    const writes = [...p.api.patch.mock.calls, ...p.api.post.mock.calls] as unknown as unknown[][];
    expect(writes.some((c) => JSON.stringify(c[1] ?? {}).includes('sampleNumberWidth'))).toBe(false);
  });

  it('no second abnormal-results switch, no report-template reads (its one home is Report Template)', () => {
    const p = make();
    show(p, null);
    expect(p.el.querySelector('button[role="switch"][aria-label="Consolidated abnormal results sheet"]')).toBeNull();
    expect(typeof p.cmp.setAbnormalSummary).toBe('undefined');
    const gets = p.api.get.mock.calls.map((c: unknown[]) => c[0]);
    expect(gets).not.toContain('/api/config/report-template');
  });

  it('billing and inventory switches are not here any more (Billing / Inventory own them)', () => {
    const p = make();
    show(p, null);
    expect(typeof p.cmp.setPaymentGateStage).toBe('undefined');
    expect(typeof p.cmp.setShowPaymentsDue).toBe('undefined');
    expect(typeof p.cmp.setInventoryEnabled).toBe('undefined');
    for (const label of ['Enable inventory', 'Show "Payments due" tab', 'Require full payment to progress']) {
      expect(titles(p.el)).not.toContain(label);
    }
  });
});

describe('Lab settings — where each card applies', () => {
  it('every group card says where it applies ONCE (this branch / all branches); no per-row pill', () => {
    const p = make();
    for (const c of ALL) {
      show(p, [c]);
      for (const g of Array.from(p.el.querySelectorAll('pf-setting-group'))) {
        expect(['this branch', 'all branches']).toContain(g.querySelector('.pf-sgroup__scope')?.textContent?.trim());
      }
      expect(p.el.querySelector('pf-setting-row .pf-ls__scope')).toBeNull();
    }
  });

  it('Specimen label code (Labels) says it is per branch (it is — branch-lab-config), not organisation-wide', () => {
    const p = make();
    show(p, ['label-code']);
    const card = p.el.querySelector('pf-setting-group')!;
    expect(card.querySelector('.pf-sgroup__scope')!.textContent!.trim()).toBe('this branch');
    expect(text(card as HTMLElement)).not.toContain('across the organisation');
  });
});

describe('Lab settings — a page shows only the cards it owns', () => {
  it('[cards] narrows to the named cards; no input shows them all (counters ride in the Queue card)', () => {
    const p = make();
    show(p, ['queue-focus']);
    expect(titles(p.el)).toEqual(['Queue']);
    show(p, ['scan-mode', 'label-code']);
    expect(titles(p.el)).toEqual(['Finding a sample', 'Labels']);
    show(p, null);
    expect(titles(p.el).length).toBe(ALL.length - 1);
  });

  it('the space codes are edited on the Departments and lab spaces page', () => {
    const p = make();
    const nav = vi.spyOn(p.f.debugElement.injector.get(Router), 'navigate').mockResolvedValue(true);
    (p.f.componentInstance as unknown as { goBranches(): void }).goBranches();
    expect(nav).toHaveBeenLastCalledWith([LAB_SPACES_PATH], { queryParams: LAB_SPACES_QUERY });
  });
});
