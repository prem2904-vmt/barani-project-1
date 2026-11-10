import { OPD_PERMISSION_CODES } from '../../opd/shared/opd-permissions';
import { CASESHEET_PERMISSION_CODES } from './casesheet-permissions';

/**
 * The role editor's permission list with every GATED code removed while its gate is closed: OPD / pharmacy codes
 * (OpdGateService) and the case-sheet codes (CasesheetGateService). Pure; the role editor preserves hidden grants on
 * save (it never sends what it did not show).
 */
export function visibleGatedPermissions<T extends { code: string }>(
  perms: readonly T[],
  gates: { opd: boolean; casesheets: boolean },
): T[] {
  return perms.filter(p =>
    (gates.opd || !OPD_PERMISSION_CODES.has(p.code)) &&
    (gates.casesheets || !CASESHEET_PERMISSION_CODES.has(p.code)));
}
