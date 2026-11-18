import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  escLeavesFullScreen,
  fieldOwnsEsc,
  installEscToLeaveFullScreen,
  isBareEsc,
  overlayOpen,
  snapshotEsc,
} from './desktop-fullscreen-esc';

/**
 * Desktop kiosk full screen — Esc leaves full screen ONLY when the app did
 * not use that Esc (a dialog / popover / pf-select / keypad / search field).
 * Real KeyboardEvents dispatched through the test DOM with the real listeners.
 */
const esc = (init: KeyboardEventInit = {}) =>
  new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init });

describe('Esc → leave full screen (installed listeners, real dispatch)', () => {
  let leave: ReturnType<typeof vi.fn<() => void>>;
  let full: boolean;
  let off: () => void;
  const extra: Array<() => void> = [];

  const listen = (target: EventTarget, fn: (e: KeyboardEvent) => void, capture = false) => {
    const h = (e: Event) => fn(e as KeyboardEvent);
    target.addEventListener('keydown', h, capture);
    extra.push(() => target.removeEventListener('keydown', h, capture));
  };
  const press = async (target: EventTarget = document.body, init?: KeyboardEventInit) => {
    const ev = esc(init);
    target.dispatchEvent(ev);
    await new Promise(r => setTimeout(r, 5)); // the decision runs one task later
    return ev;
  };

  beforeEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    full = true;
    leave = vi.fn<() => void>();
    off = installEscToLeaveFullScreen(window, () => full, leave);
  });
  afterEach(() => {
    off();
    extra.splice(0).forEach(f => f());
    document.body.innerHTML = '';
  });

  it('nothing open, nothing uses Esc → leaves full screen once', async () => {
    await press();
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it('windowed already → does nothing', async () => {
    full = false;
    await press();
    expect(leave).not.toHaveBeenCalled();
  });

  it('a handler preventDefault()s it (consumed) → stays full screen', async () => {
    listen(document, e => e.preventDefault());
    await press();
    expect(leave).not.toHaveBeenCalled();
  });

  it('a window listener added AFTER ours preventDefault()s it → still seen (deferred decision)', async () => {
    listen(window, e => e.preventDefault());
    await press();
    expect(leave).not.toHaveBeenCalled();
  });

  it('a handler stopPropagation()s it → consumed', async () => {
    listen(document.body, e => e.stopPropagation());
    await press();
    expect(leave).not.toHaveBeenCalled();
  });

  it('a dialog is open and a plain document:keydown.escape handler CLOSES it (no preventDefault) → stays full screen', async () => {
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    document.body.appendChild(dlg);
    // Same shape as DialogService / notification bell / top strip handlers.
    listen(document, e => { if (e.key === 'Escape') dlg.remove(); });
    await press();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(leave).not.toHaveBeenCalled();
    // The NEXT Esc (nothing open any more) leaves full screen.
    await press();
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it('an open menu (avatar menu / actions menu) → stays full screen', async () => {
    document.body.innerHTML = '<div class="pf-profile-pop" role="menu"></div>';
    await press();
    expect(leave).not.toHaveBeenCalled();
  });

  it('an open pf-select (floating listbox + expanded combobox) → stays full screen', async () => {
    document.body.innerHTML =
      '<div role="combobox" aria-expanded="true"></div><div role="listbox" style="position:fixed"></div>';
    await press();
    expect(leave).not.toHaveBeenCalled();
  });

  it('the pf-keys keypad is up → stays full screen', async () => {
    document.body.innerHTML = '<pf-keys-panel><div class="pf-k" role="group"></div></pf-keys-panel>';
    await press();
    expect(leave).not.toHaveBeenCalled();
  });

  it('focus in a search box with text (Esc clears it) → stays full screen; empty box → leaves', async () => {
    const input = document.createElement('input');
    input.type = 'search';
    input.value = 'LFT';
    document.body.appendChild(input);
    input.focus();
    await press(input);
    expect(leave).not.toHaveBeenCalled();
    input.value = '';
    await press(input);
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it('Esc with a modifier / auto-repeat / mid-IME → ignored', async () => {
    await press(document.body, { shiftKey: true });
    await press(document.body, { metaKey: true });
    await press(document.body, { repeat: true });
    await press(document.body, { isComposing: true });
    expect(leave).not.toHaveBeenCalled();
  });

  it('other keys → ignored', async () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 5));
    expect(leave).not.toHaveBeenCalled();
  });

  it('uninstall removes both listeners', async () => {
    off();
    await press();
    expect(leave).not.toHaveBeenCalled();
    off = () => undefined;
  });
});

describe('Esc rule — pure pieces', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('overlayOpen: hidden / display:none overlays and INLINE listboxes do not count', () => {
    document.body.innerHTML = `
      <div role="dialog" hidden></div>
      <div style="display:none"><div role="menu"></div></div>
      <div role="listbox" aria-label="Container"></div>
      <button aria-haspopup="menu" aria-expanded="false"></button>
      <button aria-expanded="true"></button>`; // a plain disclosure, not a popup
    expect(overlayOpen()).toBe(false);
    document.body.insertAdjacentHTML('beforeend', '<button aria-haspopup="listbox" aria-expanded="true"></button>');
    expect(overlayOpen()).toBe(true);
  });

  it('overlayOpen: opt-in marker for a new overlay type', () => {
    document.body.innerHTML = '<div data-pf-esc></div>';
    expect(overlayOpen()).toBe(true);
  });

  it('fieldOwnsEsc: typed text / textarea / contenteditable yes; empty, checkbox, button no', () => {
    const mk = (html: string) => { document.body.innerHTML = html; return document.body.firstElementChild; };
    expect(fieldOwnsEsc(mk('<input value="x">'))).toBe(true);
    expect(fieldOwnsEsc(mk('<input value="">'))).toBe(false);
    expect(fieldOwnsEsc(mk('<input type="checkbox" value="on">'))).toBe(false);
    expect(fieldOwnsEsc(mk('<textarea>note</textarea>'))).toBe(true);
    expect(fieldOwnsEsc(mk('<button>ok</button>'))).toBe(false);
    expect(fieldOwnsEsc(null)).toBe(false);
  });

  it('escLeavesFullScreen needs THIS event\'s capture snapshot (synthetic window-only dispatch is not guessed)', () => {
    const ev = esc();
    expect(escLeavesFullScreen(ev, null)).toBe(false);
    expect(escLeavesFullScreen(ev, { event: esc(), owned: false })).toBe(false);
    expect(escLeavesFullScreen(ev, snapshotEsc(ev))).toBe(true);
    ev.preventDefault();
    expect(escLeavesFullScreen(ev, { event: ev, owned: false })).toBe(false);
  });

  it('isBareEsc accepts the legacy "Esc" key name', () => {
    expect(isBareEsc(new KeyboardEvent('keydown', { key: 'Esc' }))).toBe(true);
    expect(isBareEsc(new KeyboardEvent('keydown', { key: 'Escape', altKey: true }))).toBe(false);
  });
});

