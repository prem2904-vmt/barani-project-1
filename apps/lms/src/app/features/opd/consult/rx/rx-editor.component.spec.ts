import { TestBed } from '@angular/core/testing';
import type { OpdPatientAllergy } from '../../shared/opd.models';
import { timesSched } from '../../shared/rx-schedule';
import { RxEditorComponent, durLabel } from './rx-editor.component';
import { ConsultDrugRef, ConsultRxLine } from './rx-model';

const CLAV: ConsultDrugRef = { id: 'd-clav', name: 'Clavumox 625', form: 'tab', generic: 'Amoxicillin + Clavulanic acid', aliases: 'co-amoxiclav clav', schedule: 'H1' };
const AZI: ConsultDrugRef = { id: 'd-azi', name: 'Azimax 500', form: 'tab', generic: 'Azithromycin', schedule: 'H' };
const SAL: ConsultDrugRef = { id: 'd-sal', name: 'Salinex Nasal Drops', form: 'drops', generic: 'Sodium chloride 0.65%', siteKind: 'nose', schedule: 'none' };
const DRUGS = [CLAV, AZI, SAL];
const PEN: OpdPatientAllergy = { id: 'a1', patientId: 'p', allergen: 'Penicillin', reaction: 'rash (2019)', status: 'active' };

function mount(lines: ConsultRxLine[] = [], allergies: OpdPatientAllergy[] = []) {
  TestBed.configureTestingModule({ imports: [RxEditorComponent] });
  const f = TestBed.createComponent(RxEditorComponent);
  f.componentRef.setInput('lines', lines);
  f.componentRef.setInput('drugs', DRUGS);
  f.componentRef.setInput('allergies', allergies);
  f.componentRef.setInput('start', new Date(2026, 8, 30));
  f.detectChanges();
  return f;
}
const clavLine = (): ConsultRxLine => ({ key: 'k1', drug: CLAV, line: { drugId: CLAV.id, dose: 1, sched: timesSched([1, 0, 1]), dur: 5, food: 'After' } });
const key = (el: Element, k: string, shift = false) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true }));

describe('RxEditorComponent — one line per medicine', () => {
  it('renders the line in shorthand columns with the patient sentence and quantity', () => {
    const f = mount([clavLine()]);
    const el: HTMLElement = f.nativeElement;
    const vals = [...el.querySelectorAll('.rxv')].map(b => b.textContent!.trim());
    expect(vals).toEqual(['1 tab', '1-0-1', '5 days', 'After food']);
    expect(el.querySelector('.rxe__say')!.textContent).toContain('Take 1 tablet in the morning and at night, after food, for 5 days.');
    expect(el.querySelector('.rxe__qty')!.textContent!.trim()).toBe('10 tablets');
    expect(el.querySelector('.rxe__sch')!.textContent).toContain('Sch H1');
  });

  it('tapping a value opens a popover with ONLY that value\'s options; arrows + Enter pick', () => {
    const f = mount([clavLine()]);
    const el: HTMLElement = f.nativeElement;
    (el.querySelectorAll('.rxv')[1] as HTMLButtonElement).click(); // When
    f.detectChanges();
    const pop = el.querySelector('.rxp')!;
    expect(pop).toBeTruthy();
    const chips = [...pop.querySelectorAll('.rxp__chip')].map(c => c.textContent!.trim());
    expect(chips).toContain('1-0-0');
    expect(chips).toContain('When needed (SOS)');
    expect(pop.textContent).toContain('21 days on, 7 off');
    expect(pop.querySelector('.rxp__chip.on')!.textContent!.trim()).toBe('1-0-1');
    // 1-0-1 is active; → moves to 1-0-0; Enter picks it.
    key(pop, 'ArrowRight'); key(pop, 'Enter');
    f.detectChanges();
    expect(el.querySelector('.rxp')).toBeNull();
    expect(f.componentInstance.lines()[0].line.sched).toEqual(timesSched([1, 0, 0]));
    expect(el.querySelector('.rxe__qty')!.textContent!.trim()).toBe('5 tablets');
  });

  it('Esc closes without a change; Tab closes and moves focus to the next value', async () => {
    const f = mount([clavLine()]);
    const el: HTMLElement = f.nativeElement;
    document.body.appendChild(el);
    const dose = el.querySelectorAll('.rxv')[0] as HTMLButtonElement;
    dose.click(); f.detectChanges();
    key(el.querySelector('.rxp')!, 'Escape'); f.detectChanges();
    expect(el.querySelector('.rxp')).toBeNull();
    expect(f.componentInstance.lines()[0].line.dose).toBe(1);

    dose.click(); f.detectChanges();
    key(el.querySelector('.rxp')!, 'Tab'); f.detectChanges();
    await Promise.resolve();
    expect(document.activeElement?.textContent?.trim()).toBe('1-0-1');
    el.remove();
  });

  it('+ then… adds a taper continuation line; the sentence reads both steps', () => {
    const f = mount([clavLine()]);
    const el: HTMLElement = f.nativeElement;
    (el.querySelector('.rxe__then') as HTMLButtonElement).click(); f.detectChanges();
    const row = [...el.querySelectorAll('.rxp__row')].find(r => r.textContent!.includes('Once a day, 5 days')) as HTMLButtonElement;
    row.click(); f.detectChanges();
    expect(el.querySelectorAll('.rxe__row--then').length).toBe(1);
    expect(el.querySelector('.rxe__say')!.textContent).toContain('then in the morning for 5 days');
    expect(el.querySelector('.rxe__qty')!.textContent!.trim()).toBe('15 tablets');
  });

  it('the calendar glyph shows the 14-day strip', () => {
    const f = mount([clavLine()]);
    const el: HTMLElement = f.nativeElement;
    (el.querySelector('.rxe__cal') as HTMLButtonElement).click(); f.detectChanges();
    const days = el.querySelectorAll('.rxs__d');
    expect(days.length).toBe(14);
    expect(days[0].querySelectorAll('i').length).toBe(2);
    expect(days[6].classList.contains('rxs__d--done')).toBe(true); // 5-day course
  });
});

