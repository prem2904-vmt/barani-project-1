import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { OpdAdminApi, OpdWorkflowSettings } from './opd-admin.api';
import { DEFAULT_WORKFLOW_SETTINGS, OpdWorkflowPage, applyPatch, mergeSettings } from './workflow.page';

/**
 * OPD workflow & settings — every step is the lab's own opt-in / opt-out,
 * saved as a merge-patch (only the changed key), rolled back on failure;
 * private notes default to the doctor only.
 */
function render(opts: { saveFails?: boolean; confirm?: boolean; server?: Partial<OpdWorkflowSettings> } = {}) {
  const api = {
    workflow: vi.fn(() => of(mergeSettings(opts.server ?? {}))),
    saveWorkflow: vi.fn((p: unknown) => (opts.saveFails ? throwError(() => new Error('nope')) : of(applyPatch(mergeSettings(opts.server ?? {}), p as never)))),
  };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  const dialog = { confirm: vi.fn(async () => opts.confirm ?? true) };
  TestBed.configureTestingModule({
    imports: [OpdWorkflowPage],
    providers: [
      { provide: OpdAdminApi, useValue: api },
      { provide: ToastService, useValue: toasts },
      { provide: DialogService, useValue: dialog },
      { provide: ThemeService, useValue: { isDark: () => false, isNewDesign: () => true } },
    ],
  });
  TestBed.overrideComponent(OpdWorkflowPage, { set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA] } });
  const f = TestBed.createComponent(OpdWorkflowPage);
  f.detectChanges();
  return { f, c: f.componentInstance, el: f.nativeElement as HTMLElement, api, toasts, dialog };
}

describe('OPD workflow settings', () => {
  it('defaults: vitals at the desk, pay at booking, pharmacy on, private notes doctor only, earliest expiry', () => {
    const d = DEFAULT_WORKFLOW_SETTINGS;
    expect(d.workflow).toMatchObject({ vitals: 'desk', billing: 'before_consult', privateNotesVisibility: 'doctor', pharmacy: { enabled: true } });
    expect(d.pharmacy.batchPick).toBe('earliest_expiry');
    expect(d.queue).toMatchObject({ organise: 'per_doctor', doctorUnavailable: 'manual' });
  });

  it('merges a partial server answer over the defaults', () => {
    const s = mergeSettings({ workflow: { vitals: 'station' } as never });
    expect(s.workflow.vitals).toBe('station');
    expect(s.workflow.prefill.purposeToComplaint).toBe(true);
    expect(s.pharmacy.batchPick).toBe('earliest_expiry');
  });

  it('a change is applied at once and sent as a merge-patch of only that key', () => {
    const { c, api } = render();
    c.put({ queue: { organise: 'per_room' } });
    expect(api.saveWorkflow).toHaveBeenCalledWith({ queue: { organise: 'per_room' } });
    expect(c.s().queue.organise).toBe('per_room');
  });

  it('rolls back and says so when the save fails', () => {
    const { c, toasts } = render({ saveFails: true });
    c.put({ workflow: { billing: 'after_consult' } });
    expect(c.s().workflow.billing).toBe('before_consult');
    expect(toasts.error).toHaveBeenCalled();
  });

  it('turning the pharmacy step off asks first (DialogService, never window.confirm)', async () => {
    const { c, api, dialog } = render({ confirm: false });
    await c.togglePharmacy();
    expect(dialog.confirm).toHaveBeenCalled();
    expect(api.saveWorkflow).not.toHaveBeenCalled();
  });

  it('token prefix must be up to 4 letters or digits', () => {
    const { c, api, toasts } = render();
    c.setPrefix('toolong');
    expect(toasts.error).toHaveBeenCalled();
    c.setPrefix('a1');
    expect(api.saveWorkflow).toHaveBeenCalledWith({ queue: { tokenPrefix: 'A1' } });
  });

  it('renders the flow with the radio cards as kit rows (no native select)', () => {
    const { el } = render();
    expect(el.querySelector('select')).toBeNull();
    expect(el.querySelectorAll('[role="radio"]').length).toBeGreaterThan(8);
    expect(Array.from(el.querySelectorAll('.wf-step__t')).map((x) => x.textContent?.trim())).toEqual(['Front desk', 'Vitals', 'Doctor', 'Pharmacy', 'Exit']);
  });
});
