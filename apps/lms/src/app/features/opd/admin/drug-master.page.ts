import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';

/** Where the ONE drug master lives (Agent D): the pharmacy settings' Drug master tab. */
export const DRUG_MASTER_URL = { path: ['/admin/pharmacy/drugs'], queryParams: {} } as const;

/**
 * `/admin/opd/drugs` (OPD Master hub → "Drug master & stock"). Integrator: the
 * drug master is Agent D's copy-on-write grid (`<pf-pharmacy-drug-master>` in
 * `/admin/opd/pharmacy?tab=drugs`, whose band carries the one Save) — this
 * gated route keeps its path and forwards there, so there is never a second
 * drug-master screen.
 */
@Component({
  selector: 'pf-opd-drug-master',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
})
export class OpdDrugMasterPage {
  constructor() {
    void inject(Router).navigate([...DRUG_MASTER_URL.path], { queryParams: { ...DRUG_MASTER_URL.queryParams }, replaceUrl: true });
  }
}
