import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { SetPinDialogComponent } from './set-pin-dialog.component';
import { SetPinDialogService } from '../../../core/services/set-pin-dialog.service';
import { AuthService } from '../../../core/auth/auth.service';

/**
 * OPS-107 (iPad: the Set PIN form inside the avatar popover never raised the
 * keypad). It is now a dialog rendered by the shell; `open()` runs change
 * detection and focuses the first PIN field INSIDE the opening tap, which is
 * the only focus iPad / WKWebView turns into a keypad.
 */
function setup(hasPin: boolean, setPin = vi.fn(async () => {})) {
  const user = signal<any>({ id: 'u1', hasPin });
  TestBed.configureTestingModule({
    imports: [SetPinDialogComponent],
    providers: [{ provide: AuthService, useValue: { user, setPin } }],
  });
  const f = TestBed.createComponent(SetPinDialogComponent);
  f.detectChanges();
  const svc = TestBed.inject(SetPinDialogService);
  const el = f.nativeElement as HTMLElement;
  const type = (sel: string, digits: string) => {
    const input = el.querySelector(`${sel} input`) as HTMLInputElement;
    input.value = digits;
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
  };
  return { f, svc, el, setPin, type, user };
}

describe('Set PIN dialog (OPS-107)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('is closed until opened; open() focuses the PIN field synchronously, in the same tap (no PIN yet = one field)', () => {
    const { f, svc, el } = setup(false);
    expect(el.querySelector('[data-set-pin]')).toBeNull();
    // The caller's click handler: open() and NOTHING else.
    const tap = () => svc.open();
    tap();
    f.detectChanges();
    const dlg = el.querySelector('[data-set-pin]');
    expect(dlg?.getAttribute('role')).toBe('dialog');
    expect(el.querySelector('[data-pin-current]')).toBeNull();
    const input = el.querySelector('[data-pin-new] input') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    // iPad keypad contract: numeric keypad, 16px (no zoom), digits only.
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('type')).toBe('tel');
    expect(input.getAttribute('pattern')).toBe('[0-9]*');
  });

  it('a profile that has a PIN focuses the CURRENT field first, then moves to the new one after 4 digits', () => {
    const { f, svc, el, type } = setup(true);
    svc.open(); f.detectChanges();
    const cur = el.querySelector('[data-pin-current] input') as HTMLInputElement;
    const nxt = el.querySelector('[data-pin-new] input') as HTMLInputElement;
    expect(document.activeElement).toBe(cur);
    type('[data-pin-current]', '1234');
    expect(document.activeElement).toBe(nxt);
  });

  it('Save is off until the PIN is complete; it calls auth.setPin(new, current) and closes', async () => {
    vi.useFakeTimers();
    try {
      const { f, svc, el, setPin, type } = setup(true);
      svc.open(); f.detectChanges();
      const save = () => el.querySelector('[data-set-pin-save]') as HTMLButtonElement;
      expect(save().disabled).toBe(true);
      type('[data-pin-current]', '1111');
      expect(save().disabled).toBe(true);
      type('[data-pin-new]', '2222');
      expect(save().disabled).toBe(false);
      save().click();
      await vi.advanceTimersByTimeAsync(0);
      expect(setPin).toHaveBeenCalledWith('2222', '1111');
      f.detectChanges();
      await vi.advanceTimersByTimeAsync(900);
      expect(svc.isOpen()).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it('first PIN: setPin(new) with no current; a server error is shown and the field is cleared', async () => {
    const setPin = vi.fn(async () => { throw new Error('Current PIN is wrong.'); });
    const { f, svc, el, type } = setup(false, setPin as any);
    svc.open(); f.detectChanges();
    type('[data-pin-new]', '4321');
    (el.querySelector('[data-set-pin-save]') as HTMLButtonElement).click();
    await f.whenStable(); f.detectChanges();
    expect(setPin).toHaveBeenCalledWith('4321', undefined);
    expect(el.querySelector('.pf-sp-err')?.textContent).toContain('Current PIN is wrong.');
    expect((el.querySelector('[data-pin-new] input') as HTMLInputElement).value).toBe('');
    expect(svc.isOpen()).toBe(true);
  });

  it('Escape and Cancel close it without saving', () => {
    const { f, svc, el, setPin } = setup(false);
    svc.open(); f.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    f.detectChanges();
    expect(svc.isOpen()).toBe(false);
    svc.open(); f.detectChanges();
    (el.querySelector('.pf-sp-actions .pf-btn--secondary') as HTMLButtonElement).click();
    expect(svc.isOpen()).toBe(false);
    expect(setPin).not.toHaveBeenCalled();
  });

  it('the avatar menus open the dialog and no longer carry an inline PIN form (popover inputs)', () => {
    const root = resolve(process.cwd(), 'apps/lms/src/app/layout');
    for (const f of ['bottom-nav/bottom-nav.component.html', 'top-strip/top-strip.component.html']) {
      const html = readFileSync(resolve(root, f), 'utf8');
      expect(html, f).not.toMatch(/type="password"[^>]*inputmode="numeric"/);
      expect(html, f).not.toContain('pinFormOpen');
    }
    for (const f of ['bottom-nav/bottom-nav.component.ts', 'top-strip/top-strip.component.ts']) {
      expect(readFileSync(resolve(root, f), 'utf8'), f).toContain('pinDialog.open()');
    }
    expect(readFileSync(resolve(root, 'shell/shell.component.ts'), 'utf8')).toContain('<pf-set-pin-dialog>');
  });
});
