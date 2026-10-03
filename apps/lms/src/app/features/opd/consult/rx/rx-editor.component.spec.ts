import { TestBed } from '@angular/core/testing';
import type { OpdPatientAllergy, OpdPregnancy } from '../../shared/opd.models';
import { timesSched } from '../../shared/rx-schedule';
import { RxEditorComponent, durLabel } from './rx-editor.component';
import { ConsultDrugRef, ConsultRxLine } from './rx-model';

const CLAV: ConsultDrugRef = { id: 'd-clav', name: 'Clavumox 625', form: 'tab', generic: 'Amoxicillin + Clavulanic acid', aliases: 'co-amoxiclav clav', schedule: 'H1' };
const AZI: ConsultDrugRef = { id: 'd-azi', name: 'Azimax 500', form: 'tab', generic: 'Azithromycin', schedule: 'H' };
const SAL: ConsultDrugRef = { id: 'd-sal', name: 'Salinex Nasal Drops', form: 'drops', generic: 'Sodium chloride 0.65%', siteKind: 'nose', schedule: 'none' };
const DOXY: ConsultDrugRef = { id: 'd-doxy', name: 'Doxyt 100', form: 'cap', generic: 'Doxycycline', schedule: 'H', pregnancyRisk: 'avoid' };
const DRUGS = [CLAV, AZI, SAL, DOXY];
const PEN: OpdPatientAllergy = { id: 'a1', patientId: 'p', allergen: 'Penicillin', reaction: 'rash (2019)', status: 'active' };
const PREGNANT: OpdPregnancy = { status: 'pregnant', source: 'form answer', since: '2026-08-01' };

function mount(lines: ConsultRxLine[] = [], allergies: OpdPatientAllergy[] = [], pregnant: OpdPregnancy | null = null) {
  TestBed.configureTestingModule({ imports: [RxEditorComponent] });
  const f = TestBed.createComponent(RxEditorComponent);
  f.componentRef.setInput('lines', lines);
  f.componentRef.setInput('drugs', DRUGS);
  f.componentRef.setInput('allergies', allergies);
  f.componentRef.setInput('pregnant', pregnant);
  f.componentRef.setInput('start', new Date(2026, 8, 30));
  f.detectChanges();
  return f;
}
const clavLine = (): ConsultRxLine => ({ key: 'k1', drug: CLAV, line: { drugId: CLAV.id, dose: 1, sched: timesSched([1, 0, 1]), dur: 5, food: 'After' } });
const key = (el: Element, k: string, shift = false) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true }));

const toks = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.rl .tok')].map(b => b.textContent!.trim());
const tok = (el: HTMLElement, t: string) => el.querySelector(`.rl [data-tok="${t}"]`) as HTMLButtonElement;
const opts = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.rl__opts button')];

