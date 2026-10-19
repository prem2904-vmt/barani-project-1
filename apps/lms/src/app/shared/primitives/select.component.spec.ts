import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { SelectComponent } from './select.component';

/**
 * Regression: a searchable single pf-select closed the instant it opened in
 * Chrome. Opening swaps the trigger <button> for the search input; Chrome
 * focuses buttons on click (WebKit doesn't), so the outgoing button fires
 * focusout with relatedTarget=null — which used to close the panel.
 */
describe('SelectComponent focusout', () => {
  function make(opts: { searchable: boolean; multiple: boolean }) {
    const fixture = TestBed.createComponent(SelectComponent<string>);
    const c = fixture.componentInstance;
    c.options = [{ value: 'mg/dL', label: 'mg/dL' }];
    c.searchable = opts.searchable;
    c.multiple = opts.multiple;
    c.isOpen.set(true);
    const close = vi.spyOn(c as unknown as { closePanel: () => void }, 'closePanel').mockImplementation(() => {});
    return { c, close };
  }

  function blurFrom(el: Element): FocusEvent {
    const ev = new FocusEvent('focusout', { relatedTarget: null });
    Object.defineProperty(ev, 'target', { value: el });
    return ev;
  }

  it('ignores the trigger button blur caused by its own open (searchable single)', () => {
    const { c, close } = make({ searchable: true, multiple: false });
    const btn = document.createElement('button');
    btn.className = 'pf-dd__trigger';
    c.onFocusOut(blurFrom(btn));
    expect(close).not.toHaveBeenCalled();
  });

  it('still closes when focus leaves the search input', () => {
    const { c, close } = make({ searchable: true, multiple: false });
    c.onFocusOut(blurFrom(document.createElement('input')));
    expect(close).toHaveBeenCalled();
  });

  it('non-searchable selects keep the old behaviour', () => {
    const { c, close } = make({ searchable: false, multiple: false });
    const btn = document.createElement('button');
    btn.className = 'pf-dd__trigger';
    c.onFocusOut(blurFrom(btn));
    expect(close).toHaveBeenCalled();
  });
});
