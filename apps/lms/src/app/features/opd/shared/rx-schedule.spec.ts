import {
  RX_USUAL_EXAMPLES, RxDrugRef, RxLine, RxSchedule, bestDrug, dayInfo, doseShort, isComplex, lineShort,
  newRxLine, parseRx, perDaySched, qtyWords, rxQty, sayRx, shortSched, stripDays, totalDays, whenShort,
} from './rx-schedule';

// The mockup's drug list (projection). Quantity fixtures below are mirrored
// 1:1 in prefrontal-mw Prefrontal.Tests/Opd/RxScheduleTests.cs — change both.
const DRUGS: RxDrugRef[] = [
  { id: 'amc', name: 'Clavumox 625', form: 'tab', generic: 'Amoxicillin 500 mg + Clavulanic acid 125 mg', aliases: 'co-amoxiclav amoxiclav' },
  { id: 'mlc', name: 'Montiz-LC', form: 'tab', generic: 'Montelukast 10 mg + Levocetirizine 5 mg', aliases: 'montelukast levocet' },
  { id: 'flu', name: 'Fluticon Nasal Spray', form: 'spray', unit: 'bottle', siteKind: 'nose', generic: 'Fluticasone propionate 50 mcg / spray', aliases: 'steroid spray' },
  { id: 'pcm', name: 'Dolopar 650', form: 'tab', generic: 'Paracetamol 650 mg', aliases: 'pcm fever' },
  { id: 'oto', name: 'Otiflox', form: 'drops', unit: 'bottle', siteKind: 'ear', generic: 'Ofloxacin 0.3% ear drops' },
  { id: 'azi', name: 'Azimax 500', form: 'tab', generic: 'Azithromycin 500 mg', aliases: 'azithro' },
  { id: 'pan', name: 'Pantowin 40', form: 'tab', generic: 'Pantoprazole 40 mg' },
  { id: 'cet', name: 'Cetrizet 10', form: 'tab', generic: 'Cetirizine 10 mg' },
  { id: 'tel', name: 'Tel-Am 40', form: 'tab', generic: 'Telmisartan 40 mg' },
  { id: 'clo', name: 'Betaclo Cream', form: 'cream', unit: 'tube', generic: 'Clobetasol propionate 0.05% cream' },
  { id: 'fol', name: 'Folvita 5', form: 'tab', generic: 'Folic acid 5 mg' },
  { id: 'ors', name: 'Electrosol ORS', form: 'sachet', unit: 'sachet', generic: 'Oral rehydration salts (WHO)' },
  { id: 'sal', name: 'Salinex Nasal Drops', form: 'drops', unit: 'bottle', siteKind: 'nose', generic: 'Sodium chloride 0.65% nasal drops', aliases: 'saline' },
  { id: 'inh', name: 'Budelin Inhaler 200', form: 'inhaler', unit: 'inhaler', generic: 'Budesonide 200 mcg / puff' },
  { id: 'syr', name: 'Coughlin Syrup', form: 'syrup', unit: 'bottle', generic: 'Dextromethorphan 10 mg + Chlorpheniramine 2 mg / 5 ml' },
];
const drug = (id: string) => DRUGS.find(d => d.id === id)!;
const TAB = drug('amc');
/** Monday 28 Sep 2026 (local). */
const MON = new Date(2026, 8, 28);
const T = (pat: number[]): RxSchedule => ({ type: 'times', pat });
const line = (sched: RxSchedule, dur: number, dose = 1, extra: Partial<RxLine> = {}): RxLine => ({ drugId: 'x', dose, sched, dur, ...extra });

