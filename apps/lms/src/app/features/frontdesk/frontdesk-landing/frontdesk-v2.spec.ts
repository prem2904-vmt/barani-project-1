import { readFileSync } from 'node:fs';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { FrontdeskLandingComponent } from './frontdesk-landing.component';
import { NO_WORK_FILTERS } from './flow-grid/work-filters';
import type { FlowRow } from './flow-grid/flow-row';

/**
 * Frontdesk redesign (owner-approved 2026-11-19): the Services shelf's pick filters BOTH panels, More filters
 * narrow the work list (grid and phone lists alike), and every grid action runs the landing's EXISTING handler.
 */
const DIR = 'apps/lms/src/app/features/frontdesk/frontdesk-landing';
const ts = readFileSync(`${DIR}/frontdesk-landing.component.ts`, 'utf8');
const html = readFileSync(`${DIR}/frontdesk-landing.component.html`, 'utf8');
const proto = FrontdeskLandingComponent.prototype as any;

function host(selected: string, filters = NO_WORK_FILTERS, balance = 0) {
  const h = Object.create(proto);
  Object.assign(h, {
    serviceShelf: { selected: signal(selected) },
    workFilters: signal(filters),
    nowTick: signal(Date.parse('2026-11-19T10:00:00Z')),
    getBillBalance: () => balance,
  });
  return h;
}
const order = (extra: Record<string, unknown> = {}) => ({
  id: 'o1', status: 'billed', module: null, refDoctorName: 'Dr. Rao', branchId: 'b1',
  createdAt: '2026-11-19T08:00:00Z', updatedAt: '2026-11-19T09:00:00Z', ...extra,
});

