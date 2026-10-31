import { Component, input, output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, firstValueFrom, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakePfSense } from '../../../core/services/pf-sense.testing';
import { BetaFeaturesService } from '../../../core/services/beta-features.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { AssistantApiService } from '../../../shared/assistant/assistant-api.service';
import { INSTRUMENT_BRIDGE_SOURCE } from '../../../shared/instruments/instrument-bridge.service';
import { InsightsBuilderApiService } from './insights-builder-api.service';
import { InsightsDashboardComponent } from './insights-dashboard.component';
import { InsightsChartComponent } from '../insights-chart.component';
import type {
  InsightsChatReply, InsightsDashboard, InsightsMetric, InsightsPreview, InsightsRecipe, WidgetData,
} from './insights-builder.models';

/**
 * My dashboards (beta) — the dashboard card with a MOCKED builder API (nothing
 * reaches a server): rendering per chart kind, money hidden, the per-widget
 * edit controls, PF Sense proposal Keep / Undo, publish + visibility, restore.
 */

/** jsdom has no canvas: a stand-in for the ECharts wrapper (inputs only). */
@Component({ selector: 'pf-ins-chart', standalone: true, template: '' })
class StubChartComponent {
  readonly option = input<unknown>(null);
  readonly height = input('');
  readonly label = input('');
  readonly clickable = input(false);
  readonly spark = input(false);
  readonly pick = output<unknown>();
}

const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const settle = async (f: { detectChanges(): void }) => { for (let i = 0; i < 3; i++) { await wait(170); f.detectChanges(); } };

const M = (m: Pick<InsightsMetric, 'id' | 'label' | 'description' | 'money' | 'unit' | 'groupBy' | 'charts'> & Partial<InsightsMetric>): InsightsMetric => ({
  filters: ['branchId'], supportsCompare: false, usesPeriod: true, multiSeries: false, groupByKinds: {}, ...m,
});
const METRICS: InsightsMetric[] = [
  M({ id: 'patients', label: 'Patients', description: 'People registered', money: false, unit: 'count', groupBy: ['day'], charts: ['kpi', 'line', 'bar'],
    supportsCompare: true, filters: ['branchId', 'refDoctorId'] }),
  M({ id: 'tests_by_department', label: 'Tests by department', description: '', money: false, unit: 'count', groupBy: ['department'], charts: ['hbar', 'donut', 'table'],
    filters: ['branchId', 'departmentId', 'testId', 'refDoctorId'] }),
  M({ id: 'revenue', label: 'Revenue', description: '', money: true, unit: 'money', groupBy: ['day'], charts: ['line', 'bar', 'kpi'], supportsCompare: true }),
  M({ id: 'tat', label: 'Turnaround', description: '', money: false, unit: 'minutes', groupBy: ['department'], charts: ['grouped_hbar', 'table'], multiSeries: true }),
  M({ id: 'patient_flow', label: 'Patient flow', description: '', money: false, unit: 'count', groupBy: ['hour', 'stage'], charts: ['stacked_bar', 'bar'], multiSeries: true }),
];

const RECIPE: InsightsRecipe = {
  version: 1, title: 'Morning view',
  widgets: [
    { id: 'k', title: 'Patients today', metric: 'patients', chart: 'kpi', period: { preset: 'today' }, size: 's' },
    { id: 'l', title: 'Patients per day', metric: 'patients', chart: 'line', groupBy: 'day', period: { preset: 'month' }, size: 'm' },
    { id: 'h', title: 'Tests by department', metric: 'tests_by_department', chart: 'hbar', groupBy: 'department', period: { preset: 'month' }, size: 'm' },
    { id: 'd', title: 'Department mix', metric: 'tests_by_department', chart: 'donut', groupBy: 'department', period: { preset: 'month' }, size: 's' },
    { id: 'g', title: 'Turnaround', metric: 'tat', chart: 'grouped_hbar', groupBy: 'department', period: { preset: 'month' }, size: 'm' },
    { id: 's', title: 'Patient flow by hour', metric: 'patient_flow', chart: 'stacked_bar', groupBy: 'hour', period: { preset: 'today' }, size: 'l' },
    { id: 't', title: 'Department table', metric: 'tests_by_department', chart: 'table', groupBy: 'department', period: { preset: 'month' }, size: 'l' },
    { id: 'm', title: 'Revenue', metric: 'revenue', chart: 'line', groupBy: 'day', period: { preset: 'month' }, size: 'l' },
  ],
};