describe('rx-schedule · quantity fixtures (mirrored in RxScheduleTests.cs)', () => {
  const cases: Array<[string, RxLine, RxDrugRef, number]> = [
    ['1-0-1 × 5 days', line(T([1, 0, 1]), 5), TAB, 10],
    ['1-0-0 × 3 days', line(T([1, 0, 0]), 3), TAB, 3],
    ['qid 1-1-1-1 × 5 days', line(T([1, 1, 1, 1]), 5), TAB, 20],
    ['½ tab 1-0-1 × 5 days', line(T([1, 0, 1]), 5, 0.5), TAB, 5],
    ['½ tab 1-0-0 × 3 days rounds up', line(T([1, 0, 0]), 3, 0.5), TAB, 2],
    ['½-0-½ pattern × 3 days', line(T([0.5, 0, 0.5]), 3), TAB, 3],
    ['sos max 3 × 3 days', line({ type: 'sos', max: 3, gap: 6 }, 3), TAB, 9],
    ['alternate days × 14', line({ type: 'days', mode: 'alt' }, 14), TAB, 7],
    ['every 3rd day × 10', line({ type: 'days', mode: 'nth', n: 3 }, 10), TAB, 4],
    ['weekly Mon+Thu × 14 from a Monday', line({ type: 'days', mode: 'weekly', wd: [1, 4] }, 14), TAB, 4],
    ['every 2 h awake × 3 days', line({ type: 'hours', every: 2, awake: true }, 3), TAB, 27],
    ['every 6 h round the clock × 2 days', line({ type: 'hours', every: 6, awake: false }, 2), TAB, 8],
    ['every 4 h awake × 1 day', line({ type: 'hours', every: 4, awake: true }, 1), TAB, 5],
    ['cycle 21 on / 7 off × 3 (1-0-0)', line({ type: 'cycle', on: 21, off: 7, pat: [1, 0, 0], cycles: 3 }, 0), TAB, 63],
    ['taper 2×tds 3d → 1-0-1 3d → ½ od 2d', line({ type: 'steps', steps: [
      { sched: T([1, 1, 1]), dur: 3, dose: 2 }, { sched: T([1, 0, 1]), dur: 3 }, { sched: T([1, 0, 0]), dur: 2, dose: 0.5 },
    ] }, 0), TAB, 25],
    ['sachet 1-1-1 × 3 days', line(T([1, 1, 1]), 3), drug('ors'), 9],
    ['spray is one pack', line(T([1, 0, 1]), 14, 2), drug('flu'), 1],
    ['syrup is one pack', line(T([1, 1, 1]), 5, 10), drug('syr'), 1],
    ['cream is one pack', line({ type: 'days', mode: 'alt' }, 14), drug('clo'), 1],
    ['inhaler is one pack', line(T([1, 0, 1]), 30, 2), drug('inh'), 1],
    ['a zero-dose course still dispenses at least 1', line(T([0, 0, 0]), 5), TAB, 1],
  ];
  for (const [name, l, d, q] of cases) {
    it(name + ' → ' + q, () => expect(rxQty(l, d, MON)).toBe(q));
  }
});

