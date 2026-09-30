import { ReportTemplateComponent } from './report-template.component';
import { readReportTheme } from '../../../shared/utils/report-theme';

/**
 * Report designer → Results table → "Report theme" picker: choosing a card
 * writes the theme into the template's metadata (keeping every other key —
 * the letterhead layout, the report options), Classic removes it, and
 * re-picking the current theme is a no-op. Methods run against a stub
 * `tpl()` / `patch()` — no TestBed.
 */
describe('Report designer — report theme picker', () => {
  const proto = ReportTemplateComponent.prototype as any;
  const make = (metadata: string | null) => {
    const patches: Array<Record<string, unknown>> = [];
    let tpl: Record<string, unknown> = { metadata };
    const self: any = {
      tpl: () => tpl,
      reportTheme: () => readReportTheme(tpl as never),
      patch: (p: Record<string, unknown>) => { patches.push(p); tpl = { ...tpl, ...p }; },
    };
    return { pick: (id: string) => proto.setReportTheme.call(self, id), patches, tpl: () => tpl };
  };

  it('picking Modern stores it and keeps the other metadata keys', () => {
    const m = make(JSON.stringify({ headerLayout: { v: 1, items: {} }, options: { abnormalSummary: true } }));
    m.pick('source-sans');
    const meta = JSON.parse(String(m.tpl()['metadata']));
    expect(meta.reportTheme).toBe('source-sans');
    expect(meta.options).toEqual({ abnormalSummary: true });
    expect(meta.headerLayout).toEqual({ v: 1, items: {} });
  });

  it('back to Classic removes the key; re-picking the current theme patches nothing', () => {
    const m = make(JSON.stringify({ reportTheme: 'source-sans' }));
    m.pick('source-sans');
    expect(m.patches).toHaveLength(0);
    m.pick('classic');
    expect(JSON.parse(String(m.tpl()['metadata'])).reportTheme).toBeUndefined();
  });
});
