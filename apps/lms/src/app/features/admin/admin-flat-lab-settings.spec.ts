import { signal } from '@angular/core';
import { vi } from 'vitest';
import { renderBandPage } from './admin-band.spec-helpers';
import { AuthService } from '../../core/auth/auth.service';
import { TenantStateService } from '../../core/services/tenant-state.service';
import { BranchLabConfigService } from '../../core/services/branch-lab-config.service';
import { TenantEntitlementsService } from '../../core/services/tenant-entitlements.service';
import { LabSettingsComponent } from './lab-settings/lab-settings.component';
import { ADMIN_SETTINGS } from './admin-catalog';

/**
 * Lab settings, flattened (ND-PATTERN "Admin pages"): ONE scrolling page —
 * no pill tabs, every section at once, plain rows with segmented controls /
 * slate switches, every search anchor present, the unused "number width"
 * row gone, the sticker code described as per-branch.
 */
const auth = {
  provide: AuthService,
  useValue: {
    user: () => ({ tenantName: 'Micro World', firstName: 'Admin', branchId: null, permissions: [] }),
    activeBranchId: () => null,
    hasPermission: () => true,
    hasAnyPermission: () => true,
    isAuthenticated: () => true,
    waitForAuth: async () => undefined,
  },
};

function make(cfg: Record<string, unknown> = { labStructure: 'auto', paymentGateStage: 'none', labelCodeMode: 'barcode' }) {
  return renderBandPage(LabSettingsComponent, {
    getFor: (url) => (url === '/api/tenants/branch-lab-config' ? cfg : []),
    providers: [
      auth,
      { provide: TenantStateService, useValue: { tenant: () => ({ scanMode: 'scan' }), ensureLoaded: vi.fn(), update: vi.fn() } },
      {
        provide: BranchLabConfigService,
        useValue: { collectionMode: signal('front_desk'), billingMode: signal('front_desk'), ensureLoaded: vi.fn(), update: vi.fn() },
      },
      { provide: TenantEntitlementsService, useValue: { moduleEnabled: () => true, ensureLoaded: vi.fn() } },
    ],
  });
}

describe('Lab settings — one scrolling page (no tabs)', () => {
  it('band: no search, no pill tabs; the pill carries the page h1', () => {
    const p = make();
    expect(p.bandInput()).toBeNull();
    expect(p.tools()!.querySelector('pf-segmented')).toBeNull();
    expect(p.tools()!.querySelector('h1.nd-band-page')?.textContent).toContain('Lab settings');
    expect(p.headerIsClassicOnly()).toBe(true);
    expect(p.actions().length).toBe(0); // autosave: no Save button
  });

  it('every section renders at once, with plain headings and a jump list', () => {
    const p = make();
    const heads = Array.from(p.body()!.querySelectorAll('.nd-setsec h2')).map((h) => h.textContent?.trim());
    expect(heads).toEqual(['Samples', 'Work lists', 'Rules', 'Counters', 'Calculations']);
    const jump = Array.from(p.el.querySelectorAll('pf-settings-jump .nd-setjump__item')).map((b) => b.textContent?.trim());
    expect(jump).toEqual(heads);
  });

  it('every lab-settings search anchor exists on the page', () => {
    const p = make();
    const ids = ADMIN_SETTINGS.filter((s) => s.page === 'lab-settings').map((s) => s.id);
    expect(ids.length).toBeGreaterThan(8);
    for (const id of ids) expect(p.el.querySelector(`#${id}`), id).not.toBeNull();
  });

  it('plain labels + one short help line per row; no radio cards, paragraphs or tips', () => {
    const p = make();
    const labels = Array.from(p.body()!.querySelectorAll('.nd-set__label')).map((l) => l.textContent!.trim());
    expect(labels).toContain('How staff find a sample');
    expect(labels).toContain('Doctor must check every result');
    for (const l of labels) expect(l.split(/\s+/).length, l).toBeLessThanOrEqual(6);
    const helps = Array.from(p.body()!.querySelectorAll('.nd-set__help')).map((h) => h.textContent!.trim());
    for (const h of helps) expect(h.split(/\s+/).length, h).toBeLessThanOrEqual(12);
    expect(p.el.querySelector('.pf-ls__gate-opt, .pf-ls__hint')).toBeNull();
    expect(p.el.textContent).not.toMatch(/tip:/i);
  });

  it('the unused sample "number width" row is gone', () => {
    const p = make();
    expect(p.el.textContent).not.toMatch(/number width/i);
  });

  it('sticker code says per branch, never organisation-wide', () => {
    const p = make();
    const row = p.el.querySelector('#label-code')!;
    expect(row.textContent).toMatch(/this branch/i);
    expect(p.el.textContent).not.toMatch(/organi[sz]ation-wide|across the organi[sz]ation/i);
  });

  it('choices are segmented radiogroups named by their row label', () => {
    const p = make();
    const groups = Array.from(p.body()!.querySelectorAll<HTMLElement>('[role="radiogroup"]'));
    expect(groups.length).toBe(5); // scan · sticker code · work list · layout · unpaid bill
    for (const g of groups) {
      const by = g.getAttribute('aria-labelledby')!;
      expect(p.el.querySelector(`#${by}`)?.textContent?.trim().length).toBeGreaterThan(0);
      const radios = g.querySelectorAll('[role="radio"]');
      expect(radios.length).toBeGreaterThanOrEqual(2);
      expect(g.querySelectorAll('[role="radio"][aria-checked="true"]').length).toBe(1);
    }
  });

  it('picking "Type number" patches scanMode (same API as before)', () => {
    const p = make();
    const btn = Array.from(p.el.querySelectorAll<HTMLButtonElement>('#scan-mode [role="radio"]'))
      .find((b) => b.getAttribute('aria-label') === 'Type number')!;
    btn.click();
    p.f.detectChanges();
    expect(p.api.patch).toHaveBeenCalledWith('/api/tenants/current', { scanMode: 'manual' });
  });

  it('unpaid-bill gate: 3 short options; picking Report patches paymentGateStage', () => {
    const p = make();
    const radios = Array.from(p.el.querySelectorAll<HTMLButtonElement>('#payment-gate [role="radio"]'));
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual(['Nothing', 'Sending to lab', 'Report']);
    radios[2].click();
    p.f.detectChanges();
    expect(p.api.patch).toHaveBeenCalledWith('/api/tenants/branch-lab-config', { paymentGateStage: 'report' });
  });

  it('switches are slate kit toggles, labelled by their row', () => {
    const p = make();
    const sws = Array.from(p.body()!.querySelectorAll<HTMLButtonElement>('.nd-toggle[role="switch"]'));
    expect(sws.length).toBe(6);
    for (const sw of sws) {
      const by = sw.getAttribute('aria-labelledby')!;
      expect(p.el.querySelector(`#${by}`)?.textContent?.trim().length).toBeGreaterThan(0);
    }
    const val = p.el.querySelector<HTMLButtonElement>('#require-validation .nd-toggle')!;
    val.click();
    p.f.detectChanges();
    expect(p.api.patch).toHaveBeenCalledWith('/api/tenants/branch-lab-config', { requireValidationForAllResults: true });
  });

  it('number inputs have real labels', () => {
    const p = make();
    for (const id of ['ls-isi', 'ls-mnpt', 'ls-hct']) {
      expect(p.el.querySelector(`label[for="${id}"]`)).not.toBeNull();
    }
  });
});
