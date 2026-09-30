import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The desktop app loads the renderer from file://, where a root-absolute
 *  URL such as url('/assets/x.svg') resolves to the disk root and silently
 *  renders nothing (the Collect nav icon went blank this way). Global styles
 *  must inline their images or use relative paths. */
describe('Global styles work under Electron file://', () => {
  const css = readFileSync(resolve(process.cwd(), 'apps/lms/src/styles.scss'), 'utf8');

  it('has no root-absolute url() references', () => {
    expect(css).not.toMatch(/url\(\s*['"]?\/(?!\/)/);
  });

  it('the Collect nav icon mask is inlined', () => {
    const rule = css.slice(css.indexOf('.pf-collect-nav-icon'), css.indexOf('}', css.indexOf('.pf-collect-nav-icon')));
    expect(rule).toContain("mask: url('data:image/svg+xml;base64,");
  });
});
