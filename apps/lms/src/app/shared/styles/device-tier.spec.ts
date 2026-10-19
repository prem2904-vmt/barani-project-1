import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { encapsulateStyle } from '@angular/compiler';
import * as sass from 'sass';

/**
 * The tablet-vs-desktop switch is ONE mechanism: shared/styles/_device-tier.scss.
 * Below 1280px nothing changed; at 1280px+ a touch-first device
 * (html.device-touch) keeps the TABLET layout and a mouse device keeps the
 * DESKTOP layout, byte-for-byte as before.
 */

const SRC = resolve(process.cwd(), 'apps/lms/src');
const TIER = readFileSync(join(SRC, 'app/shared/styles/_device-tier.scss'), 'utf8');

/** Compile a component stylesheet that uses the mixins, the way Angular does
 *  (Sass, then emulated encapsulation), and return its top-level blocks. */
function compile(body: string): string {
  const css = sass.compileString(`${TIER}\n${body}`).css;
  return encapsulateStyle(css, 'c0');
}

interface Rule { media: string; selector: string }
function rules(css: string): Rule[] {
  const out: Rule[] = [];
  const re = /@media ([^{]+)\{([\s\S]*?)\n\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const inner = m[2];
    const sel = /([^{}]+)\{/g;
    let s: RegExpExecArray | null;
    while ((s = sel.exec(inner))) out.push({ media: m[1].trim(), selector: s[1].trim() });
  }
  return out;
}

/** Tiny media evaluator for the queries these mixins emit. */
function mediaMatches(q: string, width: number): boolean {
  return q.split(/\s+and\s+/).every((part) => {
    const mm = /\((min|max)-width:\s*(\d+)px\)/.exec(part);
    if (!mm) return true; // (pointer: coarse) etc. — not under test here
    const n = Number(mm[2]);
    return mm[1] === 'min' ? width >= n : width <= n;
  });
}

/** Does a shimmed selector list match an element inside the component, given
 *  the <html> classes? (Only the html-level condition varies in these tests.) */
function selectorMatches(selector: string, touch: boolean): boolean {
  return selector.split(',').some((one) => {
    if (/:where\(html\.device-touch\)/.test(one)) return touch;
    if (/:where\(html:not\(\.device-touch\)\)/.test(one)) return !touch;
    return true;
  });
}

function applies(css: string, width: number, touch: boolean): boolean {
  return rules(css).some((r) => mediaMatches(r.media, width) && selectorMatches(r.selector, touch));
}

describe('device tier mixins (the ONE tablet-vs-desktop switch)', () => {
  const tablet = compile('@include tablet-tier { .probe { color: red; } }');
  const band = compile('@include tablet-band { .probe { color: red; } }');
  const desktop = compile('@include desktop-only { .probe { color: red; } }');

  it('tablet layout on touch at 1280 and 1440 (landscape Android tablet / iPad Pro); desktop layout with a mouse', () => {
    for (const w of [1280, 1366, 1440, 1920]) {
      expect(applies(tablet, w, true), `tablet-tier touch @${w}`).toBe(true);
      expect(applies(tablet, w, false), `tablet-tier mouse @${w}`).toBe(false);
      expect(applies(band, w, true), `tablet-band touch @${w}`).toBe(true);
      expect(applies(band, w, false), `tablet-band mouse @${w}`).toBe(false);
      expect(applies(desktop, w, true), `desktop-only touch @${w}`).toBe(false);
      expect(applies(desktop, w, false), `desktop-only mouse @${w}`).toBe(true);
    }
  });

  it('below 1280px nothing changed: same as the old width-only queries, touch or not', () => {
    for (const touch of [true, false]) {
      for (const w of [390, 640, 641, 800, 1024, 1279]) {
        expect(applies(tablet, w, touch), `tablet-tier @${w}`).toBe(w <= 1279);
        expect(applies(band, w, touch), `tablet-band @${w}`).toBe(w >= 641 && w <= 1279);
        expect(applies(desktop, w, touch), `desktop-only @${w}`).toBe(false);
      }
    }
  });

  it('the old query is emitted verbatim, and the touch copy adds NO specificity (:where)', () => {
    expect(tablet).toMatch(/@media \(max-width: 1279px\) \{\s*\.probe\[_ngcontent-c0\]/);
    expect(band).toMatch(/@media \(min-width: 641px\) and \(max-width: 1279px\) \{\s*\.probe\[_ngcontent-c0\]/);
    expect(tablet).toMatch(/:where\(html\.device-touch\)\[_nghost-c0\] +\.probe\[_ngcontent-c0\]/);
    expect(desktop).toMatch(/:where\(html:not\(\.device-touch\)\)\[_nghost-c0\] +\.probe\[_ngcontent-c0\]/);
  });

  it('combines with an existing :host-context (nav-bottom rules in the top strip)', () => {
    const css = compile('@include tablet-tier { :host-context(.design-new.nav-bottom) .probe { color: red; } }');
    expect(css).toContain(':where(html.device-touch).design-new.nav-bottom[_nghost-c0]   .probe[_ngcontent-c0]');
  });
});

/* ── Guard: no screen switches tablet/desktop on raw width any more ── */

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(ts|scss|css)$/.test(name) && !/\.spec\.ts$/.test(name)) acc.push(p);
  }
  return acc;
}

describe('every tablet/desktop switch goes through the device tier', () => {
  const files = walk(join(SRC, 'app')).filter((f) => !f.endsWith('_device-tier.scss'));

  it('no raw @media (max-width: 1279px) / (min-width: 1280px) left in component styles', () => {
    const offenders = files.filter((f) => /@media[^{]*\((max-width:\s*1279px|min-width:\s*1280px)\)/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => f.slice(SRC.length + 1))).toEqual([]);
  });

  it('the shell hides the desktop top chrome through the tablet tier (touch at any width)', () => {
    const shell = readFileSync(join(SRC, 'app/layout/shell/shell.component.ts'), 'utf8');
    expect(shell).toMatch(/@use '\.\.\/\.\.\/shared\/styles\/device-tier' as dt;/);
    expect(shell).toMatch(/@include dt\.tablet-tier \{\s*\.pf-chrome \{ display: none !important; \}/);
  });

  it('the docked bar goes icon-only on touch at every width (top strip)', () => {
    const ts = readFileSync(join(SRC, 'app/layout/top-strip/top-strip.component.scss'), 'utf8');
    expect(ts).toMatch(/@include dt\.tablet-tier \{\s*\/\*[\s\S]*?\*\/\s*:host-context\(\.design-new\.nav-bottom\) \.pf-topnav-link \{/);
  });

  it('result entry keeps its numpad rail on touch (desktop-only hides it)', () => {
    const re = readFileSync(join(SRC, 'app/features/lab/result-entry/result-entry.component.ts'), 'utf8');
    expect(re).toMatch(/@include dt\.desktop-only \{\s*\.pf-rail \{ display: none !important; \}/);
    expect(re).not.toMatch(/class="[^"]*xl:grid-cols-1/);
  });
});
