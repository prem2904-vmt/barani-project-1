import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { WorkSetFilterComponent } from './work-set-filter.component';

describe('work grids — the shared set filter (values present; empty selection = no filter)', () => {
  function make(values: string[]) {
    const f = TestBed.createComponent(WorkSetFilterComponent);
    const nodes = values.map((v, i) => ({ id: String(i), v }));
    const changed = vi.fn();
    f.componentInstance.agInit({
      colDef: { headerName: 'Status' }, api: { forEachNode: (cb: (n: unknown) => void) => nodes.forEach(cb) },
      getValue: (n: { v: string }) => n.v, filterChangedCallback: changed,
    } as never);
    f.detectChanges();
    return { f, c: f.componentInstance, el: f.nativeElement as HTMLElement, changed, nodes };
  }
  afterEach(() => TestBed.resetTestingModule());
  it('lists each value once, sorted, as kit check rows (no native checkbox)', () => {
    const { el } = make(['Draft', 'To enter', 'Draft', 'Re-entry']);
    expect([...el.querySelectorAll('[role=checkbox]')].map(b => b.textContent!.trim())).toEqual(['Draft', 'Re-entry', 'To enter']);
    expect(el.querySelector('input')).toBeNull();
  });
  it('picking values filters to them; clearing removes the filter', () => {
    const { c, el, changed, nodes, f } = make(['Draft', 'To enter']);
    expect(c.isFilterActive()).toBe(false);
    (el.querySelector('[data-value="Draft"]') as HTMLElement).click();
    f.detectChanges();
    expect(changed).toHaveBeenCalled();
    expect(c.isFilterActive()).toBe(true);
    expect(nodes.map(n => c.doesFilterPass({ node: n } as never))).toEqual([true, false]);
    expect(c.getModel()).toEqual({ values: ['Draft'] });
    c.clear();
    expect(c.isFilterActive()).toBe(false);
    c.setModel({ values: ['To enter'] });
    expect(nodes.map(n => c.doesFilterPass({ node: n } as never))).toEqual([false, true]);
  });
});
