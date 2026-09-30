import type { OpdPatientAllergy, OpdPregnancy } from '../../shared/opd.models';
import { rxQty, timesSched, totalDays } from '../../shared/rx-schedule';
import {
  ConsultDrugRef, ConsultRxLine, THEN_PRESETS, addThen, allergyHit, drugRefOf, freeDrug, fromDto, pregnancyHit, removeStep,
  siteKindOf, swapCandidate, timingIdOf, toDto, unresolvedAllergies, unresolvedPregnancyRisks,
} from './rx-model';

const CLAV: ConsultDrugRef = { id: 'd-clav', name: 'Clavumox 625', form: 'tab', generic: 'Amoxicillin 500 mg + Clavulanic acid 125 mg', schedule: 'H1' };
const AZI: ConsultDrugRef = { id: 'd-azi', name: 'Azimax 500', form: 'tab', generic: 'Azithromycin 500 mg', schedule: 'H' };
const PCM: ConsultDrugRef = { id: 'd-pcm', name: 'Dolopar 650', form: 'tab', generic: 'Paracetamol 650 mg', schedule: 'none' };
const CEF: ConsultDrugRef = { id: 'd-cef', name: 'Cefakind 500', form: 'tab', generic: 'Cefuroxime 500 mg' };
const PEN: OpdPatientAllergy = { id: 'a1', patientId: 'p', allergen: 'Penicillin', reaction: 'rash', status: 'active' };

const line = (drug: ConsultDrugRef, over: Partial<ConsultRxLine> = {}): ConsultRxLine => ({
  key: 'k-' + drug.id, drug, line: { drugId: drug.id, dose: 1, sched: timesSched([1, 0, 1]), dur: 5, food: 'After' }, ...over,
});

describe('rx-model — allergy check (TS mirror of server AllergyCheck)', () => {
  it('flags an amoxicillin + clavulanate drug for a penicillin allergy (family match)', () => {
    const hit = allergyHit(CLAV, [PEN]);
    expect(hit?.allergy.allergen).toBe('Penicillin');
    expect(hit?.reason).toContain('penicillin');
  });
  it('flags a direct word match and an exact drug id match', () => {
    expect(allergyHit(PCM, [{ ...PEN, allergen: 'Paracetamol' }])).not.toBeNull();
    expect(allergyHit(AZI, [{ ...PEN, allergen: 'Something', drugId: 'd-azi' }])).not.toBeNull();
  });
  it('does not flag unrelated drugs, inactive allergies or a different family', () => {
    expect(allergyHit(AZI, [PEN])).toBeNull();
    expect(allergyHit(CEF, [PEN])).toBeNull();
    expect(allergyHit(CLAV, [{ ...PEN, status: 'inactive' }])).toBeNull();
  });
  it('an acknowledged line is no longer unresolved', () => {
    const l = line(CLAV);
    expect(unresolvedAllergies([l], [PEN]).length).toBe(1);
    expect(unresolvedAllergies([{ ...l, allergyAck: true }], [PEN]).length).toBe(0);
  });
  it('swap suggests a same-form antibiotic outside the allergic family', () => {
    expect(swapCandidate(line(CLAV), [CLAV, PCM, AZI], [PEN])?.id).toBe('d-azi');
    expect(swapCandidate(line(CLAV), [CLAV, PCM], [PEN])).toBeNull(); // paracetamol is no antibiotic swap
  });
});

describe('rx-model — pregnancy-safety guard (TS mirror of server PregnancyStatus + the Complete gate)', () => {
  const PREGNANT: OpdPregnancy = { status: 'pregnant', source: 'form answer', since: '2026-08-01' };
  const LACTATING: OpdPregnancy = { status: 'lactating', source: 'diagnosis Z39.1' };
  const AVOID: ConsultDrugRef = { ...CLAV, id: 'd-doxy', name: 'Doxyt 100', pregnancyRisk: 'avoid' };
  const CONTRA: ConsultDrugRef = { ...CLAV, id: 'd-itra', name: 'Itrazole 100', pregnancyRisk: 'contraindicated' };
  const CAUTION: ConsultDrugRef = { ...CLAV, id: 'd-metf', name: 'Metfor 500', pregnancyRisk: 'caution' };
  const SAFE: ConsultDrugRef = { ...CLAV, id: 'd-pcm2', name: 'Paracet 650', pregnancyRisk: 'safe' };

  it('flags avoid / contraindicated drugs only when the patient is pregnant', () => {
    expect(pregnancyHit(AVOID, PREGNANT)?.risk).toBe('avoid');
    expect(pregnancyHit(CONTRA, PREGNANT)?.risk).toBe('contraindicated');
    expect(pregnancyHit(AVOID, null)).toBeNull();
    expect(pregnancyHit(AVOID, LACTATING)).toBeNull(); // lactating never blocks today
  });
  it('never flags caution or safe drugs — caution is a non-blocking chip, not a hit', () => {
    expect(pregnancyHit(CAUTION, PREGNANT)).toBeNull();
    expect(pregnancyHit(SAFE, PREGNANT)).toBeNull();
  });
  it('uses the drug master note when present, else a generic sentence', () => {
    expect(pregnancyHit({ ...AVOID, pregnancyNote: 'ARB — fetal renal toxicity' }, PREGNANT)?.reason).toBe('ARB — fetal renal toxicity');
    expect(pregnancyHit(CONTRA, PREGNANT)?.reason).toContain('contraindicated');
  });
  it('an acknowledged line is no longer unresolved', () => {
    const l = line(AVOID);
    expect(unresolvedPregnancyRisks([l], PREGNANT).length).toBe(1);
    expect(unresolvedPregnancyRisks([{ ...l, pregnancyAck: true }], PREGNANT).length).toBe(0);
  });
  it('a safe line on a pregnant patient is never unresolved', () => {
    expect(unresolvedPregnancyRisks([line(SAFE)], PREGNANT).length).toBe(0);
  });
  it('pregnancyAck round-trips through toDto/fromDto like allergyAck', () => {
    const dto = toDto(line(AVOID, { pregnancyAck: true, pregnancyAckNote: 'Benefit outweighs risk' }));
    expect(dto).toMatchObject({ pregnancyAck: true, pregnancyAckNote: 'Benefit outweighs risk' });
    expect(fromDto(dto, [AVOID]).pregnancyAck).toBe(true);
  });
});

