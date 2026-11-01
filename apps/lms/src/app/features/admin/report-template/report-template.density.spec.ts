import { ReportTemplateComponent } from './report-template.component';
import { readReportStyle } from '../../../shared/utils/report-style';

/**
 * Report designer -> Results table -> "Page density" card. Density and the
 * squeeze switch write `reportStyle` into the template metadata (every other key
 * kept); switching back leaves nothing behind. The "Widen the name column" switch
 * lives on this card now and still writes `reportStyle.fit.autoColumns`.
 * Methods run against a stub `tpl()` / `patch()` - no TestBed.
 */
describe('Report designer — Page density', () => {
  const proto = ReportTemplateComponent.prototype as any;
  const make = (metadata: string | null) => {
    let tpl: Record<string, unknown> = { metadata };
    const self: any = { tpl: () => tpl, patch: (p: Record<string, unknown>) => { tpl = { ...tpl, ...p }; }, };
    return {
      self,
      setDensity: (v: string) => proto.setDensity.call(self, v),
      setSqueeze: (on: boolean) => proto.setSqueeze.call(self, on),
      setFit: (p: unknown) => proto.setFit.call(self, p),
      meta: () => JSON.parse(String(tpl['metadata'] ?? '{}')),
      style: () => readReportStyle(tpl as never),
    };
  };

  it('Compact writes only the density key and keeps the other metadata', () => {
    const m = make(JSON.stringify({ reportTheme: 'source-sans', options: { abnormalSummary: true } }));
    m.setDensity('compact');
    expect(m.meta().reportStyle).toEqual({ v: 1, density: 'compact' });
    expect(m.meta().reportTheme).toBe('source-sans');
    expect(m.meta().options).toEqual({ abnormalSummary: true });
  });

  it('back to Normal leaves nothing behind', () => {
    const m = make(null);
    m.setDensity('compact');
    m.setDensity('normal');
    expect(m.meta().reportStyle).toBeUndefined();
  });

  it('a junk density is Normal', () => {
    const m = make(null);
    m.setDensity('huge');
    expect(m.meta().reportStyle).toBeUndefined();
  });

  it('the squeeze switch rides along with the density and with text fitting', () => {
    const m = make(null);
    m.setFit({ enabled: true });
    m.setDensity('compact');
    m.setSqueeze(true);
    expect(m.style()).toMatchObject({ density: 'compact', squeeze: true, fit: { enabled: true } });
    m.setSqueeze(false);
    expect(m.style().squeeze).toBe(false);
    expect(m.meta().reportStyle).toEqual({ v: 1, fit: { enabled: true }, density: 'compact' });
  });

  it('the name-column switch (now on this card) writes fit.autoColumns', () => {
    const m = make(null);
    m.setFit({ enabled: true });
    m.setFit({ autoColumns: true });
    expect(m.style().fit.autoColumns).toBe(true);
    m.setFit({ autoColumns: false });
    expect(m.meta().reportStyle).toEqual({ v: 1, fit: { enabled: true } });
  });
});
