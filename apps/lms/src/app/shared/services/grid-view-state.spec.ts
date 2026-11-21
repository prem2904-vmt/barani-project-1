import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { GridApi } from 'ag-grid-community';
import { AuthService } from '../../core/auth/auth.service';
import { SessionScopeService } from '../../core/auth/session-scope.service';
import { ViewStateService } from './view-state.service';
import { keepGridViewState } from './grid-view-state';

/** A grid API stand-in: filter model, column sort state, events, first displayed row. */
function fakeApi() {
  let filter: Record<string, unknown> = {};
  let sort: { colId: string; sort: 'asc' | 'desc' | null; sortIndex?: number | null }[] = [{ colId: 'name', sort: null }, { colId: 'due', sort: null }];
  const handlers: Record<string, Array<() => void>> = {};
  let first = 0;
  const api = {
    setFilterModel: (m: Record<string, unknown>) => { filter = { ...m }; handlers['filterChanged']?.forEach(h => h()); },
    getFilterModel: () => filter,
    applyColumnState: (o: { state: typeof sort }) => { sort = sort.map(c => ({ ...c, sort: o.state.find(s => s.colId === c.colId)?.sort ?? null })); },
    getColumnState: () => sort,
    addEventListener: (e: string, h: () => void) => { (handlers[e] ??= []).push(h); },
    isDestroyed: () => false,
    getFirstDisplayedRowIndex: () => first,
    getDisplayedRowCount: () => 50,
    ensureIndexVisible: (i: number) => { first = i; },
  };
  const fire = (e: string) => handlers[e]?.forEach(h => h());
  return { api: api as unknown as GridApi, raw: api, fire, setFirst: (n: number) => { first = n; }, setSort: (s: typeof sort) => { sort = s; } };
}

describe('keepGridViewState', () => {
  let vs: ViewStateService;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [{ provide: AuthService, useValue: { activeBranchId: signal('b1').asReadonly() } }] });
    TestBed.inject(SessionScopeService).changed({ userId: 'u1', tenantId: 't1' });
    vs = TestBed.inject(ViewStateService);
  });
  afterEach(() => TestBed.resetTestingModule());

  it('restores column filters, sort and the first row on the next visit', () => {
    const a = fakeApi();
    keepGridViewState(a.api, vs, 'fd');
    a.raw.setFilterModel({ status: { values: ['Due'] } });
    a.setSort([{ colId: 'name', sort: null }, { colId: 'due', sort: 'desc', sortIndex: 0 }]);
    a.fire('sortChanged');
    a.setFirst(12);
    a.fire('bodyScrollEnd');

    const b = fakeApi();
    keepGridViewState(b.api, vs, 'fd');
    expect(b.raw.getFilterModel()).toEqual({ status: { values: ['Due'] } });
    expect(b.raw.getColumnState().find(c => c.colId === 'due')?.sort).toBe('desc');
    b.fire('firstDataRendered');
    expect(b.raw.getFirstDisplayedRowIndex()).toBe(12);
  });

  it('sort: false leaves the sort alone (it persists elsewhere)', () => {
    const a = fakeApi();
    keepGridViewState(a.api, vs, 'mw', { sort: false });
    a.setSort([{ colId: 'name', sort: 'asc', sortIndex: 0 }, { colId: 'due', sort: null }]);
    a.fire('sortChanged');
    const b = fakeApi();
    keepGridViewState(b.api, vs, 'mw', { sort: false });
    expect(b.raw.getColumnState().every(c => c.sort === null)).toBe(true);
  });

  it('keys are isolated and a sign-out forgets them', () => {
    const a = fakeApi();
    keepGridViewState(a.api, vs, 'one');
    a.raw.setFilterModel({ x: 1 });
    const b = fakeApi();
    keepGridViewState(b.api, vs, 'two');
    expect(b.raw.getFilterModel()).toEqual({});
    TestBed.inject(SessionScopeService).changed(null);
    const c = fakeApi();
    keepGridViewState(c.api, vs, 'one');
    expect(c.raw.getFilterModel()).toEqual({});
  });
});
