import {
  blankRow, checkDoctorRows, checkHospitalRows, doctorBody, doctorKey, isHeaderRow, parseSheetText, pasteRows, saveLabel, splitHospitals,
} from './referring-paste';

const HOSPITALS = [
  { id: 'h1', name: 'Apollo Hospitals', code: 'APO', isActive: true },
  { id: 'h2', name: 'Kauvery', code: 'KAU', isActive: true },
];
const DOCTORS = [{ name: 'Dr. Priya Krishnan', isActive: true }];

describe('parseSheetText', () => {
  it('tab-separated rows from Excel / Sheets; blank lines dropped; spaces tidied', () => {
    expect(parseSheetText('Ravi\tMBBS\tApollo\r\n\r\nMeena \t MD\tKauvery\n')).toEqual([['Ravi', 'MBBS', 'Apollo'], ['Meena', 'MD', 'Kauvery']]);
  });
  it('quoted cells keep tabs, commas and line breaks ("" = a quote)', () => {
    expect(parseSheetText('"Dr ""Bala"" Murugan"\t"Apollo,\nKauvery"\tx')).toEqual([['Dr "Bala" Murugan', 'Apollo, Kauvery', 'x']]);
  });
  it('CSV when no line has a tab', () => {
    expect(parseSheetText('Ravi,MBBS,Apollo')).toEqual([['Ravi', 'MBBS', 'Apollo']]);
  });
  it('nothing → no rows', () => { expect(parseSheetText('  \n ')).toEqual([]); });
});

describe('pasteRows', () => {
  it('no header: the default doctor order Name · Qualification · Hospital(s) · Department · Phone', () => {
    const [r] = pasteRows('doctors', [['Dr Ravi', 'MBBS', 'Apollo; Kauvery', 'Cardiology', '9876543210']]);
    expect([r.n, r.name, r.qualification, r.hospitals, r.department, r.phone]).toEqual([1, 'Dr Ravi', 'MBBS', 'Apollo; Kauvery', 'Cardiology', '9876543210']);
  });
  it('a header row maps the columns in any order (and is not a row)', () => {
    expect(isHeaderRow('doctors', ['Mobile', 'Doctor Name', 'Hospital'])).toBe(true);
    expect(isHeaderRow('doctors', ['Dr Ravi', 'MBBS', 'Apollo'])).toBe(false);
    const rows = pasteRows('doctors', [['Mobile', 'Doctor Name', 'Hospital'], ['9876543210', 'Dr Ravi', 'Apollo']], 4);
    expect(rows).toHaveLength(1);
    expect([rows[0].n, rows[0].name, rows[0].phone, rows[0].hospitals]).toEqual([4, 'Dr Ravi', '9876543210', 'Apollo']);
  });
  it('hospitals mode: Name · Code · Phone · Address · Email; "Hospital" header = the name', () => {
    const [r] = pasteRows('hospitals', [['Hospital', 'Code'], ['MIOT', 'MIO']]);
    expect([r.name, r.code]).toEqual(['MIOT', 'MIO']);
  });
});

describe('doctor checks', () => {
  const rows = (...cells: string[][]) => pasteRows('doctors', cells);
  it('a doctor at several hospitals links each existing one by name (case / spaces ignored)', () => {
    expect(splitHospitals('Apollo Hospitals; kauvery , Apollo hospitals')).toEqual(['Apollo Hospitals', 'kauvery']);
    const c = checkDoctorRows(rows(['Dr Ravi', 'MBBS', 'apollo  hospitals, KAUVERY']), DOCTORS, HOSPITALS);
    expect(c.rows[0].state).toBe('ready');
    expect(c.rows[0].hospitalIds).toEqual(['h1', 'h2']);
    expect(c.rows[0].words.detail).toBe('At Apollo Hospitals, Kauvery');
  });
  it('unknown hospital → "New hospital", listed once for creation', () => {
    const c = checkDoctorRows(rows(['Dr A', '', 'MIOT; Apollo Hospitals'], ['Dr B', '', 'miot']), DOCTORS, HOSPITALS);
    expect(c.rows.map(r => r.state)).toEqual(['new-hospital', 'new-hospital']);
    expect(c.rows[0].hospitalIds).toEqual(['h1']);
    expect(c.rows[0].newHospitals).toEqual(['MIOT']);
    expect(c.newHospitals).toEqual(['MIOT']);
    expect(c.saveable).toHaveLength(2);
  });
  it('duplicates (already a doctor, or twice in the paste; "Dr" / dots / case ignored) are flagged and never saved', () => {
    expect(doctorKey('Dr. Priya  KRISHNAN')).toBe(doctorKey('priya krishnan'));
    const c = checkDoctorRows(rows(['priya krishnan'], ['Dr Ravi'], ['DR. RAVI']), DOCTORS, HOSPITALS);
    expect(c.rows.map(r => r.state)).toEqual(['duplicate', 'ready', 'duplicate']);
    expect(c.rows[2].words.detail).toBe('Same as row 2 — not saved');
    expect(c.saveable.map(r => r.row.name)).toEqual(['Dr Ravi']);
  });
  it('a name is required; a bad phone is a row to fix; empty rows are ignored', () => {
    const c = checkDoctorRows([...rows(['', 'MBBS'], ['Dr X', '', '', '', '12']), blankRow(9)], DOCTORS, HOSPITALS);
    expect(c.rows.map(r => r.state)).toEqual(['invalid', 'invalid']);
    expect(c.rows[0].words.now).toBe('Name missing');
    expect(c.rows[0].words.tone).toBe('late');
    expect(c.saveable).toHaveLength(0);
  });
  it('a saved row reads Saved (done) and is not saved again', () => {
    const [r] = rows(['Dr Ravi', '', 'Apollo Hospitals']);
    const c = checkDoctorRows([{ ...r, result: { ok: true, message: 'Saved' } }], DOCTORS, HOSPITALS);
    expect(c.rows[0].state).toBe('saved');
    expect(c.rows[0].words.tone).toBe('done');
    expect(c.saveable).toHaveLength(0);
  });
  it('the POST body is the single editor\'s shape (first hospital = primary)', () => {
    const [r] = rows(['Dr Ravi', 'MBBS', 'x', '', '9876543210']);
    expect(doctorBody(r, ['h2', 'h1'])).toMatchObject({ hospitalId: 'h2', hospitalIds: ['h2', 'h1'], name: 'Dr Ravi', qualification: 'MBBS', department: null, phone: '9876543210' });
  });
});

describe('hospital checks', () => {
  it('same name or same code as an existing hospital, or twice in the paste = duplicate', () => {
    const c = checkHospitalRows(pasteRows('hospitals', [['apollo hospitals'], ['MIOT', 'kau'], ['Fortis', 'FOR'], ['fortis']]), HOSPITALS);
    expect(c.rows.map(r => r.state)).toEqual(['duplicate', 'duplicate', 'ready', 'duplicate']);
    expect(c.saveable.map(r => r.row.name)).toEqual(['Fortis']);
  });
  it('save label', () => {
    expect(saveLabel('doctors', 4)).toBe('Save 4 doctors');
    expect(saveLabel('hospitals', 1)).toBe('Save 1 hospital');
    expect(saveLabel('doctors', 0)).toBe('Save doctors');
  });
});
