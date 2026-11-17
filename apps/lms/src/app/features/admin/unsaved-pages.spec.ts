import { computed, signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { ReportTemplateComponent } from './report-template/report-template.component';
import { BillingConfigComponent } from './billing-config/billing-config.component';
import { TestEditorComponent } from './tests/test-editor/test-editor.component';
import { hasUnsavedChangesContract } from '../../shared/utils/unsaved-changes';

/**
 * "Save your changes?" (owner 2026-11-17) on the pages with an explicit Save: Report design, Billing › GST / Invoices
 * and bill design, and the test editor implement HasUnsavedChanges. Methods run against stubs (no TestBed).
 */
const rt = ReportTemplateComponent.prototype as any;
const bc = BillingConfigComponent.prototype as any;
const te = TestEditorComponent.prototype as any;

describe('Report design asks before it is left', () => {
  const make = (post: () => unknown) => {
    const self: any = {
      dirty: signal(true), deptPatientDirty: signal(false), saving: signal(false), _tpl: signal({ labName: 'X' }), savedJson: signal(''),
      api: { post: vi.fn(post) }, toasts: { success: vi.fn(), error: vi.fn() },
    };
    self.postTemplate = rt.postTemplate.bind(self);
    self.postDeptPatient = vi.fn(async () => true);
    return self;
  };
  it('implements the contract: dirty template or department strip = unsaved', () => {
    const s = make(() => of({}));
    expect(hasUnsavedChangesContract(rt)).toBe(true);
    expect(rt.hasUnsavedChanges.call(s)).toBe(true);
    s.dirty.set(false);
    expect(rt.hasUnsavedChanges.call(s)).toBe(false);
    s.deptPatientDirty.set(true);
    expect(rt.hasUnsavedChanges.call(s)).toBe(true);
  });
  it('Save from the prompt posts the template and resolves true; a failed save stays', async () => {
    const ok = make(() => of({}));
    expect(await rt.saveChanges.call(ok)).toBe(true);
    expect(ok.api.post).toHaveBeenCalledWith('/api/config/report-template', { labName: 'X' });
    const bad = make(() => throwError(() => ({ message: 'no' })));
    expect(await rt.saveChanges.call(bad)).toBe(false);
    expect(bad.toasts.error).toHaveBeenCalled();
  });
});

describe('Billing › bill design asks before it is left', () => {
  it('dirty only after the server answered and something changed', () => {
    const self: any = { _tpl: signal({ a: 1 }), _config: signal({ gstEnabled: true }), savedTplJson: signal<string | null>(null), savedConfigJson: signal<string | null>(null) };
    self.tplDirty = computed(() => self.savedTplJson() !== null && JSON.stringify(self._tpl()) !== self.savedTplJson());
    self.configDirty = computed(() => self.savedConfigJson() !== null && JSON.stringify(self._config()) !== self.savedConfigJson());
    expect(bc.hasUnsavedChanges.call(self)).toBe(false);
    self.savedTplJson.set(JSON.stringify({ a: 1 })); self.savedConfigJson.set(JSON.stringify({ gstEnabled: true }));
    expect(bc.hasUnsavedChanges.call(self)).toBe(false);
    self._tpl.set({ a: 2 });
    expect(bc.hasUnsavedChanges.call(self)).toBe(true);
  });
  it('Save from the prompt saves what changed, in order, and stops on a failure', async () => {
    const self: any = { configDirty: () => true, tplDirty: () => true, postConfig: vi.fn(async () => false), postTpl: vi.fn(async () => true) };
    expect(await bc.saveChanges.call(self)).toBe(false);
    expect(self.postTpl).not.toHaveBeenCalled();
    self.postConfig = vi.fn(async () => true);
    expect(await bc.saveChanges.call(self)).toBe(true);
    expect(self.postTpl).toHaveBeenCalled();
  });
});

describe('Test editor asks before it is left', () => {
  it('unsaved = dirty once the record has loaded; Save from the prompt waits for the save', async () => {
    const self: any = { dirty: signal(true), recordSkeleton: signal(false), _saving: signal(false) };
    expect(te.hasUnsavedChanges.call(self)).toBe(true);
    self.recordSkeleton.set(true);
    expect(te.hasUnsavedChanges.call(self)).toBe(false);
    self.saveTest = () => { self._saving.set(true); setTimeout(() => { self.dirty.set(false); self._saving.set(false); }, 150); };
    expect(await te.saveChanges.call(self)).toBe(true);
  });
});