describe('RxEditorComponent — shorthand add box', () => {
  it('"clav 1-0-1 5d af" previews live and Enter adds the parsed line', () => {
    const f = mount();
    const el: HTMLElement = f.nativeElement;
    const input = el.querySelector('.rxe__addin') as HTMLInputElement;
    input.value = 'clav 1-0-1 5d af';
    input.dispatchEvent(new Event('input')); f.detectChanges();
    expect(el.querySelector('.rxe__asTyped')!.textContent).toContain('Clavumox 625');
    expect(el.querySelector('.rxe__asTyped')!.textContent).toContain('1 tab · 1-0-1 · 5 days · after food');
    key(input, 'Enter'); f.detectChanges();
    const l = f.componentInstance.lines()[0];
    expect(l.drug.id).toBe('d-clav');
    expect(l.line).toMatchObject({ dose: 1, dur: 5, food: 'After', sched: timesSched([1, 0, 1]) });
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
    cmp.addFree();
    expect(cmp.lines()[0].drug.free).toBe(true);
    expect(cmp.lines()[0].drug.name).toBe('Zzqx');
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
    expect(el.querySelector('.rxe__allergy')!.textContent).toContain('Allergy: Penicillin');
    expect(el.querySelector('.rxe__swap')!.textContent).toContain('Swap to Azimax 500');
    (el.querySelector('.rxe__keep') as HTMLButtonElement).click(); f.detectChanges();
    expect(f.componentInstance.lines()[0].allergyAck).toBe(true);
    expect(el.querySelector('.rxe__allergy')).toBeNull();
    expect(el.querySelector('.rxe__acked')).toBeTruthy();
  });
  it('swap replaces the drug with the alternative and clears the warning', () => {
    const f = mount([clavLine()], [PEN]);
    const el: HTMLElement = f.nativeElement;
    const notes: string[] = [];
    f.componentInstance.notice.subscribe(n => notes.push(n));
    (el.querySelector('.rxe__swap') as HTMLButtonElement).click(); f.detectChanges();
    expect(f.componentInstance.lines()[0].drug.id).toBe('d-azi');
    expect(el.querySelector('.rxe__allergy')).toBeNull();
    expect(notes[0]).toContain('Clavumox 625 swapped for Azimax 500');
  });
});

describe('durLabel', () => {
  it('speaks weeks like a doctor', () => {
    expect([durLabel(1), durLabel(5), durLabel(7), durLabel(14), durLabel(30)]).toEqual(['1 day', '5 days', '1 week', '2 weeks', '30 days']);
  });
});
