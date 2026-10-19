import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ActionsMenuComponent, ActionsMenuTriggerDirective, type PfAction } from './actions-menu.component';

/**
 * pf-actions-menu — the ONE ⋮ menu: trigger ARIA, role=menu / menuitem,
 * arrow keys, Esc closes + focus returns, sheet on phones / popover on
 * tablets, emits only after closing, SVG icons (never glyphs), 44px rows.
 */
const ACTS: PfAction[] = [
  { id: 'share', label: 'Share…', icon: 'share', group: 'Share' },
  { id: 'copy', label: 'Copy patient link', icon: 'link', group: 'Share' },
  { id: 'off', label: 'Disabled', icon: 'edit', group: 'Report', disabled: true },
  { id: 'print', label: 'Print', icon: 'print', group: 'Report' },
  { id: 'regen', label: 'Regenerate', icon: 'regenerate', group: 'Report', tone: 'danger' },
];

@Component({
  standalone: true,
  imports: [ActionsMenuComponent],
  template: `<pf-actions-menu [actions]="acts()" label="Report actions" heading="Report · Priya" (action)="picked.push($event)" (opened)="opens = opens + 1" />`,
})
class HostDefault {
  acts = signal<PfAction[]>(ACTS);
  picked: string[] = [];
  opens = 0;
}

@Component({
  standalone: true,
  imports: [ActionsMenuComponent, ActionsMenuTriggerDirective],
  template: `<pf-actions-menu [actions]="acts" (action)="picked.push($event)">
    <button pfActionsTrigger type="button" class="host-btn" aria-label="More actions">dots</button>
  </pf-actions-menu>`,
})
class HostProjected {
  acts = ACTS;
  picked: string[] = [];
}

