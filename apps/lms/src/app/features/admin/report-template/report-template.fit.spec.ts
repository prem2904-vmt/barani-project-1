import { ReportTemplateComponent } from './report-template.component';
import { readReportStyle } from '../../../shared/utils/report-style';

/**
 * Report designer → Patient strip → "Long text" card + the band's Issues chip.
 * The switch and the size picker write `reportStyle.fit` into the template
 * metadata (keeping every other key); switching off again leaves nothing
 * behind, so an untouched lab stores nothing. Methods run against a stub
 * `tpl()` / `patch()` — no TestBed.
 */
describe('Report designer — Long text (text fitting)', () => {
  const proto = ReportTemplateComponent.prototype as any;
  const make = (metadata: string | null, issues = { count: 0, lines: [] as string[] }) => {
    let tpl: Record<string, unknown> = { metadata };
    const self: any = {
      tpl: () => tpl,
      patch: (p: Record<string, unknown>) => { tpl = { ...tpl, ...p }; },
      issues: () => issues,
      setTab: (t: string) => { self.tab = t; },
    };
    self.setFit = (p: unknown) => proto.setFit.call(self, p);
    return {
      self,
      setFit: (p: unknown) => proto.setFit.call(self, p),
      setMinPt: (v: string) => proto.setMinPt.call(self, v),
      meta: () => JSON.parse(String(tpl['metadata'] ?? '{}')),
      style: () => readReportStyle(tpl as never),
    };
  };

  it('turning it on writes only the fit key and keeps the other metadata', () => {
    const m = make(JSON.stringify({ reportTheme: 'source-sans', options: { abnormalSummary: true } }));
    m.setFit({ enabled: true });
    expect(m.meta().reportStyle).toEqual({ v: 1, fit: { enabled: true } });
    expect(m.meta().reportTheme).toBe('source-sans');
    expect(m.meta().options).toEqual({ abnormalSummary: true });
  });

  it('the smallest size and the name-column switch ride along; turning it all off removes the key', () => {
    const m = make(null);
    m.setFit({ enabled: true });
    m.setMinPt('6.5');
    m.setFit({ autoColumns: true });
    expect(m.style().fit).toEqual({ enabled: true, minPt: 6.5, maxLines: 2, autoColumns: true });
    m.setFit({ enabled: false, minPt: 7, autoColumns: false });
    expect(m.meta().reportStyle).toBeUndefined();
  });

  it('a junk size is ignored', () => {
    const m = make(null);
    m.setMinPt('abc');
    m.setMinPt('99');
    expect(m.meta().reportStyle).toBeUndefined();
  });

  it('the classic Warnings chip sends the person to the first warning\'s field', () => {
    const m = make(null, { count: 3, lines: ['a runs into b'] });
    const go = vi.fn(async () => true);
    m.self.warnSpots = () => [{ line: 'a runs into b', page: 1, x: 0, y: 0, w: 0, h: 0, target: { tab: 'patient', anchor: 'pf-long-text', focus: '' } }];
    m.self.goToWarning = go;
    proto.openIssues.call(m.self);
    expect(go).toHaveBeenCalledWith(expect.objectContaining({ line: 'a runs into b' }));
  });
});
