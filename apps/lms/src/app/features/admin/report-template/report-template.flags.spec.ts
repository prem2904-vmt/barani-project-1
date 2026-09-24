import { ReportTemplateComponent } from './report-template.component';

/**
 * Abnormal-result marks, High vs Low made explicit (QA 2026-09-24): the live
 * preview shows a HIGH and a LOW row, each option names both marks, and the
 * legend spells the pair out. Methods run against a stub `tpl()` — no TestBed.
 */
describe('Report layout — High / Low abnormal marks', () => {
  const proto = ReportTemplateComponent.prototype as any;
  const withTpl = (tpl: Record<string, unknown>) => {
    const self: any = { tpl: () => tpl };
    self.flagGlyph = proto.flagGlyph.bind(self);
    return {
      glyph: (d: 'high' | 'low') => self.flagGlyph(d),
      color: (d: 'high' | 'low') => proto.flagDemoColor.call(self, d),
      legend: () => proto.flagLegend.call(self),
    };
  };

  it('letters (default): H for high, L for low', () => {
    const t = withTpl({});
    expect([t.glyph('high'), t.glyph('low')]).toEqual(['H', 'L']);
    expect(t.legend()).toContain('High: H');
    expect(t.legend()).toContain('Low: L');
  });

  it('arrows: ▲ for high, ▼ for low (what the PDF draws)', () => {
    const t = withTpl({ flagIndicator: 'arrow' });
    expect([t.glyph('high'), t.glyph('low')]).toEqual(['▲', '▼']);
    expect(t.legend()).toContain('High: ▲');
    expect(t.legend()).toContain('Low: ▼');
  });

  it('none: no marks, plain colour', () => {
    const t = withTpl({ flagIndicator: 'none', flagStyle: 'bold_color' });
    expect([t.glyph('high'), t.glyph('low')]).toEqual(['', '']);
    expect(t.color('high')).toBe('#111');
    expect(t.legend()).toContain('No marks');
  });

  it('bold + colour paints high and low with their own colours', () => {
    const t = withTpl({ flagStyle: 'bold_color', abnormalColor: '#aa0000', abnormalLowColor: '#0000aa' });
    expect(t.color('high')).toBe('#aa0000');
    expect(t.color('low')).toBe('#0000aa');
  });

});
