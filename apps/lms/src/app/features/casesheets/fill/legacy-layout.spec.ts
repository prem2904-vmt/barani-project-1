import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { headerColor } from './case.page';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');
const html = read('apps/lms/src/app/features/casesheets/fill/case.page.html');
const scss = read('apps/lms/src/app/features/casesheets/fill/case.page.scss');
const ts = read('apps/lms/src/app/features/casesheets/fill/case.page.ts');

describe('the case sheet page colour', () => {
  it('uses the page colour only when it is a plain hex colour', () => {
    expect(headerColor('#8B5CF6')).toBe('#8B5CF6');
    expect(headerColor(' #abc ')).toBe('#abc');
    expect(headerColor('red')).toBeNull();
    expect(headerColor('url(x)')).toBeNull();
    expect(headerColor(undefined)).toBeNull();
  });
});

/** Owner 2026-11-11: "we have changed our theme" — the fill screen wears the standard band, not Prepare's purple bar. */
describe('the fill screen header is the standard band', () => {
  it('renders pf-hero-band with the back chevron, the lab brand slot and the context-bar pill', () => {
    expect(html).toMatch(/<pf-hero-band [^>]*\[back\]="true"[^>]*\[backAction\]="backFn"[^>]*\[customBrand\]="true"[^>]*\[contextBar\]="true"/);
    expect(html).toMatch(/<button\s+band-brand[\s\S]*?feHold[\s\S]*?\(feHold\)="holdLogo\(\)"[\s\S]*?\(click\)="goHome\(\)"/);
    expect(html).toMatch(/<div band-actions class="lf-actions">[\s\S]*?<app-save-state[\s\S]*?aria-label="Narrative"/);
    expect(html).toMatch(/<div band-search class="pf-ctx lf-ctx"/);
  });
  it('keeps no purple gradient header and no hard-coded PF mark', () => {
    expect(html).not.toMatch(/lf-head|lf-logo|glyph\[/);
    expect(ts).not.toMatch(/PF_GLYPH|M0 131\.126/);
    expect(scss).not.toMatch(/\.lf-head\b|\.lf-logo\b/);
    // the report dialog's head is the kit's too (tokens, no white-on-gradient bar)
    expect(scss).toMatch(/\.rp__head\s*\{[^}]*color:\s*var\(--text-primary\)/);
    expect(scss).not.toMatch(/\.rp__head\s*\{[^}]*gradient/);
  });
  it('the hold fill takes the lab logo\'s own shape (mask = the logo) and rises from the bottom', () => {
    expect(html).toMatch(/class="lf-brand__fill"[^>]*\[style\.mask-image\]="maskOf\(src\)"/);
    expect(scss).toMatch(/\.lf-brand__fill\s*\{[^}]*clip-path:\s*inset\(100% 0 0 0\)/);
    expect(scss).toMatch(/\.lf-brand\[data-holding\] \.lf-brand__fill\s*\{[^}]*clip-path:\s*inset\(0 0 0 0\)[^}]*var\(--fe-hold-ms/);
  });
});

/** Owner 2026-11-13: while a sheet is open the bar is ONLY Back · Pages · Next, and the PF logo goes home. */
describe('the lab bar while a sheet is open', () => {
  it('there is no footer strip in the page any more', () => {
    expect(html).not.toMatch(/lf-foot|data-step-foot/);
    expect(scss).not.toMatch(/\.lf-foot/);
  });
  it('lab and public both lend the controls to FormBarService, with the way home for the logo', () => {
    expect(ts).toMatch(/this\.formBar\.show\(this, tpl, this\.backFn\)/);
    expect(ts).not.toMatch(/NavActionsService/);
  });
  it('the buttons are the kit\'s at their normal size (owner: only the form body is touch-sized)', () => {
    expect(html).toMatch(/class="lf-back pf-touch" \[class\.lf-bar__item\]="!nav\.isLab" \[class\.pf-btn\]="nav\.isLab" \[class\.pf-btn--secondary\]="nav\.isLab"/);
    expect(html).toMatch(/class="lf-next pf-touch"\s+\[class\.lf-bar__item\]="!nav\.isLab"\s+\[class\.pf-btn\]="nav\.isLab"\s+\[class\.pf-btn--primary\]="nav\.isLab"/);
    expect(html).toMatch(/\[class\.pf-btn--tertiary\]="nav\.isLab"/);
    const rules = scss.match(/\[data-sheetbar\] \.lf-(back|next|pages|finish)[^{]*\{[^}]*\}/g) ?? [];
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules.filter((r) => !r.includes('.lf-bar__lbl'))) expect(rule, rule).not.toMatch(/(^|[^-])(height|font-size):/);
  });
  it('Pages stays in the middle on every size (the sheet bar never hides it)', () => {
    const mid = scss.match(/\[data-sheetbar\] \.lf-bar__mid\s*\{[^}]*\}/g) ?? [];
    expect(mid.length).toBe(1);
    expect(mid[0]).toMatch(/justify-content:\s*center/);
    expect(mid[0]).not.toMatch(/display:\s*none/);
  });
  it('the lent-bar desktop rules only reach the public pill ([data-formbar]), never the lab bar', () => {
    const lent = scss.match(/::ng-deep html:not\(\.device-touch\) [^{]+/g) ?? [];
    expect(lent.length).toBeGreaterThan(0);
    for (const sel of lent) expect(sel).toContain('[data-formbar]');
    expect(scss).not.toMatch(/\.pf-navact/);
  });
});

