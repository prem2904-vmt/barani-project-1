import { ReceiveSamplesComponent } from './receive-samples.component';

/** Lab Intake rows in the new design (owner): palette + pattern. Asserted on
 *  the compiled component CSS — the rows need a full dispatched-order fixture
 *  to render, which the intake specs elsewhere already cover. */
const css = () => ((ReceiveSamplesComponent as any).ɵcmp.styles as string[]).join('\n');
/** Only the new-design rules (comments are stripped at compile time). */
const nd = () => css().split('}').filter(r => r.includes('design-new')).map(r => r + '}').join('\n');

describe('Lab Intake rows — new design', () => {
  it('no green / amber / teal anywhere in the new-design rules', () => {
    expect(nd()).not.toMatch(/#34d399|52,\s*211,\s*153|245,\s*158,\s*11|#f59e0b|248,\s*113,\s*113|#22d3ee|teal/i);
  });

  it('pending / received rows drop the coloured left stripe', () => {
    expect(nd()).toMatch(/\.pf-rs-row--received[^{]*\{[^}]*border-left:\s*1px solid var\(--nd-line\)/);
  });

  it('received = quieter row + violet check + muted label, no pill fill', () => {
    expect(nd()).toMatch(/\.pf-rs-row--received[^{]*\.pf-rs-row__sample[^{]*\{[^}]*text-tertiary/);
    expect(nd()).toMatch(/\.pf-rs-row__chip\.pf-rs-done[^{]*\{[^}]*background:\s*none/);
    expect(nd()).toMatch(/\.pf-rs-done[^{]*svg[^{]*\{[^}]*violet/);
  });

  it('sample ID is the primary line (16.5 / 600, Noto tabular — no monospace)', () => {
    expect(nd()).toMatch(/\.pf-rs-row__sample[^{]*\{[^}]*font-family:\s*inherit[^}]*font-size:\s*16\.5px[^}]*font-weight:\s*600/);
  });
});
