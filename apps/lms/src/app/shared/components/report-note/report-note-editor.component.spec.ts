import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ReportNoteEditorComponent } from './report-note-editor.component';
import { ReportNoteViewComponent } from './report-note-view.component';

/** The technician report-note editor (owner 2026-09-30): textarea + the
 *  Cortex formatting set, shortcuts, live preview, the 1000 cap. */
function make(initial = '', max = 1000) {
  const f = TestBed.createComponent(ReportNoteEditorComponent);
  f.componentRef.setInput('initial', initial);
  f.componentRef.setInput('label', 'Report note — Glucose');
  f.componentRef.setInput('max', max);
  f.componentRef.setInput('autofocus', false);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const ta = el.querySelector('textarea')!;
  const saved = vi.fn(); const cancelled = vi.fn();
  f.componentInstance.saved.subscribe(saved);
  f.componentInstance.cancelled.subscribe(cancelled);
  const type = (v: string) => { ta.value = v; ta.dispatchEvent(new Event('input')); f.detectChanges(); };
  const select = (a: number, b: number) => ta.setSelectionRange(a, b);
  const key = (k: string, mods: Partial<KeyboardEventInit> = {}) => {
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods }));
    f.detectChanges();
  };
  const tool = (name: string) => { el.querySelector<HTMLButtonElement>(`[data-rne="${name}"]`)!.click(); f.detectChanges(); };
  const saveBtn = () => el.querySelector<HTMLButtonElement>('.pf-rne__save')!;
  return { f, el, ta, saved, cancelled, type, select, key, tool, saveBtn };
}

describe('pf-report-note-editor', () => {
  it('toolbar: every Cortex tool is an SVG icon button with an accessible name', () => {
    const { el } = make();
    const tools = [...el.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button')];
    expect(tools.map(b => b.getAttribute('aria-label'))).toEqual(['Bold', 'Italic', 'Underline', 'Bulleted list', 'Numbered list']);
    expect(tools.every(b => b.querySelector('svg[aria-hidden="true"]'))).toBe(true);
    expect(el.querySelector('select, datalist, [contenteditable]')).toBeNull();
    expect(el.querySelector('textarea')!.getAttribute('aria-label')).toBe('Report note — Glucose');
  });

  it('B / I / U wrap the selection; the preview prints it formatted', () => {
    const { ta, type, select, tool, el } = make();
    type('Hb low today');
    select(3, 6); tool('bold');
    expect(ta.value).toBe('Hb **low** today');
    select(11, 16); tool('italic');
    expect(ta.value).toBe('Hb **low** _today_');
    const preview = el.querySelector('.pf-rne__preview')!;
    expect(preview.querySelector('.pf-rnv__b')!.textContent).toBe('low');
    expect(preview.querySelector('.pf-rnv__i')!.textContent).toBe('today');
  });

  it('Ctrl/Cmd+B / I / U format the selection', () => {
    const { ta, type, select, key } = make();
    type('abc def');
    select(0, 3); key('b', { ctrlKey: true });
    expect(ta.value).toBe('**abc** def');
    select(8, 11); key('u', { metaKey: true });
    expect(ta.value).toBe('**abc** __def__');
  });

  it('list buttons + Enter continue the list; Enter on an empty item ends it', () => {
    const { ta, type, select, tool, key } = make();
    type('first\nsecond');
    select(0, ta.value.length); tool('ol');
    expect(ta.value).toBe('1. first\n2. second');
    select(ta.value.length, ta.value.length); key('Enter');
    expect(ta.value).toBe('1. first\n2. second\n3. ');
    key('Enter');
    expect(ta.value).toBe('1. first\n2. second\n');
  });

  it('saves the cleaned note; Ctrl+Enter saves, Esc cancels; unchanged = nothing to save', () => {
    const { type, saved, cancelled, key, saveBtn } = make('kept');
    expect(saveBtn().disabled).toBe(true);
    type('\n**new** note  \n\n');
    expect(saveBtn().disabled).toBe(false);
    saveBtn().click();
    expect(saved).toHaveBeenLastCalledWith('**new** note');
    type('again');
    key('Enter', { ctrlKey: true });
    expect(saved).toHaveBeenLastCalledWith('again');
    key('Escape');
    expect(cancelled).toHaveBeenCalled();
  });

  it('over the cap: counter turns red, an alert shows, save is off', () => {
    const { type, el, saveBtn } = make('', 10);
    type('01234567890');
    expect(el.querySelector('.pf-rne__count')!.textContent).toContain('11 / 10');
    expect(el.querySelector('.pf-rne__count--over')).not.toBeNull();
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('10 characters');
    expect(saveBtn().disabled).toBe(true);
  });

  it('an existing note can be removed (saves empty)', () => {
    const { el, saved, f } = make('old note');
    el.querySelector<HTMLButtonElement>('.pf-rne__remove')!.click();
    f.detectChanges();
    expect(saved).toHaveBeenLastCalledWith('');
  });
});

describe('pf-report-note-view — never HTML', () => {
  it('renders markup as elements and typed HTML as text', () => {
    const f = TestBed.createComponent(ReportNoteViewComponent);
    f.componentRef.setInput('text', '<img src=x onerror="alert(1)"> **<b>x</b>**\n- one\n2. two');
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('img, script, b')).toBeNull();
    expect(el.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(el.querySelector('.pf-rnv__b')!.textContent).toBe('<b>x</b>');
    expect(el.querySelector('ul li')!.textContent).toBe('one');
    expect(el.querySelector('ol')!.getAttribute('start')).toBe('2');
  });
});