describe('rx-schedule · day arithmetic', () => {
  it('totalDays: plain = dur, taper = Σ steps, cycle = (on+off)×cycles', () => {
    expect(totalDays(line(T([1, 0, 1]), 5))).toBe(5);
    expect(totalDays(line({ type: 'steps', steps: [{ sched: T([1, 1, 1]), dur: 3 }, { sched: T([1, 0, 0]), dur: 4 }] }, 99))).toBe(7);
    expect(totalDays(line({ type: 'cycle', on: 21, off: 7, pat: [1, 0, 0], cycles: 2 }, 99))).toBe(56);
    expect(totalDays(line({ type: 'cycle', on: 5, off: 2, pat: [1, 0, 0], cycles: 0 }, 99))).toBe(7); // cycles falsy ⇒ 1
  });

  it('perDaySched per type', () => {
    expect(perDaySched(T([1, 1, 1]), 0)).toBe(3);
    expect(perDaySched({ type: 'hours', every: 1, awake: true }, 0)).toBe(17);
    expect(perDaySched({ type: 'hours', every: 8, awake: false }, 0)).toBe(3);
    expect([0, 1, 2, 3].map(i => perDaySched({ type: 'days', mode: 'alt' }, i))).toEqual([1, 0, 1, 0]);
    expect([0, 1, 2, 3, 4, 5, 6].map(i => perDaySched({ type: 'days', mode: 'nth' }, i))).toEqual([1, 0, 0, 1, 0, 0, 1]); // n defaults 3
    // Mon 28 Sep … Sun 4 Oct; Mon(1) + Thu(4)
    expect([0, 1, 2, 3, 4, 5, 6].map(i => perDaySched({ type: 'days', mode: 'weekly', wd: [1, 4] }, i, MON))).toEqual([1, 0, 0, 1, 0, 0, 0]);
    expect(perDaySched({ type: 'sos', max: 4, gap: 4 }, 2)).toBe(4);
    const cyc: RxSchedule = { type: 'cycle', on: 2, off: 1, pat: [1, 0, 1], cycles: 2 };
    expect([0, 1, 2, 3, 4, 5].map(i => perDaySched(cyc, i))).toEqual([2, 2, 0, 2, 2, 0]);
  });

  it('weekly depends on the start weekday', () => {
    const wed = new Date(2026, 8, 30);
    expect(perDaySched({ type: 'days', mode: 'weekly', wd: [3] }, 0, wed)).toBe(1);
    expect(perDaySched({ type: 'days', mode: 'weekly', wd: [3] }, 0, MON)).toBe(0);
  });

  it('dayInfo walks taper steps with per-step dose, null past the end', () => {
    const l = line({ type: 'steps', steps: [{ sched: T([1, 1, 1]), dur: 2, dose: 2 }, { sched: T([1, 0, 0]), dur: 1 }] }, 0, 1);
    expect(dayInfo(l, 0)).toEqual({ n: 3, dose: 2, step: 0 });
    expect(dayInfo(l, 1)).toEqual({ n: 3, dose: 2, step: 0 });
    expect(dayInfo(l, 2)).toEqual({ n: 1, dose: 1, step: 1 });
    expect(dayInfo(l, 3)).toBeNull();
    expect(dayInfo(line(T([1, 0, 1]), 2), 2)).toBeNull();
  });

  it('a weekly step inside a taper counts real calendar days', () => {
    // step 0: 3 days od (Mon-Wed), step 1: weekly Thu for 7 days (Thu 1 Oct … Wed 7 Oct) → 1 dose
    const l = line({ type: 'steps', steps: [{ sched: T([1, 0, 0]), dur: 3 }, { sched: { type: 'days', mode: 'weekly', wd: [4] }, dur: 7 }] }, 0);
    expect(dayInfo(l, 3, MON)!.n).toBe(1);
    expect(rxQty(l, TAB, MON)).toBe(4);
  });
});

