import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Both shells render ONLY the bar from nav-pins.ts (pins never grant access; the bar is decided in one place),
 * and the PF logo is the Start menu's trigger in each. Source-level wiring checks: the shells are too heavy to
 * mount in a unit spec, and the rules themselves are pinned in nav-pins.spec.ts.
 */
const read = (p: string) => readFileSync(resolve(process.cwd(), 'apps/lms/src/app/layout', p), 'utf8');
const stripHtml = read('top-strip/top-strip.component.html');
const stripTs = read('top-strip/top-strip.component.ts');
const bottomHtml = read('bottom-nav/bottom-nav.component.html');
const bottomTs = read('bottom-nav/bottom-nav.component.ts');

describe('top strip (desktop)', () => {
  it('phone-width bar (< 768px): the PF badge in the avatar slot opens the Start menu, account moves into the menu', () => {
    expect(stripTs).toMatch(/compactBar = computed\([\s\S]*?viewportW\(\) < 768/);
    expect(stripTs).toMatch(/toggleProfile\(\) \{\s*if \(this\.compactBar\(\) && !this\.profileOpen\(\)\) \{ this\.toggleStart\(\); return; \}/);
    expect(stripHtml).toMatch(/\[showAccount\]="compactBar\(\)"/);
    expect(stripHtml).toMatch(/\(account\)="openAccount\(\)"/);
  });
  it('both designs render bar(), never the full primary() list, and Settings is a normal bar item', () => {
    expect((stripHtml.match(/@for \(n of bar\(\); track n\.id\)/g) ?? []).length).toBe(2); // new + classic
    expect(stripHtml).not.toMatch(/@for \(n of primary\(\)/);
    expect(stripHtml).not.toContain('routerLink="/admin"');
  });
  it('icons only drops the labels and keeps a title + accessible name', () => {
    expect(stripHtml).toMatch(/\[attr\.title\]="n\.label"/);
    expect(stripHtml).toMatch(/\[attr\.aria-label\]="iconsOnly\(\) \? n\.label : null"/);
    expect(stripHtml).toMatch(/@if \(!iconsOnly\(\)\)/);
  });
  it('the PF brand lockup opens the Start menu (a button, not the landing link)', () => {
    const lockup = stripHtml.slice(stripHtml.lastIndexOf('<', stripHtml.indexOf('pf-brand-lockup')), stripHtml.indexOf('pf-brand-glyph'));
    expect(lockup).toContain('data-start-trigger');
    expect(lockup).toContain('toggleStart()');
    expect(lockup).not.toContain('routerLink');
    expect(stripHtml).toMatch(/<pf-start-menu[^>]*\[homeHref\]="pickLanding\(\)"/);
  });
  it('the bar comes from computeNavLayout over primary() + Settings, nothing else', () => {
    expect(stripTs).toMatch(/readonly bar = computed\(\(\) => this\.navLayout\(\)\.bar\)/);
    expect(stripTs).toContain('computeNavLayout({');
    expect(stripTs).toMatch(/\[\.\.\.this\.primary\(\), \.\.\.\(this\.showAdmin\(\) \? \[ADMIN_NAV\] : \[\]\)\]/);
  });
});

describe('bottom nav (phone / iPad)', () => {
  it('displays exactly the layout bar and indexes taps, drags and the active tab by it', () => {
    expect(bottomTs).toMatch(/displayedItems = computed\(\(\) => this\.navLayout\(\)\.bar\)/);
    expect(bottomTs).toMatch(/const items = this\.displayedItems\(\);\s+if \(idx < 0/);
    expect(bottomTs).toMatch(/const shown = this\.displayedItems\(\)/);
    expect(bottomHtml).toMatch(/@for \(n of displayedItems\(\)/);
    expect(bottomHtml).not.toMatch(/@for \(n of primary\(\)/);
  });
  it('Settings is no longer a separate fixed link: it is a bar item like any other', () => {
    expect(bottomHtml).not.toContain('routerLink="/admin"');
  });
  it('the PF button opens the Start menu in both the pill and the rail', () => {
    expect((bottomHtml.match(/data-start-trigger/g) ?? []).length).toBe(2);
    expect((bottomHtml.match(/\(click\)="toggleStart\(\$event\)"/g) ?? []).length).toBe(2);
    expect(bottomHtml).toMatch(/<pf-start-menu[^>]*\[homeHref\]="homeHref\(\)"/);
  });
  it('icons only: no label, a title + accessible name, and a long-press label bubble on touch', () => {
    expect(bottomHtml).toMatch(/@if \(!iconsOnly\(\)\) \{ <span class="pf-nav-btn__lbl">/);
    expect(bottomHtml).toMatch(/\[attr\.aria-label\]="iconsOnly\(\) \? n\.label : null"/);
    expect(bottomHtml).toContain('class="pf-nav-tip"');
    expect(bottomTs).toContain('onBtnPointerDown');
  });
});
