import { provideHttpClient } from '@angular/common/http';
import { renderBandPage } from './admin-band.spec-helpers';
import { BranchesComponent } from './branches/branches.component';

/**
 * Admin band — list pages (group C): each gets a page-specific pill search,
 * its filters in the pill, and its primary button in the band actions. The
 * classic header stays in code as pf-classic-only.
 */
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ');

describe('Admin band — Branches', () => {
  const branches = [
    { id: 'b1', name: 'Main Lab', code: 'MAIN', city: 'Chennai', isActive: true, hasPfBox: false },
    { id: 'b2', name: 'Anna Nagar', code: 'ANN', city: 'Chennai', isActive: true, hasPfBox: false,
      subBranches: [{ id: 's1', branchId: 'b2', name: 'Kilpauk Satellite', code: 'KIL', type: 'satellite', isActive: true }] },
    { id: 'b3', name: 'Madurai Centre', code: 'MDU', city: 'Madurai', isActive: true, hasPfBox: false },
  ];
  const render = () => renderBandPage(BranchesComponent, {
    getFor: (url) => url.startsWith('/api/tenants/branches') ? branches
      : url.startsWith('/api/tenants/departments') ? [{ id: 'd1', name: 'Haematology', code: 'HEM', isActive: true }]
          : [],
  });
  const names = (el: HTMLElement) => Array.from(el.querySelectorAll('.pf-branch-toggle')).map(b => text(b));

  it('band present, header classic-only, list in the band body', () => {
    const p = render();
    expect(p.band()).not.toBeNull();
    expect(p.headerIsClassicOnly()).toBe(true);
    expect(p.body()!.querySelectorAll('.pf-branch-toggle').length).toBe(3);
  });

  it('"Add branch" rides the band actions and toggles the form (Cancel while open)', () => {
    const p = render();
    const btn = p.actions().find(b => /Add branch/.test(b.textContent ?? ''))!;
    expect(btn).toBeTruthy();
    btn.click(); p.f.detectChanges();
    expect(text(p.body())).toContain('New branch');
    expect(p.actions()[0].textContent).toContain('Cancel');
  });

  it('pill search matches branch fields, and a sub-branch keeps its parent', () => {
    const p = render();
    p.type('madurai');
    expect(names(p.el).length).toBe(1);
    expect(names(p.el)[0]).toContain('Madurai Centre');
    p.type('kilpauk');
    expect(names(p.el).length).toBe(1);
    expect(names(p.el)[0]).toContain('Anna Nagar');
  });

  it('a department hit keeps every branch (departments are tenant-global)', () => {
    const p = render();
    p.type('haem');
    expect(names(p.el).length).toBe(3);
  });

  it('no match → empty state', () => {
    const p = render();
    p.type('zzz');
    expect(names(p.el).length).toBe(0);
    expect(p.body()!.querySelector('.pf-band-empty')).not.toBeNull();
  });
});
