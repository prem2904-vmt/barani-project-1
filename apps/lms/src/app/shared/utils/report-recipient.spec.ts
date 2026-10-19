import { describe, expect, it } from 'vitest';
import { currentRecipient } from './report-recipient';

describe('currentRecipient — a report is sent to the patient AS ON FILE today', () => {
  it('prefers the current patient over the snapshot (rename / new mobile reach the message)', () => {
    expect(currentRecipient(
      { patient: { displayName: 'Ms. Yamini Rao', phone: '+919000000001' } },
      { displayName: 'Xavier Rao', phone: '+919000000000' },
    )).toEqual({ name: 'Ms. Yamini Rao', phone: '+919000000001' });
  });

  it('composes the name from first + father\'s name when displayName is absent', () => {
    expect(currentRecipient({ patient: { firstName: 'Yamini', fathersName: 'Rao' } }, null).name).toBe('Yamini Rao');
  });

  it('falls back to the guardian mobile, then the snapshot', () => {
    expect(currentRecipient({ patient: { displayName: 'Baby', guardianPhone: '+919111111111' } }, { phone: '+919' }).phone)
      .toBe('+919111111111');
    expect(currentRecipient({ patient: { displayName: 'A' } }, { phone: '+919222222222' }).phone).toBe('+919222222222');
  });

  it('older responses without `patient` keep the snapshot', () => {
    expect(currentRecipient({}, { displayName: 'Old Name', phone: '9876543210' }))
      .toEqual({ name: 'Old Name', phone: '9876543210' });
    expect(currentRecipient(null, null)).toEqual({ name: null, phone: null });
  });
});
