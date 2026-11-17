import { Observable, of } from 'rxjs';
import { vi } from 'vitest';
import { confirmLeaveUnsaved, hasUnsavedChangesContract } from './unsaved-changes';
import { DialogService } from '../../core/services/dialog.service';

/** "Save your changes?" (owner 2026-11-17): dirty → dialog; Save success leaves; Save fail stays; Leave discards; clean → no dialog. */
function dialog(action: string | null) {
  return { actions: vi.fn(async () => ({ action, checked: false })) } as unknown as DialogService & { actions: ReturnType<typeof vi.fn> };
}
const page = (dirty: boolean, save?: () => Promise<boolean> | Observable<boolean>) => ({
  hasUnsavedChanges: () => dirty, unsavedLabel: 'Billing', ...(save ? { saveChanges: save } : {}),
});

describe('unsaved changes — ask before leaving', () => {
  it('clean (or not a page with Save): no dialog, leave', async () => {
    const d = dialog('save');
    expect(await confirmLeaveUnsaved(d, page(false))).toBe(true);
    expect(await confirmLeaveUnsaved(d, { anything: 1 })).toBe(true);
    expect(d.actions).not.toHaveBeenCalled();
    expect(hasUnsavedChangesContract({ hasUnsavedChanges: () => true })).toBe(true);
  });

  it('dirty: asks "Save your changes?" naming the page, Save / Leave without saving / Stay', async () => {
    const d = dialog(null);
    expect(await confirmLeaveUnsaved(d, page(true, async () => true))).toBe(false);   // Stay
    const req = d.actions.mock.calls[0][0];
    expect(req.title).toBe('Save your changes?');
    expect(req.message).toBe("You changed Billing but haven't saved.");
    expect(req.cancelLabel).toBe('Stay');
    expect(req.actions.map((a: { label: string }) => a.label)).toEqual(['Save', 'Leave without saving']);
    expect(req.actions[0].variant).toBe('primary');
  });

  it('Save that succeeds leaves; Save that fails (or throws) stays', async () => {
    expect(await confirmLeaveUnsaved(dialog('save'), page(true, async () => true))).toBe(true);
    expect(await confirmLeaveUnsaved(dialog('save'), page(true, () => of(true)))).toBe(true);
    expect(await confirmLeaveUnsaved(dialog('save'), page(true, async () => false))).toBe(false);
    expect(await confirmLeaveUnsaved(dialog('save'), page(true, async () => { throw new Error('x'); }))).toBe(false);
  });

  it('Leave without saving discards and leaves; a page without saveChanges offers only Leave / Stay', async () => {
    expect(await confirmLeaveUnsaved(dialog('leave'), page(true, async () => true))).toBe(true);
    const d = dialog('leave');
    expect(await confirmLeaveUnsaved(d, page(true))).toBe(true);
    expect(d.actions.mock.calls[0][0].actions.map((a: { label: string }) => a.label)).toEqual(['Leave without saving']);
  });
});
