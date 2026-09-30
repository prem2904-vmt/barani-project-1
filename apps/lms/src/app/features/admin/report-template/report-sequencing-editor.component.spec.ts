import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { of } from 'rxjs';
import { ReportSequencingEditorComponent } from './report-sequencing-editor.component';
import { buildSequencePreviewTests, departmentItems, profileMemberIds } from './report-sequencing-preview';
import { sequencePreviewSnapshot } from './report-template.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import type { ReportTemplate } from '../../../shared/models/report.model';
import type { Department } from '../../../shared/models/tenant.model';
import type { Test } from '../../../shared/models/test.model';
import { applyReportSequencing, readReportSequencing } from '../../../shared/utils/report-sequencing';

/**
 * Report designer → Sequencing (owner 2026-09-30): department print order +
 * the order inside a department, written into the template metadata; the
 * preview runs on the lab's own departments and tests.
 */
const D = (id: string, name: string, code: string): Department =>
  ({ id, name, code, tenantId: 't', isActive: true, createdAt: '' });
const T = (id: string, name: string, deptId: string, testCode: string, extra: Partial<Test> = {}): Test =>
  ({ id, name, departmentId: deptId, testCode, type: 'individual', isActive: true, tenantId: 't', flow: 'direct',
     taxSlab: 0, price: 0, discount: 0, tatHours: 1, createdAt: '', ...extra } as Test);

const DEPTS = [D('b', 'Biochemistry', 'BIO'), D('h', 'Haematology', 'HAE'), D('m', 'Microbiology', 'MIC')];
const TESTS = [
  T('tsh', 'TSH', 'b', 'BIO120'),
  T('glu', 'Glucose, Fasting', 'b', 'BIO9'),
  T('alt', 'SGPT (ALT)', 'b', 'BIO052'),
  T('bil', 'Total Bilirubin', 'b', 'BIO051'),
  T('lft', 'Liver Function Test', 'b', 'BIO050', { type: 'profile',
    parameters: JSON.stringify({ items: [{ testId: 'bil' }, { testId: 'alt' }], reportOrder: ['alt', 'bil'] }) }),
  T('pkg', 'Health Package', 'b', 'PKG1', { type: 'package' }),
  T('off', 'Switched off', 'b', 'BIO1', { isActive: false }),
  T('cbc', 'Complete Blood Count', 'h', 'HAE001'),
  T('esr', 'ESR', 'h', 'HAE002'),
  T('cs', 'Urine Culture', 'm', 'MIC010'),
];

function make(metadata: string | null = null) {
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: { get: vi.fn((p: string) => of(p.includes('departments') ? DEPTS : TESTS)) } },
      { provide: ToastService, useValue: { error: vi.fn(), success: vi.fn() } },
    ],
  });
  const f = TestBed.createComponent(ReportSequencingEditorComponent);
  let tpl = { metadata } as ReportTemplate;
  f.componentRef.setInput('template', tpl);
  const c = f.componentInstance;
  const writes: string[] = [];
  c.metadataChange.subscribe(m => { writes.push(m); tpl = { ...tpl, metadata: m }; f.componentRef.setInput('template', tpl); });
  f.detectChanges();
  return { f, c, writes, seq: () => readReportSequencing(tpl) };
}

describe('Sequencing — department items + preview data', () => {
  it("a department's orderable items: tests + profiles (never packages or switched-off tests), by test number", () => {
    expect(departmentItems(DEPTS[0], TESTS).map(i => i.id)).toEqual(['glu', 'lft', 'bil', 'alt', 'tsh']);
    expect(departmentItems(DEPTS[0], TESTS).find(i => i.id === 'lft')).toMatchObject({ isProfile: true, memberIds: ['alt', 'bil'] });
  });

  it("a profile's members: its printed-report order, else its lab items", () => {
    expect(profileMemberIds({ parameters: JSON.stringify({ items: [{ testId: 'a' }, { testId: 'b' }] }) })).toEqual(['a', 'b']);
    expect(profileMemberIds({ parameters: JSON.stringify({ items: [{ testId: 'a' }], reportOrder: ['b', 'a'] }) })).toEqual(['b', 'a']);
    expect(profileMemberIds({ parameters: 'junk' })).toEqual([]);
  });

  it('the preview interleaves departments (a desk order) and compiles a profile from its members', () => {
    const tests = buildSequencePreviewTests(DEPTS, TESTS, 'b');
    // Microbiology booked first → default prints it first; every department present.
    expect(tests[0]['department']).toBe('Microbiology');
    expect(new Set(tests.map(t => t['department']))).toEqual(new Set(['Biochemistry', 'Haematology', 'Microbiology']));
    const lft = tests.filter(t => t['profileTestId'] === 'lft');
    expect(lft.map(t => t['testId'])).toEqual(['alt', 'bil']);
    expect(lft[0]).toMatchObject({ profileCode: 'BIO050', packageType: 'profile', departmentId: 'b' });
    // …and the sequencer reorders it like a real report.
    const seq = applyReportSequencing(tests as never[], { departments: [{ id: 'b' }], mode: 'code' }) as Array<Record<string, unknown>>;
    expect(seq.map(t => t['testId']).slice(0, 5)).toEqual(['glu', 'alt', 'bil', 'tsh', 'cs']);   // then Microbiology (booked before Haematology)
  });

  it('the preview snapshot swaps the sample tests (and departments line) only when the lab data is loaded', () => {
    const sample = JSON.stringify({ order: { id: 'o' }, tests: [{ testId: 'x' }] });
    expect(sequencePreviewSnapshot(sample, [])).toBe(sample);
    const out = JSON.parse(sequencePreviewSnapshot(sample, [{ testId: 'a', department: 'Haematology' }]));
    expect(out.tests).toEqual([{ testId: 'a', department: 'Haematology' }]);
    expect(out.order).toEqual({ id: 'o', departments: 'Haematology' });
  });
});

