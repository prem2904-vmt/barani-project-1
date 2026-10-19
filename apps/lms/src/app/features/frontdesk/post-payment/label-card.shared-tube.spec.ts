import { TestBed } from '@angular/core/testing';
import { LabelCardComponent } from './label-card.component';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';

/** A shared tube (CBC + HbA1c on one EDTA) prints ONE label naming both departments. */
describe('Label card — shared tube', () => {
  it('names every department on the tube', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: BranchLabConfigService, useValue: { ensureLoaded() {}, config: () => null, labelCodeMode: () => 'barcode' } }],
    });
    const f = TestBed.createComponent(LabelCardComponent);
    const c = f.componentInstance as any;
    c.sample = {
      id: 's1', barcode: '26209', tubeColor: 'edta', status: 'pending', rejectionCount: 0, tests: [],
      department: { id: 'h', name: 'Haematology', code: 'HEM' },
      departments: [{ id: 'h', name: 'Haematology', code: 'HEM' }, { id: 'b', name: 'Biochemistry', code: 'BIO' }],
    };
    expect(c.deptName).toBe('HAEMATOLOGY · BIOCHEMISTRY');
    expect(c.deptCode).toBe('HEM/BIO');
    expect(c.barcode).toBe('26209');
  });
});