const DASH: InsightsDashboard = {
  id: 'd1', title: 'Morning view', status: 'published', visibility: 'private', version: 3, updatedAt: '2026-10-30T04:00:00Z',
  canEdit: true, recipe: RECIPE, roleIds: [], mine: true, canShare: true, widgetCount: RECIPE.widgets.length, notes: [], ownerName: 'Latha Ramesh',
};

function dataFor(r: InsightsRecipe): InsightsPreview {
  const cats = ['Haematology', 'Biochemistry', 'Serology'];
  const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];
  return {
    notes: [],
    widgets: r.widgets.map((w): WidgetData => {
      if (w.metric === 'revenue') return { id: w.id, state: 'hidden', unit: 'money', categories: [], series: [] };
      const byDay = w.groupBy === 'day';
      const n = byDay ? 4 : 3;
      return {
        id: w.id, state: 'ok', unit: w.metric === 'tat' ? 'minutes' : 'count', bucketUnit: byDay ? 'day' : null,
        categories: byDay ? days : cats,
        series: w.chart === 'stacked_bar' || w.chart === 'grouped_hbar'
          ? [{ name: 'Collected', values: [3, 4, 5, 6].slice(0, n), unit: w.metric === 'tat' ? 'minutes' : 'count' },
            { name: 'Reported', values: [1, 2, 3, 4].slice(0, n), unit: w.metric === 'tat' ? 'minutes' : 'count' }]
          : [{ name: 'Value', values: [12, 30, 7, 9].slice(0, n), unit: 'count' }],
        total: w.chart === 'kpi' ? 42 : null, deltaPct: w.chart === 'kpi' ? 12.5 : null,
      };
    }),
  };
}

interface Opts { id?: string | null; dash?: InsightsDashboard; chat?: InsightsChatReply; confirm?: boolean; canShare?: boolean; updateError?: unknown; sense?: ReturnType<typeof fakePfSense>; }