describe('rx-schedule · plain language (sayRx)', () => {
  const U = (id: string) => newRxLine(id, RX_USUAL_EXAMPLES[id]);
  it('the mockup usuals read as the owner wrote them', () => {
    expect(sayRx(U('amc'), drug('amc'))).toBe('Take 1 tablet in the morning and at night, after food, for 5 days.');
    expect(sayRx(U('mlc'), drug('mlc'))).toBe('Take 1 tablet at night, after food, for 10 days.');
    expect(sayRx(U('flu'), drug('flu'))).toBe('Use 2 sprays in each nostril in the morning and at night, for 2 weeks.');
    expect(sayRx(U('pcm'), drug('pcm'))).toBe('Take 1 tablet only when needed — at most 3 a day, at least 6 hours apart, after food, for 3 days.');
    expect(sayRx(U('oto'), drug('oto'))).toBe('Put 3 drops in both ears 3 times a day, for 1 week.');
    expect(sayRx(U('clo'), drug('clo'))).toBe('Apply a thin layer on the affected area every other day, for 2 weeks.');
    expect(sayRx(U('fol'), drug('fol'))).toBe('Take 1 tablet in the afternoon, after food, for 30 days.');
    expect(sayRx(U('pan'), drug('pan'))).toBe('Take 1 tablet in the morning, before food, for 2 weeks.');
    expect(sayRx(U('sal'), drug('sal'))).toBe('Put 2 drops in both nostrils every 2 hours while awake (6 AM–10 PM) for 1 day, then 4 times a day for 5 days.');
    expect(sayRx(U('syr'), drug('syr'))).toBe('Take 10 ml 3 times a day, after food, for 5 days.');
    expect(sayRx(U('inh'), drug('inh'))).toBe('Use 2 puffs in the morning and at night, for 30 days.');
  });

  it('half, 4-slot, hours round the clock, nth, weekly, cycle', () => {
    expect(sayRx(line(T([1, 0, 0]), 3, 0.5), TAB)).toBe('Take ½ tablet in the morning, for 3 days.');
    expect(sayRx(line(T([0, 1, 1, 0]), 1), TAB)).toBe('Take 1 tablet at noon and in the evening, for 1 day.');
    expect(sayRx(line({ type: 'hours', every: 6, awake: false }, 2), TAB)).toBe('Take 1 tablet every 6 hours, round the clock, for 2 days.');
    expect(sayRx(line({ type: 'hours', every: 1, awake: true }, 1), TAB)).toBe('Take 1 tablet every hour while awake (6 AM–10 PM), for 1 day.');
    expect(sayRx(line({ type: 'days', mode: 'nth', n: 3 }, 9), TAB)).toBe('Take 1 tablet every 3rd day, for 9 days.');
    expect(sayRx(line({ type: 'days', mode: 'weekly', wd: [1, 4] }, 28), TAB)).toBe('Take 1 tablet every Monday and Thursday, for 4 weeks.');
    expect(sayRx(line({ type: 'cycle', on: 21, off: 7, pat: [1, 0, 0], cycles: 3 }, 0), TAB)).toBe('Take 1 tablet in the morning for 21 days, then stop for 7 days, and repeat.');
  });

  it('taper with per-step dose names the dose in every step; food goes last', () => {
    const l = line({ type: 'steps', steps: [{ sched: T([1, 1, 1]), dur: 3, dose: 2 }, { sched: T([1, 0, 1]), dur: 3 }] }, 0, 1, { food: 'After' });
    expect(sayRx(l, TAB)).toBe('Take 2 tablets 3 times a day for 3 days, then 1 tablet in the morning and at night for 3 days, after food.');
  });

  it('food is ignored for forms that take no food; site only for site forms', () => {
    expect(sayRx(line(T([1, 0, 1]), 5, 2, { food: 'After', site: 'Right eye' }), drug('inh'))).toBe('Use 2 puffs in the morning and at night, for 5 days.');
    expect(sayRx(line(T([1, 0, 0]), 7, 1, { site: 'Right ear' }), drug('oto'))).toBe('Put 1 drop in the right ear in the morning, for 1 week.');
  });

  it('unknown language falls back to English', () => {
    expect(sayRx(U('amc'), drug('amc'), 'xx')).toBe(sayRx(U('amc'), drug('amc'), 'en'));
  });
});

describe('rx-schedule · short labels', () => {
  it('shortSched / whenShort / isComplex', () => {
    expect(shortSched(T([1, 0, 1]))).toBe('1-0-1');
    expect(shortSched(T([1, 1, 1, 1]))).toBe('4× a day');
    expect(shortSched({ type: 'hours', every: 2, awake: false })).toBe('Every 2 h · 24 h');
    expect(shortSched({ type: 'days', mode: 'weekly', wd: [1, 4] })).toBe('Mon, Thu');
    expect(shortSched({ type: 'sos', max: 3, gap: 6 })).toBe('SOS · max 3/day');
    expect(shortSched({ type: 'cycle', on: 21, off: 7, pat: [1, 0, 0], cycles: 1 })).toBe('21 on / 7 off');
    expect(shortSched(RX_USUAL_EXAMPLES['sal'].sched)).toBe('Every 2 h → 4× a day');
    expect(whenShort({ type: 'hours', every: 4, awake: false })).toBe('Every 4 h, day & night');
    expect(whenShort({ type: 'days', mode: 'alt' })).toBe('Every other day');
    expect(whenShort({ type: 'days', mode: 'nth', n: 2 })).toBe('Every 2nd day');
    expect(whenShort({ type: 'days', mode: 'weekly', wd: [0] })).toBe('Weekly · Sun');
    expect(whenShort({ type: 'sos', max: 2, gap: 8 })).toBe('SOS · max 2');
    expect(whenShort({ type: 'cycle', on: 5, off: 2, pat: [1, 0, 1], cycles: 1 })).toBe('1-0-1 · 5 on, 2 off');
    expect(isComplex(line(T([1, 0, 1]), 5))).toBe(false);
    expect(isComplex(line({ type: 'sos', max: 3, gap: 6 }, 3))).toBe(true);
  });

  it('doseShort / lineShort / qtyWords', () => {
    expect(doseShort(TAB, 0.5)).toBe('½ tab');
    expect(doseShort(TAB, 2)).toBe('2 tabs');
    expect(doseShort(drug('clo'), 1)).toBe('Thin layer');
    expect(lineShort(newRxLine('amc', RX_USUAL_EXAMPLES['amc']), TAB)).toBe('1 tab · 1-0-1 · 5 days · after food');
    expect(lineShort(newRxLine('flu', RX_USUAL_EXAMPLES['flu']), drug('flu'))).toBe('2 sprays · Both nostrils · 1-0-1 · 14 days');
    expect(lineShort(newRxLine('sal', RX_USUAL_EXAMPLES['sal']), drug('sal'))).toBe('2 drops · Both nostrils · Every 2 h · 1 day, then 2 drops · 1-1-1-1 · 5 days');
    expect(lineShort(line({ type: 'cycle', on: 21, off: 7, pat: [1, 0, 0], cycles: 3 }, 0), TAB)).toBe('1 tab · 1-0-0 · 21 on, 7 off · 3 cycles');
    expect(qtyWords(newRxLine('amc', RX_USUAL_EXAMPLES['amc']), TAB)).toBe('10 tablets');
    expect(qtyWords(line(T([1, 0, 0]), 1), TAB)).toBe('1 tablet');
    expect(qtyWords(newRxLine('flu', RX_USUAL_EXAMPLES['flu']), drug('flu'))).toBe('1 bottle');
    expect(qtyWords(newRxLine('clo', RX_USUAL_EXAMPLES['clo']), drug('clo'))).toBe('1 tube');
  });
});

