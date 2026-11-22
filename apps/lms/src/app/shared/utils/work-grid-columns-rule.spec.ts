import { readFileSync } from 'node:fs';
import { vi } from 'vitest';
import { actionCol, alignCol, choiceFilterCol, numberCol, shapeCol, textCol, valuesCol } from './work-grid';
import { WorkSetFilterComponent, valuesPass } from '../components/work-set-filter/work-set-filter.component';
import { TestBed } from '@angular/core/testing';
import { FlowGridComponent, flowPatientText, flowPayAmount, flowPayValue, flowSamples, flowTokenText, flowTokenValue } from '../../features/frontdesk/frontdesk-landing/flow-grid/flow-grid.component';
import { sortsAndFilters, tokenValue } from './work-grid';
import type { FlowRow } from '../../features/frontdesk/frontdesk-landing/flow-grid/flow-row';

/**
 * THE work-grid column rule (owner 2026-11-20) — ONE helper module (shared/utils/work-grid.ts) and ONE set-style
 * filter (shared/components/work-set-filter) for Frontdesk, My Work / Pathologist and Results.
 */
type R = { name: string; mrn: string; wait: number | null; pay: string };
const row: R = { name: 'Nithin Ragav', mrn: 'AA0004', wait: 41, pay: 'Due' };
const fv = (c: object) => (c as { filterValueGetter: (p: { data: R }) => unknown }).filterValueGetter({ data: row });

describe('ONE module, ONE filter component', () => {
  it('the duplicates are gone and every grid imports the shared pair', () => {
    const exists = (f: string) => { try { readFileSync(f); return true; } catch { return false; } };
    expect(exists('apps/lms/src/app/shared/utils/work-grid-columns.ts')).toBe(false);
    expect(exists('apps/lms/src/app/shared/components/grid-choice-filter/grid-choice-filter.component.ts')).toBe(false);
    for (const f of [
      'apps/lms/src/app/features/frontdesk/frontdesk-landing/flow-grid/flow-grid.component.ts',
      'apps/lms/src/app/features/lab/my-work/my-work-grid.component.ts',
      'apps/lms/src/app/features/pathologist/pending-validation/pending-validation.component.ts',
      'apps/lms/src/app/features/reports/report-queue/report-queue.component.ts',
    ]) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).toContain("shared/utils/work-grid'");
      expect(src, f).toContain('shared/components/work-set-filter/work-set-filter.component');
    }
  });
});

describe('column helpers', () => {
  it('text → text filter over the given text, LEFT (or centred for a token); classes are the shared wg-*', () => {
    const c = textCol<R>({ colId: 'patient' }, r => `${r.name} ${r.mrn}`) as unknown as { filter: unknown; cellClass: string[]; headerClass: string[] };
    expect(c.filter).toBe('agTextColumnFilter');
    expect(fv(c)).toBe('Nithin Ragav AA0004');
    expect(c.cellClass).toContain('wg-c-left');
    expect(c.headerClass).toContain('wg-h-left');
    const tok = textCol<R>({ colId: 'token' }, () => '#4', 'center') as unknown as { cellClass: string[]; headerClass: string[] };
    expect(tok.cellClass).toContain('wg-c-center');
    expect(tok.headerClass).toContain('wg-h-center');
    expect(alignCol('center')).toEqual({ headerClass: 'wg-h-center', cellClass: ['wg-c-center'] });
  });

  it('values → the shared set filter; number → number filter (minutes), centred', () => {
    const v = valuesCol<R>({ colId: 'pay' }, r => r.pay, WorkSetFilterComponent, 'center') as unknown as { filter: unknown; cellClass: string[] };
    expect(v.filter).toBe(WorkSetFilterComponent);
    expect(fv(v)).toBe('Due');
    const n = numberCol<R>({ colId: 'wait' }, r => r.wait) as unknown as { filter: unknown; cellClass: string[] };
    expect(n.filter).toBe('agNumberColumnFilter');
    expect(fv(n)).toBe(41);
    expect(n.cellClass).toContain('wg-c-center');
  });

  it('shape (ring) is centred and unfiltered; the action column is RIGHT, never filtered; own classes are kept', () => {
    const s = shapeCol({ colId: 'journey', cellClass: 'fd-flow__c-ring' }) as unknown as { filter: unknown; cellClass: string[] };
    expect(s.filter).toBe(false);
    expect(s.cellClass).toEqual(['wg-c-center', 'fd-flow__c-ring']);
    const a = actionCol({ colId: 'next', headerClass: 'fd-flow__h-right', cellClass: 'fd-flow__c-next' }) as unknown as { filter: unknown; cellClass: string[]; headerClass: string[] };
    expect(a.filter).toBe(false);
    expect(a.cellClass).toEqual(['wg-c-right', 'fd-flow__c-next']);
    expect(a.headerClass).toEqual(['wg-h-right', 'fd-flow__h-right']);
  });

  it('a bound choice filter column (Results) carries the screen\'s own state', () => {
    const p = { title: 'Status', options: () => [], selected: () => '', select: () => undefined };
    expect(choiceFilterCol(p, WorkSetFilterComponent)).toEqual({ filter: WorkSetFilterComponent, filterParams: p, suppressHeaderMenuButton: true, suppressHeaderFilterButton: false });
  });
});

