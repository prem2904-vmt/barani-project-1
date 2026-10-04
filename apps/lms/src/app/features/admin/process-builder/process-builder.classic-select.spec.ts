import { ProcessBuilderComponent } from './process-builder.component';
import { renderBandPage } from '../admin-band.spec-helpers';

/** The CLASSIC bar's branch-scope + workflow pickers used native `<select>`
 *  — now `pf-select`, reusing the same `scopeOptions()`/`workflowOptions()`
 *  the band pill's (already-converted) pickers use. */
describe('Process builder — classic bar pickers (no native select)', () => {
  const wfs = [
    { id: 'w1', name: 'Main', isActive: true, branchId: null, configJson: '{"categories":[],"actions":[]}' },
    { id: 'w2', name: 'Evening', isActive: false, branchId: null, configJson: '{"categories":[],"actions":[]}' },
  ];
  const make = () => renderBandPage(ProcessBuilderComponent, {
    getFor: (u) => (u.startsWith('/api/process-workflows') ? wfs : u === '/api/tenants/branches' ? [{ id: 'b1', name: 'Anna Nagar' }] : []),
  });

  it('the classic .pb-bar has two pf-select pickers, never a native select', () => {
    const p = make();
    const bar = p.el.querySelector('.pb-bar')!;
    expect(bar.querySelectorAll('pf-select').length).toBe(2);
    expect(bar.querySelector('select')).toBeNull();
  });

  it('workflowOptions() (consumed by the classic pf-select) lists both workflows', () => {
    const p = make();
    expect(p.cmp.workflowOptions().map((o: any) => o.label)).toEqual(['Main · active', 'Evening']);
    p.cmp.selectWorkflow('w2');
    expect(p.cmp.currentId()).toBe('w2');
  });
});
