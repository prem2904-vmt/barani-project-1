import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Safe-area insets: ONE source of truth per edge (owner, real iPad: an empty
 * band sat under the docked bottom navbar).
 *
 *  - bottom: the docked navbar (.pf-chrome) pads env(safe-area-inset-bottom)
 *    exactly once, INSIDE its own box, so its background runs to the physical
 *    edge. No ancestor (html / body / app-root / shell) adds it again.
 *  - top: <html> absorbs the status-bar inset once; the bar never re-adds it.
 *  - native: WKWebView adds no inset of its own (contentInset 'never'), and the
 *    Keyboard plugin no longer shrinks the WebView for an accessory-only
 *    "keyboard" (iPad shortcuts bar: hardware keyboard / the numpad's
 *    inputmode="none" fields) — that shrink WAS the empty band.
 */
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const global = read('apps/lms/src/styles.scss');
const shell = read('apps/lms/src/app/layout/shell/shell.component.ts');
const topStrip = read('apps/lms/src/app/layout/top-strip/top-strip.component.scss');
const indexHtml = read('apps/lms/src/index.html');
const capConfig = read('capacitor.config.ts');
const pkg = JSON.parse(read('package.json'));
const kbPatch = read('patches/@capacitor+keyboard+8.0.3.patch');

/** Strip comments so prose that NAMES a property can't satisfy / trip a rule. */
const noComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const g = noComments(global);
const sh = noComments(shell);

/** Every top-level block whose selector list is exactly `sel` (e.g. `html`). */
function blocks(css: string, sel: RegExp): string[] {
  const out: string[] = [];
  const re = new RegExp(`(^|\\n)\\s*${sel.source}\\s*\\{([^}]*)\\}`, 'g');
  for (const m of css.matchAll(re)) out.push(m[2]);
  return out;
}
const count = (s: string, needle: RegExp) => (s.match(new RegExp(needle.source, 'g')) ?? []).length;

describe('Safe area — bottom edge has ONE owner (the docked navbar)', () => {
  it('<html> adds no bottom inset (padding-bottom is 0), and is border-box at 100dvh', () => {
    const html = blocks(g, /html/);
    expect(html.length).toBeGreaterThan(0);
    const base = html.find((b) => /height:\s*100dvh/.test(b))!;
    expect(base).toBeDefined();
    expect(base).toMatch(/box-sizing:\s*border-box/);
    expect(base).toMatch(/padding-bottom:\s*0\s*;/);
    for (const b of html) expect(b).not.toMatch(/safe-area-inset-bottom/);
  });

  it('no ancestor of the shell (html, html.cap-*, body, app-root) pads or offsets the bottom inset', () => {
    const ancestors = [
      ...blocks(g, /html/),
      ...blocks(g, /html\.cap-native[\w.-]*/),
      ...blocks(g, /body/),
      ...blocks(g, /app-root/),
      ...blocks(g, /app-root > router-outlet \+ \*/),
    ];
    expect(ancestors.length).toBeGreaterThan(3);
    for (const b of ancestors) {
      expect(b).not.toMatch(/safe-area-inset-bottom/);
      expect(b).not.toMatch(/--pf-safe-bottom/);
    }
  });

  it('<body> fills html\'s content box (100%), not 100dvh — it must not run past the physical bottom', () => {
    const body = blocks(g, /body/).find((b) => /height:/.test(b))!;
    expect(body).toMatch(/(^|[^-])height:\s*100%/);
    expect(body).not.toMatch(/100d?vh/);
  });

  it('the shell applies env(safe-area-inset-bottom) exactly once — on the docked bar, as padding', () => {
    expect(count(sh, /safe-area-inset-bottom/)).toBe(1);
    const rule = [...sh.matchAll(/:host-context\(\.design-new\.nav-bottom\) \.pf-chrome \{([^}]*)\}/g)]
      .map((m) => m[1])
      .find((b) => /safe-area-inset-bottom/.test(b))!;
    expect(rule).toBeDefined();
    expect(rule).toMatch(/position:\s*fixed/);
    expect(rule).toMatch(/bottom:\s*0\s*;/);
    expect(rule).toMatch(/padding-bottom:\s*env\(safe-area-inset-bottom, 0px\)/);
    // Flush: no margin, no min-height, no inset added as an offset.
    expect(rule).toMatch(/margin:\s*0/);
    expect(rule).not.toMatch(/min-height/);
    expect(rule).not.toMatch(/(^|[\s;])(bottom|margin-bottom):\s*(calc|env)/);
  });

  it('the bar content height is the token only — the inset is never baked into the inner bar', () => {
    expect(noComments(topStrip)).not.toMatch(/safe-area-inset-bottom/);
    expect(g).toMatch(/--pf-botbar-h:\s*calc\(var\(--pf-navbar-h\) \+ 1px \+ env\(safe-area-inset-bottom, 0px\)\)/);
    // The clearance token counts the inset once, not twice.
    const botbar = g.match(/--pf-botbar-h:[^;]*;/)![0];
    expect(count(botbar, /safe-area-inset-bottom/)).toBe(1);
  });

  it('page content clears the bar through the token (no second raw inset on shell-main)', () => {
    expect(sh).toMatch(/\.shell-main \{\s*padding-bottom:\s*calc\(var\(--pf-botbar-h, 5\dpx\) \+ 12px\) !important;/);
  });
});