describe('RxEditorComponent — one line per medicine (consult v6)', () => {
  it('renders number, name, form, the three tokens, the plain sentence and the total', () => {
    const f = mount([clavLine()]);
    const el: HTMLElement = f.nativeElement;
    expect(el.querySelector('.rl__no')!.textContent!.trim()).toBe('1');
    expect(el.querySelector('.rl__name')!.textContent).toContain('Clavumox 625');
    expect(el.querySelector('.rl__form')!.textContent).toContain('Tablet');
    expect(toks(el)).toEqual(['1-0-1', '5 days', 'After food']);
    expect(el.querySelector('.rl__sent')!.textContent).toContain('Take 1 tablet in the morning and at night, after food, for 5 days');
    expect(el.querySelector('.rl__qty')!.textContent!.trim()).toBe('10 tablets');
    expect(el.querySelector('.rl__sch')!.textContent).toContain('Sch H1');
  });

  it('tapping a token opens ONE row of common choices; a tap sets it and closes the row', () => {
    const f = mount([clavLine()]);
    const el: HTMLElement = f.nativeElement;
    tok(el, 'pat').click(); f.detectChanges();
    expect(opts(el).map(b => b.textContent!.trim())).toEqual(['1-0-0', '0-0-1', '1-0-1', '1-1-1', '1-1-1-1', '0-1-0', '½-0-½', 'SOS', 'More…']);
    expect(opts(el).find(b => b.getAttribute('aria-pressed') === 'true')!.textContent!.trim()).toBe('1-0-1');
    opts(el).find(b => b.textContent!.trim() === '1-1-1')!.click(); f.detectChanges();
    expect(el.querySelector('.rl__opts')).toBeNull();
    expect(f.componentInstance.lines()[0].line.sched).toEqual(timesSched([1, 1, 1]));
    expect(el.querySelector('.rl__qty')!.textContent!.trim()).toBe('15 tablets');

    tok(el, 'days').click(); f.detectChanges();
    expect(opts(el).map(b => b.textContent!.trim())).toEqual(['1 d', '3 d', '5 d', '7 d', '10 d', '15 d', '30 d', 'Ongoing']);
    opts(el).find(b => b.textContent!.trim() === '7 d')!.click(); f.detectChanges();
    expect(f.componentInstance.lines()[0].line.dur).toBe(7);

    tok(el, 'food').click(); f.detectChanges();
    expect(opts(el).map(b => b.textContent!.trim())).toEqual(['After food', 'Before food', 'With food', 'Any time']);
    opts(el).find(b => b.textContent!.trim() === 'Before food')!.click(); f.detectChanges();
    expect(el.querySelector('.rl__sent')!.textContent).toContain('Take 1 tablet in the morning, in the afternoon and at night, before food, for 7 days');
  });

  it('½-0-½ reads half a tablet; SOS reads "only when needed" with an "up to" total; Ongoing reads "until your next visit"', () => {
    const f = mount([clavLine()]);
    const el: HTMLElement = f.nativeElement;
    tok(el, 'pat').click(); f.detectChanges();
    opts(el).find(b => b.textContent!.trim() === '½-0-½')!.click(); f.detectChanges();
    expect(el.querySelector('.rl__sent')!.textContent).toContain('Take ½ tablet in the morning and at night');
    expect(el.querySelector('.rl__qty')!.textContent!.trim()).toBe('5 tablets');
    tok(el, 'pat').click(); f.detectChanges();
    opts(el).find(b => b.textContent!.trim() === 'SOS')!.click(); f.detectChanges();
    expect(el.querySelector('.rl__sent')!.textContent).toContain('only when needed');
    expect(el.querySelector('.rl__qty')!.textContent!.trim()).toMatch(/^up to \d+ tablets$/);
    tok(el, 'pat').click(); f.detectChanges();
    opts(el).find(b => b.textContent!.trim() === '1-0-1')!.click(); f.detectChanges();
    tok(el, 'days').click(); f.detectChanges();
    opts(el).find(b => b.textContent!.trim() === 'Ongoing')!.click(); f.detectChanges();
    expect(tok(el, 'days').textContent!.trim()).toBe('Ongoing');
    expect(el.querySelector('.rl__sent')!.textContent).toContain('continue until your next visit');
    expect(f.componentInstance.lines()[0].line.dur).toBe(30);
  });

  it('More… opens the advanced schedules (every few hours, taper "then…")', () => {
    const f = mount([clavLine()]);
    const el: HTMLElement = f.nativeElement;
    tok(el, 'pat').click(); f.detectChanges();
    opts(el).find(b => b.textContent!.trim() === 'More…')!.click(); f.detectChanges();
    const pop = el.querySelector('.rxp')!;
    expect(pop.textContent).toContain('Every 8 hours');
    expect(pop.textContent).toContain('21 days on, 7 off');
    const then = [...pop.querySelectorAll<HTMLButtonElement>('.rxp__row')].find(r => r.textContent!.includes('once a day, 5 days'))!;
    then.click(); f.detectChanges();
    expect(f.componentInstance.lines()[0].line.sched.type).toBe('steps');
    expect(el.querySelector('.rl__sent')!.textContent).toContain('then in the morning for 5 days');
    expect(el.querySelector('.rl__qty')!.textContent!.trim()).toBe('15 tablets');
  });

  it('Escape closes the row without a change', () => {
    const f = mount([clavLine()]);
    const el: HTMLElement = f.nativeElement;
    tok(el, 'days').click(); f.detectChanges();
    key(el.querySelector('.rl__opts')!, 'Escape'); f.detectChanges();
    expect(el.querySelector('.rl__opts')).toBeNull();
    expect(f.componentInstance.lines()[0].line.dur).toBe(5);
  });
});

