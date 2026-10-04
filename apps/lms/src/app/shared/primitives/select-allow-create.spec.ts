import { TestBed } from '@angular/core/testing';
import { SelectComponent } from './select.component';

/**
 * pf-select allowCreate (owner 2026-09-28, Test Master → Methodology): typing a
 * value the list does not hold must be OBVIOUS — the panel offers a
 * "Use “<typed>”" row, and picking it emits the typed text as the value.
 */
describe('SelectComponent allowCreate', () => {
  function make(over: { allowCreate?: boolean; multiple?: boolean } = {}) {
    const fixture = TestBed.createComponent(SelectComponent<string>);
    const c = fixture.componentInstance;
    c.options = [
      { value: '', label: '— no methodology —' },
      { value: 'Hexokinase', label: 'Hexokinase' },
      { value: 'GOD-POD', label: 'GOD-POD' },
    ];
    c.searchable = true;
    c.allowCreate = over.allowCreate ?? true;
    c.multiple = over.multiple ?? false;
    c.createHint = 'Not in the list';
    return { fixture, c };
  }

  it('offers a create row for text that matches no option', () => {
    const { c } = make();
    c.search.set('Modified Arsenazo III');
    const opts = c.visibleOpts();
    expect(opts).toHaveLength(1);
    expect(opts[0]).toMatchObject({ value: 'Modified Arsenazo III', label: 'Modified Arsenazo III', create: true, hint: 'Not in the list' });
  });

  it('keeps the partial matches first, the create row last', () => {
    const { c } = make();
    c.search.set('Hexo');
    const opts = c.visibleOpts();
    expect(opts.map(o => o.label)).toEqual(['Hexokinase', 'Hexo']);
    expect(opts[1].create).toBe(true);
  });

  it('no create row when the text already IS an option (case-insensitive)', () => {
    const { c } = make();
    c.search.set('  hexokinase ');
    expect(c.visibleOpts().some(o => o.create)).toBe(false);
  });

  it('no create row with an empty search, without allowCreate, or in multi mode', () => {
    const a = make();
    a.c.search.set('   ');
    expect(a.c.visibleOpts().some(o => o.create)).toBe(false);
    const b = make({ allowCreate: false });
    b.c.search.set('Nephelometry X');
    expect(b.c.visibleOpts()).toHaveLength(0);
    const m = make({ multiple: true });
    m.c.search.set('Nephelometry X');
    expect(m.c.visibleOpts().some(o => o.create)).toBe(false);
  });

  it('picking the create row emits the typed text', () => {
    const { c } = make();
    const got: string[] = [];
    c.valueChange.subscribe(v => got.push(v));
    c.search.set('Modified Arsenazo III');
    c.pick(c.visibleOpts()[0]);
    expect(got).toEqual(['Modified Arsenazo III']);
  });

  it('Enter in the search box picks the create row when nothing else matches', () => {
    const { c } = make();
    const got: string[] = [];
    c.valueChange.subscribe(v => got.push(v));
    c.onSearchInput('CHOD-PAP');
    c.onPanelKey(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(got).toEqual(['CHOD-PAP']);
  });

  it('a SPACE typed in the search box is text, never a pick (multi-word methods)', () => {
    const { c } = make();
    const got: string[] = [];
    c.valueChange.subscribe(v => got.push(v));
    c.isOpen.set(true);
    c.onSearchInput('Modified');
    const input = document.createElement('input');
    input.className = 'pf-dd__combox';
    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true });
    Object.defineProperty(space, 'target', { value: input });
    c.onKey(space);                       // the host listener sees the bubbled key
    expect(got).toEqual([]);
    expect(space.defaultPrevented).toBe(false);
  });

  it('renders the row as "Use “…”" with its hint', () => {
    const { fixture, c } = make();
    fixture.detectChanges();
    c.onSearchInput('LC-MS/MS');
    // The panel is portalled to <body>; open it to render.
    (c as unknown as { openPanel: () => void }).openPanel();
    c.onSearchInput('LC-MS/MS');
    const row = document.querySelector('.pf-dd__option--create');
    expect(row?.textContent).toContain('Use “LC-MS/MS”');
    expect(row?.textContent).toContain('Not in the list');
    (c as unknown as { closePanel: () => void }).closePanel();
  });
});
