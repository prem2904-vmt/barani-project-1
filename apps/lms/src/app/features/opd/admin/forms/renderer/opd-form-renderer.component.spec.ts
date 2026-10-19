import { TestBed } from '@angular/core/testing';
import { OpdFormRendererComponent } from './index';
import type { OpdAnswers, OpdFormDoc } from './index';

/**
 * <pf-opd-form-renderer> — the ONE renderer Agent C's consult screen imports:
 * edit / readonly / print / design modes, conditions, left & right, add-ons,
 * media requests and the builder's selection + toolbar.
 */
const DOC: OpdFormDoc = {
  schemaVersion: 2, allowAddons: true,
  sections: [{ key: 'findings', title: 'Findings', fields: [
    { key: 'complaint', label: 'Chief complaints', type: 'short', required: true, print: true },
    { key: 'discharge', label: 'Ear discharge?', type: 'yn', print: false },
    { key: 'dtype', label: 'Discharge type', type: 'one', choices: ['Mucoid', 'Purulent'], when: { key: 'discharge', value: 'Yes' }, print: true },
    { key: 'oto', label: 'Otoscopy', type: 'one', sides: true, choices: ['Normal', 'Wax'], print: true },
    { key: 'symptoms', label: 'Symptoms', type: 'many', choices: ['Fever', 'Headache'], print: true },
    { key: 'endo', label: 'Nasal endoscopy', type: 'media', print: true },
    { key: 'grade', label: 'Polyp grade', type: 'scale', min: 0, max: 4, print: true },
  ] }],
};

function render(mode: 'edit' | 'readonly' | 'print' | 'design', answers: OpdAnswers = {}, extra: Record<string, unknown> = {}) {
  TestBed.configureTestingModule({ imports: [OpdFormRendererComponent] });
  const f = TestBed.createComponent(OpdFormRendererComponent);
  f.componentRef.setInput('schema', DOC);
  f.componentRef.setInput('answers', answers);
  f.componentRef.setInput('mode', mode);
  for (const [k, v] of Object.entries(extra)) f.componentRef.setInput(k, v);
  const emitted: OpdAnswers[] = [];
  f.componentInstance.answersChange.subscribe((a) => { emitted.push(a); f.componentRef.setInput('answers', a); f.detectChanges(); });
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const q = (key: string) => el.querySelector<HTMLElement>(`[data-q="${key}"]`);
  const btn = (key: string, text: string) => Array.from(q(key)?.querySelectorAll('button') ?? []).find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
  return { f, el, q, btn, emitted };
}

