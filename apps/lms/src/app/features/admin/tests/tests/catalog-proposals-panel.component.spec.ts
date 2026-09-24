import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { CatalogProposalsPanelComponent } from './catalog-proposals-panel.component';
import { ApiService } from '../../../../core/services/api.service';
import { ToastService } from '../../../../core/services/toast.service';
import { DialogService } from '../../../../core/services/dialog.service';
import { AuthService } from '../../../../core/auth/auth.service';

/** Test Master updates for tests the lab changed: per-row (branch copies
 *  named) with Accept all / Dismiss all behind a DialogService confirm. */
function render(opts: { confirm?: boolean; proposals?: any[] } = {}) {
  const api = { post: vi.fn(() => of({})) };
  const dialog = { confirm: vi.fn(async () => opts.confirm ?? true) };
  TestBed.configureTestingModule({
    imports: [CatalogProposalsPanelComponent],
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn() } },
      { provide: DialogService, useValue: dialog },
      { provide: AuthService, useValue: { user: () => ({ branches: [{ id: 'b1', name: 'Alwarpet' }] }) } },
    ],
  });
  const f = TestBed.createComponent(CatalogProposalsPanelComponent);
  f.componentRef.setInput('proposals', opts.proposals ?? [
    { id: 'p1', catalogKey: 'HEM012', kind: 'update', targetTestId: 'hb', createdAt: '' },
    { id: 'p2', catalogKey: 'HEM012', kind: 'update', targetTestId: 'hb-b1', branchId: 'b1', createdAt: '' },
  ]);
  f.componentRef.setInput('tests', [
    { id: 'hb', name: 'Haemoglobin', testCode: 'HEM012' },
    { id: 'hb-b1', name: 'Haemoglobin', testCode: 'HEM012', branchId: 'b1' },
  ]);
  const changed = vi.fn();
  f.componentInstance.changed.subscribe(changed);
  f.detectChanges();
  return { f, c: f.componentInstance as any, api, dialog, changed, el: f.nativeElement as HTMLElement };
}

describe('CatalogProposalsPanel', () => {
  it('hidden when nothing waits', () => {
    const { el } = render({ proposals: [] });
    expect(el.querySelector('.pf-cp')).toBeNull();
  });

  it('summarises and lists every proposal per copy, naming the branch', () => {
    const { f, c, el } = render();
    expect(el.textContent).toContain('2 Test Master updates');
    c.open.set(true);
    f.detectChanges();
    const rows = [...el.querySelectorAll('.pf-cp__row')].map(r => r.textContent ?? '');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('All branches');
    expect(rows[1]).toContain('Alwarpet');
    expect(rows[1]).toContain('HEM012');
  });

  it('Accept all confirms, POSTs accept-all and tells the host', async () => {
    const { c, api, dialog, changed } = render();
    await c.acceptAll();
    expect(dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Accept all' }));
    expect(api.post).toHaveBeenCalledWith('/api/catalog-proposals/accept-all', {});
    expect(changed).toHaveBeenCalled();
  });

  it('Dismiss all cancelled sends nothing', async () => {
    const { c, api } = render({ confirm: false });
    await c.dismissAll();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('Dismiss all confirmed POSTs dismiss-all; single accept / dismiss hit the per-proposal routes', async () => {
    const { c, api } = render();
    await c.dismissAll();
    expect(api.post).toHaveBeenCalledWith('/api/catalog-proposals/dismiss-all', {});
    c.accept('p2');
    expect(api.post).toHaveBeenCalledWith('/api/catalog-proposals/p2/accept', {});
    c.dismiss('p1');
    expect(api.post).toHaveBeenCalledWith('/api/catalog-proposals/p1/dismiss', {});
  });
});
