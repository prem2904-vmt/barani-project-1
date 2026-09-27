import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { pickReassignee } from './reassign-picker';

/** Reassign = a DialogService choice of the validators who cover the
 *  result's department (server-filtered) — never a pasted user id. */
describe('pickReassignee', () => {
  const t = { id: 'ot1', test: { name: 'CBC' } } as any;
  const deps = (opts: unknown[] | Error, pick: string | null = 'u2') => ({
    api: { get: vi.fn(() => (opts instanceof Error ? throwError(() => opts) : of(opts))) } as any,
    dialog: { choose: vi.fn(async () => pick), prompt: vi.fn() } as any,
    toasts: { error: vi.fn() } as any,
  });

  it('offers the department\'s validators as choices and returns the pick', async () => {
    const d = deps([{ id: 'u1', name: 'Dr. A', assigned: true }, { id: 'u2', name: 'Dr. B', assigned: false }]);
    expect(await pickReassignee(d.api, d.dialog, d.toasts, t)).toBe('u2');
    expect(d.api.get).toHaveBeenCalledWith('/api/validation/ot1/reassign-options');
    const req = d.dialog.choose.mock.calls[0][0];
    expect(req.choices.map((c: { label: string }) => c.label)).toEqual(['Dr. A', 'Dr. B']);
    expect(req.choices[0].hint).toBe('Currently assigned');
    expect(req.initialChoice).toBe('u2');
    expect(d.dialog.prompt).not.toHaveBeenCalled();
  });

  it('nobody to pick → a toast, no dialog', async () => {
    const d = deps([]);
    expect(await pickReassignee(d.api, d.dialog, d.toasts, t)).toBeNull();
    expect(d.dialog.choose).not.toHaveBeenCalled();
    expect(d.toasts.error).toHaveBeenCalled();
  });

  it('out of scope (403) → the server message, no dialog', async () => {
    const d = deps(new Error("This work belongs to a department that isn't assigned to you."));
    expect(await pickReassignee(d.api, d.dialog, d.toasts, t)).toBeNull();
    expect(d.dialog.choose).not.toHaveBeenCalled();
    expect(d.toasts.error).toHaveBeenCalled();
  });
});