describe('Sequencing editor', () => {
  it('opens on today (as booked); Custom saves the full department list; Reset clears it', () => {
    const { c, seq } = make();
    expect(c.deptMode()).toBe('default');
    expect(c.labMode()).toBe('ordered');
    c.setDeptMode('custom');
    expect(seq().departments?.map(d => d.id)).toEqual(['b', 'h', 'm']);
    c.moveDept(2, -1);
    c.moveDept(1, -1);
    expect(seq().departments?.map(d => d.id)).toEqual(['m', 'b', 'h']);
    expect(c.deptList().map(d => d.id)).toEqual(['m', 'b', 'h']);
    c.setDeptMode('default');
    expect(seq()).toEqual({});
  });

  it('keeps other metadata keys', () => {
    const { c, writes } = make(JSON.stringify({ options: { abnormalSummary: true } }));
    c.setLabMode('alpha');
    expect(JSON.parse(writes.at(-1)!)).toEqual({ options: { abnormalSummary: true }, sequencing: { mode: 'alpha' } });
    c.setLabMode('ordered');
    expect(JSON.parse(writes.at(-1)!)).toEqual({ options: { abnormalSummary: true } });
  });

  it('a department of its own: Custom seeds its items, moves save them (a profile = one item)', () => {
    const { c, seq } = make();
    c.focusDeptId.set('b');
    c.setFocusMode('custom');
    expect(seq().depts?.['b']).toMatchObject({ mode: 'custom', code: 'BIO', name: 'Biochemistry' });
    expect(seq().depts?.['b'].items?.map(i => i.id)).toEqual(['glu', 'lft', 'bil', 'alt', 'tsh']);
    c.moveItem(4, -1);   // TSH up one
    expect(c.focusItems().map(i => i.id)).toEqual(['glu', 'lft', 'bil', 'tsh', 'alt']);
    c.resetItems();
    expect(c.focusItems().map(i => i.id)).toEqual(['glu', 'lft', 'bil', 'alt', 'tsh']);
    c.setFocusMode('inherit');
    expect(seq().depts).toBeUndefined();
  });

  it('Alt + ↑ / ↓ on a row moves it', () => {
    const { c } = make();
    c.setDeptMode('custom');
    const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true });
    c.rowKey(ev, 'dept', 0);
    expect(c.deptList().map(d => d.id)).toEqual(['h', 'b', 'm']);
    c.rowKey(new KeyboardEvent('keydown', { key: 'ArrowDown' }), 'dept', 0);   // no Alt → nothing
    expect(c.deptList().map(d => d.id)).toEqual(['h', 'b', 'm']);
  });

  it('a department added later appears at the end of a saved order', () => {
    const meta = JSON.stringify({ sequencing: { departments: [{ id: 'm' }, { id: 'b' }] } });
    const { c } = make(meta);
    expect(c.deptList().map(d => d.id)).toEqual(['m', 'b', 'h']);
  });

  it('renders the lists with move buttons (no native select)', () => {
    const { f, c } = make();
    c.setDeptMode('custom');
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelectorAll('[data-list="dept"] .pf-seq__row').length).toBe(3);
    expect(el.querySelector('select')).toBeNull();
    expect(el.querySelector('[data-list="dept"] .pf-seq__btn')?.getAttribute('aria-label')).toBe('Print Biochemistry earlier');
  });
});
