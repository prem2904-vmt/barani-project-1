import { prepareSwitchOn } from './casesheet-gate';
import { prepareNav, withPrepare, type NavItem } from '../../../layout/nav-items';
import { casesheetNavFor } from '../data/casesheet-nav';
import { CASESHEET_SHELL_ROUTES } from '../casesheets.routes';
import { casesheetPrepareGuard } from './casesheet.guard';

/** Owner 2026-11-11: a Prepare tab next to Frontdesk, switched in Settings → IPD (ipd.features.prepare; absent = on). */
describe('Prepare switch + tab', () => {
  it('Prepare is on unless ipd.features.prepare is literally false', () => {
    expect(prepareSwitchOn(null)).toBe(true);
    expect(prepareSwitchOn({ ipd: { enabled: true } } as never)).toBe(true);
    expect(prepareSwitchOn({ ipd: { enabled: true, features: { prepare: true } } } as never)).toBe(true);
    expect(prepareSwitchOn({ ipd: { enabled: true, features: { prepare: 'false' } } } as never)).toBe(true);
    expect(prepareSwitchOn({ ipd: { enabled: true, features: { prepare: false } } } as never)).toBe(false);
  });

  const tab = (id: string): NavItem => ({ id, label: id, href: `/${id}`, iconPath: [] });

  it('the tab goes right after Frontdesk, once', () => {
    const out = withPrepare([tab('frontdesk'), tab('lab'), tab('results')], prepareNav(true));
    expect(out.map(i => i.id)).toEqual(['frontdesk', 'prepare', 'lab', 'results']);
    expect(withPrepare(out, prepareNav(true)).filter(i => i.id === 'prepare').length).toBe(1);
  });

  it('no Frontdesk tab: Prepare is first; switched off: unchanged', () => {
    expect(withPrepare([tab('lab')], prepareNav(true)).map(i => i.id)).toEqual(['prepare', 'lab']);
    expect(withPrepare([tab('lab')], null).map(i => i.id)).toEqual(['lab']);
  });

  it('a filler opens Departments; a reader opens the list', () => {
    expect(prepareNav(true).href).toBe('/prepare');
    expect(prepareNav(false).href).toBe('/prepare/cases');
    expect(prepareNav(true).iconPath?.length).toBeGreaterThan(0);
  });

  it('in the lab, home without a patient is the Prepare tab (never the front desk)', () => {
    const lab = casesheetNavFor('lms');
    expect(lab.departments(null)).toEqual({ path: '/prepare' });
    expect(lab.list(null)).toBe('/prepare/cases');
    expect(lab.departments('p1')).toEqual({ path: '/casesheets/new', queryParams: { patientId: 'p1' } });
  });

  it('/prepare, /prepare/cases and /casesheets/new need Prepare on; reading a sheet does not', () => {
    const guarded = (p: string) => !!CASESHEET_SHELL_ROUTES.find(r => r.path === p)?.canActivate?.includes(casesheetPrepareGuard);
    expect(guarded('prepare')).toBe(true);
    expect(guarded('prepare/cases')).toBe(true);
    expect(guarded('casesheets/new')).toBe(true);
    expect(guarded('casesheets/:id')).toBe(false);
    expect(guarded('admin/ipd/myprefrontal')).toBe(false);
  });
});
