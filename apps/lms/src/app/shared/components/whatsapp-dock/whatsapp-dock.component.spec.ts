import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { DialogService } from '../../../core/services/dialog.service';
import { WaDockState } from '../../../core/services/whatsapp-manual.service';
import { WA_DOCKED_CLASS, WhatsAppDockComponent } from './whatsapp-dock.component';

/** Desktop app: the strip above the docked WhatsApp panel + the app reflow. */
const OPEN: WaDockState = { open: true, width: 380, top: 128, loading: false, failed: false, pdfName: null };

function setup(bridge: Record<string, unknown> | null, confirm = true) {
  let push: ((s: WaDockState) => void) | null = null;
  const b = bridge && {
    onState: vi.fn((cb: (s: WaDockState) => void) => { push = cb; return () => { push = null; }; }),
    state: vi.fn(async () => ({ ...OPEN, open: false, width: 0 })),
    close: vi.fn(async () => ({ ok: true })),
    signOut: vi.fn(async () => ({ ok: true })),
    openElsewhere: vi.fn(async () => ({ ok: true })),
    startDrag: vi.fn(),
    ...bridge,
  };
  const dialog = { confirm: vi.fn(async () => confirm) };
  TestBed.configureTestingModule({ imports: [WhatsAppDockComponent], providers: [{ provide: DialogService, useValue: dialog }] });
  const f = TestBed.createComponent(WhatsAppDockComponent);
  f.componentInstance.bridge = b as never;
  f.detectChanges();
  const emit = (s: WaDockState) => { push!(s); f.detectChanges(); };
  return { f, b, dialog, emit, el: f.nativeElement as HTMLElement };
}
afterEach(() => {
  TestBed.resetTestingModule();
  document.documentElement.classList.remove(WA_DOCKED_CLASS);
  document.documentElement.style.removeProperty('--pf-wa-dock-w');
});

describe('WhatsAppDockComponent', () => {
  it('web / phone (no desktop bridge): renders nothing, never reflows', () => {
    const { el } = setup(null);
    expect(el.querySelector('[data-testid="wa-dock"]')).toBeNull();
    expect(document.documentElement.classList.contains(WA_DOCKED_CLASS)).toBe(false);
  });

  it('open → the app reflows left by the panel width; close → back to full width', () => {
    const { el, emit } = setup({});
    emit(OPEN);
    expect(el.querySelector('[data-testid="wa-dock"]')).not.toBeNull();
    expect(document.documentElement.classList.contains(WA_DOCKED_CLASS)).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--pf-wa-dock-w')).toBe('380px');
    expect(el.textContent).toContain('press Send in WhatsApp');
    emit({ ...OPEN, open: false, width: 0 });
    expect(el.querySelector('[data-testid="wa-dock"]')).toBeNull();
    expect(document.documentElement.classList.contains(WA_DOCKED_CLASS)).toBe(false);
  });

  it('Close asks main to close the panel', () => {
    const { el, emit, b } = setup({});
    emit(OPEN);
    (el.querySelector('[data-testid="wa-dock-close"]') as HTMLButtonElement).click();
    expect(b!.close).toHaveBeenCalled();
  });

  it('Sign out of WhatsApp on this computer: DialogService confirm first', async () => {
    const { el, emit, b, dialog } = setup({});
    emit(OPEN);
    (el.querySelector('[data-testid="wa-dock-signout"]') as HTMLButtonElement).click();
    await new Promise(r => setTimeout(r, 0));
    expect(dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Sign out of WhatsApp on this computer?', tone: 'danger' }));
    expect(b!.signOut).toHaveBeenCalled();
  });

  it('Sign out cancelled: nothing is wiped', async () => {
    const { el, emit, b } = setup({}, false);
    emit(OPEN);
    (el.querySelector('[data-testid="wa-dock-signout"]') as HTMLButtonElement).click();
    await new Promise(r => setTimeout(r, 0));
    expect(b!.signOut).not.toHaveBeenCalled();
  });

  it("won't load here: plain note + the same chat in the browser or the WhatsApp app", () => {
    const { el, emit, b } = setup({});
    emit({ ...OPEN, failed: true });
    expect(el.textContent).toContain("WhatsApp didn't load here.");
    const btns = [...el.querySelectorAll('button')].filter(x => ['Browser', 'WhatsApp app'].includes(x.textContent!.trim()));
    btns.forEach(x => x.click());
    expect(b!.openElsewhere).toHaveBeenCalledWith('browser');
    expect(b!.openElsewhere).toHaveBeenCalledWith('app');
  });

  it('PDF ready: a chip the person drags into the chat (native drag on their gesture)', () => {
    const { el, emit, b } = setup({});
    emit({ ...OPEN, pdfName: 'report-AB.pdf' });
    const chip = el.querySelector('[data-testid="wa-dock-pdf"]') as HTMLElement;
    expect(chip.getAttribute('draggable')).toBe('true');
    expect(chip.textContent).toContain('Report PDF');
    const ev = new Event('dragstart', { cancelable: true });
    chip.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(b!.startDrag).toHaveBeenCalledTimes(1);
  });

  it('the card line follows the automatic attach: working → attached → press Ctrl/Cmd+V when it did not work', () => {
    const { el, emit } = setup({});
    const line = () => (el.querySelector('[data-testid="wa-dock-line"]') as HTMLElement).textContent!.trim();
    emit({ ...OPEN, pdfName: 'r.pdf', attach: 'working' });
    expect(line()).toBe('Attaching the report PDF to the chat…');
    emit({ ...OPEN, pdfName: 'r.pdf', attach: 'attached' });
    expect(line()).toBe('Report PDF attached — check it, then press Send.');
    emit({ ...OPEN, pdfName: 'r.pdf', attach: 'manual' });
    expect(line()).toMatch(/^Report PDF is ready — press (Ctrl|Cmd)\+V in the chat, then Send\./);
    expect(el.textContent).not.toMatch(/\bAI\b/);
  });

  it('Copy again puts the PDF back on the clipboard and says how to paste it', async () => {
    const copyPdf = vi.fn(async () => ({ ok: true }));
    const { el, emit, f } = setup({ copyPdf });
    emit({ ...OPEN, pdfName: 'r.pdf', attach: 'manual' });
    (el.querySelector('[data-testid="wa-dock-copy"]') as HTMLButtonElement).click();
    await f.whenStable();
    expect(copyPdf).toHaveBeenCalledTimes(1);
  });

  it('destroy undoes the reflow', () => {
    const { f, emit } = setup({});
    emit(OPEN);
    f.destroy();
    expect(document.documentElement.classList.contains(WA_DOCKED_CLASS)).toBe(false);
  });
});
