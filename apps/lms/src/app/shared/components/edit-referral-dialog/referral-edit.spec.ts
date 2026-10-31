import {
  NONE, currentDoctorValue, doctorKey, doctorOptions, formFrom, hospitalOptions, parseDoctorKey,
  referralChanged, referralPayload, referralSummary, sourceOptions,
} from './referral-edit';

/** Edit referral — the pure rules behind the dialog. */
describe('referral-edit', () => {
  const booked = formFrom({ orderId: 'o1', refDoctorId: 'd1', refDoctorName: ' Dr Anand ', refHospitalName: 'City', referralSourceType: null });

  it('reads the order referral into a trimmed form', () => {
    expect(booked).toEqual({ doctorId: 'd1', doctor: 'Dr Anand', hospital: 'City', sourceType: '' });
    expect(formFrom(null)).toEqual({ doctorId: null, doctor: '', hospital: '', sourceType: '' });
  });

  it('a change is a different doctor / hospital / source, or a newly picked directory doctor', () => {
    expect(referralChanged(booked, { ...booked })).toBe(false);
    expect(referralChanged(booked, { ...booked, doctor: 'Dr  Anand ' })).toBe(false); // whitespace only
    expect(referralChanged(booked, { ...booked, doctor: 'Dr Rao', doctorId: null })).toBe(true);
    expect(referralChanged(booked, { ...booked, hospital: '' })).toBe(true);
    expect(referralChanged(booked, { ...booked, sourceType: 'Doctor' })).toBe(true);
    expect(referralChanged(booked, { ...booked, doctorId: 'd2' })).toBe(true);
  });

  it('payload: blank ⇒ null, the source type always sent ("" clears), the reason trimmed', () => {
    expect(referralPayload({ doctorId: null, doctor: ' Dr Rao ', hospital: '', sourceType: '' }, '  typo ')).toEqual({
      refDoctorId: null, refDoctorName: 'Dr Rao', refHospitalName: null, referralSourceType: '', reason: 'typo',
    });
    expect(referralPayload({ doctorId: 'd9', doctor: 'Dr X', hospital: 'Apollo', sourceType: 'Hospital' }, '')['reason']).toBeNull();
  });

  it('doctor keys round-trip, even with a | in a name; a bare value is a typed new name', () => {
    const o = { doctorId: 'd1', name: 'Dr A|B', hospitalName: 'City' };
    expect(parseDoctorKey(doctorKey(o))).toEqual(o);
    expect(parseDoctorKey('Dr Typed New')).toEqual({ doctorId: null, name: 'Dr Typed New', hospitalName: null });
    expect(parseDoctorKey(NONE)).toBeNull();
  });

  it('doctor options: "No referring doctor", the current doctor when the list lacks it, then "Dr · Hospital" rows', () => {
    const opts = doctorOptions([{ doctorId: 'd2', name: 'Dr Rao', hospitalName: 'Apollo' }, 'Dr Legacy'], booked);
    expect(opts.map(o => o.label)).toEqual(['No referring doctor', 'Dr Anand', 'Dr Rao · Apollo', 'Dr Legacy']);
    expect(opts[1].value).toBe(currentDoctorValue(booked));
    // Current doctor present in the list: not repeated.
    const again = doctorOptions([{ doctorId: 'd1', name: 'Dr Anand', hospitalName: 'City' }], booked);
    expect(again.filter(o => o.label.startsWith('Dr Anand'))).toHaveLength(1);
  });

  it('hospital + source options carry a "none" row; the current hospital is always selectable', () => {
    expect(hospitalOptions(['Apollo'], 'City').map(o => o.label)).toEqual(['No hospital', 'City', 'Apollo']);
    expect(hospitalOptions(['city'], 'City').map(o => o.label)).toEqual(['No hospital', 'city']);
    expect(sourceOptions(null).map(o => o.value)).toEqual(['', 'Doctor', 'Hospital', 'Walk-in', 'Corporate', 'Camp', 'Online']);
    expect(sourceOptions(['Doctor']).map(o => o.label)).toEqual(['Not set', 'Doctor']);
  });

  it('summary reads like the report', () => {
    expect(referralSummary({ doctor: 'Dr Anand', hospital: 'City' })).toBe('Dr Anand · City');
    expect(referralSummary({ doctor: '', hospital: '' })).toBe('Self referral');
    expect(referralSummary({ doctor: '', hospital: 'City' })).toBe('No doctor · City');
  });
});
