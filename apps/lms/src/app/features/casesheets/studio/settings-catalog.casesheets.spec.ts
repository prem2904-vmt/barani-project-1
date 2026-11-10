import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../../core/auth/auth.service';
import { BetaFeaturesService } from '../../../core/services/beta-features.service';
import { LabFeaturesService } from '../../../core/services/lab-features.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { SettingsCatalogService } from '../../../core/services/settings-catalog.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { SETTINGS_CATALOG } from '../../../shared/utils/settings-catalog';
import { CasesheetGateService } from '../shared/casesheet-gate.service';

function svc(gate: boolean, perms: string[]) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: { hasAnyPermission: (p: string[]) => p.some((x) => perms.includes(x)) } },
      { provide: ProcessWorkflowService, useValue: { isEnabled: () => true } },
      { provide: TenantEntitlementsService, useValue: { moduleEnabled: () => true } },
      { provide: BetaFeaturesService, useValue: { enabled: () => true } },
      { provide: LabFeaturesService, useValue: { homeCollectionEnabled: () => true } },
      { provide: CasesheetGateService, useValue: { visible: () => gate } },
    ],
  });
  return TestBed.inject(SettingsCatalogService);
}

describe('settings catalog: MyPrefrontal entry', () => {
  const entry = SETTINGS_CATALOG.find((e) => e.href === '/admin/ipd/myprefrontal')!;

  it('is listed only with the case-sheet gate open AND casesheet_forms_manage', () => {
    expect(entry.casesheets).toBe(true);
    expect(svc(true, ['casesheet_forms_manage']).canSee(entry)).toBe(true);
    expect(svc(false, ['casesheet_forms_manage']).canSee(entry)).toBe(false);
    expect(svc(true, []).canSee(entry)).toBe(false);
  });

  it('searchable by "case sheet" when visible, absent when the gate is closed', () => {
    expect(svc(true, ['casesheet_forms_manage']).search('case sheet').map((e) => e.title)).toContain('MyPrefrontal');
    expect(svc(false, ['casesheet_forms_manage']).search('case sheet').map((e) => e.title)).not.toContain('MyPrefrontal');
  });
});
