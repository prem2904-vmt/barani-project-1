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
    expect(el.textContent).toContain('Master updates');
    expect(el.textContent).toContain('2 updates for tests you changed');
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

  it('Review shows each request\'s dates and the Field · Yours · Master difference', () => {
    const { f, c, el } = render({ proposals: [{
      id: 'p1', catalogKey: 'BIO010', kind: 'update', targetTestId: 'hb', createdAt: '',
      masterUpdatedAt: '2026-09-24T12:00:00Z', yourChangedAt: '2026-09-20T12:00:00Z',
      fields: [
        { field: 'TatHours', label: 'Turnaround time', yours: '4 hours', master: '3 hours' },
        { field: 'Section', label: 'Section', yours: null, master: 'Glucose' },
      ],
    }] });
    c.open.set(true);
    f.detectChanges();
    const row = el.querySelector('.pf-cp__row')!;
    expect(row.querySelector('.pf-cp__dates')?.textContent).toMatch(/^Master updated 24 Sep( 2026)?, after your change on 20 Sep( 2026)?$/);
    const head = [...row.querySelectorAll('.pf-cp__diff thead th')].map(th => th.textContent?.trim());
    expect(head).toEqual(['Field', 'Yours', 'Master']);
    const cells = [...row.querySelectorAll('.pf-cp__diff tbody tr')].map(tr =>
      [...tr.querySelectorAll('th, td')].map(x => x.textContent?.trim()));
    expect(cells).toEqual([
      ['Turnaround time', '4 hours', '3 hours'],
      ['Section', '\u2014', 'Glucose'],
    ]);
  });

  it('per-row Accept / Dismiss buttons post that request and tell the host', () => {
    const { f, c, el, api, changed } = render();
    c.open.set(true);
    f.detectChanges();
    const rows = el.querySelectorAll('.pf-cp__row');
    const btn = (row: Element, label: string) =>
      [...row.querySelectorAll('button')].find(b => b.textContent?.trim() === label) as HTMLButtonElement;
    btn(rows[1], 'Accept').click();
    expect(api.post).toHaveBeenCalledWith('/api/catalog-proposals/p2/accept', {});
    expect(changed).toHaveBeenCalledTimes(1);
    btn(rows[0], 'Dismiss').click();
    expect(api.post).toHaveBeenCalledWith('/api/catalog-proposals/p1/dismiss', {});
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('falls back to the server-resolved test name / code when the grid has no row', () => {
    const { f, c, el } = render({ proposals: [{ id: 'p3', catalogKey: 'BIO010', kind: 'update', targetTestId: 'gone',
      testName: 'Fasting Blood Sugar', testCode: 'BIO010', createdAt: '' }] });
    c.open.set(true);
    f.detectChanges();
    expect(el.querySelector('.pf-cp__row')?.textContent).toContain('Fasting Blood Sugar');
  });
});