describe('rx-model — taper ("+ then…") and timing', () => {
  it('addThen turns a plain line into a 2-step taper that keeps the course length arithmetic', () => {
    const l = { drugId: 'x', dose: 1, sched: timesSched([1, 0, 0]), dur: 10, food: 'After' as const };
    const t = addThen(l, THEN_PRESETS.find(p => p.id === 'tds-5')!.step);
    expect(t.sched.type).toBe('steps');
    expect(totalDays(t)).toBe(15);
    expect(rxQty(t, { form: 'tab' })).toBe(10 + 15);
    // Removing the continuation collapses back to the plain line.
    const back = removeStep(t, 1);
    expect(back.sched).toEqual(timesSched([1, 0, 0]));
    expect(back.dur).toBe(10);
  });
  it('the "same" preset continues with the line\'s own timing', () => {
    const l = { drugId: 'x', dose: 1, sched: timesSched([1, 1, 1]), dur: 3 };
    const t = addThen(l, THEN_PRESETS.find(p => p.id === 'same-5')!.step);
    expect(t.sched.type === 'steps' && t.sched.steps[1].sched).toEqual(timesSched([1, 1, 1]));
  });
  it('timingIdOf recognises the popover options', () => {
    expect(timingIdOf(timesSched([1, 0, 1]))).toBe('1-0-1');
    expect(timingIdOf({ type: 'sos', max: 2, gap: 8 })).toBe('sos');
    expect(timingIdOf({ type: 'hours', every: 4, awake: true })).toBe('q4h');
    expect(timingIdOf({ type: 'days', mode: 'weekly', wd: [3] })).toBe('weekly');
    expect(timingIdOf(timesSched([2, 0, 2]))).toBeNull();
  });
});

describe('rx-model — wire mapping', () => {
  it('toDto → fromDto round-trips the schedule, dose, site and ack', () => {
    const l = line(CLAV, { allergyAck: true, allergyAckNote: 'Kept after review' });
    const dto = toDto(l);
    expect(dto).toMatchObject({ drugId: 'd-clav', drugName: 'Clavumox 625', form: 'tab', dose: 1, durationDays: 5, food: 'After', allergyAck: true, quantity: 10 });
    const back = fromDto(dto, [CLAV]);
    expect(back.drug).toBe(CLAV);
    expect(back.line.sched).toEqual(l.line.sched);
    expect(back.allergyAck).toBe(true);
  });
  it('a free-text drug goes out with no drug id and food only for forms that take it', () => {
    const spray = freeDrug('Nasoclear spray', 'spray');
    const dto = toDto({ key: 'k', drug: spray, line: { drugId: spray.id, dose: 2, site: 'Both nostrils', sched: timesSched([1, 0, 1]), dur: 14, food: 'After' } });
    expect(dto.drugId).toBeNull();
    expect(dto.food).toBeNull();
    expect(dto.quantity).toBe(1); // pack form
  });
  it('site kind comes from the form + name', () => {
    expect(siteKindOf('drops', 'Otorex ear drops')).toBe('ear');
    expect(siteKindOf('drops', 'Moxicip eye drops')).toBe('eye');
    expect(siteKindOf('spray', 'Fluticon')).toBe('nose');
    expect(siteKindOf('tab', 'x')).toBeUndefined();
    expect(drugRefOf({ id: '1', catalogKey: 'k', name: 'Salinex Nasal Drops', form: 'drops', schedule: 'none', isMaster: true }).siteKind).toBe('nose');
  });
});
