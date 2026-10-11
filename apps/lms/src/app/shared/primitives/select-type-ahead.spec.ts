import { Component, ViewChild, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PfSelectOption, SelectComponent } from './select.component';
import { TYPE_AHEAD_RESET_MS } from '../utils/type-ahead';

/**
 * Type-to-select (owner 2026-10-11): every single pf-select picks from the
 * keyboard while CLOSED — letters/digits select the closest option, arrows
 * step, Enter commits (and advances in result entry), Escape reverts. The
 * pick flows through the ordinary `valueChange` exactly ONCE per commit.
 */
@Component({
  standalone: true,
  imports: [SelectComponent],
  template: `
    <div class="wrap" (keydown.enter)="advanced = advanced + 1">
      <pf-select #sel [options]="opts" [value]="value()" [enterAdvances]="enterAdvances"
                 [typeAhead]="typeAhead" [allowCreate]="allowCreate" [searchable]="allowCreate"
                 [multiple]="multiple"
                 (valueChange)="onChange($event)"></pf-select>
    </div>
    <button class="elsewhere">elsewhere</button>
  `,
})
class HostComponent {
  @ViewChild('sel') sel!: SelectComponent<string>;
  opts: PfSelectOption<string>[] = [
    { value: '', label: '—' },
    { value: 'Positive', label: 'Positive' },
    { value: 'Negative', label: 'Negative' },
    { value: 'Nil', label: 'Nil' },
    { value: 'Preliminary', label: 'Preliminary' },
    { value: '1+', label: '1+' },
    { value: '1++', label: '1++' },
  ];
  value = signal<string>('');
  enterAdvances = false;
  typeAhead: boolean | undefined = undefined;
  allowCreate = false;
  multiple = false;
  advanced = 0;
  /** Stands in for the result-entry setValue → flag + autosave path. */
  saves: string[] = [];
  onChange(v: string) { this.saves.push(v); this.value.set(v); }
}

let clock = 10_000;

function setup(init: Partial<Pick<HostComponent, 'enterAdvances' | 'typeAhead' | 'allowCreate' | 'multiple'>> & { value?: string } = {}) {
  const f = TestBed.createComponent(HostComponent);
  const h = f.componentInstance;
  const { value, ...flags } = init;
  Object.assign(h, flags);
  if (value !== undefined) h.value.set(value);
  document.body.appendChild(f.nativeElement);
  f.detectChanges();
  h.sel.now = () => clock;
  const trigger = () => f.nativeElement.querySelector('.pf-dd__trigger') as HTMLElement;
  trigger().focus();
  const key = (k: string, mods: KeyboardEventInit = {}) => {
    const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods });
    trigger().dispatchEvent(ev);
    f.detectChanges();
    return ev;
  };
  const type = (s: string) => { for (const ch of s) { key(ch); clock += 50; } };
  const shown = () => (f.nativeElement.querySelector('.pf-dd__value') as HTMLElement)?.textContent?.trim();
  return { f, h, key, type, shown, trigger };
}

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});
beforeEach(() => { clock += 10 * TYPE_AHEAD_RESET_MS; });
afterEach(() => {
  document.body.querySelectorAll('#pf-overlay-host').forEach(n => n.remove());
  document.body.innerHTML = '';
});

