import { previewTemplateForTab } from './report-template.component';
import { readReportOption, writeReportOption } from '../../../shared/utils/report-header-layout';

describe('report template preview — Table columns tab hides the summary sheet', () => {
  const on = { metadata: writeReportOption({ metadata: JSON.stringify({ headerLayout: { k: 1 } }) }, 'abnormalSummary', true) };

  it('columns tab: the preview template has the summary off, other metadata kept', () => {
    const t = previewTemplateForTab('columns', on);
    expect(readReportOption(t, 'abnormalSummary')).toBe(false);
    expect(JSON.parse(t.metadata as string).headerLayout).toEqual({ k: 1 });
    expect(readReportOption(on, 'abnormalSummary')).toBe(true);   // the saved template is untouched
  });

  it('other tabs keep the lab setting', () => {
    for (const tab of ['letterhead', 'patient', 'results', 'footer']) {
      expect(readReportOption(previewTemplateForTab(tab, on), 'abnormalSummary')).toBe(true);
    }
  });

  it('summary off: returned as-is', () => {
    const off = { metadata: null };
    expect(previewTemplateForTab('columns', off)).toBe(off);
  });
});
