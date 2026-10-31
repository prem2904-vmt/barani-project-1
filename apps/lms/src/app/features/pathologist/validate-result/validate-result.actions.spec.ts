import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { ShareService } from '../../../core/services/share.service';
import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ValidateResultComponent } from './validate-result.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ZoomTransitionService } from '../../../core/navigation/zoom-transition';
import { PlatformService } from '../../../core/services/platform.service';

/**
 * Validate screen — the ⋮ More actions (pf-actions-menu) replaces the old
 * "More ▴" dropdown: same workflow rows under the same rules, plus go-to
 * rows gated by their route guards. Validate stays THE primary, Reject stays
 * visible — neither moves into the menu.
 */
const param = { name: 'hb', title: 'Hb', unit: 'g/dL', referenceRanges: [{ min: 12, max: 15 }] };
const ot = (id: string, sampleId = 's1', extra: Record<string, unknown> = {}) => ({
  id, status: 'entered',
  currentResult: JSON.stringify({ values: { hb: '13' } }),
  test: { name: 'Haemoglobin', parameters: JSON.stringify({ parameters: [param] }), department: { id: 'd1', name: 'Haematology' } },
  subOrder: { id: sampleId, orderId: 'o1', order: { id: 'o1', patientId: 'p1', patient: { id: 'p1', displayName: 'Priya Nair', sex: 'Female', age: 30 } } },
  ...extra,
});

afterEach(() => {
  TestBed.resetTestingModule();
  document.querySelectorAll('.pf-am-layer').forEach(n => n.remove());
  vi.restoreAllMocks();
});

async function render(o: { perms?: string[]; queue?: unknown[]; messages?: boolean } = {}) {
  const perms = o.perms ?? ['validate_result', 'edit_result', 'view_patient'];
  const api = {
    get: vi.fn((url: string) => url.startsWith('/api/validation/queue') ? of(o.queue ?? [ot('t1')]) : of([])),
    post: vi.fn(() => of({})), patch: vi.fn(() => of({})), put: vi.fn(() => of({})),
  };
  const share = { available: () => !!o.messages, openSheet: vi.fn() };
  const router = { url: '/pathologist/validate/t1', navigate: vi.fn(() => Promise.resolve(true)), events: of() };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: HttpClient, useValue: {} },
      { provide: PlatformService, useValue: { getApiUrl: () => '' } },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
      { provide: DialogService, useValue: { prompt: vi.fn(async () => null), confirm: vi.fn(async () => false), choose: vi.fn(async () => null) } },
      { provide: NavBackService, useValue: { showBack: () => true, back: vi.fn(), backTo: vi.fn() } },
      { provide: AuthService, useValue: {
        user: () => ({ id: 'u1', displayName: 'Dr A' }),
        hasPermission: (p: string) => perms.includes(p),
        hasAnyPermission: (ps: string[]) => ps.some(p => perms.includes(p)),
      } },
      { provide: ZoomTransitionService, useValue: { holding: signal(false), attachTarget() {}, detachTarget() {}, attachSource() {}, detachSource() {} } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', 't1']]), queryParamMap: new Map() } } },
      { provide: Router, useValue: router },
      { provide: TenantEntitlementsService, useValue: { moduleEnabled: () => !!o.messages } },
      { provide: ShareService, useValue: share },
    ],
  });
  const f = TestBed.createComponent(ValidateResultComponent);
  f.detectChanges();
  await f.whenStable();
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance as any, router, api, share };
}
const ids = (c: any) => c.menuActions().map((a: { id: string }) => a.id);

