import { vi } from 'vitest';
import { renderBandPage } from '../admin-band.spec-helpers';
import { OrganizationSettingsComponent } from './organization-settings.component';
import { AuthService } from '../../../core/auth/auth.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { DialogService } from '../../../core/services/dialog.service';

/**
 * Organization › Identity (owner, 2026-09-25): saving a CHANGED login handle
 * asks first — "Changing the login handle changes how staff sign in.
 * Continue?" — and writes nothing on Cancel. An unchanged handle (name-only
 * save) never asks.
 */
function make(confirmResult: boolean) {
  const confirm = vi.fn(async () => confirmResult);
  const p = renderBandPage(OrganizationSettingsComponent, {
    getFor: (url) => (url === '/api/tenants/current' ? { name: 'Micro World', slug: 'microworld' } : {}),
    providers: [
      { provide: AuthService, useValue: {
        user: () => ({ tenantName: 'Micro World', firstName: 'Admin', branchId: null, permissions: [] }),
        activeBranchId: () => null, hasPermission: () => true, hasAnyPermission: () => true,
        isAuthenticated: () => true, waitForAuth: async () => undefined,
      } },
      { provide: TenantStateService, useValue: { tenant: () => null, ensureLoaded: vi.fn(), update: vi.fn() } },
      { provide: DialogService, useValue: { confirm, prompt: vi.fn(async () => null) } },
    ],
  });
  return { ...p, confirm };
}
const bandSave = (p: ReturnType<typeof make>) =>
  p.el.querySelector<HTMLButtonElement>('pf-hero-band .pf-hb__actions .pf-hb-btn--primary')!;
const flush = () => new Promise(r => setTimeout(r));
const slugPatches = (p: ReturnType<typeof make>) =>
  p.api.patch.mock.calls.filter((c: any[]) => c[0] === '/api/tenants/current' && 'slug' in (c[1] ?? {}));

describe('Organization — login-handle change needs a confirm', () => {
  it('a changed handle asks first; Cancel writes nothing', async () => {
    const p = make(false);
    p.cmp.onSlugInput('newlab');
    p.f.detectChanges();
    bandSave(p).click();
    await flush();
    expect(p.confirm).toHaveBeenCalledTimes(1);
    expect((p.confirm.mock.calls[0] as any[])[0].message).toBe('Changing the login handle changes how staff sign in. Continue?');
    expect(slugPatches(p).length).toBe(0);
  });

  it('confirming saves the new handle', async () => {
    const p = make(true);
    p.cmp.onSlugInput('newlab');
    p.f.detectChanges();
    bandSave(p).click();
    await flush();
    expect(slugPatches(p).map((c: any[]) => c[1])).toEqual([{ slug: 'newlab' }]);
  });

  it('an unchanged handle (name-only save) never asks', async () => {
    const p = make(true);
    p.cmp.orgName.set('Micro World Labs');
    p.f.detectChanges();
    bandSave(p).click();
    await flush();
    expect(p.confirm).not.toHaveBeenCalled();
    expect(slugPatches(p).length).toBe(0);
    expect(p.api.patch).toHaveBeenCalledWith('/api/tenants/current', { name: 'Micro World Labs' });
  });
});
