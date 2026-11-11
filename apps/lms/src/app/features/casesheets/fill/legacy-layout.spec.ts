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

/** Owner 2026-11-11: "the next button is not getting synced" — Back / Next sit under the form column, as wide as it. */
describe('the lab step foot', () => {
  it('lives in the page under the scroller, inside the form column', () => {
    expect(html).toMatch(/<div class="lf-col">\s*<main[\s\S]*?<\/main>\s*@if \(nav\.isLab\) \{[\s\S]*?<footer class="lf-foot" data-step-foot>\s*<div class="lf-foot__in"><ng-container \[ngTemplateOutlet\]="formBarTpl" \/>/);
  });
  it('the foot\'s inner box IS the form column (same max width + side padding as the page)', () => {
    expect(scss).toMatch(/\.lf-page\s*\{[^}]*max-width:\s*var\(--lf-col-max\)[^}]*padding:\s*16px var\(--lf-col-pad\) 32px/);
    expect(scss).toMatch(/\.lf-foot__in\s*\{[^}]*max-width:\s*var\(--lf-col-max\)[^}]*margin:\s*0 auto[^}]*padding:\s*0 var\(--lf-col-pad\)/);
    // Back at the column's left edge, Next at its right edge, whatever is in the middle
    expect(scss).toMatch(/\.lf-foot \.lf-bar\s*\{[^}]*grid-template-columns:\s*1fr auto 1fr/);
    expect(scss).toMatch(/\.lf-foot \.lf-back\s*\{[^}]*justify-self:\s*start/);
    expect(scss).toMatch(/\.lf-foot \.lf-next\s*\{[^}]*justify-self:\s*end/);
  });
  it('in the lab the foot\'s buttons are the kit\'s at their normal size (owner: only the form body is touch-sized)', () => {
    expect(html).toMatch(/class="lf-back pf-touch" \[class\.lf-bar__item\]="!nav\.isLab" \[class\.pf-btn\]="nav\.isLab" \[class\.pf-btn--secondary\]="nav\.isLab"/);
    expect(html).toMatch(/class="lf-next pf-touch"\s+\[class\.lf-bar__item\]="!nav\.isLab"\s+\[class\.pf-btn\]="nav\.isLab"\s+\[class\.pf-btn--primary\]="nav\.isLab"/);
    expect(html).toMatch(/\[class\.pf-btn--tertiary\]="nav\.isLab"/);
    // nothing in the foot re-sizes the kit buttons
    const foot = scss.match(/\.lf-foot \.lf-(back|next|pages|finish)[^{]*\{[^}]*\}/g) ?? [];
    expect(foot.length).toBeGreaterThan(0);
    for (const rule of foot) expect(rule, rule).not.toMatch(/(^|[^-])(height|font-size|padding):/);
  });
  it('the lent-bar desktop rules only reach a lent bar ([data-formbar]), never the lab foot', () => {
    const lent = scss.match(/::ng-deep html:not\(\.device-touch\) [^{]+/g) ?? [];
    expect(lent.length).toBeGreaterThan(0);
    for (const sel of lent) expect(sel).toContain('[data-formbar]');
  });
  it('the lab never lends the controls to the LMS bar', () => {
    expect(ts).toMatch(/const open = !this\.nav\.isLab && /);
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
