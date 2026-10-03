import { TestBed } from '@angular/core/testing';
import type { ConsultProcedureDraft, ConsultProcedureOption } from './consult.api';
import { checkProcedurePrice, needsPriceReason, parsePrice, priceHint, priceRange, procedureLineLabel, proceduresBody, proceduresTotal } from './procedure-rules';
import { ConsultProceduresComponent } from './procedure-editor.component';
import { ConsultEditState, draftBody, procedureDraftOf } from './consult-state';
import { spaceCount } from './consult-records';
import { ConsultCompleteSheetComponent, deskDueText } from './complete-sheet.component';
import { laterPrintText, procedurePrintText } from './rx-print';

/**
 * Consult procedures (owner: "pay after consult has no way to collect"). The
 * price-rule fixtures are the SAME as prefrontal-mw ProcedureRulesTests.cs.
 */
afterEach(() => TestBed.resetTestingModule());

const OFF = { doctorCanChange: false, maxChangePercent: null };
const ON_ANY = { doctorCanChange: true, maxChangePercent: null };
const ON_20 = { doctorCanChange: true, maxChangePercent: 20 };

const ENDO: ConsultProcedureOption = { serviceId: 's-endo', name: 'Diagnostic nasal endoscopy', code: 'ENT-P01', price: 1500, taxSlab: 0 };
const WAX: ConsultProcedureOption = { serviceId: 's-wax', name: 'Ear wax removal', code: 'ENT-P02', price: 400, taxSlab: 0 };
const row = (p: Partial<ConsultProcedureDraft> = {}): ConsultProcedureDraft => ({
  key: 'k1', id: null, serviceId: ENDO.serviceId, name: ENDO.name, code: ENDO.code, qty: 1, rulePrice: 1500, price: 1500, side: null, note: null, status: 'draft', ...p,
});

describe('Procedure price rule (mirror of ProcedureRules.cs)', () => {
  it('off: the rule price only', () => {
    expect(checkProcedurePrice(1500, 1500, OFF)).toBeNull();
    expect(checkProcedurePrice(1500, 1200, OFF)?.code).toBe('procedure_price_locked');
    expect(checkProcedurePrice(1500, 1800, OFF)?.code).toBe('procedure_price_locked');
  });
  it('cap: a percent of the rule, up or down', () => {
    expect(checkProcedurePrice(1500, 1200, ON_20)).toBeNull();
    expect(checkProcedurePrice(1500, 1800, ON_20)).toBeNull();
    expect(checkProcedurePrice(1500, 1199, ON_20)?.code).toBe('procedure_price_over_cap');
    expect(checkProcedurePrice(1500, 1801, ON_20)?.code).toBe('procedure_price_over_cap');
    expect(checkProcedurePrice(0, 100, ON_20)?.code).toBe('procedure_price_over_cap');
    expect(checkProcedurePrice(0, 0, ON_20)).toBeNull();
    expect(checkProcedurePrice(1500, 1000, ON_20)?.message).toContain('₹1200 – ₹1800');
  });
  it('no cap: any amount, never negative', () => {
    expect(checkProcedurePrice(1500, 1, ON_ANY)).toBeNull();
    expect(checkProcedurePrice(0, 250, ON_ANY)).toBeNull();
    expect(checkProcedurePrice(1500, -1, ON_ANY)?.code).toBe('invalid_procedure');
  });
  it('bill line reads like the desk override', () => {
    expect(procedureLineLabel('Ear wax removal', null, 400, 400, 'Dr Rao')).toBe('Ear wax removal');
    expect(procedureLineLabel('Ear wax removal', 'left', 400, 400)).toBe('Ear wax removal · Left');
    expect(procedureLineLabel('Diagnostic nasal endoscopy', 'both', 1500, 1300, 'Dr Rao')).toBe('Diagnostic nasal endoscopy · Both sides — set by Dr Rao (rule ₹1500)');
    expect(procedureLineLabel('Cautery', null, 899.5, 800, null)).toBe('Cautery — set by the doctor (rule ₹899.5)');
  });
  it('parses typed prices and totals qty × price', () => {
    expect(parsePrice('₹1,200')).toBe(1200);
    expect(parsePrice('99.5')).toBe(99.5);
    expect(Number.isNaN(parsePrice('12a'))).toBe(true);
    expect(proceduresTotal([{ price: 1500, qty: 1 }, { price: 300, qty: 2 }])).toBe(2100);
  });
});

