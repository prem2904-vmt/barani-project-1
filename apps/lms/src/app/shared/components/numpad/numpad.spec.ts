import { ApplicationRef, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { NumpadDirective, NumpadScopeDirective } from './numpad.directive';
import { NumpadFlag, NumpadService } from './numpad.service';
import { NumpadPanelComponent } from './numpad-panel.component';
import { backspaceText, insertText, parseKeySet } from './numpad-keys';
import { navigableFields, nextField, placePopover } from './numpad-nav';

/**
 * The result numpad (shared/components/numpad): keys go through the field's
 * OWN keydown validator, Next walks down the list skipping calculated /
 * read-only / hidden fields, a dropdown in between opens, the last field
 * reads Done and lands on the CTA; desktop + hardware keyboards untouched.
 */

/** The validator the result screens use today (allowOnlyNumbers, verbatim
 *  rules): digits, one '.', one '-', navigation keys; nothing else. */
function allowOnlyNumbers(event: KeyboardEvent) {
  const key = event.key;
  if (['Backspace', 'Tab', 'Enter', 'Escape', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)
    || event.ctrlKey || event.metaKey || event.altKey) return;
  const val = (event.target as HTMLInputElement | null)?.value || '';
  if (key === '.' && !val.includes('.')) return;
  if (key === '-' && !val.includes('-')) return;
  if (!/^[0-9]$/.test(key)) event.preventDefault();
}

@Component({
  standalone: true,
  imports: [NumpadDirective, NumpadScopeDirective],
  template: `
    <div class="scope" pfNumpadScope="[data-f]" pfNumpadCta=".cta">
      <input data-f class="a" type="text" pfNumpad pfNumpadLabel="Haemoglobin" pfNumpadUnit="g/dL"
             [pfNumpadFlag]="flag()" (keydown)="allowOnlyNumbers($event)" (input)="aVal.set($any($event.target).value)"
             (change)="changes = changes + 1" />
      <input data-f class="calc" type="text" pfNumpad data-numpad-skip (keydown)="allowOnlyNumbers($event)" />
      <input data-f class="ro" type="text" pfNumpad readonly />
      <input data-f class="off" type="text" pfNumpad disabled />
      <input data-f class="gone" type="text" pfNumpad style="display:none" />
      <div data-f class="sel"><button type="button" class="pf-dd__trigger" (click)="opened = opened + 1">Pick</button></div>
      <input data-f class="mic" type="number" pfNumpad pfNumpadKeys="digits . < >" />
      <input data-f class="b" type="text" pfNumpad (keydown)="allowOnlyNumbers($event)" (keydown.enter)="enters = enters + 1" />
      <button type="button" class="cta">Submit</button>
    </div>
    <input class="free" type="text" [pfNumpad]="enabled()" inputmode="decimal" />
  `,
})
class HostComponent {
  readonly allowOnlyNumbers = allowOnlyNumbers;
  readonly flag = signal<NumpadFlag | null>(null);
  readonly aVal = signal('');
  readonly enabled = signal(true);
  changes = 0;
  opened = 0;
  enters = 0;
}

function touchDown(el: Element) {
  el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
}

async function setup(opts: { touch?: boolean; reduced?: boolean } = {}) {
  TestBed.configureTestingModule({});
  const svc = TestBed.inject(NumpadService);
  svc.touch.set(opts.touch ?? true);
  svc.reducedMotion.set(!!opts.reduced);
  const f = TestBed.createComponent(HostComponent);
  f.detectChanges();
  const appRef = TestBed.inject(ApplicationRef);
  const root = f.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLInputElement>(s: string) => root.querySelector(s) as T;
  const tick = () => { f.detectChanges(); appRef.tick(); };
  const pad = () => document.body.querySelector('.pf-np') as HTMLElement | null;
  const key = (k: string) => pad()!.querySelector(`[data-key="${k}"]`) as HTMLButtonElement;
  /** Tap a field with a finger (pointerdown → focus), as on an iPad. */
  const tapField = (el: HTMLElement) => { touchDown(el); el.focus(); tick(); };
  const press = (...keys: string[]) => { for (const k of keys) { key(k).click(); tick(); } };
  return { f, svc, root, q, tick, pad, key, tapField, press, host: f.componentInstance };
}

afterEach(() => {
  document.body.querySelectorAll('pf-numpad-panel').forEach(n => n.remove());
});

describe('numpad keys (pure edits)', () => {
  it('inserts at the caret and replaces a selection', () => {
    expect(insertText('12', 2, 2, '3')).toEqual({ value: '123', caret: 3 });
    expect(insertText('12', 1, 1, '.')).toEqual({ value: '1.2', caret: 2 });
    expect(insertText('999', 0, 3, '4')).toEqual({ value: '4', caret: 1 });
    expect(insertText('7', null, null, '5')).toEqual({ value: '75', caret: 2 });
  });
  it('backspace deletes the selection or one char before the caret', () => {
    expect(backspaceText('123', 3, 3)).toEqual({ value: '12', caret: 2 });
    expect(backspaceText('123', 1, 1)).toEqual({ value: '23', caret: 0 });
    expect(backspaceText('123', 0, 3)).toEqual({ value: '', caret: 0 });
    expect(backspaceText('123', 0, 0)).toEqual({ value: '123', caret: 0 });
  });
  it('key sets: all by default, digits always', () => {
    expect([...parseKeySet(null)].sort()).toEqual(['-', '.', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '<', '>'].sort());
    const mm = parseKeySet('digits .');
    expect(mm.has('.')).toBe(true);
    expect(mm.has('-')).toBe(false);
    expect(mm.has('<')).toBe(false);
    expect(mm.has('7')).toBe(true);
  });
});

describe('popover placement', () => {
  const vp = { width: 1024, height: 1366 };
  const pad = { width: 272, height: 330 };
  it('prefers below the field, aligned to it', () => {
    expect(placePopover({ top: 100, left: 300, width: 120, height: 40 }, pad, vp)).toEqual({ top: 148, left: 300, placement: 'below' });
  });
  it('flips above when there is no room below', () => {
    const s = placePopover({ top: 1200, left: 300, width: 120, height: 40 }, pad, vp)!;
    expect(s.placement).toBe('above');
    expect(s.top + pad.height).toBeLessThanOrEqual(1200);
  });
  it('goes to the side on a short viewport, never covering the field', () => {
    const field = { top: 300, left: 200, width: 120, height: 40 };
    const s = placePopover(field, pad, { width: 1366, height: 640 })!;
    expect(s.placement).toBe('right');
    expect(s.left).toBeGreaterThanOrEqual(field.left + field.width);
    const l = placePopover({ ...field, left: 1100 }, pad, { width: 1366, height: 640 })!;
    expect(l.placement).toBe('left');
    expect(l.left + pad.width).toBeLessThanOrEqual(1100);
  });
  it('clamps horizontally inside the viewport', () => {
    const s = placePopover({ top: 100, left: 900, width: 100, height: 40 }, pad, vp)!;
    expect(s.left + pad.width).toBeLessThanOrEqual(vp.width - 8);
  });
  it('returns null when nothing fits (the caller docks a sheet)', () => {
    expect(placePopover({ top: 100, left: 10, width: 360, height: 40 }, pad, { width: 390, height: 420 })).toBeNull();
  });
});

describe('pfNumpad — desktop / fine pointer', () => {
  it('changes nothing: inputmode, type and focus behave as before', async () => {
    const { q, pad, tapField } = await setup({ touch: false });
    const free = q('.free');
    expect(free.getAttribute('inputmode')).toBe('decimal');
    expect(q('.mic').type).toBe('number');
    expect(q('.a').hasAttribute('inputmode')).toBe(false);
    tapField(q('.a'));
    expect(pad()).toBeNull();
  });
});

describe('pfNumpad — touch', () => {
  it('suppresses the system keyboard with inputmode=none (never readonly) and keeps partial numbers typable', async () => {
    const { q, host, tick } = await setup();
    const a = q('.a');
    expect(a.getAttribute('inputmode')).toBe('none');
    expect(a.readOnly).toBe(false);
    expect(q('.mic').type).toBe('text');
    // Turning it off restores the original inputmode.
    expect(q('.free').getAttribute('inputmode')).toBe('none');
    host.enabled.set(false);
    tick();
    expect(q('.free').getAttribute('inputmode')).toBe('decimal');
  });

  it('opens on a finger tap as a labelled group of buttons; focus stays on the field', async () => {
    const { q, pad, tapField } = await setup();
    const a = q('.a');
    tapField(a);
    const p = pad()!;
    expect(p).not.toBeNull();
    expect(p.getAttribute('role')).toBe('group');
    expect(p.getAttribute('aria-label')).toBe('Number pad');
    const keys = Array.from(p.querySelectorAll('button'));
    expect(keys.length).toBeGreaterThan(14);
    expect(keys.every(b => b.getAttribute('aria-label'))).toBe(true);
    expect(p.textContent).toContain('Haemoglobin');
    expect(p.textContent).toContain('g/dL');
    expect(document.activeElement).toBe(a);
    // A pointerdown on the pad is cancelled so the field never loses focus.
    const ev = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch' });
    p.querySelector('[data-key="7"]')!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('does not pop up for programmatic / Tab focus', async () => {
    const { q, pad, tick } = await setup();
    q('.a').focus();
    tick();
    expect(pad()).toBeNull();
  });

  it('types digits and decimals through the field validator (live value + input events)', async () => {
    const { q, host, pad, tapField, press } = await setup();
    const a = q('.a');
    tapField(a);
    press('1', '2', '.', '5');
    expect(a.value).toBe('12.5');
    expect(host.aVal()).toBe('12.5');
    expect(pad()!.querySelector('.pf-np__value')!.textContent).toContain('12.5');
    // A second '.' is refused by today's validator: value unchanged, key dimmed.
    press('.');
    expect(a.value).toBe('12.5');
    expect(pad()!.querySelector('[data-key="."]')!.getAttribute('aria-disabled')).toBe('true');
  });

  it('minus once, and < / > only where the field validator allows them', async () => {
    const { q, pad, tapField, press } = await setup();
    const a = q('.a');
    tapField(a);
    press('-', '4');
    expect(a.value).toBe('-4');
    press('-');
    expect(a.value).toBe('-4');
    // allowOnlyNumbers blocks < and > today → the keys are shown but refuse.
    expect(pad()!.querySelector('[data-key="<"]')!.getAttribute('aria-disabled')).toBe('true');
    press('<', '>');
    expect(a.value).toBe('-4');

    // A field with no such rule (MIC) takes them: "<0.5".
    const mic = q('.mic');
    tapField(mic);
    expect(pad()!.querySelector('[data-key="<"]')!.getAttribute('aria-disabled')).toBeNull();
    expect(pad()!.querySelector('[data-key="-"]')).toBeNull();   // not in its key set
    press('<', '0', '.', '5');
    expect(mic.value).toBe('<0.5');
  });

  it('replaces the selected text (Next selects the value, first key overwrites)', async () => {
    const { q, tapField, press } = await setup();
    const a = q('.a');
    a.value = '999';
    tapField(a);
    a.setSelectionRange(0, 3);
    press('4');
    expect(a.value).toBe('4');
  });

  it('backspace deletes one; a long press clears the field', async () => {
    const { q, key, tick, tapField, press } = await setup();
    const a = q('.a');
    tapField(a);
    press('1', '2', '3', 'backspace');
    expect(a.value).toBe('12');
    vi.useFakeTimers();
    try {
      const back = key('backspace');
      back.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch' }));
      vi.advanceTimersByTime(520);
      back.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
      back.click();               // the click ending the long press is swallowed
      tick();
      expect(a.value).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the live flag hint the screen computes', async () => {
    const { q, host, pad, tick, tapField } = await setup();
    tapField(q('.a'));
    expect(pad()!.querySelector('.pf-np__flag')).toBeNull();
    host.flag.set({ tone: 'critical', label: 'CH · above 20' });
    tick();
    const chip = pad()!.querySelector('.pf-np__flag')!;
    expect(chip.textContent).toContain('CH');
    expect(chip.getAttribute('data-tone')).toBe('critical');
  });

  it('Next walks down the list: skips calculated / read-only / disabled / hidden, opens a dropdown, then continues', async () => {
    const { q, root, host, pad, key, tick, tapField, press } = await setup();
    expect(navigableFields(root.querySelector('.scope') as HTMLElement, '[data-f]').map(e => e.className))
      .toEqual(['a', 'pf-dd__trigger', 'mic', 'b']);
    const a = q('.a');
    tapField(a);
    press('7');
    expect(key('next').textContent).toContain('Next');
    press('next');
    // Landed on the dropdown (focused + opened); the pad steps aside.
    const trigger = q<HTMLButtonElement>('.pf-dd__trigger');
    expect(document.activeElement).toBe(trigger);
    await new Promise(r => setTimeout(r));
    tick();
    expect(host.opened).toBe(1);
    expect(pad()).toBeNull();
    // Leaving the field fired ONE change (screens that save on change).
    expect(host.changes).toBe(1);
    // After the choice the screen advances focus programmatically → the pad
    // comes back (the Next chain), no tap needed.
    const mic = q('.mic');
    mic.focus();
    tick();
    expect(pad()).not.toBeNull();
    expect(nextField(navigableFields(root.querySelector('.scope') as HTMLElement, '[data-f]'), mic)).toBe(q('.b'));
  });

  it('the last field reads Done and lands on the Submit CTA', async () => {
    const { q, pad, key, tick, tapField, press } = await setup();
    const b = q('.b');
    tapField(b);
    expect(key('next').textContent).toContain('Done');
    expect(key('next').getAttribute('aria-label')).toBe('Done, go to Submit');
    press('next');
    expect(document.activeElement).toBe(q('.cta'));
    await new Promise(r => setTimeout(r));
    tick();
    expect(pad()).toBeNull();
  });

  it('a hardware keyboard keeps working: the pad steps aside, Enter still moves on', async () => {
    const { q, host, pad, tick, tapField } = await setup();
    const b = q('.b');
    tapField(b);
    expect(pad()).not.toBeNull();
    // A real key (not synthesised by the pad).
    b.dispatchEvent(new KeyboardEvent('keydown', { key: '5', bubbles: true, cancelable: true }));
    tick();
    expect(pad()).toBeNull();
    b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(host.enters).toBe(1);
  });

  it('pad presses never reach page-level key listeners', async () => {
    const { q, tapField, press } = await setup();
    const seen: string[] = [];
    const spy = (e: KeyboardEvent) => seen.push(e.key);
    document.addEventListener('keydown', spy);
    try {
      tapField(q('.a'));
      press('1', '.', 'next');
    } finally {
      document.removeEventListener('keydown', spy);
    }
    expect(seen).toEqual([]);
  });

  it('Hide closes the pad and keeps the field focused', async () => {
    const { q, pad, tick, tapField } = await setup();
    const a = q('.a');
    tapField(a);
    (pad()!.querySelector('.pf-np__hide') as HTMLButtonElement).click();
    tick();
    expect(pad()).toBeNull();
    expect(document.activeElement).toBe(a);
    // Tapping the focused field brings it back.
    touchDown(a);
    tick();
    expect(pad()).not.toBeNull();
  });

  it('reduced motion: the pad renders still (no entrance / press motion)', async () => {
    const { q, pad, tapField } = await setup({ reduced: true });
    tapField(q('.a'));
    expect(pad()!.classList).toContain('pf-np--still');
    const css = ((NumpadPanelComponent as any).ɵcmp.styles as string[]).join('\n');
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
  });
});
