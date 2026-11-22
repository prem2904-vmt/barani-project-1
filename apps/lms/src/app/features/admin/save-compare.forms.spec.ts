import { signal } from '@angular/core';
import { ReportTemplateComponent } from './report-template/report-template.component';
import { ReferringNetworkComponent } from './referring-network/referring-network.component';

/**
 * SAVE ONLY WHEN SOMETHING CHANGED (owner 2026-11-19) — the compares behind two Saves that used to be "touched" flags
 * or always-on buttons. Methods run against stubs (no TestBed), like unsaved-pages.spec.
 */
const rt = ReportTemplateComponent.prototype as any;
const rn = ReferringNetworkComponent.prototype as any;

describe('Report design: the template is compared by VALUE', () => {
  const key = (t: unknown) => rt.tplKey.call({}, t);
  it('JSON-in-a-string fields (metadata, …Json) written back in another key order are not a change', () => {
    const saved = { labName: 'Demo Lab', metadata: JSON.stringify({ headerLayout: { items: {}, v: 1 }, options: { specimenLine: true } }) };
    const again = { metadata: JSON.stringify({ options: { specimenLine: true }, headerLayout: { v: 1, items: {} } }), labName: 'Demo Lab' };
    expect(key(again)).toBe(key(saved));
  });
  it('a real difference inside the metadata IS a change; an undefined key is the same as no key', () => {
    const saved = { labName: 'Demo Lab', metadata: JSON.stringify({ headerLayout: { v: 1, items: {} } }) };
    expect(key({ ...saved, metadata: JSON.stringify({ headerLayout: { v: 1, items: { logo: { hidden: true } } } }) })).not.toBe(key(saved));
    expect(key({ ...saved, tagline: undefined })).toBe(key(saved));
    expect(key({ ...saved, patientColumnsJson: '[["name"],["age"]]' })).not.toBe(key({ ...saved, patientColumnsJson: '[["age"],["name"]]' }));
  });
  it('plain text that only looks like JSON stays text', () => {
    expect(key({ footerText: '{not json' })).not.toBe(key({ footerText: '{not  json' }));
  });
});

describe('Referring network: Save hospital / Save doctor follow the compare', () => {
  const make = () => {
    const self: any = {
      hospitalFieldErr: signal({}), doctorFieldErr: signal({}), hospitalEditor: signal<any>(null), doctorEditor: signal<any>(null),
      doctorsAll: signal([]), hospitalBase: '', doctorBase: '', hospitalEditorDoctorsBefore: [],
    };
    for (const m of ['openHospitalEditor', 'openDoctorEditor', 'hospitalChanged', 'doctorChanged', 'setHospitalDoctors', 'setDoctorHospitals']) self[m] = rn[m].bind(self);
    return self;
  };
  it('an existing hospital: off as opened, on after an edit, off again when the edit is put back', () => {
    const s = make();
    s.openHospitalEditor({ id: 'h1', name: 'Demo Hospital', isActive: true });
    expect(s.hospitalChanged()).toBe(false);
    s.hospitalEditor().name = 'Demo Hospital (East)';           // ngModel edits the draft in place
    expect(s.hospitalChanged()).toBe(true);
    s.hospitalEditor().name = 'Demo Hospital';
    expect(s.hospitalChanged()).toBe(false);
    s.setHospitalDoctors(['d1']);
    expect(s.hospitalChanged()).toBe(true);
    s.setHospitalDoctors([]);
    expect(s.hospitalChanged()).toBe(false);
  });
  it('a NEW hospital / doctor has nothing saved to compare with: Save follows the name only', () => {
    const s = make();
    s.openHospitalEditor(null);
    expect(s.hospitalChanged()).toBe(true);
    s.openDoctorEditor(null, null);
    expect(s.doctorChanged()).toBe(true);
  });
  it('an existing doctor: a hospital link added and removed again is no change', () => {
    const s = make();
    s.openDoctorEditor({ id: 'd1', name: 'Dr Demo', isActive: true, hospitals: [] }, null);
    expect(s.doctorChanged()).toBe(false);
    s.setDoctorHospitals(['h1']);
    expect(s.doctorChanged()).toBe(true);
    s.setDoctorHospitals([]);
    expect(s.doctorChanged()).toBe(false);
  });
});