function setup(o: Opts = {}) {
  (window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const dash = o.dash ?? DASH;
  const api = {
    metrics: vi.fn(() => of(METRICS)),
    options: vi.fn(() => of({ charts: [], periodPresets: [], sizes: [], maxWidgets: 12, maxCustomDays: 731, canSeeMoney: false, canShare: o.canShare ?? true })),
    dimensions: vi.fn((kind: string) => of(kind === 'department' ? [{ id: 'dep1', name: 'Biochemistry' }, { id: 'dep2', name: 'Haematology' }]
      : kind === 'referrer' ? [{ id: 'ref1', name: 'Dr. Meera Krishnan' }] : [])),
    preview: vi.fn((r: InsightsRecipe, _band?: unknown) => of(dataFor(r))),
    get: vi.fn(() => of(dash)),
    create: vi.fn((b: { recipe: InsightsRecipe; title: string; visibility: string }) =>
      of({ ...dash, id: 'new1', status: 'draft' as const, version: 1, title: b.title, recipe: b.recipe, visibility: b.visibility as 'private' })),
    update: vi.fn((_id: string, b: { recipe: InsightsRecipe; title: string }) => (o.updateError
      ? throwError(() => o.updateError) : of({ ...dash, version: dash.version + 1, title: b.title, recipe: b.recipe }))),
    unpublish: vi.fn(() => of({ ...dash, status: 'draft' as const, visibility: 'private' as const, roleIds: [] })),
    publish: vi.fn((_id: string, b: { visibility: 'private' | 'roles' | 'lab'; roleIds: string[] }) =>
      of({ ...dash, status: 'published' as const, visibility: b.visibility, roleIds: b.roleIds })),
    remove: vi.fn(() => of({})),
    versions: vi.fn(() => of([
      { version: 3, savedAt: '2026-10-30T04:00:00Z', savedByName: 'Admin', title: 'Morning view', widgetCount: 8 },
      { version: 2, savedAt: '2026-10-29T04:00:00Z', savedByName: 'Admin', title: 'Morning view (old)', widgetCount: 2 },
    ])),
    restore: vi.fn((_id: string, v: number) => of({ ...dash, version: 4, title: 'Morning view (old)', recipe: { ...RECIPE, title: 'Morning view (old)', widgets: RECIPE.widgets.slice(0, 2) }, restoredFrom: v })),
    roles: vi.fn(() => of([{ id: 'r1', name: 'Pathologist' }, { id: 'r2', name: 'Front desk' }])),
    chat: vi.fn((): Observable<InsightsChatReply> => of(o.chat ?? {
      reply: 'Added patient flow and made revenue a line.', model: 'gemini-x', provider: 'gemini',
      changes: ['Added “Pending by stage”', 'Removed “Department table”'], notes: [],
      recipe: { ...RECIPE, widgets: [...RECIPE.widgets.filter((w) => w.id !== 't'), { id: 'p', title: 'Pending by stage', metric: 'patient_flow', chart: 'bar', groupBy: 'stage', period: { preset: 'today' }, size: 'm' }] },
    })),
  };
  const dialog = { confirm: vi.fn(async () => o.confirm ?? true), prompt: vi.fn(async () => null) };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  TestBed.configureTestingModule({
    imports: [InsightsDashboardComponent],
    providers: [
      o.sense ?? fakePfSense(),
      { provide: InsightsBuilderApiService, useValue: api },
      { provide: DialogService, useValue: dialog },
      { provide: ToastService, useValue: toasts },
      { provide: BetaFeaturesService, useValue: { enabled: (k: string) => k === 'assistant', ensureLoaded: async () => undefined, loaded: () => true } },
      { provide: AssistantApiService, useValue: { providers: vi.fn(() => of([{ id: 'gemini', label: 'Gemini', available: true }])), chat: vi.fn() } },
      { provide: INSTRUMENT_BRIDGE_SOURCE, useValue: () => undefined },
    ],
  });
  TestBed.overrideComponent(InsightsDashboardComponent, { remove: { imports: [InsightsChartComponent] }, add: { imports: [StubChartComponent] } });
  const f = TestBed.createComponent(InsightsDashboardComponent);
  f.componentRef.setInput('dashboardId', o.id === undefined ? 'd1' : o.id);
  const events = { saved: [] as unknown[], created: [] as string[], deleted: [] as string[] };
  f.componentInstance.saved.subscribe((s) => events.saved.push(s));
  f.componentInstance.created.subscribe((s) => events.created.push(s));
  f.componentInstance.deleted.subscribe((s) => events.deleted.push(s));
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  document.body.appendChild(el);
  const card = (id: string) => el.querySelectorAll<HTMLElement>('.pf-insd-w')[f.componentInstance.shown().widgets.findIndex((w) => w.id === id)];
  const titles = () => Array.from(el.querySelectorAll('.pf-insd-w__title')).map((t) => t.textContent!.trim());
  return { f, el, cmp: f.componentInstance, api, dialog, toasts, events, card, titles, settle: () => settle(f) };
}

describe('My dashboards — view', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders every widget kind with the shared chart pieces', { timeout: 20000 }, async () => {
    const p = setup();
    await p.settle();
    expect(p.api.get).toHaveBeenCalledWith('d1');
    expect(p.el.querySelector('.pf-insd-title')!.textContent).toContain('Morning view');
    expect(p.el.querySelector('.pf-insd-status')!.textContent).toContain('Published · Just me');
    const state = (id: string) => p.card(id).getAttribute('data-state');
    for (const id of ['k', 'l', 'h', 'd', 'g', 's', 't']) expect(state(id), id).toBe('ok');
    // KPI tile: value + Δ + sparkline-free (no series over time here → no spark).
    expect(p.card('k').querySelector('.pf-insd-kpi__value')!.textContent).toContain('42');
    expect(p.card('k').querySelector('.pf-insd-kpi__delta')!.textContent).toContain('+12.5%');
    // Chart kinds → one pf-ins-chart each with an ECharts option of the right type.
    const optOf = (id: string) => p.cmp.widgets().find((v) => v.w.id === id)!.option;
    expect(optOf('l').series[0].type).toBe('line');
    expect(optOf('h').series[0].type).toBe('bar');
    expect(optOf('d').series[0].type).toBe('pie');
    expect(optOf('g').series).toHaveLength(2);
    expect(optOf('s').series.length).toBe(2);
    for (const id of ['l', 'h', 'd', 'g', 's']) expect(p.card(id).querySelector('pf-ins-chart'), id).toBeTruthy();
    // Table: AG-Grid, like the rest of Insights.
    expect(p.card('t').querySelector('ag-grid-angular')).toBeTruthy();
    // View mode: no edit controls, no assistant.
    expect(p.el.querySelector('.pf-insd-w__ctrls')).toBeNull();
    expect(p.el.querySelector('pf-assistant-panel')).toBeNull();
  });

  it('a money widget the viewer may not see says Hidden — and shows no number', async () => {
    const p = setup();
    await p.settle();
    const m = p.card('m');
    expect(m.getAttribute('data-state')).toBe('hidden');
    expect(m.textContent).toContain('Hidden');
    expect(m.textContent).toContain('View financial analytics');
    expect(m.querySelector('pf-ins-chart')).toBeNull();
    expect(m.textContent).not.toMatch(/₹|NaN|undefined/);
  });

  it('the band period / branch go to /preview as `band` (the server applies them to every widget)', async () => {
    const p = setup();
    await p.settle();
    expect(p.api.preview.mock.calls.at(-1)![1]).toBeNull();
    p.f.componentRef.setInput('band', { period: '7d', branchId: 'b2' });
    await p.settle();
    const [sent, band] = p.api.preview.mock.calls.at(-1)! as [InsightsRecipe, unknown];
    expect(band).toEqual({ branchId: 'b2', period: { preset: '7d' } });
    // The recipe goes as saved — never rewritten on the client.
    expect(sent).toEqual(RECIPE);
    // The saved recipe is untouched; the card says which period applies.
    expect(p.cmp.dashboard()!.recipe.widgets[0].period).toEqual({ preset: 'today' });
    expect(p.card('k').querySelector('.pf-insd-w__meta')!.textContent).toContain('7 days');
  });
});