describe('Consult state carries procedures', () => {
  const BASE: ConsultEditState = { answers: {}, chiefComplaint: '', diagnoses: [], advice: '', privateNotes: '', privateNotesVisibility: 'doctor', lines: [], tests: [], followUpDays: null };
  it('draft body: price only when changed; undefined procedures are not sent (server keeps them)', () => {
    expect('procedures' in draftBody(BASE, null)).toBe(false);
    const b = draftBody({ ...BASE, procedures: [row({ side: 'left', note: ' Under LA ' }), row({ key: 'k2', serviceId: 's-wax', rulePrice: 400, price: 300, qty: 2, priceReason: 'Both ears' }),
      row({ key: 'k3', status: 'billed', id: 'old' })] }, null);
    expect(b.procedures).toEqual([
      { id: null, serviceId: 's-endo', qty: 1, price: null, priceReason: null, side: 'left', note: 'Under LA' },
      { id: null, serviceId: 's-wax', qty: 2, price: 300, priceReason: 'Both ears', side: null, note: null },
    ]);
    expect(proceduresBody([row({ price: 1500, priceReason: 'stale' })])[0].priceReason).toBeNull();
  });
  it('the Procedures tab counts the procedures', () => {
    expect(spaceCount('proc', { ...BASE, procedures: [row(), row({ key: 'k2' })] })).toBe(2);
    expect(spaceCount('proc', { ...BASE, procedures: [] })).toBe(0);
  });
  it('a saved procedure hydrates into an editor row', () => {
    const d = procedureDraftOf({ id: 'p1', serviceId: 's', name: 'X', qty: 2, rulePrice: 500, price: 450, overridden: true, priceSetByName: 'Dr A', status: 'draft', side: 'right' });
    expect(d).toMatchObject({ id: 'p1', qty: 2, price: 450, rulePrice: 500, priceSetByName: 'Dr A', side: 'right' });
  });
  it('printout and history text', () => {
    expect(procedurePrintText({ name: 'Diagnostic nasal endoscopy', side: 'left', note: 'Polyp seen' })).toBe('Diagnostic nasal endoscopy (left) — Polyp seen');
    expect(procedurePrintText({ name: 'Ear syringing', side: 'both', qty: 2 })).toBe('Ear syringing (both sides) × 2');
  });
});

describe('Front-desk money line on Complete', () => {
  it('pay after consult: fee + procedures, one bill; pay at booking: procedures only', () => {
    expect(deskDueText({ mode: 'after_consult', consultCharged: 500, consultBalance: 500 }, 1900)).toBe('₹2,400 at the front desk — consultation ₹500 + procedures ₹1,900, one bill.');
    expect(deskDueText({ mode: 'after_consult', consultCharged: 500, consultBalance: 500 }, 0)).toBe('₹500 consultation at the front desk (pay after consult).');
    expect(deskDueText({ mode: 'before_consult', consultCharged: 500, consultBalance: 0 }, 1500)).toBe('₹1,500 for procedures at the front desk — the consultation is already paid.');
    expect(deskDueText({ mode: 'before_consult', consultCharged: 500, consultBalance: 0 }, 0)).toBeNull();
  });
  it('the complete sheet lists the procedures with the rule beside a changed price', () => {
    const f = TestBed.createComponent(ConsultCompleteSheetComponent);
    f.componentRef.setInput('procedures', [row(), row({ key: 'k2', name: 'Ear wax removal', rulePrice: 400, price: 300, qty: 2 })]);
    f.componentRef.setInput('billing', { mode: 'after_consult', consultCharged: 500, consultBalance: 500 });
    f.detectChanges();
    const sec = (f.nativeElement as HTMLElement).querySelector('[data-row="procedures"]')!;
    expect(sec.textContent).toContain('2 procedures');
    expect(sec.textContent).toContain('(rule ₹400');
    expect(sec.textContent).toContain('consultation ₹500 + procedures ₹2,100, one bill');
  });
});

