import { TestBed } from '@angular/core/testing';
import { OpdFormRendererComponent } from '../admin/forms/renderer';
import { comparePresets } from './compare-presets';
import { copyAllFromLast, keyReadings, lastHints, lastValue, sessionNumber, sessionsTable } from './procedure-sessions';

/** A laser hair-removal session form (the dermatologist demo). */
const LASER = {
  version: 2,
  sections: [{ key: 's', title: 'Session', fields: [
    { key: 'area', label: 'Area', type: 'one', choices: ['Upper lip', 'Chin', 'Underarm'] },
    { key: 'fluence', label: 'Fluence', type: 'num', unit: 'J/cm²' },
    { key: 'spot', label: 'Spot size', type: 'num', unit: 'mm' },
    { key: 'cooling', label: 'Cooling', type: 'yn' },
  ] }],
};
const S = [
  { date: '2026-08-14', visitId: 'v1', answers: { area: 'Upper lip', fluence: 12, spot: 10, cooling: 'Yes' } },
  { date: '2026-09-12', visitId: 'v2', answers: { area: 'Upper lip', fluence: 14, spot: 10 } },
  { date: '2026-10-03', visitId: 'today', answers: { fluence: 99 } },
];

describe('Procedure sessions (pure)', () => {
  it('"Last" chips come from the newest past session that answered each field; today never counts', () => {
    const h = lastHints(LASER, S, 'today');
    expect(h['fluence']).toMatch(/^14 J\/cm² · 12 Sep/);
    expect(h['area']).toContain('Upper lip');
    expect(h['cooling']).toContain('Yes');   // older session — the newest one left it blank
    expect(lastValue('fluence', S, 'today')).toBe(14);
  });

  it('copy all lays the last session over today\'s answers (form questions only)', () => {
    const out = copyAllFromLast(LASER, { cooling: 'No', other: 'kept' }, [...S, { date: '2026-09-20', visitId: 'v3', answers: { fluence: 15, junk: 1 } }], 'today');
    expect(out).toEqual({ cooling: 'No', other: 'kept', fluence: 15 });
  });

  it('the sessions table: fields as rows, dates as columns, a change highlighted', () => {
    const t = sessionsTable(LASER, S.slice(0, 2), { date: '2026-10-03', answers: { area: 'Upper lip', fluence: 16, spot: 10 } });
    expect(t.dates).toEqual(['2026-08-14', '2026-09-12', '2026-10-03']);
    const fl = t.rows.find(r => r.key === 'fluence')!;
    expect(fl.cells).toEqual(['12 J/cm²', '14 J/cm²', '16 J/cm²']);
    expect(fl.changed).toEqual([false, true, true]);
    expect(t.rows.find(r => r.key === 'spot')!.changed).toEqual([false, false, false]);
  });

  it('session number and the key readings for the line summary', () => {
    expect(sessionNumber(S, 'today')).toBe(3);
    expect(keyReadings(LASER, { area: 'Chin', fluence: 16, spot: 10 })).toEqual(['16 J/cm²', '10 mm']);
    expect(keyReadings(LASER, null)).toEqual([]);
  });

  it('compare: one "readings" preset per procedure the patient has had', () => {
    const p = comparePresets({ consults: [], reports: [], images: [], trends: [], procedures: [{ serviceId: 's1', name: 'Laser hair removal', sessions: 3 }] });
    const r = p.find(x => x.id === 'proc:s1')!;
    expect(r).toMatchObject({ label: 'Laser hair removal readings', count: 3, procedureServiceId: 's1' });
  });
});

describe('<pf-opd-form-renderer> — "Last" chips', () => {
  it('shows the previous value beside a field and emits its key on tap', () => {
    TestBed.configureTestingModule({ imports: [OpdFormRendererComponent] });
    const f = TestBed.createComponent(OpdFormRendererComponent);
    f.componentRef.setInput('schema', LASER);
    f.componentRef.setInput('mode', 'edit');
    f.componentRef.setInput('hints', { fluence: '14 J/cm² · 12 Sep' });
    f.detectChanges();
    const chip = (f.nativeElement as HTMLElement).querySelector('.ofr-last') as HTMLButtonElement;
    expect(chip.textContent).toContain('Last: 14 J/cm² · 12 Sep');
    const got: string[] = [];
    f.componentInstance.hintPick.subscribe(k => got.push(k));
    chip.click();
    expect(got).toEqual(['fluence']);
  });
});
