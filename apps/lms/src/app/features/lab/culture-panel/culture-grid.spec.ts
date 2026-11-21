import {
  cultureColumns, cultureDay, cultureDueMin, cultureMeta, culturePrimary, cultureStatus, cultureTest, nextStep, cultureStatusOptions, filterCultures, readDue, stageSub,
} from './culture-grid';
import type { CultureCaseView } from './culture-panel.component';

const NOW = Date.parse('2026-11-20T10:00:00Z');
const iso = (minFromNow: number) => new Date(NOW + minFromNow * 60000).toISOString();
const stg = (key: string, state: 'open' | 'picked' | 'done', extra: Record<string, unknown> = {}) => ({ key, label: key, state, ...extra });
const kase = (id: string, stages: ReturnType<typeof stg>[], extra: Partial<CultureCaseView> = {}): CultureCaseView => ({
  orderTestId: id, caseState: 'in_progress', createdAt: iso(-26 * 60), barcode: 'MICRO' + id, patientName: 'P ' + id,
  testName: 'Bacterial Culture & Sensitivity', departmentName: 'Microbiology', specimen: 'Urine', stages: stages as never, ...extra,
});

describe('Culture grid — status, day, read due (the culture queue\'s own fields)', () => {
  it('ONE status: sign-out › read due (rose) › incubating › in progress › to start', () => {
    expect(cultureStatus(kase('1', [stg('Gram', 'open')]), NOW)).toMatchObject({ key: 'to_start', tone: 'neutral' });
    expect(cultureStatus(kase('2', [stg('Gram', 'picked', { holderName: 'Ravi' })]), NOW).key).toBe('in_progress');
    expect(cultureStatus(kase('3', [stg('Growth', 'open', { incubateUntil: iso(90) })]), NOW).key).toBe('incubating');
    expect(cultureStatus(kase('4', [stg('Growth', 'open', { incubateUntil: iso(-30) })]), NOW)).toMatchObject({ key: 'read_due', tone: 'rose' });
    expect(cultureStatus(kase('5', [stg('Gram', 'done')], { caseState: 'awaiting_signout' }), NOW)).toMatchObject({ key: 'signout', tone: 'green' });
  });
  it('day counter, meta line and the stage sub-line', () => {
    const c = kase('1', [stg('Growth', 'open', { incubateUntil: iso(90) })]);
    expect(cultureDay(c, NOW)).toBe(2);
    expect(cultureMeta(c)).toBe('Bacterial Culture & Sensitivity · Microbiology · Urine');
    expect(stageSub(c, NOW, 'me')).toBe('Incubating · ready in 1h 30m');
    expect(stageSub(kase('2', [stg('Gram', 'picked', { holderUserId: 'me' })]), NOW, 'me')).toBe('You');
    expect(readDue(kase('3', [stg('Growth', 'done', { incubateUntil: iso(-30) })]), NOW)).toBeNull();   // a done read is never due
  });
});

describe('Culture grid — Due (the next read) + the primary', () => {
  it('minutes until the plate is ready; negative once the read is due; no clock otherwise', () => {
    expect(cultureDueMin(kase('1', [stg('Growth', 'open', { incubateUntil: iso(90) })]), NOW)).toBe(90);
    expect(cultureDueMin(kase('2', [stg('Growth', 'open', { incubateUntil: iso(-40) })]), NOW)).toBe(-40);
    expect(cultureDueMin(kase('3', [stg('Gram', 'open')]), NOW)).toBeNull();
  });
  it('the primary is "Open" (→ the culture bench, where sign-out happens too); Next step = the first open stage', () => {
    expect(culturePrimary(kase('1', [stg('Gram', 'open')]), NOW)).toMatchObject({ label: 'Open', aria: 'Open the bench for MICRO1' });
    expect(culturePrimary(kase('2', [stg('Gram', 'done')], { caseState: 'awaiting_signout' }), NOW).label).toBe('Open');
    expect(nextStep(kase('3', [stg('Gram', 'done'), stg('Growth', 'open', { incubateUntil: iso(-5) })]), NOW)).toMatchObject({ label: 'Growth', tone: 'rose' });
    expect(nextStep(kase('4', [stg('Gram', 'done')], { caseState: 'awaiting_signout' }), NOW).label).toBe('Sign-out');
    expect(cultureTest(kase('5', []))).toBe('Bacterial Culture & Sensitivity · Microbiology');
  });
});

describe('Culture grid — head filters + columns', () => {
  const rows = [kase('1', [stg('Gram', 'open')]), kase('2', [stg('Growth', 'open', { incubateUntil: iso(-5) })], { departmentName: 'Micro 2' }),
    kase('3', [stg('Growth', 'open', { incubateUntil: iso(60) })])];
  it('search · status · department', () => {
    expect(filterCultures(rows, { q: 'micro2', status: 'all', dept: null }, NOW).map(c => c.orderTestId)).toEqual(['2']);
    expect(filterCultures(rows, { q: '', status: 'incubating', dept: null }, NOW).map(c => c.orderTestId)).toEqual(['3']);
    expect(filterCultures(rows, { q: '', status: 'all', dept: 'Micro 2' }, NOW).map(c => c.orderTestId)).toEqual(['2']);
  });
  it('the pill lists the statuses present, with counts', () => {
    expect(cultureStatusOptions(rows, { q: '', status: 'all', dept: null }, NOW).map(o => `${o.label} ${o.count}`))
      .toEqual(['All 3', 'Read due 1', 'Incubating 1', 'To start 1']);
  });
  it('columns (owner 2026-11-21): Sample ID · Patient · Test · Day · Next step · Due · Open; folds keep Due + Open', () => {
    const vis = (f: Parameters<typeof cultureColumns>[0]) => cultureColumns(f).filter(c => !c.hide).map(c => c.colId);
    expect(vis('full')).toEqual(['sample', 'patient', 'test', 'day', 'next', 'due', 'acts']);
    expect(vis('fold')).toEqual(['sample', 'patient', 'day', 'next', 'due', 'acts']);
    expect(vis('tight')).toEqual(['patient', 'due', 'acts']);
  });
});