describe('<pf-consult-procedures> — list + detail (consult v6)', () => {
  function render(inputs: { items?: ConsultProcedureDraft[]; pricing?: unknown; readonly?: boolean; later?: boolean } = {}) {
    const f = TestBed.createComponent(ConsultProceduresComponent);
    f.componentRef.setInput('options', [ENDO, WAX]);
    f.componentRef.setInput('items', inputs.items ?? []);
    f.componentRef.setInput('pricing', inputs.pricing ?? OFF);
    f.componentRef.setInput('readonly', inputs.readonly ?? false);
    f.componentRef.setInput('laterEnabled', inputs.later ?? false);
    const emitted: ConsultProcedureDraft[][] = [];
    f.componentInstance.itemsChange.subscribe(v => { emitted.push(v); f.componentRef.setInput('items', v); });
    f.detectChanges();
    // A saved line is one row on the pad; tap it to open its editor.
    const line = (f.nativeElement as HTMLElement).querySelector('.pr__line') as HTMLButtonElement | null;
    if (line) { line.click(); f.detectChanges(); }
    return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance, emitted };
  }
  it('the pad field finds this department\'s procedures (word start) with their preset price; Enter adds at the rule price', () => {
    const { el, f, emitted } = render();
    const input = el.querySelector('pf-pad-add input') as HTMLInputElement;
    input.dispatchEvent(new Event('focus'));
    input.value = 'wax'; input.dispatchEvent(new Event('input')); f.detectChanges();
    const hits = el.querySelectorAll('.pa__sg');
    expect(hits.length).toBe(1);
    expect(hits[0].textContent).toContain('Ear wax removal');
    expect(hits[0].textContent).toContain('400');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); f.detectChanges();
    expect(emitted[0]).toHaveLength(1);
    expect(emitted[0][0]).toMatchObject({ serviceId: 's-wax', qty: 1, price: 400, rulePrice: 400, status: 'draft', when: 'now' });
    expect(el.querySelector('.pr__detail')!.textContent).toContain('Billed to the front desk when you complete the consult');
    expect(el.querySelector('select')).toBeNull();
  });
  it('one line per procedure: name · when · price (preset when changed); one-tap common procedures under the field', () => {
    const { f, el } = render({ items: [row({ price: 1800, priceReason: 'Both sides' })], pricing: ON_20 });
    (el.querySelector('.pr__done') as HTMLButtonElement).click(); f.detectChanges();
    const line = el.querySelector('.pr__line')!;
    expect(line.textContent).toContain('Diagnostic nasal endoscopy');
    expect(line.textContent).toContain('Do now');
    expect(line.textContent).toContain('preset ₹1,500');
    expect([...el.querySelectorAll('.pa__chip')].map(b => b.textContent!.trim())).toEqual([expect.stringContaining('Ear wax removal')]);
  });
  it('Do now with the record feature: a record box and Upload / Take photo (hidden without it)', () => {
    const { f, el } = render({ items: [row({ id: 'p1' })] });
    expect(el.querySelector('[data-record]')).toBeNull();
    f.componentRef.setInput('recordEnabled', true); f.detectChanges();
    expect(el.querySelector('[data-record]')).toBeTruthy();
    expect(el.querySelector('[data-upload]')).toBeTruthy();
    expect((el.querySelector('input[capture]') as HTMLInputElement).accept).toBe('image/*');
  });
  it('locked (admin hasn\'t allowed changes): the price shows with a lock and "Price set by the admin"', () => {
    const { el } = render({ items: [row()] });
    expect(el.querySelector('.pr__pin')).toBeNull();
    expect(el.querySelector('[data-locked]')!.textContent).toContain('1,500');
    expect(el.querySelector('[data-locked] svg')).toBeTruthy();
    expect(el.querySelector('[data-hint]')!.textContent).toContain('Price set by the admin');
  });
  it('allowed with a cap: the range shows inline; over the cap says why and is not emitted; a change needs a reason', () => {
    const { el, f, c, emitted } = render({ items: [row()], pricing: ON_20 });
    expect(el.querySelector('[data-hint]')!.textContent).toContain('Preset ₹1,500 · allowed ₹1,200 to ₹1,800');
    c.onPrice(row(), '1000'); f.detectChanges();
    expect(emitted).toHaveLength(0);
    expect(el.querySelector('[data-hint]')!.textContent).toContain('at most 20%');
    c.onPrice(row(), '1800'); f.detectChanges();
    expect(emitted.at(-1)![0].price).toBe(1800);
    c.settlePrice('k1'); f.detectChanges();
    expect(el.querySelector('[data-hint]')!.textContent).toContain('you set +20%');
    expect(el.querySelector('[data-reason]')).toBeTruthy();
    expect(c.needsReason(emitted.at(-1)![0])).toBe(true);
    expect(needsPriceReason({ price: 1800, rulePrice: 1500, priceReason: 'Both sides', status: 'draft' })).toBe(false);
    f.componentRef.setInput('showReasonErr', true); f.detectChanges();
    expect(el.textContent).toContain('Give a reason for the price change.');
  });
  it('no cap: any amount allowed', () => {
    expect(priceHint(2000, 2000, ON_ANY)).toBe('Preset ₹2,000 · any amount allowed');
    expect(priceRange(2000, ON_20)).toEqual({ lo: 1600, hi: 2400 });
    expect(priceRange(2000, OFF)).toBeNull();
  });
  it('Book for later (server supports it): preferred window, prep note and the desk badge; not on today\'s bill', () => {
    const { el, f, emitted } = render({ items: [row()], later: true });
    (el.querySelector('[data-when="later"]') as HTMLButtonElement).click(); f.detectChanges();
    expect(emitted.at(-1)![0]).toMatchObject({ when: 'later', preferredWithin: 'Within 2 weeks' });
    expect(el.textContent).toContain('Front desk books the date · paid on the procedure day');
    const prep = el.querySelector('[data-prep]') as HTMLInputElement;
    prep.value = 'Nothing to eat for 8 hours'; prep.dispatchEvent(new Event('input')); f.detectChanges();
    expect(emitted.at(-1)![0].prepNote).toBe('Nothing to eat for 8 hours');
    expect(proceduresTotal(emitted.at(-1)!)).toBe(0);
    expect(proceduresBody(emitted.at(-1)!, true)[0]).toMatchObject({ when: 'later', preferredWithin: 'Within 2 weeks', prepNote: 'Nothing to eat for 8 hours' });
    expect(proceduresBody([row({ record: ' Polyp seen ' })], false, true)[0].record).toBe('Polyp seen');
    expect('record' in proceduresBody([row({ record: 'x' })], false, false)[0]).toBe(false);
    expect('when' in proceduresBody(emitted.at(-1)!, false)[0]).toBe(false);
  });
  it('older server (no features.procedureLater): no Book for later', () => {
    const { el } = render({ items: [row()] });
    expect(el.querySelector('[data-when]')).toBeNull();
  });
  it('qty, side and remove', () => {
    const { el, emitted } = render({ items: [row()] });
    (el.querySelector('[aria-label="More Diagnostic nasal endoscopy"]') as HTMLButtonElement).click();
    expect(emitted.at(-1)![0].qty).toBe(2);
    const sides = el.querySelectorAll('[aria-label="Side for Diagnostic nasal endoscopy"] [role="radio"]');
    (sides[1] as HTMLButtonElement).click();
    expect(emitted.at(-1)![0].side).toBe('left');
    (el.querySelector('[aria-label="Remove Diagnostic nasal endoscopy"]') as HTMLButtonElement).click();
    expect(emitted.at(-1)).toEqual([]);
  });
  it('read-only (completed consult): no add bar, no edits', () => {
    const { el } = render({ items: [row({ status: 'billed' })], readonly: true });
    expect(el.querySelector('pf-pad-add')).toBeNull();
    expect(el.querySelector('.pr__x')).toBeNull();
    expect(el.textContent).toContain('Billed to the front desk');
  });
  it('the slip prints a later procedure with its window and preparation', () => {
    expect(laterPrintText({ name: 'Upper GI endoscopy', preferredWithin: 'Within 2 weeks', prepNote: 'Nothing to eat for 8 hours before' }))
      .toBe('Upper GI endoscopy — within 2 weeks. Preparation: Nothing to eat for 8 hours before');
  });
});
