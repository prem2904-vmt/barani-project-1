import { CASESHEET_PERMISSION_CODES } from './casesheet-permissions';
import { visibleGatedPermissions } from './gated-permissions';

/** The role editor hides the case-sheet (and OPD) permission codes while their gate is closed. */
describe('visibleGatedPermissions', () => {
  const perms = ['create_order', 'manage_users', 'casesheet_fill', 'casesheet_view', 'casesheet_forms_manage', 'manage_opd', 'opd_consult']
    .map(code => ({ code, name: code }));
  const codes = (g: { opd: boolean; casesheets: boolean }) => visibleGatedPermissions(perms, g).map(p => p.code);

  it('the three case-sheet codes are exactly the plan\'s', () => {
    expect([...CASESHEET_PERMISSION_CODES].sort()).toEqual(['casesheet_fill', 'casesheet_forms_manage', 'casesheet_view']);
  });
  it('both gates closed: only the lab codes (today\'s list)', () => {
    expect(codes({ opd: false, casesheets: false })).toEqual(['create_order', 'manage_users']);
  });
  it('case-sheet gate open: its codes show; OPD stays hidden', () => {
    expect(codes({ opd: false, casesheets: true })).toEqual(['create_order', 'manage_users', 'casesheet_fill', 'casesheet_view', 'casesheet_forms_manage']);
  });
  it('OPD gate open: OPD codes show; case sheets stay hidden', () => {
    expect(codes({ opd: true, casesheets: false })).toEqual(['create_order', 'manage_users', 'manage_opd', 'opd_consult']);
  });
});
