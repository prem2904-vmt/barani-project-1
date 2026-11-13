import { addressIntoContact, patientAddressLine } from './patient-address';

const f = (name: string, extra: any = {}) => ({ id: name, name, title: name, type: 'text', isStandard: true, isRequired: false, isEditable: true, storageKey: name, width: 'half', ...extra });
const cfg = (basic: any[], extra: any[]) => ({ steps: [
  { id: 's1', name: 'basic_info', title: 'Basic', fields: basic },
  { id: 's2', name: 'additional_info', title: 'Additional details', fields: extra },
] } as any);
const addr = f('address', { storageKey: 'metadata.address', isStandard: false });

describe('registration form - address with the contact fields (OPS-119)', () => {
  it('moves the address from Additional details into the basic step beside phone', () => {
    const out = addressIntoContact(cfg([f('first_name'), f('phone')], [f('email'), addr]));
    expect(out.steps[0].fields.map((x: any) => x.name)).toEqual(['first_name', 'phone', 'address']);
    expect(out.steps[1].fields.map((x: any) => x.name)).toEqual(['email']);
  });
  it('is a no-op when the basic step has no contact fields, no donor, or already has it', () => {
    const noContact = cfg([f('first_name')], [addr]);
    expect(addressIntoContact(noContact)).toBe(noContact);
    const noDonor = cfg([f('phone')], [f('email')]);
    expect(addressIntoContact(noDonor)).toBe(noDonor);
    const has = cfg([f('phone'), addr], []);
    expect(addressIntoContact(has)).toBe(has);
  });
});

describe('patientAddressLine', () => {
  it('reads address, district and state from the attributes', () => {
    expect(patientAddressLine(JSON.stringify({ address: ' 12 Park Rd ', district: 'Coimbatore', state: 'TN' }))).toBe('12 Park Rd, Coimbatore, TN');
  });
  it('is blank for none / bad JSON', () => {
    expect(patientAddressLine(undefined)).toBe('');
    expect(patientAddressLine('{nope')).toBe('');
    expect(patientAddressLine('{"occupation":"x"}')).toBe('');
  });
});