describe('Esc actions that are not overlays take the Esc (preventDefault) — source pins', () => {
  // These screens use Esc for something other than closing a role=dialog /
  // menu (clear a selection, zoom out of a detail, deselect). They must mark
  // the Esc as used, or the desktop app would ALSO leave full screen.
  const read = (p: string) => readFileSync(resolve(process.cwd(), 'apps/lms/src/app', p), 'utf8');
  it.each([
    ['features/frontdesk/frontdesk-landing/frontdesk-landing.component.ts', /onEscClearSelection\(ev\?: Event\)[\s\S]{0,400}ev\?\.preventDefault\(\);\s*this\.workSel\.clear\(\)/],
    ['features/admin/report-template/report-header-editor.component.ts', /ev\.key === 'Escape'[\s\S]{0,200}if \(this\.selected\(\)\) ev\.preventDefault\(\)/],
    ['features/frontdesk/appointments-calendar/appointments-calendar.component.ts', /e\?\.preventDefault\(\); this\.closeReschedule\(\)[\s\S]{0,80}e\?\.preventDefault\(\); this\.closeAppt\(\)/],
    ['features/frontdesk/patient-profile/patient-profile.component.ts', /if \(this\.detail\(\)\) \{ used\(\); this\.closeDetail\(\); \}/],
    ['features/frontdesk/patient-profile/patient-profile.component.html', /\(keydown\.escape\)="onEsc\(\$event\)"/],
    ['features/frontdesk/patient-profile/lab-orders.component.ts', /\(keydown\.escape\)="close\(\); \$event\.preventDefault\(\)"/],
    // v2: Esc closes the Preview popup (no sections overlay any more) and marks the Esc as used.
    ['features/admin/tests/test-editor/test-editor.component.ts', /this\.previewOpen\(\) && ev\.key === 'Escape'\) \{\s*ev\.preventDefault\(\)/],
  ])('%s', (file, re) => {
    expect(read(file)).toMatch(re);
  });
});