describe('My dashboards — when the preview is called', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('title, size and move do not call /preview again; a metric / period / chart change does', async () => {
    const p = setup();
    await p.settle();
    p.cmp.startEdit();
    await p.settle();
    const base = p.api.preview.mock.calls.length;
    p.cmp.setTitle('A new name');
    p.cmp.setSize('h', 'l');
    p.cmp.move('k', 1);
    await p.settle();
    expect(p.api.preview.mock.calls.length).toBe(base);
    p.cmp.setPeriod('h', 'quarter');
    await p.settle();
    expect(p.api.preview.mock.calls.length).toBe(base + 1);
    p.cmp.setChart('h', 'donut');
    await p.settle();
    expect(p.api.preview.mock.calls.length).toBe(base + 2);
  });

  it('a chart that is too detailed says so in plain words', async () => {
    const p = setup();
    p.api.preview.mockImplementation((r: InsightsRecipe) => of({
      widgets: r.widgets.map((w) => ({ id: w.id, state: 'error' as const, code: 'too_detailed', message: 'Too detailed — pick a shorter period.', unit: 'count' as const, categories: [], series: [] })),
      notes: [],
    }));
    await p.settle();
    expect(p.el.textContent).toContain('Too detailed — pick a shorter period.');
  });

  it('a timed-out preview says what to do, in plain words', async () => {
    const q = setup();
    q.api.preview.mockImplementation(() => throwError(() => ({ status: 504, message: 'Http failure response' })));
    q.cmp.startEdit();
    q.cmp.setPeriod('h', 'quarter');
    await q.settle();
    expect(q.cmp.previewError()).toMatch(/took too long to calculate/);
  });
});

