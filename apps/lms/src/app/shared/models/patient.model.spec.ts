import { patientDisplayName, patientMrnLabel, formatPatientInfo, formatPatientMeta, Patient } from './patient.model';

describe('patientDisplayName', () => {
  it('prefers server displayName (which already carries the title)', () => {
    expect(patientDisplayName({
      displayName: 'Dr. John Smith',
      firstName: 'John',
      fathersName: 'Smith',
      title: 'Dr.',
    })).toBe('Dr. John Smith');
  });

  it('constructs from title + firstName + fathersName, filtering falsy values', () => {
    expect(patientDisplayName({
      firstName: 'John',
      fathersName: 'Smith',
      title: 'Mr.',
    })).toBe('Mr. John Smith');
  });

  it('constructs without title when title is null or empty', () => {
    expect(patientDisplayName({
      firstName: 'John',
      fathersName: 'Smith',
      title: null,
    })).toBe('John Smith');
    expect(patientDisplayName({
      firstName: 'John',
      fathersName: 'Smith',
      title: '',
    })).toBe('John Smith');
  });

  it('tolerates missing fathersName', () => {
    expect(patientDisplayName({
      firstName: 'John',
      fathersName: '',
      title: 'Dr.',
    })).toBe('Dr. John');
  });

  it('returns empty string for null/undefined input', () => {
    expect(patientDisplayName(null)).toBe('');
    expect(patientDisplayName(undefined)).toBe('');
  });
});

describe('patientMrnLabel', () => {
  it('returns MRN if present and trims whitespace', () => {
    expect(patientMrnLabel({ mrn: '  DEL-2605-004217-3  ' })).toBe('DEL-2605-004217-3');
    expect(patientMrnLabel({ mrn: 'AA0040' })).toBe('AA0040');
  });

  it('returns "—" (dash) for null/undefined MRN', () => {
    expect(patientMrnLabel({ mrn: undefined })).toBe('—');
    expect(patientMrnLabel({ mrn: null as unknown as string })).toBe('—'); // runtime tolerates null mrn
    expect(patientMrnLabel(null)).toBe('—');
    expect(patientMrnLabel(undefined)).toBe('—');
  });

  it('returns "—" for empty MRN after trim', () => {
    expect(patientMrnLabel({ mrn: '   ' })).toBe('—');
  });
});

describe('formatPatientInfo', () => {
  it('returns "—" for null/undefined input', () => {
    expect(formatPatientInfo(null)).toBe('—');
    expect(formatPatientInfo(undefined)).toBe('—');
  });

  it('truncates name to 15 characters + ".." if longer', () => {
    expect(formatPatientInfo({
      displayName: 'VeryLongNameHere',
      firstName: 'VeryLong',
      fathersName: 'NameHere',
      age: 30,
      sex: 'Male',
      mrn: 'AA0040',
    })).toBe('VeryLongNameHer.. | 30/M | AA0040'); // current behavior truncates to 15 chars
  });

  it('keeps name as-is if 15 characters or less', () => {
    expect(formatPatientInfo({
      displayName: 'John Smith',
      firstName: 'John',
      fathersName: 'Smith',
      age: 25,
      sex: 'Female',
      mrn: 'BB0001',
    })).toBe('John Smith | 25/F | BB0001');
  });

  it('maps sex to single-letter code (M/F/O) or first char uppercase', () => {
    expect(formatPatientInfo({
      displayName: 'Test',
      firstName: 'Test',
      fathersName: 'Test',
      age: 30,
      sex: 'male',
      mrn: 'TEST1',
    })).toContain('30/M');

    expect(formatPatientInfo({
      displayName: 'Test',
      firstName: 'Test',
      fathersName: 'Test',
      age: 30,
      sex: 'Female',
      mrn: 'TEST1',
    })).toContain('30/F');

    expect(formatPatientInfo({
      displayName: 'Test',
      firstName: 'Test',
      fathersName: 'Test',
      age: 30,
      sex: 'other',
      mrn: 'TEST1',
    })).toContain('30/O');

    expect(formatPatientInfo({
      displayName: 'Test',
      firstName: 'Test',
      fathersName: 'Test',
      age: 30,
      sex: 'Unknown',
      mrn: 'TEST1',
    })).toContain('30/U');
  });

  it('shows "—" for missing age, sex, or mrn', () => {
    expect(formatPatientInfo({
      displayName: 'John',
      firstName: 'John',
      fathersName: 'Doe',
      age: undefined,
      sex: undefined,
      mrn: undefined,
    })).toBe('John | —/— | —');
  });

  it('constructs display name from firstName/fathersName if displayName missing', () => {
    expect(formatPatientInfo({
      firstName: 'John',
      fathersName: 'Smith',
      displayName: undefined,
      age: 40,
      sex: 'M',
      mrn: 'CC0002',
    })).toBe('John Smith | 40/M | CC0002');
  });

  it('handles whitespace in sex field', () => {
    expect(formatPatientInfo({
      displayName: 'Test',
      firstName: 'Test',
      fathersName: 'Test',
      age: 35,
      sex: '  male  ',
      mrn: 'TEST1',
    })).toContain('35/M');
  });
});

describe('formatPatientMeta', () => {
  it('returns empty string for null/undefined input', () => {
    expect(formatPatientMeta(null)).toBe('');
    expect(formatPatientMeta(undefined)).toBe('');
  });

  it('formats age/sex · mrn with proper sex mapping', () => {
    expect(formatPatientMeta({
      age: 23,
      sex: 'Male',
      mrn: 'AA0040',
    })).toBe('23/M · AA0040');

    expect(formatPatientMeta({
      age: 45,
      sex: 'female',
      mrn: 'BB2050',
    })).toBe('45/F · BB2050');

    expect(formatPatientMeta({
      age: 18,
      sex: 'other',
      mrn: 'CC1001',
    })).toBe('18/O · CC1001');
  });

  it('shows "—" for missing age, sex, or mrn', () => {
    expect(formatPatientMeta({
      age: undefined,
      sex: 'M',
      mrn: 'AA0040',
    })).toBe('—/M · AA0040');

    expect(formatPatientMeta({
      age: 30,
      sex: undefined,
      mrn: 'AA0040',
    })).toBe('30/— · AA0040');

    expect(formatPatientMeta({
      age: 30,
      sex: 'M',
      mrn: undefined,
    })).toBe('30/M · —');
  });

  it('handles sex field variations (case, whitespace, unknown prefixes)', () => {
    expect(formatPatientMeta({
      age: 50,
      sex: '  MALE  ',
      mrn: 'TEST1',
    })).toBe('50/M · TEST1');

    expect(formatPatientMeta({
      age: 50,
      sex: 'Xyz',
      mrn: 'TEST1',
    })).toBe('50/X · TEST1');
  });
});