describe('rx-schedule · 14-day strip', () => {
  it('returns 14 dated cells; days past the course are null; today flagged', () => {
    const cells = stripDays(line(T([1, 0, 1]), 5), MON);
    expect(cells.length).toBe(14);
    expect(cells[0].today).toBe(true);
    expect(cells[0].weekday).toBe(1);
    expect(cells[6].weekday).toBe(0);
    expect(cells[1].date.getDate()).toBe(29);
    expect(cells[3].date.getDate()).toBe(1); // 1 Oct
    expect(cells[4].day).toEqual({ n: 2, dose: 1, step: 0, sos: false });
    expect(cells[5].day).toBeNull();
  });
  it('marks SOS days (also inside a taper) and step changes', () => {
    expect(stripDays(line({ type: 'sos', max: 3, gap: 6 }, 3), MON)[0].day!.sos).toBe(true);
    const l = line({ type: 'steps', steps: [{ sched: { type: 'sos', max: 2, gap: 4 }, dur: 1 }, { sched: T([1, 0, 0]), dur: 1 }] }, 0);
    const c = stripDays(l, MON, 3);
    expect(c[0].day).toEqual({ n: 2, dose: 1, step: 0, sos: true });
    expect(c[1].day).toEqual({ n: 1, dose: 1, step: 1, sos: false });
    expect(c[2].day).toBeNull();
  });
  it('alternate days show off days as n = 0', () => {
    const c = stripDays(line({ type: 'days', mode: 'alt' }, 4), MON, 4);
    expect(c.map(x => x.day!.n)).toEqual([1, 0, 1, 0]);
  });
});