describe('OpdFormRendererComponent', () => {
  it('edit: hides a conditional question until its answer, then shows it', () => {
    const { q, btn, emitted } = render('edit');
    expect(q('complaint')).toBeTruthy();
    expect(q('dtype')).toBeNull();
    btn('discharge', 'Yes')!.click();
    expect(emitted.at(-1)).toEqual({ discharge: 'Yes' });
    expect(q('dtype')).toBeTruthy();
    btn('discharge', 'Yes')!.click();                      // tapping the chosen answer clears it
    expect(emitted.at(-1)).toEqual({ discharge: null });
    expect(q('dtype')).toBeNull();
  });

  it('edit: typing a note, picking several, a scale step', () => {
    const { q, btn, emitted } = render('edit');
    const input = q('complaint')!.querySelector('input')!;
    input.value = 'Nasal block';
    input.dispatchEvent(new Event('input'));
    expect(emitted.at(-1)!['complaint']).toBe('Nasal block');
    btn('symptoms', 'Fever')!.click();
    btn('symptoms', 'Headache')!.click();
    expect(emitted.at(-1)!['symptoms']).toEqual(['Fever', 'Headache']);
    btn('grade', '2')!.click();
    expect(emitted.at(-1)!['grade']).toBe(2);
  });

  it('edit: left & right answers are { r, l }', () => {
    const { q, emitted } = render('edit');
    const sides = q('oto')!.querySelectorAll('.ofr-side');
    expect(sides.length).toBe(2);
    (Array.from(sides[1].querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Wax') as HTMLButtonElement).click();
    expect(emitted.at(-1)!['oto']).toEqual({ l: 'Wax' });
  });

  it('edit: media asks the host to capture / upload', () => {
    const { f, q } = render('edit');
    const req: unknown[] = [];
    f.componentInstance.mediaRequest.subscribe((r) => req.push(r));
    (q('endo')!.querySelector('.ofr-shot--add') as HTMLButtonElement).click();
    expect(req).toEqual([{ key: 'endo', side: undefined }]);
  });

  it('readonly: shows answers but never emits', () => {
    const { btn, emitted, q } = render('readonly', { discharge: 'No', complaint: 'x' });
    const yes = btn('discharge', 'Yes')!;
    expect(yes.disabled).toBe(true);
    yes.click();
    expect(emitted).toEqual([]);
    expect((q('complaint')!.querySelector('input') as HTMLInputElement).readOnly).toBe(true);
  });

  it('print: answered, printable, visible questions only', () => {
    const { el } = render('print', { complaint: 'Nasal block', discharge: 'No', oto: { r: 'Normal', l: 'Wax' }, grade: 1 });
    const rows = Array.from(el.querySelectorAll('.ofr-pt > tr, .ofr-pt > tbody > tr')).map((r) => r.querySelector('th')!.textContent!.trim());
    expect(rows).toEqual(['Chief complaints', 'Otoscopy', 'Polyp grade']);
    expect(el.textContent).toContain('1 / 4');
    expect(el.textContent).not.toContain('Ear discharge');   // print off
  });

  it('print: nothing to print says so; blanks print an empty form', () => {
    expect(render('print', {}).el.textContent).toContain('Nothing on this form is set to print.');
    TestBed.resetTestingModule();
    expect(render('print', {}, { printBlanks: true }).el.querySelectorAll('.ofr-pt__blank').length).toBeGreaterThan(0);
  });

  it('design: every question shows (conditions dimmed with their rule), click selects, toolbar acts', () => {
    const { f, q, el } = render('design', { discharge: 'No' });
    const sel: string[] = [];
    const acts: unknown[] = [];
    f.componentInstance.questionSelect.subscribe((k) => sel.push(k));
    f.componentInstance.action.subscribe((a) => acts.push(a));
    expect(q('dtype')!.classList.contains('is-cond')).toBe(true);
    expect(q('dtype')!.textContent).toContain('Hidden until “Ear discharge” is Yes');
    expect(q('discharge')!.textContent).toContain('Not printed');
    q('complaint')!.click();
    expect(sel).toEqual(['complaint']);
    f.componentRef.setInput('selectedKey', 'complaint');
    f.detectChanges();
    const bar = el.querySelector('[data-q="complaint"] .ofr-bar')!;
    (bar.querySelector('[aria-label="Move down"]') as HTMLButtonElement).click();
    (bar.querySelector('[aria-label="Delete question"]') as HTMLButtonElement).click();
    expect(acts).toEqual([{ key: 'complaint', action: 'down' }, { key: 'complaint', action: 'del' }]);
    expect((bar.querySelector('[aria-label="Move up"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it("appends a doctor's add-only questions, marked as the doctor's own", () => {
    const { q } = render('edit', {}, { addons: [{ key: 'smell', label: 'Smell test', type: 'yn' }] });
    expect(q('smell')!.textContent).toContain("Doctor's own");
  });

  it('calc: read-only, live-updating, and persisted alongside its source (critic §1 #6)', () => {
    const CALC_DOC: OpdFormDoc = {
      schemaVersion: 2, allowAddons: true,
      sections: [{ key: 'findings', title: 'Findings', fields: [
        { key: 'lmp', label: 'LMP', type: 'date' },
        { key: 'edd', label: 'EDD', type: 'calc', formula: 'edd', from: 'lmp' },
      ] }],
    };
    const { f, q, emitted } = render('edit', {}, { schema: CALC_DOC, visitDate: '2026-09-30' });
    expect(q('edd')!.textContent).toContain('—');             // no LMP yet ⇒ blank
    expect(q('edd')!.querySelector('input')).toBeNull();       // never an editable control

    // Answering the source (as the pf-date picker's (valueChange) would) recomputes
    // AND persists the calc value in the SAME emitted answers object.
    const lmp = f.componentInstance.list()[0];
    f.componentInstance.set(lmp, null, '2026-01-01');
    expect(emitted.at(-1)).toEqual({ lmp: '2026-01-01', edd: '2026-10-08' });
    f.detectChanges();
    expect(q('edd')!.textContent).toContain('2026-10-08');
  });

  it('groups a multi-section doc under a heading per section; a single-section doc (the builder) shows none', () => {
    const MULTI: OpdFormDoc = {
      schemaVersion: 2, allowAddons: true,
      sections: [
        { key: 'hist', title: 'History', fields: [{ key: 'chief', label: 'Chief complaint', type: 'short', print: true }] },
        { key: 'exam', title: 'Examination', fields: [{ key: 'bp', label: 'BP', type: 'short', print: true }] },
      ],
    };
    const { el } = render('edit', {}, { schema: MULTI });
    const heads = Array.from(el.querySelectorAll('.ofr-sec-head')).map((h) => h.textContent?.trim());
    expect(heads).toEqual(['History', 'Examination']);
    expect(el.querySelector('[data-q="chief"]')).toBeTruthy();
    expect(el.querySelector('[data-q="bp"]')).toBeTruthy();

    // Single section (the builder passes one section per renderer instance) — no headers.
    TestBed.resetTestingModule();
    expect(render('design', {}, { schema: DOC }).el.querySelectorAll('.ofr-sec-head').length).toBe(0);
  });

  it('a section heading collapses its own questions, not the others', () => {
    const MULTI: OpdFormDoc = {
      schemaVersion: 2, allowAddons: true,
      sections: [
        { key: 'hist', title: 'History', fields: [{ key: 'chief', label: 'Chief complaint', type: 'short', print: true }] },
        { key: 'exam', title: 'Examination', fields: [{ key: 'bp', label: 'BP', type: 'short', print: true }] },
      ],
    };
    const { el, f } = render('edit', {}, { schema: MULTI });
    const head = Array.from(el.querySelectorAll<HTMLButtonElement>('.ofr-sec-head')).find((h) => h.textContent?.includes('History'))!;
    expect(head.getAttribute('aria-expanded')).toBe('true');
    head.click();
    f.detectChanges();
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('[data-q="chief"]')).toBeNull();
    expect(el.querySelector('[data-q="bp"]')).toBeTruthy();   // the OTHER section stays open
  });

  it('reads a foundation v1 schema', () => {
    TestBed.configureTestingModule({ imports: [OpdFormRendererComponent] });
    const f = TestBed.createComponent(OpdFormRendererComponent);
    f.componentRef.setInput('schema', { sections: [{ key: 's', title: 'S', fields: [{ key: 'b', label: 'Fever', type: 'boolean' }] }] });
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('[data-type="yn"]')).toBeTruthy();
  });
});