describe('RxEditorComponent — type, Enter, done', () => {
  it('"azi" + Enter adds the drug with the doctor\'s usual and keeps the bar ready', () => {
    const f = mount();
    f.componentRef.setInput('usuals', { 'd-azi': { dose: 1, sched: timesSched([1, 0, 0]), dur: 3, food: 'After' } });
    f.detectChanges();
    const el: HTMLElement = f.nativeElement;
    const input = el.querySelector('.rxe__addin') as HTMLInputElement;
    input.value = 'azi'; input.dispatchEvent(new Event('input')); f.detectChanges();
    expect(el.querySelector('.rxe__sg')!.textContent).toContain('1-0-0 · 3 days · after food');
    key(input, 'Enter'); f.detectChanges();
    const l = f.componentInstance.lines()[0];
    expect(l.drug.id).toBe('d-azi');
    expect(l.line).toMatchObject({ dose: 1, dur: 3, food: 'After', sched: timesSched([1, 0, 0]) });
    expect(f.componentInstance.typed()).toBe('');
  });

  it('no usual on record → 1-0-1 · 5 days · after food', () => {
    const f = mount();
    const input = (f.nativeElement as HTMLElement).querySelector('.rxe__addin') as HTMLInputElement;
    input.value = 'doxyt'; input.dispatchEvent(new Event('input')); f.detectChanges();
    key(input, 'Enter'); f.detectChanges();
    expect(f.componentInstance.lines()[0].line).toMatchObject({ dose: 1, dur: 5, food: 'After', sched: timesSched([1, 0, 1]) });
  });

  it('the shorthand still works: "clav 1-0-1 5d af" previews as typed and Enter adds it', () => {
    const f = mount();
    const el: HTMLElement = f.nativeElement;
    const input = el.querySelector('.rxe__addin') as HTMLInputElement;
    input.value = 'clav 1-1-1 7d bf';
    input.dispatchEvent(new Event('input')); f.detectChanges();
    expect(el.querySelector('.rxe__sg')!.textContent).toContain('Clavumox 625');
    key(input, 'Enter'); f.detectChanges();
    expect(f.componentInstance.lines()[0].line).toMatchObject({ dose: 1, dur: 7, food: 'Before', sched: timesSched([1, 1, 1]) });
  });

  it('understands q2h + both + days for drops, and falls back to "add as written" for unknown drugs', () => {
    const f = mount();
    const cmp = f.componentInstance;
    cmp.onType('salinex 2 drops q2h 5d both'); f.detectChanges();
    const p = cmp.preview()!;
    expect(p.drug.id).toBe('d-sal');
    expect(p.line).toMatchObject({ dose: 2, dur: 5, site: 'Both nostrils', sched: { type: 'hours', every: 2, awake: true } });
    cmp.onType('zzqx'); f.detectChanges();
    expect(cmp.preview()).toBeNull();
    expect((f.nativeElement as HTMLElement).textContent).toContain('as written');
    const input = (f.nativeElement as HTMLElement).querySelector('.rxe__addin') as HTMLInputElement;
    key(input, 'Enter'); f.detectChanges();
    expect(cmp.lines()[0].drug.free).toBe(true);
    expect(cmp.lines()[0].drug.name).toBe('Zzqx');
  });

  it('word start only ("amo" never offers a drug that merely contains it) and never a drug already on the list', () => {
    const f = mount([clavLine()]);
    const cmp = f.componentInstance;
    cmp.onType('cla'); f.detectChanges();
    expect(cmp.matches().map(d => d.id)).toEqual([]);
    cmp.onType('azi'); f.detectChanges();
    expect(cmp.matches().map(d => d.id)).toEqual(['d-azi']);
    cmp.onType('max'); f.detectChanges();
    expect(cmp.matches().map(d => d.id)).toEqual([]);
  });

  it('Tab (or "Change dose") opens the one-line composer; a chip drops its options; Add puts it on the list', () => {
    const f = mount();
    const el: HTMLElement = f.nativeElement;
    const input = el.querySelector('.rxe__addin') as HTMLInputElement;
    input.value = 'azi'; input.dispatchEvent(new Event('input')); f.detectChanges();
    key(input, 'Tab'); f.detectChanges();
    expect(el.querySelector('[data-composer]')).toBeTruthy();
    (el.querySelector('.cmp__chip') as HTMLButtonElement).click(); f.detectChanges();
    const opt = [...el.querySelectorAll<HTMLButtonElement>('.cmp__menu button')].find(b => b.textContent!.trim() === '1-1-1')!;
    opt.click(); f.detectChanges();
    expect(el.querySelector('.cmp__menu')).toBeNull();
    expect(el.querySelector('.cmp__say')!.textContent).toContain('in the morning, in the afternoon and at night');
    (el.querySelector('[data-cadd]') as HTMLButtonElement).click(); f.detectChanges();
    expect(f.componentInstance.lines()[0].line.sched).toEqual(timesSched([1, 1, 1]));
    expect(el.querySelector('[data-composer]')).toBeNull();
  });

  it('arrow keys move through the suggestions', () => {
    const f = mount();
    const cmp = f.componentInstance;
    cmp.onType('a'); f.detectChanges();
    const input = (f.nativeElement as HTMLElement).querySelector('.rxe__addin') as HTMLInputElement;
    expect(cmp.suggest().length).toBeGreaterThan(1);
    key(input, 'ArrowDown');
    expect(cmp.active()).toBe(1);
  });

  it('asks the host to search the master with the drug words only', () => {
    const f = mount();
    const seen: string[] = [];
    f.componentInstance.search.subscribe(q => seen.push(q));
    f.componentInstance.onType('amox 1-0-1 5d');
    expect(seen).toEqual(['amox']);
  });
});

