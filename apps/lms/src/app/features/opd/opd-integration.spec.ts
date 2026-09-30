import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { DEFAULT_OPD_WORKFLOW, DEFAULT_OPD_QUEUE } from './shared/opd.models';
import { OpdDrugMasterPage, DRUG_MASTER_URL } from './admin/drug-master.page';
import { REFUND_CHOICES } from './frontdesk/visit-detail.page';

/**
 * OPD integrator contracts (feat/opd-integrated): one drug master (D's), the
 * shared workflow defaults the consult and the Workflow editor both read, and
 * the desk's refund choices (credit notes).
 */
describe('OPD integration contracts', () => {
  it('/admin/opd/drugs forwards to the ONE drug master (pharmacy settings → Drug master tab)', () => {
    const navigate = vi.fn(async () => true);
    TestBed.configureTestingModule({ imports: [OpdDrugMasterPage], providers: [{ provide: Router, useValue: { navigate } }] });
    TestBed.createComponent(OpdDrugMasterPage);
    expect(navigate).toHaveBeenCalledWith(['/admin/opd/pharmacy'], { queryParams: { tab: 'drugs' }, replaceUrl: true });
    expect(DRUG_MASTER_URL.queryParams.tab).toBe('drugs');
  });

  it('workflow defaults carry the private-notes visibility the consult reads (doctor only)', () => {
    expect(DEFAULT_OPD_WORKFLOW.privateNotesVisibility).toBe('doctor');
    expect(DEFAULT_OPD_WORKFLOW.pharmacy?.enabled).toBe(true);
    expect(DEFAULT_OPD_QUEUE.organise).toBe('per_doctor');
  });

  it('a paid cancel can refund by cash / UPI / card or keep the money', () => {
    expect(REFUND_CHOICES.map(c => c.value)).toEqual(['cash', 'upi', 'card', 'keep']);
  });
});