describe('My dashboards — edit controls', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('chart type lists only the metric’s allowed charts; size / move / remove edit the working copy', async () => {
    const p = setup();
    await p.settle();
    (p.el.querySelector('.pf-insd-edit') as HTMLButtonElement).click();
    await p.settle();
    expect(p.el.querySelectorAll('.pf-insd-w__ctrls').length).toBe(RECIPE.widgets.length);
    const vm = p.cmp.widgets().find((v) => v.w.id === 'h')!;
    expect(vm.chartOpts.map((o) => o.value)).toEqual(['hbar', 'donut', 'table']);
    // A kind outside the metric's list is refused.
    p.cmp.setChart('h', 'line');
    expect(p.cmp.working().widgets.find((w) => w.id === 'h')!.chart).toBe('hbar');
    p.cmp.setChart('h', 'donut');
    expect(p.cmp.working().widgets.find((w) => w.id === 'h')!.chart).toBe('donut');

    // Size: the S / M / L segment.
    const sizeBtns = p.card('h').querySelectorAll<HTMLButtonElement>('.pf-insd-w__size .pf-seg__item');
    sizeBtns[2].click();
    p.f.detectChanges();
    expect(p.cmp.working().widgets.find((w) => w.id === 'h')!.size).toBe('l');

    // Period.
    p.cmp.setPeriod('h', 'quarter');
    expect(p.cmp.working().widgets.find((w) => w.id === 'h')!.period).toEqual({ preset: 'quarter' });

    // Move: first card's Up is disabled; Down moves it.
    expect((p.card('k').querySelector('.pf-insd-up') as HTMLButtonElement).disabled).toBe(true);
    (p.card('k').querySelector('.pf-insd-down') as HTMLButtonElement).click();
    p.f.detectChanges();
    expect(p.cmp.working().widgets.map((w) => w.id).slice(0, 2)).toEqual(['l', 'k']);

    // Remove.
    (p.card('t').querySelector('.pf-insd-remove') as HTMLButtonElement).click();
    p.f.detectChanges();
    expect(p.titles()).not.toContain('Department table');
    expect(p.el.querySelector('.pf-insd-unsaved')).toBeTruthy();
    // The saved dashboard itself is untouched until Save.
    expect(p.cmp.dashboard()!.recipe.widgets).toHaveLength(RECIPE.widgets.length);
  });

  it('Cancel with changes asks first (DialogService), then goes back to the saved one', async () => {
    const p = setup();
    await p.settle();
    p.cmp.startEdit();
    p.cmp.remove('k');
    await p.cmp.cancelEdit();
    expect(p.dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Discard your changes?', tone: 'danger' }));
    expect(p.cmp.editing()).toBe(false);
    expect(p.cmp.shown().widgets).toHaveLength(RECIPE.widgets.length);
  });

  it('a new dashboard opens in edit mode, empty, and "Add a chart" adds the metric with its default', async () => {
    const p = setup({ id: null });
    await p.settle();
    expect(p.api.get).not.toHaveBeenCalled();
    expect(p.cmp.editing()).toBe(true);
    expect(p.el.textContent).toContain('Nothing on this dashboard yet');
    p.cmp.add('tat');
    await p.settle();
    expect(p.cmp.working().widgets[0]).toMatchObject({ metric: 'tat', chart: 'grouped_hbar', groupBy: 'department' });
    p.cmp.saveDraft();
    await p.settle();
    expect(p.api.create).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'private', roleIds: [] }));
    expect(p.events.created).toEqual(['new1']);
  });
});