describe('RxEditorComponent — inline allergy', () => {
  it('shows the conflict with one-tap swap and "Keep, reviewed" (stores the ack)', () => {
    const f = mount([clavLine()], [PEN]);
    const el: HTMLElement = f.nativeElement;
    expect(el.querySelector('.rl__alert:not(.rl__alert--preg)')!.textContent).toContain('Allergy: Penicillin');
    expect(el.querySelector('.rl__swap')!.textContent).toContain('Swap to Azimax 500');
    (el.querySelector('.rl__keep') as HTMLButtonElement).click(); f.detectChanges();
    expect(f.componentInstance.lines()[0].allergyAck).toBe(true);
    expect(el.querySelector('.rl__alert:not(.rl__alert--preg)')).toBeNull();
    expect(el.querySelector('.rl__acked')).toBeTruthy();
  });
  it('swap replaces the drug with the alternative and clears the warning', () => {
    const f = mount([clavLine()], [PEN]);
    const el: HTMLElement = f.nativeElement;
    const notes: string[] = [];
    f.componentInstance.notice.subscribe(n => notes.push(n));
    (el.querySelector('.rl__swap') as HTMLButtonElement).click(); f.detectChanges();
    expect(f.componentInstance.lines()[0].drug.id).toBe('d-azi');
    expect(el.querySelector('.rl__alert:not(.rl__alert--preg)')).toBeNull();
    expect(notes[0]).toContain('Clavumox 625 swapped for Azimax 500');
  });
});

describe('RxEditorComponent — pregnancy-safety guard', () => {
  const doxyLine = (): ConsultRxLine => ({ key: 'k2', drug: DOXY, line: { drugId: DOXY.id, dose: 1, sched: timesSched([1, 0, 1]), dur: 5, food: 'After' } });

  it('shows the avoid-in-pregnancy banner with a swap + "Keep, reviewed" (stores the ack)', () => {
    const f = mount([doxyLine()], [], PREGNANT);
    const el: HTMLElement = f.nativeElement;
    expect(el.querySelector('.rl__alert--preg')!.textContent).toContain('Avoid in pregnancy');
    (el.querySelector('.rl__alert--preg .rl__keep') as HTMLButtonElement).click(); f.detectChanges();
    expect(f.componentInstance.lines()[0].pregnancyAck).toBe(true);
    expect(el.querySelector('.rl__alert--preg')).toBeNull();
    expect(el.querySelector('.rl__acked')!.textContent).toContain('Pregnancy risk reviewed');
  });

  it('never shows the banner when the patient is not pregnant, even for an avoid drug', () => {
    const f = mount([doxyLine()], [], null);
    expect((f.nativeElement as HTMLElement).querySelector('.rl__alert--preg')).toBeNull();
  });

  it('a contraindicated drug reads "Contraindicated in pregnancy"', () => {
    const contra: ConsultDrugRef = { ...DOXY, id: 'd-itra', name: 'Itrazole 100', pregnancyRisk: 'contraindicated' };
    const f = mount([{ key: 'k3', drug: contra, line: { drugId: contra.id, dose: 1, sched: timesSched([1, 0, 0]), dur: 5 } }], [], PREGNANT);
    expect((f.nativeElement as HTMLElement).querySelector('.rl__alert--preg')!.textContent).toContain('Contraindicated in pregnancy');
  });

  it('a caution drug shows a quiet amber chip and never blocks', () => {
    const caution: ConsultDrugRef = { ...DOXY, id: 'd-metf', name: 'Metfor 500', pregnancyRisk: 'caution' };
    const f = mount([{ key: 'k4', drug: caution, line: { drugId: caution.id, dose: 1, sched: timesSched([1, 0, 0]), dur: 5 } }], [], PREGNANT);
    const el: HTMLElement = f.nativeElement;
    expect(el.querySelector('.rl__caution')!.textContent).toContain('Caution in pregnancy');
    expect(el.querySelector('.rl__alert--preg')).toBeNull();
  });
});

describe('durLabel', () => {
  it('speaks weeks like a doctor', () => {
    expect([durLabel(1), durLabel(5), durLabel(7), durLabel(14), durLabel(30)]).toEqual(['1 day', '5 days', '1 week', '2 weeks', '30 days']);
  });
});
