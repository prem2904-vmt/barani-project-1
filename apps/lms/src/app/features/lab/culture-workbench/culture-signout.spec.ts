import { SampleResultEntryComponent } from '../sample-result-entry/sample-result-entry.component';
import { ResultEntryComponent } from '../result-entry/result-entry.component';
import { ValidateResultComponent } from '../../pathologist/validate-result/validate-result.component';
import { PendingValidationComponent } from '../../pathologist/pending-validation/pending-validation.component';
import { CultureEntryComponent } from '../culture-entry/culture-entry.component';
import { CultureWorkbenchComponent } from './culture-workbench.component';

/** One culture screen (owner): entry AND sign-out live on the Culture case
 *  page; every other screen only links to it. */

const deps = (cmp: any): unknown[] => {
  const d = cmp.ɵcmp.dependencies;
  return (typeof d === 'function' ? d() : d) ?? [];
};

describe('no old culture form anywhere', () => {
  it('only the Culture case page renders the culture entry component', () => {
    expect(deps(SampleResultEntryComponent)).not.toContain(CultureEntryComponent);
    expect(deps(ResultEntryComponent)).not.toContain(CultureEntryComponent);
    expect(deps(ValidateResultComponent)).not.toContain(CultureEntryComponent);
    expect(deps(CultureWorkbenchComponent)).toContain(CultureEntryComponent);
  });
});

describe('mixed tube on sample result entry', () => {
  const P = SampleResultEntryComponent.prototype as any;
  it('the culture card links to /lab/culture/:orderTestId', () => {
    const navigate = vi.fn(() => Promise.resolve(true));
    P.openCultureBench.call({ router: { navigate } }, { id: 'ot-42' });
    expect(navigate).toHaveBeenCalledWith(['/lab/culture', 'ot-42']);
  });
  it('culture tests never ride the tube\'s validate batch (other tests stay)', () => {
    const tests = [{ id: 'c', status: 'entered' }, { id: 'n', status: 'entered' }];
    const ctx = { _sample: () => ({ tests }), isCultureTest: (t: any) => t.id === 'c' };
    expect(P.enteredTests.call(ctx).map((t: any) => t.id)).toEqual(['n']);
  });
});

describe('validation routing', () => {
  it('pending-validation sends a culture test to the Culture case page', () => {
    const navigate = vi.fn();
    const C = JSON.stringify({ microFormat: 'culture_sensitivity' });
    const t = { id: 'ot-3', test: { parameters: C }, subOrder: { id: 's-3' } };
    (PendingValidationComponent.prototype as any).goToReview.call({ router: { navigate } }, t, [t]);
    expect(navigate).toHaveBeenCalledWith(['/lab/culture', 'ot-3']);
  });
  it('a non-culture test still reviews on the sample screen', () => {
    const navigate = vi.fn();
    const t = { id: 'ot-4', test: { parameters: '{}' }, subOrder: { id: 's-4' } };
    (PendingValidationComponent.prototype as any).goToReview.call({ router: { navigate } }, t, [t]);
    expect(navigate).toHaveBeenCalledWith(['/lab/sample', 's-4'], { queryParams: { validate: 1 } });
  });
});