describe('rx-schedule · parseRx shorthand', () => {
  it('"clav 1-0-1 5d af"', () => {
    const r = parseRx('clav 1-0-1 5d af', DRUGS)!;
    expect(r.drug!.id).toBe('amc');
    expect(r.any).toBe(true);
    expect(r.line).toEqual({ drugId: 'amc', dose: 1, sched: T([1, 0, 1]), dur: 5, food: 'After' });
  });
  it('frequency words, dose with unit, weeks', () => {
    const r = parseRx('azimax 2 tabs od 2 weeks', DRUGS)!;
    expect(r.drug!.id).toBe('azi');
    expect(r.line!.dose).toBe(2);
    expect(r.line!.sched).toEqual(T([1, 0, 0]));
    expect(r.line!.dur).toBe(14);
    expect(parseRx('cet tds', DRUGS)!.line!.sched).toEqual(T([1, 1, 1]));
    expect(parseRx('cet qid', DRUGS)!.line!.sched).toEqual(T([1, 1, 1, 1]));
    expect(parseRx('cet hs', DRUGS)!.line!.sched).toEqual(T([0, 0, 1]));
    expect(parseRx('cet bid', DRUGS)!.line!.sched).toEqual(T([1, 0, 1]));
  });
  it('alias match, sos keeps the usual duration', () => {
    const r = parseRx('pcm sos', DRUGS)!;
    expect(r.drug!.id).toBe('pcm');
    expect(r.line!.sched).toEqual({ type: 'sos', max: 3, gap: 6 });
    expect(r.line!.dur).toBe(3);
  });
  it('x N d, before food, halves, q-hours, eod, weekly', () => {
    const r = parseRx('pan 1 bf x 10 d', DRUGS)!;
    expect(r.drug!.id).toBe('pan');
    expect(r.line!.food).toBe('Before');
    expect(r.line!.dur).toBe(10);
    expect(parseRx('tel ½-0-½', DRUGS)!.line!.sched).toEqual(T([0.5, 0, 0.5]));
    expect(parseRx('tel half od', DRUGS)!.line!.dose).toBe(0.5);
    expect(parseRx('cet q4h', DRUGS)!.line!.sched).toEqual({ type: 'hours', every: 4, awake: true });
    expect(parseRx('cet eod', DRUGS)!.line!.sched).toEqual({ type: 'days', mode: 'alt' });
    expect(parseRx('cet weekly', DRUGS)!.line!.sched).toEqual({ type: 'days', mode: 'weekly', wd: [1] });
    expect(parseRx('cet after food 1-0-0', DRUGS)!.line!.food).toBe('After');
  });
  it('side picks the site list for the drug kind; ignored for non-site forms', () => {
    expect(parseRx('otiflox 2 drops tds 5 days right', DRUGS)!.line).toEqual(
      { drugId: 'oto', dose: 2, site: 'Right ear', sched: T([1, 1, 1]), dur: 5 });
    expect(parseRx('fluticon both', DRUGS)!.line!.site).toBe('Both nostrils');
    expect(parseRx('cet left', DRUGS)!.line!.site).toBeUndefined();
  });
  it('cream ignores dose; a taper takes the duration on its last step', () => {
    const c = parseRx('betaclo 2 bd', DRUGS)!;
    expect(c.line!.dose).toBe(1);
    expect(c.line!.sched).toEqual(T([1, 0, 1]));
    const s = parseRx('salinex 7d', DRUGS)!;
    expect(s.line!.sched.type).toBe('steps');
    expect((s.line!.sched as any).steps[1].dur).toBe(7);
  });
  it('no usual ⇒ 1 · 1-0-1 · 5 days; a new schedule on a steps usual gets a default duration', () => {
    const r = parseRx('cetrizet', DRUGS, () => null)!;
    expect(r.line).toEqual({ drugId: 'cet', dose: 1, sched: T([1, 0, 1]), dur: 5 });
    expect(r.any).toBe(false);
    expect(parseRx('salinex sos', DRUGS)!.line!.dur).toBe(3);
    expect(parseRx('salinex bd', DRUGS)!.line!.dur).toBe(5);
  });
  it('words after the first instruction never join the drug name', () => {
    const r = parseRx('dolo 1-0-1 extra words', DRUGS)!;
    expect(r.name).toBe('dolo');
    expect(r.drug!.id).toBe('pcm');
  });
  it('empty / instruction-only / unknown', () => {
    expect(parseRx('', DRUGS)).toBeNull();
    expect(parseRx('   ', DRUGS)).toBeNull();
    expect(parseRx('1-0-1 5d', DRUGS)).toBeNull();
    expect(parseRx('xyzzy', DRUGS)).toEqual({ name: 'xyzzy', none: true });
  });
  it('bestDrug ranks brand prefix over generic word over substring', () => {
    expect(bestDrug(DRUGS, 'mont')!.id).toBe('mlc');
    expect(bestDrug(DRUGS, 'paracetamol')!.id).toBe('pcm');
    expect(bestDrug(DRUGS, 'saline')!.id).toBe('sal');
    expect(bestDrug(DRUGS, '')).toBeNull();
  });
});