describe('Validate — ⋮ More actions', () => {
  it('single test, full pathologist: reassign, edit myself, send back, open patient, open lab results', async () => {
    const { c } = await render();
    expect(ids(c)).toEqual(['reassign', 'edit-self', 'send-back', 'patient', 'lab']);
  });

  it('without edit_result there is no Send back; without a patient permission no Open patient', async () => {
    const { c } = await render({ perms: ['validate_result'] });
    expect(ids(c)).toEqual(['reassign', 'edit-self', 'lab']);
  });

  it('a multi-test tube keeps only the whole-order rows (reassign / edit-self are per test)', async () => {
    const { c } = await render({ queue: [ot('t1'), ot('t2')] });
    expect(ids(c)).toEqual(['send-back', 'patient', 'lab']);
  });

  it('the ⋮ sits in the sticky bar; Validate stays the ONE primary and Reject stays visible', async () => {
    const { el, f } = await render();
    const bar = el.querySelector('.pf-stickybar') as HTMLElement;
    const kebab = bar.querySelector('pf-actions-menu .pf-vr-kebab') as HTMLButtonElement;
    expect(kebab.getAttribute('aria-label')).toBe('More actions');
    expect(kebab.getAttribute('aria-haspopup')).toBe('menu');
    expect(bar.querySelectorAll('.pf-btn--primary').length).toBe(1);
    expect(bar.querySelector('[aria-label="Reject"]')).not.toBeNull();
    kebab.click(); f.detectChanges();
    await new Promise(r => setTimeout(r, 0));
    const rows = [...document.body.querySelectorAll('[role=menu] .pf-am-item__t')].map(n => n.textContent!.trim());
    expect(rows).toEqual(['Reassign to another validator', 'Edit values myself', 'Send back for correction', 'Open patient', 'Open lab results']);
    expect(rows).not.toContain('Validate');
  });

  it('each row runs the existing handler / navigation', async () => {
    const { c, router } = await render();
    const reassign = vi.spyOn(c, 'reassign').mockResolvedValue(undefined);
    const startEdit = vi.spyOn(c, 'startEdit').mockImplementation(() => {});
    c.runAction('reassign'); expect(reassign).toHaveBeenCalled();
    c.runAction('edit-self'); expect(startEdit).toHaveBeenCalled();
    c.runAction('send-back'); expect(c.editDialogOpen()).toBe(true);
    // /p/:id picks the profile route a pathologist can open (view_patient only).
    c.runAction('patient'); expect(router.navigate).toHaveBeenCalledWith(['/p', 'p1']);
    c.runAction('lab'); expect(router.navigate).toHaveBeenCalledWith(['/lab/sample', 's1'], { queryParams: { view: 1 } });
  });
});


describe('Validate — reads only the focused test\'s tube (DB optimisation phase 3)', () => {
  it('asks the queue for this test\'s tube, not the whole queue', async () => {
    const { api } = await render();
    expect(api.get).toHaveBeenCalledWith('/api/validation/queue?mine=false&tubeOf=t1');
    expect(api.get).not.toHaveBeenCalledWith('/api/validation/queue?mine=false');
  });

  it('an older server (whole queue): the sample group is still the focused test + its tube siblings', async () => {
    const { c } = await render({ queue: [ot('t1', 's1'), ot('t2', 's1'), ot('t9', 's2')] });
    expect(c.sampleTests().map((t: { id: string }) => t.id)).toEqual(['t1', 't2']);
  });

  it('the tubeOf answer gives the same sample group', async () => {
    const { c } = await render({ queue: [ot('t1', 's1'), ot('t2', 's1')] });
    expect(c.sampleTests().map((t: { id: string }) => t.id)).toEqual(['t1', 't2']);
  });
});

describe('Validate — Share to Messages (⋮ Share)', () => {
  it('with Messages: "Share with colleague" + "Ask the technician" (who entered it is suggested) open the share sheet', async () => {
    const { c, share } = await render({ messages: true, queue: [ot('t1', 's1', { resultedBy: 'auth-tech', resultedByName: 'Karthik Iyer',
      subOrder: { id: 's1', orderId: 'o1', barcode: '26105', order: { id: 'o1', patientId: 'p1', patient: { id: 'p1', displayName: 'Priya Nair' } } } })] });
    expect(ids(c)).toEqual(['reassign', 'edit-self', 'send-back', 'share', 'ask-tech', 'patient', 'lab']);
    expect(c.menuActions().find((a: { id: string }) => a.id === 'ask-tech').hint).toBe('Entered by Karthik Iyer');
    c.runAction('share');
    expect(share.openSheet).toHaveBeenLastCalledWith(expect.objectContaining({
      target: { type: 'validation', id: 't1' }, title: 'Haemoglobin', subtitle: 'Sample 26105 · Priya Nair', heading: 'Share with colleague', suggest: [],
    }));
    c.runAction('ask-tech');
    expect(share.openSheet).toHaveBeenLastCalledWith(expect.objectContaining({
      heading: 'Ask the technician', suggest: [{ userId: 'auth-tech', name: 'Karthik Iyer' }],
    }));
  });
  it('no technician on record → no "Ask the technician"', async () => {
    const { c } = await render({ messages: true });
    expect(ids(c)).toEqual(['reassign', 'edit-self', 'send-back', 'share', 'patient', 'lab']);
  });
});
