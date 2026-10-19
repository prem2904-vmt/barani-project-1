import { TestBed } from '@angular/core/testing';
import { LabelCardComponent } from './label-card.component';

const sample = (extra: any = {}) => ({
  id: 's1', orderId: 'o1', departmentId: 'd1', status: 'pending', barcode: 'OUT-2609-00012', rejectionCount: 0,
  createdAt: '2026-09-25T00:00:00Z', tests: [{ id: 't1', subOrderId: 's1', testId: 'x', name: 'Vitamin D', status: 'pending', test: { name: 'Vitamin D' } }],
  department: { name: 'Biochemistry', code: 'BIO' }, tubeColor: 'red', ...extra,
});

function render(s: any) {
  TestBed.configureTestingModule({ imports: [LabelCardComponent] });
  const f = TestBed.createComponent(LabelCardComponent);
  f.componentInstance.sample = s;
  f.componentInstance.patient = { displayName: 'Ms. Paravai Munusamy', mrn: 'AA0007' } as any;
  f.detectChanges();
  return f.nativeElement as HTMLElement;
}

describe('Printed label — outsourced', () => {
  it('is the normal label plus a prominent OUTSOURCED word (no partner name)', () => {
    const normal = render(sample());
    expect(normal.querySelector('.pf-lc__outsourced')).toBeNull();
    TestBed.resetTestingModule();
    const out = render(sample({ outsourcedVendorId: 'lab-1' }));
    const preview = out.querySelector('.pf-lc__preview') as HTMLElement;
    expect(preview.querySelector('.pf-lc__outsourced')?.textContent?.trim()).toBe('OUTSOURCED');
    // Everything else on the label is the same.
    expect(preview.querySelector('.pf-lc__pname')?.textContent).toContain('Ms. Paravai Munusamy');
    expect(preview.querySelector('.pf-lc__sid')?.textContent).toContain('OUT-2609-00012');
    expect(out.textContent).not.toContain('⇗');
  });
});