describe('pf-select type-to-select (closed field)', () => {
  it('a letter shows the first matching option instantly, without opening or emitting yet', () => {
    const { h, type, shown } = setup();
    type('P');
    expect(shown()).toBe('Positive');
    expect(h.sel.isOpen()).toBe(false);
    expect(h.saves).toEqual([]);
  });

  it('typing more letters within the window narrows by prefix ("PR" → Preliminary)', () => {
    const { type, shown } = setup();
    type('pr');
    expect(shown()).toBe('Preliminary');
  });

  it('the same letter again cycles P → Positive → Preliminary → Positive', () => {
    const { type, shown } = setup();
    type('p'); expect(shown()).toBe('Positive');
    type('p'); expect(shown()).toBe('Preliminary');
    type('p'); expect(shown()).toBe('Positive');
  });

  it('a pause longer than the window starts a new query', () => {
    const { type, shown } = setup();
    type('n'); expect(shown()).toBe('Negative');
    clock += TYPE_AHEAD_RESET_MS + 1;
    type('i'); // fresh "i" — nothing starts with it → keeps Negative
    expect(shown()).toBe('Negative');
    clock += TYPE_AHEAD_RESET_MS + 1;
    type('ni');
    expect(shown()).toBe('Nil');
  });

  it('digits + symbols: "1+" is exact, not "1++"', () => {
    const { type, shown } = setup();
    type('1+');
    expect(shown()).toBe('1+');
  });

  it('ArrowDown / ArrowUp step through options without opening (wrapping like the open list)', () => {
    const { h, key, shown } = setup({ value: 'Positive' });
    key('ArrowDown'); expect(shown()).toBe('Negative');
    key('ArrowDown'); expect(shown()).toBe('Nil');
    key('ArrowUp'); key('ArrowUp'); key('ArrowUp');
    expect(shown()).toBe('—');
    key('ArrowUp'); // wraps to the last option
    expect(shown()).toBe('1++');
    expect(h.sel.isOpen()).toBe(false);
    expect(h.saves).toEqual([]);
  });

  it('Enter commits exactly once through valueChange (the flag/autosave path)', () => {
    const { h, type, key } = setup();
    type('po');
    const ev = key('Enter');
    expect(h.saves).toEqual(['Positive']);
    expect(h.value()).toBe('Positive');
    expect(ev.defaultPrevented).toBe(true); // elsewhere Enter only commits
    expect(h.advanced).toBe(0);
    expect(h.sel.isOpen()).toBe(false);
  });

  it('enterAdvances: Enter commits once AND bubbles to the host next-field handler', () => {
    const { h, type, key } = setup({ enterAdvances: true });
    type('n');
    const ev = key('Enter');
    expect(h.saves).toEqual(['Negative']);
    expect(h.advanced).toBe(1);
    expect(ev.defaultPrevented).toBe(false);
    expect(h.sel.changeSource).toBe('enter');
  });

  it('Escape reverts to the value before typing and emits nothing', () => {
    const { h, type, key, shown } = setup({ value: 'Negative' });
    type('ni'); key('ArrowDown');
    expect(shown()).toBe('Preliminary');
    const ev = key('Escape');
    expect(ev.defaultPrevented).toBe(true);
    expect(shown()).toBe('Negative');
    expect(h.saves).toEqual([]);
  });

  it('Escape with nothing typed is left alone (bubbles — dialogs still close)', () => {
    const { key } = setup({ value: 'Negative' });
    const ev = key('Escape');
    expect(ev.defaultPrevented).toBe(false);
  });

  it('leaving the field (Tab / click elsewhere) commits once', () => {
    const { f, h, type, trigger } = setup();
    type('ni');
    const other = f.nativeElement.querySelector('.elsewhere') as HTMLElement;
    trigger().dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: other }));
    expect(h.saves).toEqual(['Nil']);
    expect(h.sel.changeSource).toBe('blur');
  });

  it('committing the value already set emits nothing', () => {
    const { h, type, key } = setup({ value: 'Positive' });
    type('po');
    key('Enter');
    expect(h.saves).toEqual([]);
  });

  it('Alt+ArrowDown opens the full list focused on the typed option; Enter there picks once', () => {
    const { h, type, key } = setup();
    type('pr');
    key('ArrowDown', { altKey: true });
    expect(h.sel.isOpen()).toBe(true);
    const focused = document.querySelector('.pf-dd__option--focused')?.textContent?.trim();
    expect(focused).toBe('Preliminary');
    key('Enter');
    expect(h.saves).toEqual(['Preliminary']);
    expect(h.sel.isOpen()).toBe(false);
  });

  it('Space (no query being typed) and Enter (nothing typed) still open the list', () => {
    const a = setup();
    a.key(' ');
    expect(a.h.sel.isOpen()).toBe(true);
    document.body.innerHTML = '';
    const b = setup();
    b.key('Enter');
    expect(b.h.sel.isOpen()).toBe(true);
  });

  it('open list: typing moves the focus ring with the same matcher and highlights the typed run', () => {
    const { h, key, type } = setup();
    key(' ');
    expect(h.sel.isOpen()).toBe(true);
    type('ne');
    const focused = document.querySelector('.pf-dd__option--focused');
    expect(focused?.textContent?.trim()).toBe('Negative');
    expect(document.querySelector('.pf-dd__option--focused .pf-dd__hl')?.textContent).toBe('Ne');
  });

  it('screen readers: the landed option is announced and the open list exposes aria-activedescendant', () => {
    const { f, h, type, key, trigger } = setup();
    type('neg');
    expect((f.nativeElement.querySelector('.pf-dd__sr') as HTMLElement).textContent?.trim()).toBe('Negative');
    key('ArrowDown', { altKey: true });
    const id = trigger().getAttribute('aria-activedescendant');
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)?.textContent?.trim()).toBe('Negative');
    expect(h.sel.isOpen()).toBe(true);
  });

  it('opt-out [typeAhead]="false" keeps the classic model (ArrowDown opens, letters do nothing closed)', () => {
    const { h, key, type, shown } = setup({ typeAhead: false });
    type('p');
    expect(shown()).toBe('—');
    key('ArrowDown');
    expect(h.sel.isOpen()).toBe(true);
  });

  it('allow-create (free-text) comboboxes are off by default', () => {
    const { h } = setup({ allowCreate: true });
    expect(h.sel.typeAheadOn).toBe(false);
  });

  it('multi-select is never type-to-select', () => {
    const { h } = setup({ multiple: true });
    expect(h.sel.typeAheadOn).toBe(false);
  });

  it('a letter with no match is ignored (no value change, event not cancelled)', () => {
    const { h, key, shown } = setup({ value: 'Nil' });
    const ev = key('z');
    expect(shown()).toBe('Nil');
    expect(ev.defaultPrevented).toBe(false);
    expect(h.saves).toEqual([]);
  });

  it('modifier chords (Ctrl/Cmd+letter) are never captured', () => {
    const { key, shown } = setup({ value: 'Nil' });
    const ev = key('p', { ctrlKey: true });
    expect(ev.defaultPrevented).toBe(false);
    expect(shown()).toBe('Nil');
  });
});