const realMM = (window as any).matchMedia;
function setPhone(phone: boolean) {
  (window as any).matchMedia = (q: string) => ({
    matches: q.includes('640px') ? phone : false,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
}
afterEach(() => {
  (window as any).matchMedia = realMM;
  document.querySelectorAll('.pf-am-layer').forEach(n => n.remove());
  TestBed.resetTestingModule();
});

async function mount<T>(cmp: new () => T, phone = false) {
  setPhone(phone);
  const f = TestBed.createComponent(cmp);
  f.detectChanges();
  await f.whenStable();
  return { f, el: f.nativeElement as HTMLElement, host: f.componentInstance as any };
}
const tick = () => new Promise(r => setTimeout(r, 0));
const menu = () => document.body.querySelector('[role=menu]') as HTMLElement | null;
const rows = () => Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role=menuitem]'));

describe('pf-actions-menu — trigger', () => {
  it('is a labelled ⋮ icon button (SVG, no glyph) that announces a menu', async () => {
    const { el } = await mount(HostDefault);
    const btn = el.querySelector('button') as HTMLButtonElement;
    expect(btn.getAttribute('aria-label')).toBe('Report actions');
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.querySelector('svg')).not.toBeNull();
    expect(btn.textContent).not.toMatch(/[⋮…•]/);
  });

  it('disables itself when there is nothing to offer', async () => {
    const { f, el, host } = await mount(HostDefault);
    host.acts.set([]);
    f.detectChanges();
    expect((el.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('pf-actions-menu — menu', () => {
  it('opens a role=menu of menuitems in groups, portalled to <body>, and emits (opened)', async () => {
    const { f, el, host } = await mount(HostDefault);
    (el.querySelector('button') as HTMLButtonElement).click();
    f.detectChanges();
    await tick();
    expect(menu()).not.toBeNull();
    expect(el.contains(menu())).toBe(false);
    expect(rows().map(r => r.textContent?.trim())).toEqual(['Share…', 'Copy patient link', 'Disabled', 'Print', 'Regenerate']);
    expect(Array.from(document.body.querySelectorAll('.pf-am-group__t')).map(g => g.textContent)).toEqual(['Share', 'Report']);
    expect(rows().every(r => r.querySelector('svg path'))).toBe(true);
    expect((el.querySelector('button') as HTMLElement).getAttribute('aria-expanded')).toBe('true');
    expect(host.opens).toBe(1);
    expect(rows()[4].classList.contains('pf-am-item--danger')).toBe(true);
  });

  it('focuses the first row; ↓ ↑ Home End walk the ENABLED rows (skipping disabled), wrapping', async () => {
    const { f, el } = await mount(HostDefault);
    (el.querySelector('button') as HTMLButtonElement).click();
    f.detectChanges();
    await tick();
    f.detectChanges();
    const m = menu()!;
    expect(document.activeElement?.textContent?.trim()).toBe('Share…');
    const key = (k: string) => m.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    key('ArrowDown'); expect(document.activeElement?.textContent?.trim()).toBe('Copy patient link');
    key('ArrowDown'); expect(document.activeElement?.textContent?.trim()).toBe('Print');
    key('End'); expect(document.activeElement?.textContent?.trim()).toBe('Regenerate');
    key('ArrowDown'); expect(document.activeElement?.textContent?.trim()).toBe('Share…');
    key('ArrowUp'); expect(document.activeElement?.textContent?.trim()).toBe('Regenerate');
    key('Home'); expect(document.activeElement?.textContent?.trim()).toBe('Share…');
  });

  it('ArrowUp on the trigger opens on the LAST row', async () => {
    const { f, el } = await mount(HostDefault);
    (el.querySelector('button') as HTMLButtonElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    f.detectChanges();
    await tick();
    expect(document.activeElement?.textContent?.trim()).toBe('Regenerate');
  });

  it('Esc closes and returns focus to the ⋮', async () => {
    const { f, el } = await mount(HostDefault);
    const btn = el.querySelector('button') as HTMLButtonElement;
    btn.click(); f.detectChanges(); await tick();
    menu()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    f.detectChanges();
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('a pick closes FIRST, then emits the id; disabled rows emit nothing', async () => {
    const { f, el, host } = await mount(HostDefault);
    (el.querySelector('button') as HTMLButtonElement).click(); f.detectChanges(); await tick();
    rows()[2].click();   // disabled
    expect(host.picked).toEqual([]);
    const print = rows()[3];
    const spy = vi.fn(() => expect(menu()).toBeNull());
    print.addEventListener('click', () => queueMicrotask(spy));
    print.click();
    f.detectChanges();
    expect(host.picked).toEqual(['print']);
    expect(menu()).toBeNull();
  });

  it('a backdrop tap closes without emitting', async () => {
    const { f, el, host } = await mount(HostDefault);
    (el.querySelector('button') as HTMLButtonElement).click(); f.detectChanges(); await tick();
    (document.body.querySelector('.pf-am-backdrop') as HTMLElement).click();
    f.detectChanges();
    expect(menu()).toBeNull();
    expect(host.picked).toEqual([]);
  });
});

describe('pf-actions-menu — phone sheet vs tablet popover', () => {
  it('tablet / desktop: a popover (no handle, no Cancel)', async () => {
    const { f, el } = await mount(HostDefault, false);
    (el.querySelector('button') as HTMLButtonElement).click(); f.detectChanges(); await tick();
    expect(menu()!.classList.contains('pf-am-panel--sheet')).toBe(false);
    expect(document.body.querySelector('.pf-am-handle')).toBeNull();
    expect(document.body.querySelector('.pf-am-cancel')).toBeNull();
  });

  it('phones: a bottom sheet with a handle, the heading and a Cancel that restores focus', async () => {
    const { f, el } = await mount(HostDefault, true);
    const btn = el.querySelector('button') as HTMLButtonElement;
    btn.click(); f.detectChanges(); await tick();
    expect(menu()!.classList.contains('pf-am-panel--sheet')).toBe(true);
    expect(document.body.querySelector('.pf-am-handle')).not.toBeNull();
    expect(document.body.querySelector('.pf-am-heading')?.textContent).toContain('Report · Priya');
    (document.body.querySelector('.pf-am-cancel') as HTMLButtonElement).click();
    f.detectChanges();
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(btn);
  });
});

describe('pf-actions-menu — projected host trigger', () => {
  it('wires the host button (click, ARIA) and returns focus to it', async () => {
    const { f, el, host } = await mount(HostProjected);
    const btn = el.querySelector('.host-btn') as HTMLButtonElement;
    expect(el.querySelectorAll('button').length).toBe(1);   // no second, built-in trigger
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
    btn.click(); f.detectChanges(); await tick(); f.detectChanges();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(btn.getAttribute('aria-controls')).toBe(menu()!.id);
    rows()[0].click(); f.detectChanges();
    expect(host.picked).toEqual(['share']);
    expect(document.activeElement).toBe(btn);
  });
});

describe('pf-actions-menu — current row (navigation menus)', () => {
  it('marks the current row aria-current="page" with the selected look, still pickable', async () => {
    const { f, el, host } = await mount(HostDefault);
    host.acts.set([
      { id: 'a', label: '26121', hint: 'Patient A', current: true },
      { id: 'b', label: '26122' },
    ]);
    f.detectChanges();
    (el.querySelector('button') as HTMLButtonElement).click(); f.detectChanges(); await tick();
    const [a, b] = rows();
    expect(a.getAttribute('aria-current')).toBe('page');
    expect(a.classList.contains('pf-am-item--current')).toBe(true);
    expect(b.hasAttribute('aria-current')).toBe(false);
    a.click(); f.detectChanges();
    expect(host.picked).toEqual(['a']);
  });
});

describe('pf-actions-menu — styles', () => {
  const css = () => ((ActionsMenuComponent as any).ɵcmp.styles as string[]).join('\n');
  it('rows are ≥44px tap targets and motion is off under reduced motion', () => {
    expect(css()).toMatch(/\.pf-am-item[^{]*\{[^}]*min-height:\s*44px/);
    expect(css()).toContain('prefers-reduced-motion');
  });
  it('uses theme tokens (light / dark), never a hard-coded dark surface', () => {
    expect(css()).toContain('var(--pf-card-bg');
    expect(css()).toContain('var(--text-primary)');
  });
});
