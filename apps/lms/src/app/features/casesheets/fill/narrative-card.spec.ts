import { TestBed } from '@angular/core/testing';
import { CaseNarrative } from '../data/cases/case-models';
import { NarrativeCardComponent, SectionEditEvent } from './narrative-card.component';

const narrative = (over: Partial<CaseNarrative['sections'][0]> = {}): CaseNarrative => ({
  state: 'draft',
  rowVersion: 3,
  frozen: false,
  patientName: 'Rajesh Kumar',
  age: '42',
  sex: 'male',
  warnings: [],
  sections: [
    {
      id: 'hpi',
      key: 'hpi',
      title: 'History',
      order: 1,
      generated: 'Nasal block for 6 months.',
      edited: null,
      stale: false,
      content: 'Nasal block for 6 months.',
      own: false,
      formTitle: null,
      ...over,
    },
    { id: 'empty', key: 'empty', title: 'Nothing', order: 2, generated: '', edited: null, stale: false, content: '', own: false, formTitle: null },
  ],
});

async function render(n: CaseNarrative | null, state = 'idle', readOnly = false) {
  TestBed.resetTestingModule();
  const f = TestBed.createComponent(NarrativeCardComponent);
  f.componentRef.setInput('narrative', n);
  f.componentRef.setInput('state', state);
  f.componentRef.setInput('readOnly', readOnly);
  const edits: SectionEditEvent[] = [];
  const keeps: SectionEditEvent[] = [];
  const clears: string[] = [];
  f.componentInstance.edit.subscribe((e) => edits.push(e));
  f.componentInstance.keep.subscribe((e) => keeps.push(e));
  f.componentInstance.clear.subscribe((e) => clears.push(e));
  f.detectChanges();
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  const click = async (b: Element) => {
    (b as HTMLElement).click();
    f.detectChanges();
    await f.whenStable();
  };
  const btn = (t: string | RegExp) =>
    [...el.querySelectorAll('button')].find((b) =>
      typeof t === 'string' ? b.textContent?.trim() === t : t.test(b.textContent ?? ''),
    )!;
  return { f, el, edits, keeps, clears, click, btn };
}

describe('narrative card', () => {
  it('shows sections with words; hides empty ones', async () => {
    const r = await render(narrative());
    expect(r.el.querySelectorAll('[data-section]').length).toBe(1);
    expect(r.el.textContent).toContain('Nasal block for 6 months.');
  });

  it('offline with nothing yet says it needs the network, in plain words', async () => {
    const r = await render(null, 'offline');
    expect(r.el.textContent).toContain('back online');
  });

  it('Edit → change the words → Keep these words emits the edit', async () => {
    const r = await render(narrative());
    await r.click(r.el.querySelector('[aria-label="Edit History"]')!);
    const area = r.el.querySelector('textarea')!;
    area.value = 'Left nasal block for six months.';
    area.dispatchEvent(new Event('input'));
    r.f.detectChanges();
    await r.click(r.btn('Keep these words'));
    expect(r.edits).toEqual([{ sectionId: 'hpi', text: 'Left nasal block for six months.' }]);
  });

  it('an edit gone stale asks: keep mine / take the new text', async () => {
    const r = await render(narrative({ edited: 'Mine.', content: 'Mine.', stale: true, generated: 'New words.' }));
    expect(r.el.textContent).toContain('Your words');
    expect(r.el.textContent).toContain('New words.');
    await r.click(r.btn('Keep mine'));
    expect(r.keeps).toEqual([{ sectionId: 'hpi', text: 'Mine.' }]);
    await r.click(r.btn('Take the new text'));
    expect(r.clears).toEqual(['hpi']);
  });

  it('read-only (a finished sheet): no Edit, no stale question', async () => {
    const r = await render(narrative({ stale: true, edited: 'x', content: 'x' }), 'idle', true);
    expect(r.el.querySelector('[aria-label="Edit History"]')).toBeNull();
    expect(r.el.textContent).not.toContain('Keep mine');
  });

  describe('grid tables (Phase 5)', () => {
    const table = (fieldKey: string, label: string, order: number | null = null) => ({
      fieldKey,
      label,
      order,
      rowHeader: 'Tooth',
      headerGroups: null,
      columns: ['Status'],
      rows: [{ label: '18', labelSpan: 1, cells: [{ text: 'Caries', colSpan: 1 }] }],
    });

    it('a section\'s tables print under its words, and stay while the doctor edits the words', async () => {
      const r = await render(narrative({ tables: [table('teeth', 'Dental chart')] }));
      const sec = r.el.querySelector('[data-section="hpi"]')!;
      expect(sec.querySelector('fe-narrative-table[data-table="teeth"] td')?.textContent).toBe('Caries');
      await r.click(r.el.querySelector('[aria-label="Edit History"]')!);
      expect(r.el.querySelector('[data-section="hpi"] fe-narrative-table')).toBeTruthy();
    });

    it('a table whose section wrote no words shows where that section would be', async () => {
      const n = narrative();
      n.sections.push({ id: 'plan', key: 'plan', title: 'Plan', order: 5, generated: 'Review.', edited: null, stale: false, content: 'Review.', own: false, formTitle: null });
      n.tables = [table('teeth', 'Dental chart', 3)];
      const r = await render(n);
      const order = [...r.el.querySelectorAll('[data-section], [data-section-table]')].map(
        (e) => e.getAttribute('data-section') ?? 'table:' + e.getAttribute('data-section-table'),
      );
      expect(order).toEqual(['hpi', 'table:teeth', 'plan']);
      expect(r.el.querySelector('[data-section-table="teeth"] .fe-ntable__label')?.textContent).toBe('Dental chart');
    });
  });
});
