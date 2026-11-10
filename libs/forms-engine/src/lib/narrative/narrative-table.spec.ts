import { TestBed } from '@angular/core/testing';
import preview from '../testing/grid-narrative.preview.json';
import { NarrativeTable, narrativeEntries, toNarrativeTables } from './narrative-table';
import { NarrativeTableComponent } from './narrative-table.component';

/** A real `POST /api/narrative/preview` response for testing/grid-kinds.form.json (Phase 5 API, 2026-11-02). */
const exam = (preview as { sections: { key: string; tables?: unknown }[] }).sections.find((s) => s.key === 'exam')!;
const tables = toNarrativeTables(exam.tables);

describe('narrative tables: reading the API', () => {
  it('reads the tables of a section (cells already in words, "-" when empty)', () => {
    expect(tables.map((t) => t.fieldKey)).toEqual(['teeth', 'anterior', 'vision']);
    const teeth = tables[0];
    expect(teeth.rowHeader).toBe('Tooth');
    expect(teeth.headerGroups).toEqual([
      { label: 'Findings', span: 2 },
      { label: 'Gums', span: 2 },
      { label: '', span: 1 },
    ]);
    expect(teeth.columns).toEqual(['Status', 'Mobility', 'Pocket', 'Bleeding', 'Note']);
    expect(teeth.rows[0]).toEqual({
      label: '18',
      labelSpan: 1,
      cells: ['Caries', '-', '4 mm', '-', '-'].map((text) => ({ text, colSpan: 1 })),
    });
    expect(teeth.rows[1].cells[3].text).toBe('Yes');
  });

  it('never breaks on an odd response', () => {
    expect(toNarrativeTables(undefined)).toEqual([]);
    expect(toNarrativeTables([{ rows: [{ cells: [{}] }] }])[0]).toEqual({
      fieldKey: '',
      label: '',
      order: null,
      rowHeader: '',
      headerGroups: null,
      columns: [],
      rows: [{ label: null, labelSpan: 1, cells: [{ text: '-', colSpan: 1 }] }],
    });
  });

  it('a table whose section wrote no words goes where that section would be', () => {
    const t = (fieldKey: string, order: number | null) => ({ ...tables[0], fieldKey, order }) as NarrativeTable;
    const sections = [
      { id: 'a', order: 1 },
      { id: 'b', order: 3 },
    ];
    const e = narrativeEntries(sections, [t('late', null), t('two', 2), t('one', 1)]);
    expect(e.map((x) => (x.kind === 'section' ? x.section.id : x.table.fieldKey))).toEqual(['a', 'one', 'two', 'b', 'late']);
  });
});

describe('narrative tables: on screen', () => {
  async function render(table: NarrativeTable, sectionTitle: string | null = null) {
    TestBed.resetTestingModule();
    const f = TestBed.createComponent(NarrativeTableComponent);
    f.componentRef.setInput('table', table);
    f.componentRef.setInput('sectionTitle', sectionTitle);
    f.detectChanges();
    await f.whenStable();
    return f.nativeElement as HTMLElement;
  }

  it('the merged heading band, headings, row labels and cells', async () => {
    const el = await render(tables[0]);
    const head = el.querySelectorAll('thead tr');
    expect(head).toHaveLength(2);
    expect([...head[0].querySelectorAll('th')].map((h) => [h.textContent?.trim(), h.getAttribute('colspan')])).toEqual([
      ['', null],
      ['Findings', '2'],
      ['Gums', '2'],
      ['', '1'],
    ]);
    expect([...head[1].querySelectorAll('th')].map((h) => h.textContent?.trim())).toEqual(['Tooth', 'Status', 'Mobility', 'Pocket', 'Bleeding', 'Note']);
    expect(el.querySelectorAll('tbody tr')).toHaveLength(32);
    expect(el.querySelector('tbody tr th')?.textContent?.trim()).toBe('18');
    expect(el.querySelectorAll('tbody tr')[0].querySelectorAll('td.fe-ntable__empty')).toHaveLength(3);
    expect(el.querySelector('.fe-ntable__label')?.textContent).toBe('Dental chart');
  });

  it('merged row labels and merged cells', async () => {
    const t: NarrativeTable = {
      fieldKey: 'r',
      label: 'Reflexes',
      order: null,
      rowHeader: 'Reflex',
      headerGroups: null,
      columns: ['Right', 'Left'],
      rows: [
        { label: 'Upper limb', labelSpan: 2, cells: [{ text: 'Normal', colSpan: 2 }] },
        { label: null, labelSpan: 1, cells: [{ text: 'Brisk', colSpan: 1 }, { text: '-', colSpan: 1 }] },
      ],
    };
    const el = await render(t, 'Reflexes');
    const rows = el.querySelectorAll('tbody tr');
    expect(rows[0].querySelector('th')?.getAttribute('rowspan')).toBe('2');
    expect(rows[0].querySelector('td')?.getAttribute('colspan')).toBe('2');
    expect(rows[1].querySelector('th')).toBeNull();
    // the grid's name is not repeated when it is the section's title
    expect(el.querySelector('.fe-ntable__label')).toBeNull();
  });
});
