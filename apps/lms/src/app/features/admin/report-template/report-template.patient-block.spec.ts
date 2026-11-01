import { ReportTemplateComponent } from './report-template.component';
import { readReportStyle } from '../../../shared/utils/report-style';

/**
 * Report designer → Patient strip → Age & sex / Field names / Frame / Every page.
 * Every control writes `reportStyle.patient` (or `pageNumbers`) into the template
 * metadata, keeping the other keys; turning it back off leaves nothing behind.
 * Choosing One field / Two lines rewrites an arranged strip's age + sex chips.
 * Methods run against a stub `tpl()` / `patch()` — no TestBed.
 */
describe('Report designer — patient block options', () => {
  const proto = ReportTemplateComponent.prototype as any;
  const make = (tplPatch: Record<string, unknown> = {}, cols: string[][] = [[], [], []], scope = 'default') => {
    let tpl: Record<string, unknown> = { metadata: null, ...tplPatch };
    let patientCols = cols;
    const self: any = {
      tpl: () => tpl,
      patch: (p: Record<string, unknown>) => { tpl = { ...tpl, ...p }; },
      patientCols: Object.assign(() => patientCols, { set: (c: string[][]) => { patientCols = c; } }),
      patientScope: () => scope,
    };
    self.reportStyle = () => readReportStyle(tpl as never);
    return {
      call: (name: string, ...a: unknown[]) => proto[name].apply(self, a),
      meta: () => JSON.parse(String(tpl['metadata'] ?? '{}')),
      style: () => readReportStyle(tpl as never),
      tpl: () => tpl,
      cols: () => patientCols,
    };
  };

  it('One field: writes combined + the "45 Y" wording; Two lines puts both back and stores nothing', () => {
    const m = make({ metadata: JSON.stringify({ reportTheme: 'source-sans' }) });
    m.call('setAgeSex', 'combined');
    expect(m.style().patient).toMatchObject({ ageSex: 'combined', ageStyle: 'short' });
    expect(m.meta().reportTheme).toBe('source-sans');
    m.call('setAgeSex', 'separate');
    expect(m.meta().reportStyle).toBeUndefined();
    expect(m.meta().reportTheme).toBe('source-sans');
  });

  it('a lab\'s own age wording survives the switch', () => {
    const m = make();
    m.call('setPatientStyle', { ageStyle: 'yrs' });
    m.call('setAgeSex', 'combined');
    expect(m.style().patient.ageStyle).toBe('yrs');
  });

  it('an arranged strip: age + sex become the one ageSex chip, and back, in the saved columns JSON', () => {
    const arranged = [['name', 'age', 'sex', 'mrn'], ['specimen'], ['barcode']];
    const m = make({ patientColumnsJson: JSON.stringify(arranged) }, arranged);
    m.call('setAgeSex', 'combined');
    expect(JSON.parse(String(m.tpl()['patientColumnsJson']))).toEqual([['name', 'ageSex', 'mrn'], ['specimen'], ['barcode']]);
    expect(m.cols()[0]).toEqual(['name', 'ageSex', 'mrn']);
    m.call('setAgeSex', 'separate');
    expect(JSON.parse(String(m.tpl()['patientColumnsJson']))).toEqual(arranged);
  });

  it('a never-arranged strip is NOT turned into an arranged one (no columns JSON written)', () => {
    const m = make({ patientColumnsJson: null });
    m.call('setAgeSex', 'combined');
    expect(m.tpl()['patientColumnsJson']).toBeNull();
  });

  it('a department scope only changes the style (the renderer merges age + sex itself)', () => {
    const m = make({ patientColumnsJson: JSON.stringify([['age', 'sex']]) }, [['age', 'sex']], 'dept-1');
    m.call('setAgeSex', 'combined');
    expect(JSON.parse(String(m.tpl()['patientColumnsJson']))).toEqual([['age', 'sex']]);
    expect(m.style().patient.ageSex).toBe('combined');
  });

  it('renaming a field, clearing it, and the chip list', () => {
    const m = make();
    m.call('setLabel', 'orderid', 'Lab No.');
    m.call('setLabel', 'mrn', 'UHID');
    expect(m.style().patient.labels).toEqual({ orderid: 'Lab No.', mrn: 'UHID' });
    m.call('setLabel', 'orderid', '   ');
    expect(m.style().patient.labels).toEqual({ mrn: 'UHID' });
    m.call('setLabel', 'mrn', '');
    expect(m.meta().reportStyle).toBeUndefined();
  });

  it('frame, joiner, status, patient line and Page N of M each write one key and clear back to nothing', () => {
    const m = make();
    m.call('setPatientStyle', { frame: 'tint' });
    m.call('setPatientStyle', { labelJoiner: ': ' });
    m.call('setPatientStyle', { showReportStatus: true });
    m.call('setPatientStyle', { continuation: 'mini' });
    m.call('setPageNumbers', true);
    expect(m.meta().reportStyle).toEqual({ v: 1, pageNumbers: 'n-of-m', patient: { frame: 'tint', labelJoiner: ': ', showReportStatus: true, continuation: 'mini' } });
    m.call('setPatientStyle', { frame: 'rules', labelJoiner: 'auto', showReportStatus: false, continuation: 'none' });
    m.call('setPageNumbers', false);
    expect(m.meta().reportStyle).toBeUndefined();
  });
});