describe('the shared set filter — both modes', () => {
  it('values mode: distinct values, toggle, model round-trip; nothing ticked = everything passes', () => {
    const nodes = [{ v: 'Paid' }, { v: 'Due' }, { v: 'Paid' }, { v: 'Not billed' }];
    const changed = vi.fn();
    const f = new WorkSetFilterComponent();
    f.agInit({ colDef: { headerName: 'Payment' }, filterChangedCallback: changed,
      api: { forEachNode: (cb: (n: { v: string }) => void) => nodes.forEach(cb) }, getValue: (n: { v: string }) => n.v } as never);
    expect(f.bound).toBe(false);
    expect(f.values).toEqual(['Due', 'Not billed', 'Paid']);
    f.toggle('Due');
    expect(f.doesFilterPass({ node: { v: 'Due' } } as never)).toBe(true);
    expect(f.doesFilterPass({ node: { v: 'Paid' } } as never)).toBe(false);
    expect(f.getModel()).toEqual({ values: ['Due'] });
    f.clear();
    expect(f.isFilterActive()).toBe(false);
    expect(valuesPass(new Set(), 'x')).toBe(true);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('bound mode: reads and writes the screen\'s state; the rows are already narrowed', () => {
    let sel = 'pending';
    const changed = vi.fn();
    const f = new WorkSetFilterComponent();
    f.agInit({ title: 'Status', options: () => [{ value: '', label: 'All' }, { value: 'pending', label: 'Completed' }],
      selected: () => sel, select: (v: string) => { sel = v; }, filterChangedCallback: changed } as never);
    expect(f.bound).toBe(true);
    expect(f.isFilterActive()).toBe(true);
    expect(f.current()).toBe('pending');
    f.pick('');
    expect(sel).toBe('');
    expect(changed).toHaveBeenCalled();
    expect(f.getModel()).toBeNull();
    f.setModel({ value: 'pending' });
    expect(sel).toBe('pending');
    expect(f.doesFilterPass({ data: {} } as never)).toBe(true);
  });
});

describe('the Frontdesk flow grid follows the rule', () => {
  const src = readFileSync('apps/lms/src/app/features/frontdesk/frontdesk-landing/flow-grid/flow-grid.component.ts', 'utf8');
  it.each([
    "tokenCol<FlowRow>({ colId: 'token'", "textCol<FlowRow>({ colId: 'patient'",
    "valuesCol<FlowRow>({ colId: 'where'", "durationCol<FlowRow>({ colId: 'wait'", "moneyCol<FlowRow>({ colId: 'pay'", "actionCol<FlowRow>({ colId: 'next'",
  ])('%s', head => expect(src).toContain(head));

  it('filter texts: token "#N"; patient = name + MRN + phone; one "Due" value for every amount due', () => {
    const r = { name: 'Nithin', meta: '34/F · AA0004', order: { dailyNo: 4, patient: { phone: '+919876543210' } }, draft: null, payDue: true, pay: '₹450.00 due' } as unknown as FlowRow;
    expect(flowTokenText(r)).toBe('#4');
    expect(flowPatientText(r)).toBe('Nithin 34/F · AA0004 +919876543210');
    expect(flowPayValue(r)).toBe('Due');
  });

  it('the alignment classes are styled once, globally (the grid theme is untouched)', () => {
    const css = readFileSync('apps/lms/src/styles.scss', 'utf8');
    for (const k of ['.ag-cell.wg-c-center', '.ag-cell.wg-c-right', '.wg-h-center .ag-header-cell-label', '.wg-h-right .ag-header-cell-label', '.ag-header-cell-filtered']) {
      expect(css).toContain(k);
    }
  });
});

describe('the Frontdesk flow grid — every data column sorts + filters on the real value (owner 2026-11-21)', () => {
  afterEach(() => TestBed.resetTestingModule());
  const colsAt = (width: number, service: string | null) => {
    TestBed.configureTestingModule({ imports: [FlowGridComponent] });
    const f = TestBed.createComponent(FlowGridComponent);
    f.componentRef.setInput('context', {});
    f.componentRef.setInput('service', service);
    (f.componentInstance as unknown as { width: { set(n: number): void } }).width.set(width);
    return f.componentInstance.cols();
  };
  it.each([[null], ['lab'], ['opd'], ['ipd'], ['er'], ['scan']])('service %s at 1400px: data columns sort + filter; sel / next / the ring picture never', svc => {
    const cols = colsAt(1400, svc);
    for (const c of cols) {
      if (c.colId === 'sel' || c.colId === 'next' || c.colId === 'journey') { expect(c.sortable ?? false, c.colId).toBe(false); continue; }
      expect(sortsAndFilters(c as never), c.colId).toBe(true);
    }
    expect(cols.find(c => c.colId === 'wait')?.filter ?? 'agNumberColumnFilter').toBe('agNumberColumnFilter');
  });

  it('Payment sorts on the rupees due, Token on day + number, Samples on drawn / total', () => {
    const r = (o: Partial<FlowRow>) => ({ kind: 'order', due: 0, pay: 'Paid', journey: [], ...o }) as FlowRow;
    expect(flowPayAmount(r({ due: 450, pay: '₹450.00 due' }))).toBe(450);
    expect(flowPayAmount(r({ pay: 'Paid' }))).toBe(0);
    expect(flowPayAmount(r({ pay: 'Not billed' }))).toBeNull();
    expect(flowTokenValue(r({ order: { dailyNo: 2, dailyNoDay: '2026-10-01' } as never }))).toBe(tokenValue(2, '2026-10-01'));
    expect(flowSamples(r({ order: { samples: [{ status: 'collected' }, { status: 'pending' }] } as never }))).toEqual({ done: 1, total: 2 });
    expect(flowSamples(r({ kind: 'draft' }))).toBeNull();
  });
});