describe('My dashboards — PF Sense proposal: live preview, Keep / Undo', () => {
  afterEach(() => TestBed.resetTestingModule());

  async function propose() {
    const p = setup();
    await p.settle();
    p.cmp.startEdit();
    await p.settle();
    const ctx = p.cmp.asstContext();
    expect(ctx.page).toBe('insights');
    const reply = await firstValueFrom(ctx.chat!({ provider: 'gemini', messages: [{ role: 'user', text: 'add pending by stage, drop the table' }] }));
    await p.settle();
    return { p, reply };
  }

  it('sends the recipe on screen with the turns, previews the proposal and lists the changes', async () => {
    const { p, reply } = await propose();
    expect(p.api.chat).toHaveBeenCalledWith(expect.objectContaining({ provider: 'gemini', recipe: expect.objectContaining({ title: 'Morning view' }) }));
    expect(reply.suggestions).toEqual([{ kind: 'changes', ref: 'p1', changes: ['Added “Pending by stage”', 'Removed “Department table”'] }]);
    // Live preview: the canvas shows the proposal; the working copy is unchanged.
    expect(p.titles()).toContain('Pending by stage');
    expect(p.titles()).not.toContain('Department table');
    expect(p.cmp.working().widgets.find((w) => w.id === 't')).toBeTruthy();
    expect(p.el.querySelector('.pf-insd-preview')).toBeTruthy();
    expect(p.cmp.asstContext().proposals).toEqual({ p1: 'pending' });
    // Manual controls wait for Keep / Undo.
    expect((p.card('k').querySelector('.pf-insd-remove') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Keep makes it the working copy', async () => {
    const { p } = await propose();
    (p.el.querySelector('.pf-insd-keep') as HTMLButtonElement).click();
    await p.settle();
    expect(p.cmp.working().widgets.map((w) => w.id)).toContain('p');
    expect(p.cmp.proposal()).toBeNull();
    expect(p.cmp.asstContext().proposals).toEqual({ p1: 'kept' });
    expect(p.el.querySelector('.pf-insd-preview')).toBeNull();
  });

  it('Undo puts the dashboard back', async () => {
    const { p } = await propose();
    (p.el.querySelector('.pf-insd-undo') as HTMLButtonElement).click();
    await p.settle();
    expect(p.titles()).toContain('Department table');
    expect(p.titles()).not.toContain('Pending by stage');
    expect(p.cmp.asstContext().proposals).toEqual({ p1: 'undone' });
  });

  it('a plain answer (no recipe) proposes nothing', async () => {
    const p = setup({ chat: { reply: 'Revenue is billed minus discounts.', recipe: null, changes: [], notes: [], provider: 'gemini', model: 'x' } });
    await p.settle();
    p.cmp.startEdit();
    const reply = await firstValueFrom(p.cmp.asstContext().chat!({ provider: 'gemini', messages: [{ role: 'user', text: 'what is revenue?' }] }));
    expect(reply.suggestions).toEqual([]);
    expect(p.cmp.proposal()).toBeNull();
  });
});

describe('My dashboards — publish + visibility, history + restore', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('Publish confirms in plain words (DialogService) and sends the visibility', async () => {
    const p = setup();
    await p.settle();
    p.cmp.startEdit();
    p.cmp.setVisibility('lab');
    p.f.detectChanges();
    (p.el.querySelector('.pf-insd-publish') as HTMLButtonElement).click();
    await p.settle();
    expect(p.dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Publish “Morning view”?', confirmLabel: 'Publish', message: expect.stringContaining('Everyone in the lab'),
    }));
    expect(p.api.update).toHaveBeenCalled(); // visibility changed → saved first
    expect(p.api.publish).toHaveBeenCalledWith('d1', { visibility: 'lab', roleIds: [] });
    expect(p.cmp.editing()).toBe(false);
    expect(p.el.querySelector('.pf-insd-status')!.textContent).toContain('Published · Whole lab');
  });

  it('Roles: needs at least one role, then publishes to them', async () => {
    const p = setup();
    await p.settle();
    p.cmp.startEdit();
    p.cmp.setVisibility('roles');
    await p.settle();
    expect(p.api.roles).toHaveBeenCalled();
    expect((p.el.querySelector('.pf-insd-publish') as HTMLButtonElement).disabled).toBe(true);
    expect(p.el.textContent).toContain('Pick at least one role');
    p.cmp.roleIds.set(['r1']);
    p.f.detectChanges();
    await p.cmp.publish();
    await p.settle();
    expect(p.dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Pathologist') }));
    expect(p.api.publish).toHaveBeenCalledWith('d1', { visibility: 'roles', roleIds: ['r1'] });
  });

  it('declining the confirm publishes nothing', async () => {
    const p = setup({ confirm: false });
    await p.settle();
    p.cmp.startEdit();
    await p.cmp.publish();
    expect(p.api.publish).not.toHaveBeenCalled();
    expect(p.api.update).not.toHaveBeenCalled();
  });

  it('History lists versions; Restore confirms and reloads the restored one', async () => {
    const p = setup();
    await p.settle();
    (p.el.querySelector('.pf-insd-history') as HTMLButtonElement).click();
    await p.settle();
    const sheet = p.el.querySelector('.pf-insd-history-sheet')!;
    expect(sheet.textContent).toContain('Version 3');
    expect(sheet.textContent).toContain('current');
    // Only older versions offer Restore.
    const restoreBtns = sheet.querySelectorAll<HTMLButtonElement>('.pf-insd-restore');
    expect(restoreBtns).toHaveLength(1);
    restoreBtns[0].click();
    await p.settle();
    expect(p.dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Restore version 2?' }));
    expect(p.api.restore).toHaveBeenCalledWith('d1', 2);
    expect(p.el.querySelector('.pf-insd-history-sheet')).toBeNull();
    expect(p.cmp.shown().widgets).toHaveLength(2);
    expect(p.events.saved).toHaveLength(1);
  });
});

describe('My dashboards — aligned with the server (options, notes, unpublish, conflict, sharing, compare, filters)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('server notes about dropped parts are said under the PF Sense answer', async () => {
    const p = setup({ chat: { reply: 'Added patient flow.', recipe: null, changes: [], notes: ['Dropped "Weather": not something Prefrontal can show.'], provider: 'gemini', model: 'x' } });
    await p.settle();
    p.cmp.startEdit();
    const reply = await firstValueFrom(p.cmp.asstContext().chat!({ provider: 'gemini', messages: [{ role: 'user', text: 'add weather' }] }));
    expect(reply.reply).toBe('Added patient flow.\n\n- Dropped "Weather": not something Prefrontal can show.');
  });

  it('Unpublish: owners see it on a published dashboard, it confirms, then it is a private draft', async () => {
    const p = setup();
    await p.settle();
    const btn = p.el.querySelector('.pf-insd-unpublish') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    await p.settle();
    expect(p.dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Unpublish “Morning view”?', confirmLabel: 'Unpublish' }));
    expect(p.api.unpublish).toHaveBeenCalledWith('d1');
    expect(p.el.querySelector('.pf-insd-status')!.textContent).toContain('Draft · Just me');
    expect(p.el.querySelector('.pf-insd-unpublish')).toBeNull();
    expect(p.events.saved).toHaveLength(1);
  });

  it('no Unpublish for someone who cannot edit, or on a draft; declining changes nothing', async () => {
    const viewer = setup({ dash: { ...DASH, canEdit: false, mine: false } });
    await viewer.settle();
    expect(viewer.el.querySelector('.pf-insd-unpublish')).toBeNull();
    TestBed.resetTestingModule();
    const draft = setup({ dash: { ...DASH, status: 'draft' } });
    await draft.settle();
    expect(draft.el.querySelector('.pf-insd-unpublish')).toBeNull();
    TestBed.resetTestingModule();
    const no = setup({ confirm: false });
    await no.settle();
    await no.cmp.unpublish();
    expect(no.api.unpublish).not.toHaveBeenCalled();
  });

  it('a 409 version_conflict says so in plain words and offers Reload (which drops the local edit)', async () => {
    const p = setup({ updateError: Object.assign(new Error('Someone saved a newer version of this dashboard. Reload it first.'), { code: 'version_conflict' }) });
    await p.settle();
    p.cmp.startEdit();
    p.cmp.remove('k');
    await p.cmp.saveDraft();
    await p.settle();
    expect(p.toasts.error).toHaveBeenCalledWith('Someone else changed this dashboard — reload it to see their version.');
    const alert = p.el.querySelector('.pf-insd-conflict')!;
    expect(alert.textContent).toContain('Someone else changed this dashboard');
    (alert.querySelector('.pf-insd-reload') as HTMLButtonElement).click();
    await p.settle();
    expect(p.api.get).toHaveBeenCalledTimes(2);
    expect(p.cmp.editing()).toBe(false);
    expect(p.cmp.shown().widgets).toHaveLength(RECIPE.widgets.length);
    expect(p.el.querySelector('.pf-insd-conflict')).toBeNull();
  });

  it('without sharing rights only "Just me" is offered (canShare from the dashboard / options)', async () => {
    const p = setup({ id: null, canShare: false });
    await p.settle();
    expect(p.cmp.visibilityOptions().map((o) => o.value)).toEqual(['private']);
    p.cmp.setVisibility('lab');
    expect(p.cmp.visibility()).toBe('private');
    TestBed.resetTestingModule();
    const admin = setup({ id: null, canShare: true });
    await admin.settle();
    expect(admin.cmp.visibilityOptions().map((o) => o.value)).toEqual(['private', 'roles', 'lab']);
  });

  it('compare + narrow-to pickers edit the widget; the meta line names the filter', async () => {
    const p = setup();
    await p.settle();
    p.cmp.startEdit();
    await p.settle();
    // Compare only where the metric supports it on this chart.
    expect(p.card('k').querySelector('.pf-insd-w__cmp')).toBeTruthy();
    expect(p.card('h').querySelector('.pf-insd-w__cmp')).toBeNull();
    (p.card('k').querySelector('.pf-insd-w__cmp') as HTMLButtonElement).click();
    p.f.detectChanges();
    expect(p.cmp.working().widgets.find((w) => w.id === 'k')!.compare).toBe(true);
    // Filters: department picker from /dimensions.
    expect(p.api.dimensions).toHaveBeenCalledWith('department');
    (p.card('h').querySelector('.pf-insd-filters') as HTMLButtonElement).click();
    await p.settle();
    const vm = p.cmp.widgets().find((v) => v.w.id === 'h')!;
    expect(vm.pickers.map((x) => x.key)).toEqual(['departmentId', 'refDoctorId']);
    expect(vm.pickers[0].options.map((o) => o.label)).toEqual(['All departments', 'Biochemistry', 'Haematology']);
    p.cmp.setFilter('h', 'departmentId', 'dep1');
    await p.settle();
    expect(p.cmp.working().widgets.find((w) => w.id === 'h')!.filters).toEqual({ departmentId: 'dep1' });
    expect(p.card('h').querySelector('.pf-insd-w__meta')!.textContent).toContain('Biochemistry');
    p.cmp.setFilter('h', 'departmentId', '');
    expect(p.cmp.working().widgets.find((w) => w.id === 'h')!.filters).toBeUndefined();
  });

  it('the widget cap comes from /options', async () => {
    const p = setup({ id: null });
    await p.settle();
    for (let i = 0; i < 14; i++) p.cmp.add('patients');
    await p.settle();
    expect(p.cmp.working().widgets).toHaveLength(12);
    expect(p.el.textContent).toContain('A dashboard holds up to 12 charts');
  });
});

