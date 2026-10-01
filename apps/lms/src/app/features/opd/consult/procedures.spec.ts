import { TestBed } from '@angular/core/testing';
import type { ConsultProcedureDraft, ConsultProcedureOption } from './consult.api';
import { checkProcedurePrice, parsePrice, procedureLineLabel, proceduresBody, proceduresTotal } from './procedure-rules';
import { ConsultProceduresComponent } from './procedure-editor.component';
import { ConsultEditState, draftBody, procedureDraftOf, stepDone, stepSummary } from './consult-state';
import { ConsultCompleteSheetComponent, deskDueText } from './complete-sheet.component';
import { procedurePrintText } from './rx-print';

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
  it('step 3 summary + tick include procedures', () => {
    const s = { ...BASE, tests: [{ testId: 't', name: 'AEC' }], procedures: [row()] };
    expect(stepSummary(3, s, [], 'doctor').text).toBe('AEC, Diagnostic nasal endoscopy');
    expect(stepDone(3, { ...BASE, procedures: [row()] })).toBe(true);
    expect(stepDone(3, { ...BASE, procedures: [] })).toBe(false);
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

describe('<pf-consult-procedures> — the doctor\'s picker', () => {
  function render(inputs: { items?: ConsultProcedureDraft[]; pricing?: unknown; readonly?: boolean } = {}) {
    const f = TestBed.createComponent(ConsultProceduresComponent);
    f.componentRef.setInput('options', [ENDO, WAX]);
    f.componentRef.setInput('items', inputs.items ?? []);
    f.componentRef.setInput('pricing', inputs.pricing ?? OFF);
    f.componentRef.setInput('readonly', inputs.readonly ?? false);
    const emitted: ConsultProcedureDraft[][] = [];
    f.componentInstance.itemsChange.subscribe(v => emitted.push(v));
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance, emitted };
  }
  it('shows the department\'s procedures with their fixed price; a tap adds one at the rule price', () => {
    const { el, emitted } = render();
    const tiles = el.querySelectorAll('[data-proc]');
    expect(tiles.length).toBe(2);
    expect(tiles[0].textContent).toContain('Diagnostic nasal endoscopy');
    expect(tiles[0].textContent).toContain('1,500');
    (tiles[1] as HTMLButtonElement).click();
    expect(emitted[0]).toHaveLength(1);
    expect(emitted[0][0]).toMatchObject({ serviceId: 's-wax', qty: 1, price: 400, rulePrice: 400, status: 'draft' });
    expect(el.querySelector('select')).toBeNull();
  });
  it('setting off: the price is read-only (no input)', () => {
    const { el } = render({ items: [row()] });
    expect(el.querySelector('.pr__price')).toBeNull();
    expect(el.querySelector('.pr__fixed')!.textContent).toContain('1,500');
  });
  it('setting on: the doctor types a price within the cap; over the cap shows why and is not emitted', () => {
    const { el, f, c, emitted } = render({ items: [row()], pricing: ON_20 });
    const input = el.querySelector('.pr__price') as HTMLInputElement;
    expect(input).toBeTruthy();
    c.onPrice(row(), '1000'); f.detectChanges();
    expect(emitted).toHaveLength(0);
    expect(el.querySelector('.pr__err')!.textContent).toContain('at most 20%');
    c.onPrice(row(), '1300'); f.detectChanges();
    expect(emitted.at(-1)![0].price).toBe(1300);
    expect(el.querySelector('.pr__err')).toBeNull();
  });
  it('qty, side and remove', () => {
    const { el, emitted } = render({ items: [row()] });
    (el.querySelector('[aria-label="More Diagnostic nasal endoscopy"]') as HTMLButtonElement).click();
    expect(emitted.at(-1)![0].qty).toBe(2);
    const sides = el.querySelectorAll('[role="radio"]');
    (sides[1] as HTMLButtonElement).click();
    expect(emitted.at(-1)![0].side).toBe('left');
    (el.querySelector('[aria-label="Remove Diagnostic nasal endoscopy"]') as HTMLButtonElement).click();
    expect(emitted.at(-1)).toEqual([]);
  });
  it('read-only (completed consult): no picker, no edits', () => {
    const { el } = render({ items: [row({ status: 'billed' })], readonly: true });
    expect(el.querySelector('[data-proc]')).toBeNull();
    expect(el.querySelector('.pr__x')).toBeNull();
    expect(el.textContent).toContain('Billed to the front desk.');
  });
});
