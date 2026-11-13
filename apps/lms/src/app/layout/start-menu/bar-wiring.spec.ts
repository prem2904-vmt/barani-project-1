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
    expect(lockup).toContain('onBrand()');
    expect(stripTs).toMatch(/onBrand\(\): void \{[\s\S]*?if \(home\) \{[\s\S]*?this\.toggleStart\(\);/);
    expect(lockup).not.toContain('routerLink');
    expect(stripHtml).toMatch(/<pf-start-menu[^>]*\[homeHref\]="pickLanding\(\)"/);
  });
  it('people can see the logo is a menu: a quiet chevron + a one-time hint that never returns once dismissed or opened', () => {
    expect(stripHtml).toMatch(/class="pf-brand-start" data-start-chev/);
    expect(stripHtml).toMatch(/@if \(startHint\(\)\)/);
    expect(stripTs).toMatch(/START_HINT_KEY = 'pf\.startHintSeen'/);
    expect(stripTs).toMatch(/if \(next\) this\.dismissStartHint\(\);/);
    expect(stripTs).toMatch(/startHint = computed\(\(\) => !this\.startHintSeen\(\) && !this\.startOpen\(\) && !this\.sheetHome\(\)\)/);
  });
  it('while a case sheet owns the bar the logo goes home and the chevron goes (FormBarService.home)', () => {
    expect(stripTs).toMatch(/sheetHome = computed\(\(\) => \(this\.formBar\.template\(\) \? this\.formBar\.home\(\) : null\)\)/);
    expect(stripHtml).toMatch(/\[attr\.aria-label\]="sheetHome\(\) \? 'Back to Departments' : 'Start menu'"/);
    expect(stripHtml).toMatch(/@if \(!sheetHome\(\)\) \{\s*<svg class="pf-brand-start"/);
  });
  it('phones: the pf badge carries the chevron, and a sheet brings the logo back as the way home', () => {
    expect(stripHtml).toMatch(/@if \(compactBar\(\)\) \{[\s\S]{0,200}pf-brand-start--badge/);
    expect(stripHtml).toMatch(/\[class\.pf-topstrip-bar--sheet\]="!!sheetHome\(\)"/);
    const scss = read('top-strip/top-strip.component.scss');
    expect(scss).toMatch(/\.pf-topstrip-bar--sheet \.pf-brand-lockup \{\s*display: inline-flex !important;/);
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

describe('Start menu + account menu are one system', () => {
  it('top strip: opening the account / branch / more menus closes the Start menu (closeAll includes it); Esc and outside clicks leave the Start menu to its own handlers', () => {
    expect(stripTs).toMatch(/private closeAll\(keepStart = false\)[\s\S]*?if \(!keepStart\) this\.startOpen\.set\(false\)/);
    expect(stripTs).toMatch(/onEscape\(\) \{\s*this\.closeAll\(true\)/);
    expect(stripTs).toMatch(/if \(!inside\) this\.closeAll\(true\)/);
    expect(stripTs).toMatch(/toggleProfile\(\)[\s\S]*?this\.closeAll\(\);\s*this\.profileOpen\.set\(next\)/);
  });
  it('bottom nav: opening the account menu closes the Start menu and Esc closes the account menu', () => {
    expect(bottomTs).toMatch(/if \(this\.moreOpen\(\)\) this\.startOpen\.set\(false\)/);
    expect(bottomTs).toMatch(/protected openAccount\(\): void \{\s*this\.startOpen\.set\(false\);\s*this\.moreOpen\.set\(true\)/);
    expect(bottomTs).toMatch(/document:keydown\.escape[\s\S]*?this\.closeMore\(\)/);
  });
  it('both menus register with the back gesture / Android back', () => {
    expect(bottomTs).toContain('this.overlays.register(() => this.closeMore())');
    expect(stripTs).toContain('this.overlays.register(() => this.closeProfile())');
    expect(read('start-menu/start-menu.component.ts')).toContain('this.overlays.register(() => this.close())');
  });
  it('the account menu uses the same sheet geometry, surface and motion as the Start menu', () => {
    const scss = read('bottom-nav/bottom-nav.component.scss');
    expect(scss).toContain("@use '../menu-panel' as mp;");
    expect(scss).toMatch(/\.pf-bottom-nav:not\(\.pf-bottom-nav--rail\) \.pf-more-pop \{[\s\S]*?mp\.menu-sheet-size/);
    expect(scss).toContain('mp.menu-surface');
    expect(read('top-strip/top-strip.component.scss')).toMatch(/max-width: 767px\)[\s\S]*?\.pf-profile-pop[\s\S]*?position: fixed/);
    expect(read('start-menu/start-menu.component.scss')).toContain('mp.menu-sheet-size');
  });
});