describe('My dashboards — history sheet vs the confirm dialog', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('Restore closes the sheet while it asks, and brings it back on "Cancel"', async () => {
    const p = setup({ confirm: false });
    await p.settle();
    p.cmp.openHistory();
    await p.settle();
    let openWhileAsking: boolean | null = null;
    p.dialog.confirm.mockImplementation(async () => { openWhileAsking = p.cmp.historyOpen(); return false; });
    await p.cmp.restore(p.cmp.versions()[1]);
    expect(openWhileAsking).toBe(false);
    expect(p.cmp.historyOpen()).toBe(true);
    expect(p.api.restore).not.toHaveBeenCalled();
  });
});

describe('My dashboards — PF Sense admin switch', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('feature on: the Ask PF Sense toggle and panel are there in edit mode', async () => {
    const p = setup();
    await p.settle();
    p.cmp.startEdit();
    await p.settle();
    expect(p.el.querySelector('.pf-insd-asktoggle')).not.toBeNull();
    expect(p.el.querySelector('pf-assistant-panel')).not.toBeNull();
  });

  it('insights_assistant off: no toggle, no panel, no empty-state button, not auto-opened', async () => {
    const p = setup({ sense: fakePfSense({ off: ['insights_assistant'] }) });
    await p.settle();
    p.cmp.startEdit();
    await p.settle();
    expect(p.el.querySelector('.pf-insd-asktoggle')).toBeNull();
    expect(p.el.querySelector('pf-assistant-panel')).toBeNull();
    expect(p.cmp.assistantOpen()).toBe(false);
  });

  it('master switch off hides it too; another feature off does not', async () => {
    let p = setup({ sense: fakePfSense({ master: false }) });
    await p.settle(); p.cmp.startEdit(); await p.settle();
    expect(p.el.querySelector('.pf-insd-asktoggle')).toBeNull();
    TestBed.resetTestingModule();
    p = setup({ sense: fakePfSense({ off: ['instruments_assistant', 'ast_disk_read'] }) });
    await p.settle(); p.cmp.startEdit(); await p.settle();
    expect(p.el.querySelector('.pf-insd-asktoggle')).not.toBeNull();
  });
});