describe('Services shelf → both panels', () => {
  it('All (and every lab-only user) lets everything through; a service keeps only its own rows', () => {
    expect(host('all').svcPass(order())).toBe(true);
    expect(host('all').svcPass(order({ module: 'opd' }))).toBe(true);
    expect(host('lab').svcPass(order())).toBe(true);
    expect(host('lab').svcPass(order({ module: 'opd' }))).toBe(false);
    expect(host('opd').svcPass(order())).toBe(false);
    expect(host('opd').svcPass(order({ module: 'opd' }))).toBe(true);
    expect(host('opd').svcOn('lab')).toBe(false);
    expect(host('all').svcOn('lab')).toBe(true);
  });

  it('the left panel (appointments, home collection) and the parked drafts are Lab; the work lists filter by service', () => {
    expect(ts).toMatch(/readonly visibleAppointments = computed\(\(\) =>[\s\S]{0,200}!this\.svcOn\('lab'\) \? \[\]/);
    expect(ts).toMatch(/readonly homeCollections = computed\(\(\) => \{[\s\S]{0,200}if \(!this\.svcOn\('lab'\)\) return \[\];/);
    expect(ts).toContain("readonly visibleOrders = computed(() => this._ipAll().filter(o => this.svcPass(o)));");
    expect(ts).toContain("readonly completedOrders = computed(() => this._doneAll().filter(o => this.svcPass(o)));");
    expect(ts).toContain("readonly paymentsDueAll = computed(() => this._dueAll().filter(o => this.svcPass(o)));");
    expect(ts).toMatch(/readonly shownDrafts = computed\(\(\) => \{[\s\S]{0,120}if \(!this\.svcOn\('lab'\)\) return \[\];/);
    // The shelf's counts read the lists BEFORE its own filter (every service).
    expect(ts).toMatch(/_publishServices = effect\(\(\) => \{[\s\S]{0,300}this\._ipAll\(\), \.\.\.this\._doneAll\(\)/);
  });
});

describe('More filters → the work list (grid and phone lists alike)', () => {
  it('doctor · branch · only late · only with dues', () => {
    expect(host('all').morePass(order())).toBe(true);
    expect(host('all', { ...NO_WORK_FILTERS, doctor: 'Dr. Rao' }).morePass(order())).toBe(true);
    expect(host('all', { ...NO_WORK_FILTERS, doctor: 'Dr. Menon' }).morePass(order())).toBe(false);
    expect(host('all', { ...NO_WORK_FILTERS, branch: 'b2' }).morePass(order())).toBe(false);
    expect(host('all', { ...NO_WORK_FILTERS, onlyLate: true }).morePass(order())).toBe(true);               // 60 min at its stage
    expect(host('all', { ...NO_WORK_FILTERS, onlyLate: true }).morePass(order({ updatedAt: '2026-11-19T09:50:00Z' }))).toBe(false);
    expect(host('all', { ...NO_WORK_FILTERS, onlyDues: true }).morePass(order())).toBe(false);
    expect(host('all', { ...NO_WORK_FILTERS, onlyDues: true }, 450).morePass(order())).toBe(true);
  });

  it('the shown lists (grid rows + phone rows) all go through morePass', () => {
    for (const name of ['shownInProgress', 'shownCompleted', 'shownPaymentsDue', 'shownPaymentsDueTab']) {
      expect(ts).toMatch(new RegExp(`readonly ${name} = computed\\(\\(\\) =>[^;]*morePass`));
    }
  });
});

describe('flow grid actions → the landing\'s existing handlers', () => {
  const handlers = ['goToBilling', 'recollectOrder', 'collectSample', 'markDispatched', 'reprintLabels', 'openSeriesSheet',
    'downloadReport', 'openPaymentDrawer', 'openFlowShare', 'openPatientProfile', 'resumeDraft', 'discardDraft', 'openOrder',
    'onWorkRowClick', 'openMergedRow'] as const;
  const mk = () => {
    const h = Object.create(proto);
    for (const k of handlers) h[k] = vi.fn();
    return h;
  };
  const o = { id: 'o1' };
  const row = (extra: Partial<FlowRow> = {}) => ({ id: 'o1', kind: 'order', order: o, draft: null, merged: null, status: 'ip', ...extra }) as unknown as FlowRow;

  it.each([
    ['bill', 'goToBilling'], ['recollect', 'recollectOrder'], ['collect', 'collectSample'], ['dispatch', 'markDispatched'],
    ['dispatch-drawn', 'markDispatched'], ['reprint', 'reprintLabels'], ['series', 'openSeriesSheet'],
    ['download', 'downloadReport'], ['pay', 'openPaymentDrawer'], ['profile', 'openPatientProfile'],
  ] as const)('%s → %s', (id, fn) => {
    const h = mk();
    h.flowAct(row(), id, null);
    expect(h[fn]).toHaveBeenCalledWith(o);
  });

  it('share opens the floating menu by the pressed control', () => {
    const h = mk();
    const btn = {} as HTMLElement;
    h.flowAct(row({ status: 'done' }), 'share', btn);
    expect(h.openFlowShare).toHaveBeenCalledWith(o, btn);
  });

  it('a draft resumes / discards; tapping rows opens exactly what the old rows opened', () => {
    const h = mk();
    const d = { patientId: 'p2' };
    h.flowAct(row({ kind: 'draft', order: null, draft: d as never }), 'resume', null);
    expect(h.resumeDraft).toHaveBeenCalledWith(d);
    h.flowAct(row({ kind: 'draft', order: null, draft: d as never }), 'discard', null);
    expect(h.discardDraft).toHaveBeenCalledWith(d);
    h.openFlowRow(row());
    expect(h.onWorkRowClick).toHaveBeenCalledWith(o);              // In progress: honours long-press / selection
    h.openFlowRow(row({ status: 'done' }));
    expect(h.openOrder).toHaveBeenCalledWith(o);
    const merged = { source: 'synthetic', order: o };
    h.openFlowRow(row({ merged: merged as never }));
    expect(h.openMergedRow).toHaveBeenCalledWith(merged);          // synthetic rows read the real order first
  });
});

describe('template wiring', () => {
  it('flow grid only in the new design at ≥1024px; Outsourced keeps its list; the old rows stay for phones / classic', () => {
    expect(ts).toContain("readonly flowMode = computed(() => this.theme.isNewDesign() && this.wide());");
    expect(html).toMatch(/@if \(flowMode\(\) && rightTab\(\) !== 'out'\) \{[\s\S]{0,600}<pf-fd-work-view/);
    expect((html.match(/@if \(!flowMode\(\)\) \{/g) ?? []).length).toBe(2);
    expect(html).toMatch(/@if \(rightTab\(\) === 'out'\) \{\s*<pf-outsourced-list/);
  });

  it('the shared splitter in the new design (per-user key); the classic % handle otherwise', () => {
    expect(html).toMatch(/@if \(theme\.isNewDesign\(\)\) \{\s*@if \(wide\(\)\) \{\s*<pf-pane-splitter class="pf-fd-splitter" \[storageKey\]="sideWidthKey\(\)"/);
    expect(ts).toContain('`pf-lms.frontdesk.side-w.${this.auth.user()?.id ?? \'anon\'}`');
    expect(html).toMatch(/\[style\.flex-basis\.%\]="theme\.isNewDesign\(\) \? null : twoPaneSplit\(\)"/);
  });

  it('no native controls, no emoji', () => {
    const files = ['flow-grid/flow-cells.ts', 'flow-grid/flow-grid.component.ts', 'flow-grid/more-filters.component.ts', 'flow-grid/flow-share-menu.component.ts']
      .map(f => readFileSync(`${DIR}/${f}`, 'utf8')).join('\n');
    expect(files + html).not.toMatch(/<select|<datalist|window\.confirm/);
    expect(files).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
