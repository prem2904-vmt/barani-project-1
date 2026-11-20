import { readFileSync } from 'node:fs';
import type { ColDef, ValueGetterParams } from 'ag-grid-community';
import { vi } from 'vitest';
import { PfValuesFilterComponent, actionCol, numberCol, shapeCol, textCol, valuesCol, valuesPass } from './work-grid-columns';
import { flowPatientText, flowPayValue, flowTokenText } from '../../features/frontdesk/frontdesk-landing/flow-grid/flow-grid.component';
import type { FlowRow } from '../../features/frontdesk/frontdesk-landing/flow-grid/flow-row';

/** THE work-grid column rule (owner 2026-11-20): filters like Test Master + alignment per column type. */
type R = { name: string; mrn: string; wait: number | null; pay: string };
const row: R = { name: 'Nithin Ragav', mrn: 'AA0004', wait: 41, pay: 'Due' };
const fv = (c: ColDef<R>) => (c.filterValueGetter as (p: ValueGetterParams<R>) => unknown)({ data: row } as ValueGetterParams<R>);

describe('column types', () => {
  it('text → text filter over the given text, LEFT (or centred for a token)', () => {
    const c = textCol<R>({ colId: 'patient' }, r => `${r.name} ${r.mrn}`);
    expect(c.filter).toBe('agTextColumnFilter');
    expect(fv(c)).toBe('Nithin Ragav AA0004');
    expect(c.cellClass).toContain('pf-wg-left');
    expect(c.headerClass).toContain('pf-wg-h-left');
    const tok = textCol<R>({ colId: 'token' }, () => '#4', 'center');
    expect(tok.cellClass).toContain('pf-wg-center');
    expect(tok.headerClass).toContain('pf-wg-h-center');
  });

  it('values → the set-style filter; number → number filter (minutes), centred', () => {
    const v = valuesCol<R>({ colId: 'pay' }, r => r.pay, 'center');
    expect(v.filter).toBe(PfValuesFilterComponent);
    expect(fv(v)).toBe('Due');
    const n = numberCol<R>({ colId: 'wait' }, r => r.wait);
    expect(n.filter).toBe('agNumberColumnFilter');
    expect(fv(n)).toBe(41);
    expect(n.cellClass).toContain('pf-wg-center');
  });

  it('shape (ring) is centred and unfiltered; the action column is RIGHT, never filtered; own classes are kept', () => {
    const s = shapeCol<R>({ colId: 'journey', cellClass: 'fd-flow__c-ring' });
    expect(s.filter).toBe(false);
    expect(s.cellClass).toEqual(['pf-wg-center', 'fd-flow__c-ring']);
    const a = actionCol<R>({ colId: 'next', headerClass: 'fd-flow__h-right', cellClass: 'fd-flow__c-next' });
    expect(a.filter).toBe(false);
    expect(a.cellClass).toEqual(['pf-wg-right', 'fd-flow__c-next']);
    expect(a.headerClass).toEqual(['pf-wg-h-right', 'fd-flow__h-right']);
  });

  it('the set rule: no ticks = everything; ticks = only those values', () => {
    expect(valuesPass(null, 'Paid')).toBe(true);
    expect(valuesPass(new Set(['Due']), 'Due')).toBe(true);
    expect(valuesPass(new Set(['Due']), 'Paid')).toBe(false);
  });

  it('the set filter component: distinct values, toggle, All, model round-trip, doesFilterPass', () => {
    const nodes = [{ v: 'Paid' }, { v: 'Due' }, { v: 'Paid' }, { v: 'Not billed' }];
    const changed = vi.fn();
    const f = new PfValuesFilterComponent();
    f.agInit({
      colDef: { headerName: 'Payment' }, filterChangedCallback: changed,
      api: { forEachNode: (cb: (n: { v: string }) => void) => nodes.forEach(cb) },
      getValue: (n: { v: string }) => n.v,
    } as never);
    expect(f.values()).toEqual(['Due', 'Not billed', 'Paid']);
    expect(f.isFilterActive()).toBe(false);
    f.toggle('Due');
    expect(f.isFilterActive()).toBe(true);
    expect(f.doesFilterPass({ node: { v: 'Due' } } as never)).toBe(true);
    expect(f.doesFilterPass({ node: { v: 'Paid' } } as never)).toBe(false);
    expect(f.getModel()).toEqual({ values: ['Due'] });
    f.all();
    expect(f.getModel()).toBeNull();
    f.setModel({ values: ['Paid'] });
    expect(f.doesFilterPass({ node: { v: 'Paid' } } as never)).toBe(true);
    expect(changed).toHaveBeenCalledTimes(2);
  });
});

describe('the Frontdesk flow grid follows the rule', () => {
  const src = readFileSync('apps/lms/src/app/features/frontdesk/frontdesk-landing/flow-grid/flow-grid.component.ts', 'utf8');
  it.each([
    ["textCol<FlowRow>({ colId: 'token'", "'center'"],
    ["textCol<FlowRow>({ colId: 'patient'", ''],
    ["shapeCol<FlowRow>({ colId: 'journey'", ''],
    ["valuesCol<FlowRow>({ colId: 'where'", ''],
    ["numberCol<FlowRow>({ colId: 'wait'", ''],
    ["valuesCol<FlowRow>({ colId: 'pay'", "'center'"],
    ["actionCol<FlowRow>({ colId: 'next'", ''],
  ])('%s', (head, align) => {
    expect(src).toContain(head);
    if (align) expect(src.slice(src.indexOf(head)).split('\n      ').slice(0, 6).join(' ')).toContain(align);
  });

  it('filter texts: token "#N"; patient = name + MRN + phone; one "Due" value for every amount due', () => {
    const r = { name: 'Nithin', meta: '34/F · AA0004', order: { dailyNo: 4, patient: { phone: '+919876543210' } }, draft: null, payDue: true, pay: '₹450.00 due' } as unknown as FlowRow;
    expect(flowTokenText(r)).toBe('#4');
    expect(flowPatientText(r)).toBe('Nithin 34/F · AA0004 +919876543210');
    expect(flowPayValue(r)).toBe('Due');
    expect(flowPayValue({ ...r, payDue: false, pay: 'Paid' } as FlowRow)).toBe('Paid');
  });

  it('header and cell alignment classes are styled once, globally (the grid theme is untouched)', () => {
    const css = readFileSync('apps/lms/src/styles.scss', 'utf8');
    for (const k of ['.ag-cell.pf-wg-center', '.ag-cell.pf-wg-right', '.pf-wg-h-center .ag-header-cell-label', '.pf-wg-h-right .ag-header-cell-label', '.ag-header-cell-filtered']) {
      expect(css).toContain(k);
    }
  });
});
