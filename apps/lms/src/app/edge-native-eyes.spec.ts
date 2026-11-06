import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('OPS-9 Edge native password eye', () => {
  it('global styles hide ::-ms-reveal and ::-ms-clear', () => {
    const css = readFileSync(resolve(__dirname, '../styles.scss'), 'utf8');
    expect(css).toMatch(/input::-ms-reveal,\s*input::-ms-clear\s*\{\s*display:\s*none/);
  });
});
