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
const card = read('apps/lms/src/app/features/casesheets/studio/editor/field-card.component.scss');
const dept = read('apps/lms/src/app/features/casesheets/departments/forms.page.scss');
const deptHtml = read('apps/lms/src/app/features/casesheets/departments/forms.page.html');
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
  });
  it('the PF Listen tab has its own name', () => {
    expect(fillHtml).toMatch(/aria-label="PF Listen"/);
  });
});

describe('Studio question title', () => {
  it('wraps at word boundaries, never letter by letter', () => {
    expect(card).not.toMatch(/\.fc-label__t\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(card).toMatch(/\.fc-label__t\s*\{[^}]*min-width:\s*0[^}]*overflow-wrap:\s*break-word/);
  });
  it('on a phone the quick actions leave the title row', () => {
    expect(card).toMatch(/@media \(max-width: 640px\)\s*\{[^@]*\.fc-head\s*\{\s*flex-wrap:\s*wrap/);
  });
});

describe('case-sheet search box', () => {
  it('hides the browser clear button and offers our own SVG one', () => {
    expect(dept).toMatch(/::-webkit-search-cancel-button/);
    expect(deptHtml).toMatch(/class="dp__clear"[^>]*aria-label="Clear search"/);
    expect(deptHtml).toMatch(/<svg[^>]*>\s*<path d="M18 6 6 18M6 6l12 12"/);
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