describe('band, rail and layout polish (owner 2026-11-12)', () => {
  it('the title is shown once: the page chip carries "Page x of y" and the page title only when it differs', () => {
    expect(html).toMatch(/@if \(pageTitleShown\(\); as t\)/);
    expect(ts).toMatch(/pageTitleShown = computed/);
  });
  it('the rail shows the position once ("x of y"), not a second counter', () => {
    expect(html).not.toContain('lf-rail__of');
    expect(html).not.toContain('visitedCount()');
    expect((html.match(/ of \{\{ wiz\.pages\(\)\.length \}\}/g) ?? []).length).toBe(2); // band chip + rail head
  });
  it('the rail list scrolls inside the rail (no clipped last page) and the form sits next to the rail', () => {
    expect(scss).toMatch(/\.lf-rail \.lf-steps\s*\{[^}]*flex:\s*1 1 0/);
    expect(scss).toMatch(/\.lf-steps,\s*\.lf-menu__list\s*\{[^}]*overflow-y:\s*auto/);
    expect(scss).toMatch(/\.lf-mid\s*\{[^}]*justify-content:\s*center/);
    expect(scss).toMatch(/\.lf-col \.lf-page\s*\{[^}]*margin:\s*0/);
  });
});

/** Owner 2026-11-11: "all the buttons are zoomed in" — only the case sheet's form body is touch-sized. */
describe('touch sizes stay inside the form body', () => {
  const touch = read('apps/lms/src/app/features/casesheets/styles/_touch.scss');
  it('every kit raise in _touch.scss is nested under .cs-page (the questions), none reaches the chrome', () => {
    const body = touch.slice(touch.indexOf(':root.cs-touch {'));
    const inner = body.slice(body.indexOf('.cs-page {'));
    expect(body.indexOf('.cs-page {')).toBeGreaterThan(0);
    // before .cs-page opens, nothing in :root.cs-touch sets a size
    expect(body.slice(0, body.indexOf('.cs-page {'))).not.toMatch(/height|font-size/);
    expect(inner).toMatch(/\.pf-btn \{[^}]*min-height:\s*var\(--pf-touch\)/);
    expect(touch).not.toMatch(/pf-hb__back|pf-dh-actions/);
  });
  it('the fill page chrome (rail, narrative, report) uses the card scale, not a touch raise', () => {
    expect(scss).not.toMatch(/\.lf-step\s*\{[^}]*--pf-touch/);
    expect(scss).toMatch(/\.lf-rail__title\s*\{[^}]*font-size:\s*12px[^}]*text-transform:\s*uppercase/);
    expect(scss).toMatch(/\.lf-nv__title\s*\{[^}]*font-size:\s*15px/);
  });
});

/** Owner 2026-11-12: the patient page keeps legacy's "Fetch from ABHA" box, switched off with a coming-soon note; subtitles stay hidden. */
describe('the patient page ABHA box and the page subtitle', () => {
  it('shows a disabled "Fetch from ABHA" button with a coming-soon hint on a patient page only', () => {
    expect(html).toMatch(/@if \(isPatientPage\(\)\)[\s\S]*?data-abha[\s\S]*?<button[^>]*class="cs-abha__btn"[^>]*disabled[\s\S]*?Fetch from ABHA[\s\S]*?Coming soon/);
    expect(ts).toMatch(/isPatientPage = computed[\s\S]*?includes\('patient'\)/);
  });
  it('prints no page subtitle (legacy dynamic-page had it commented out)', () => {
    expect(html).not.toMatch(/lf-page__sub|page\.subtitle/);
  });
});