describe('Safe area — top edge has ONE owner (<html>)', () => {
  it('html pads the status-bar inset; native iOS keeps its first-paint floor', () => {
    expect(blocks(g, /html/).some((b) => /padding-top:\s*env\(safe-area-inset-top\)/.test(b))).toBe(true);
    expect(g).toMatch(/html\.cap-native \{\s*padding-top:\s*max\(env\(safe-area-inset-top\), 50px\);/);
  });

  it('Android native uses the reported inset (no floor, no hard 0 that ignores edge-to-edge)', () => {
    const android = blocks(g, /html\.cap-native\.cap-android/).join('\n');
    expect(android).toMatch(/padding-top:\s*env\(safe-area-inset-top(, 0px)?\)/);
    expect(android).not.toMatch(/padding-top:\s*0\s*;/);
    expect(android).not.toMatch(/max\(/);
  });

  it('neither the chrome nor the bar re-adds the top inset', () => {
    const chromeRules = [...sh.matchAll(/\.pf-chrome \{([^}]*)\}/g)].map((m) => m[1]).join('\n');
    expect(chromeRules).not.toMatch(/safe-area-inset-top/);
    expect(noComments(topStrip)).not.toMatch(/safe-area-inset-top/);
  });
});

describe('Safe area — native shells', () => {
  it('the page is laid out under the system bars (viewport-fit=cover) so env() reports real insets', () => {
    expect(indexHtml).toMatch(/<meta name="viewport"[^>]*viewport-fit=cover/);
  });

  it('iOS WKWebView adds no content inset of its own (CSS is the single owner)', () => {
    expect(capConfig).toMatch(/contentInset:\s*'never'/);
    expect(capConfig).not.toMatch(/contentInset:\s*'(always|automatic|scrollableAxes)'/);
  });

  it('the Keyboard plugin ignores accessory-only keyboards (iPad shortcuts bar) — patched and applied on install', () => {
    expect(pkg.scripts.postinstall).toMatch(/patch-package/);
    expect(pkg.dependencies['@capacitor/keyboard'] ?? pkg.devDependencies?.['@capacitor/keyboard']).toMatch(/8\.0\.3$/);
    expect(kbPatch).toMatch(/\+\+\+ b\/node_modules\/@capacitor\/keyboard\/ios\/Sources\/KeyboardPlugin\/Keyboard\.m/);
    expect(kbPatch).toMatch(/^\+\s*if \(rect\.size\.height < 100\) \{$/m);
    expect(kbPatch).toMatch(/^\+\s*\[self onKeyboardWillHide:notification\];$/m);
    // The guard sits BEFORE the iPad stage-manager branch caches an offset.
    expect(kbPatch.indexOf('rect.size.height < 100')).toBeLessThan(kbPatch.indexOf('UIUserInterfaceIdiomPad'));
  });
});
