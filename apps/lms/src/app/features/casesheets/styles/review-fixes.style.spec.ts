import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Style contracts from the case-sheets end-to-end review (the CSS cannot be seen by a unit test, so the source is read):
 * the page menu's colours are tokens, the "Edit your report" tab row keeps its height, the Studio question title wraps on
 * word boundaries, the search box has its own clear button, and the starter pictures follow the theme.
 */
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');
const fill = read('apps/lms/src/app/features/casesheets/fill/case.page.scss');
const fillHtml = read('apps/lms/src/app/features/casesheets/fill/case.page.html');
const dept = read('apps/lms/src/app/features/casesheets/departments/forms.page.scss');
const deptHtml = read('apps/lms/src/app/features/casesheets/departments/forms.page.html');
const editor = read('apps/lms/src/app/features/casesheets/studio/editor/editor.page.scss');
const canvas = read('libs/forms-engine/src/lib/canvas/_canvas.scss');

describe('page menu contrast', () => {
  it('counts use the strong text colours, never white-on-tint or the faint tertiary one', () => {
    expect(fill).not.toMatch(/\.lf-menu \.lf-step--on \.lf-step__c\s*\{[^}]*rgba\(255,\s*255,\s*255/);
    expect(fill).toMatch(/\.lf-step--on \.lf-step__c\s*\{[^}]*var\(--violet-text/);
    expect(fill).toMatch(/\.lf-step__c\s*\{[^}]*color:\s*var\(--text-secondary\)/);
    expect(fill).toMatch(/\.lf-rail__count\s*\{[^}]*color:\s*var\(--text-secondary\)/);
  });
  it('the active number badge is ringed so it separates from the tinted row', () => {
    expect(fill).toMatch(/\.lf-step--on \.lf-step__n\s*\{[^}]*box-shadow:[^;]*var\(--pf-card-bg/);
  });
});

describe('Edit your report on a phone', () => {
  it('the head, tab row and foot keep their height; only the body scrolls', () => {
    expect(fill).toMatch(/\.rp__head,\s*\.rp__tabs,\s*\.rp__foot\s*\{\s*flex:\s*none/);
    expect(fill).toMatch(/\.rp__body\s*\{[^}]*overflow-y:\s*auto/);
    // the global tab-strip rules once left the tab row and the foot shifted right
    expect(fill).toMatch(/\.rp__tabs\s*\{[^}]*width:\s*100%/);
    expect(fill).toMatch(/\.rp__foot\s*\{[^}]*width:\s*100%/);
  });
  it('the PF Listen tab has its own name', () => {
    expect(fillHtml).toMatch(/aria-label="PF Listen"/);
  });
});

describe('Studio question row', () => {
  it('its title may shrink and never breaks letter by letter', () => {
    expect(editor).not.toMatch(/\.lg-fcard__label\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(editor).toMatch(/\.lg-fcard__info\s*\{[^}]*min-width:\s*0/);
  });
});

describe('Studio page rail', () => {
  it('a page name wraps between words, and the grip leaves it room', () => {
    expect(editor).not.toMatch(/\.ed-pbtn__t\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(editor).toMatch(/\.ed-pbtn__t\s*\{[^}]*overflow-wrap:\s*break-word[^}]*word-break:\s*normal/);
    expect(editor).toMatch(/\.ed-pages \.ed-grip\s*\{\s*width:\s*28px/);
  });
});

describe('case-sheet search box', () => {
  it('Prepare home searches in the band (no native search field, so no browser clear button to hide)', () => {
    expect(deptHtml).toMatch(/<pf-hero-band[^>]*\[placeholder\]="searchPlaceholder\(\)"/);
    // The band is THE search (owner 2026-11-21): no second search field in the card head, drafts included.
    expect(deptHtml.match(/<input[^>]*type="search"[^>]*>/g) ?? []).toEqual([]);
    expect(deptHtml).not.toMatch(/data-draft-search/);
    expect(dept).not.toMatch(/dp__search/);
  });
});

describe('body-map artwork', () => {
  it('the paper and the starter drawing follow the theme through tokens', () => {
    expect(canvas).toMatch(/:root\.dark\s*\{[^}]*--fe-cv-art-filter:\s*invert\(1\)/);
    expect(canvas).toMatch(/\.fe-cv__image\.is-art\s*\{\s*filter:\s*var\(--fe-cv-art-filter\)/);
    // only an uploaded picture / photo is forced white
    expect(read('libs/forms-engine/src/lib/canvas/canvas.component.ts')).toMatch(/is-doc\]="!!imageUrl\(\) && !artwork\(\)"/);
  });
});
