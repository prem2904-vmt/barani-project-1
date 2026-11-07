import { withClearedIdentifiers } from './patient-edit-body';

const FORM = ['first_name', 'abha_id', 'aadhaar_last4'];

describe('withClearedIdentifiers (OPS-72)', () => {
  it('sends "" for an emptied ABHA / Aadhaar field', () => {
    const body = withClearedIdentifiers({ firstName: 'A' }, { first_name: 'A', abha_id: '', aadhaar_last4: null }, FORM);
    expect(body).toEqual({ firstName: 'A', abhaId: '', aadhaarLast4: '' });
  });

  it('treats an absent value as emptied too (the form drops empty values)', () => {
    expect(withClearedIdentifiers({}, {}, FORM)).toEqual({ abhaId: '', aadhaarLast4: '' });
  });

  it('leaves a filled field exactly as the body has it', () => {
    const body = withClearedIdentifiers({ abhaId: '12345678901234' }, { abha_id: '12345678901234', aadhaar_last4: '' }, FORM);
    expect(body).toEqual({ abhaId: '12345678901234', aadhaarLast4: '' });
  });

  it('never touches a field the form does not carry', () => {
    expect(withClearedIdentifiers({ firstName: 'A' }, { first_name: 'A' }, ['first_name'])).toEqual({ firstName: 'A' });
  });

  it('does not mutate the body it was given', () => {
    const body = { firstName: 'A' };
    withClearedIdentifiers(body, {}, FORM);
    expect(body).toEqual({ firstName: 'A' });
  });
});
