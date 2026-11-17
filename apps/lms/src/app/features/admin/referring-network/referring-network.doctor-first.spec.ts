import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { of } from 'rxjs';
import { ReferringNetworkComponent } from './referring-network.component';
import {
  ALL_HOSPITALS, NO_HOSPITAL, doctorHospitalIds, doctorHospitalsLabel, filterDoctorsByHospital, linkDiff,
} from './referring-network.model';
import { renderBandPage } from '../admin-band.spec-helpers';
import { DialogService } from '../../../core/services/dialog.service';

/**
 * Referring network, doctor-first (owner 2026-09-30): a doctor can be created
 * with no hospital and linked to one or more hospitals later; a hospital can
 * be created with existing doctors attached. Both lists filter both ways.
 */
/** Same probes as admin-pf-audit-d.spec (not imported: importing a spec
 *  file would re-register its suites here). */
function hygiene(el: HTMLElement) {
  expect(el.querySelector('select, datalist')).toBeNull();
  expect(el.querySelector('input[type="checkbox"]')).toBeNull();
  expect(/[✕✓✔⠿●↑↓]/.test(el.textContent ?? '')).toBe(false);
}
const primaries = (el: HTMLElement) =>
  Array.from(el.querySelectorAll('.pf-hb-btn--primary, .pf-btn--primary, pf-touch-btn .v-primary'))
    .filter(b => !b.closest('.pf-classic-only')).length;

const HOSPITALS = [
  { id: 'h1', name: 'Apollo Hospitals', code: 'APO', isActive: true, doctorCount: 2 },
  { id: 'h2', name: 'Kauvery Hospital', code: 'KAU', isActive: true, doctorCount: 1 },
];
const DOCTORS = [
  { id: 'd1', name: 'Dr. Priya Krishnan', hospitalId: 'h1', hospitalName: 'Apollo Hospitals',
    hospitals: [{ id: 'h1', name: 'Apollo Hospitals' }, { id: 'h2', name: 'Kauvery Hospital' }], isActive: true },
  { id: 'd2', name: 'Dr. Arun Iyer', hospitalId: 'h1', hospitalName: 'Apollo Hospitals',
    hospitals: [{ id: 'h1', name: 'Apollo Hospitals' }], isActive: true },
  { id: 'd3', name: 'Dr. Meena Solo', hospitalId: null, hospitalName: null, hospitals: [], department: 'Pediatrics', isActive: true },
];

describe('Referring network model', () => {
  it('a doctor with no hospital is Independent; several hospitals are listed primary first', () => {
    expect(doctorHospitalsLabel(DOCTORS[2])).toBe('Independent');
    expect(doctorHospitalsLabel(DOCTORS[0])).toBe('Apollo Hospitals, Kauvery Hospital');
  });

  it('falls back to the primary hospital when the payload has no hospitals list (older server)', () => {
    expect(doctorHospitalIds({ hospitalId: 'h9', hospitalName: 'Old' })).toEqual(['h9']);
    expect(doctorHospitalIds({ hospitalId: null })).toEqual([]);
  });

  it('filters doctors by hospital, independent, or all', () => {
    const ids = (f: string) => filterDoctorsByHospital(DOCTORS, f).map(d => d.id);
    expect(ids(ALL_HOSPITALS)).toEqual(['d1', 'd2', 'd3']);
    expect(ids('h2')).toEqual(['d1']);
    expect(ids('h1')).toEqual(['d1', 'd2']);
    expect(ids(NO_HOSPITAL)).toEqual(['d3']);
  });

  it('linkDiff reports what to attach and detach', () => {
    expect(linkDiff(['a', 'b'], ['b', 'c'])).toEqual({ add: ['c'], remove: ['a'] });
    expect(linkDiff([], [])).toEqual({ add: [], remove: [] });
  });
});

describe('Referring network — doctor-first screen', () => {
  const render = async (dialogOk = true) => {
    const p = renderBandPage(ReferringNetworkComponent, {
      getFor: (url) => url.startsWith('/api/referring-network/hospitals') ? HOSPITALS
        : url.startsWith('/api/referring-network/doctors') ? DOCTORS : [],
      providers: [{ provide: DialogService, useValue: { confirm: vi.fn(async () => dialogOk), prompt: vi.fn(async () => null) } }],
    });
    await p.f.whenStable(); p.f.detectChanges();
    return p;
  };

  it('loads every doctor once; a hospital row opens the Doctors grid filtered to it (visiting doctors too, all hospitals as chips)', async () => {
    const p = await render();
    expect(p.api.get).toHaveBeenCalledWith('/api/referring-network/doctors?includeInactive=true');
    p.cmp.setView('hospitals'); p.f.detectChanges();
    p.cmp.onHospitalCell({ colDef: { colId: 'name' }, data: HOSPITALS[1] });
    expect(p.cmp.view()).toBe('doctors');
    expect(p.cmp.gridDoctors().map((d: any) => d.name)).toEqual(['Dr. Priya Krishnan']);
    const chips = p.cmp.doctorColDefs().find((c: any) => c.colId === 'hospitals').cellRenderer({ data: p.cmp.gridDoctors()[0] }) as HTMLElement;
    expect(chips.textContent).toContain('Apollo Hospitals');
    // Independent doctors: the hospital filter offers them.
    expect(p.cmp.hospitalFilterOptions().some((o: any) => o.value === NO_HOSPITAL)).toBe(true);
    expect(primaries(p.el)).toBe(1);
    hygiene(p.el);
  });

  it('the Doctors view is an AG-Grid with a Hospitals column, filterable by hospital and by search', async () => {
    const p = await render();
    p.cmp.setView('doctors'); p.f.detectChanges(); await p.f.whenStable();
    expect(p.el.querySelector('ag-grid-angular')).not.toBeNull();
    expect(p.el.querySelector('pf-select.pf-rn-hfilter')).not.toBeNull();
    const cols = p.cmp.doctorColDefs().map((c: any) => c.headerName);
    expect(cols).toContain('Hospital(s)');
    expect(p.cmp.gridDoctors().map((d: any) => d.id)).toEqual(['d1', 'd2', 'd3']);
    p.cmp.setHospitalFilter('h2');
    expect(p.cmp.gridDoctors().map((d: any) => d.id)).toEqual(['d1']);
    p.cmp.setHospitalFilter(NO_HOSPITAL);
    expect(p.cmp.gridDoctors().map((d: any) => d.id)).toEqual(['d3']);
    p.cmp.setHospitalFilter(ALL_HOSPITALS);
    p.type('kauvery');                       // band search covers the hospitals column
    expect(p.cmp.gridDoctors().map((d: any) => d.id)).toEqual(['d1']);
    // The view's ONE primary is Add doctor.
    expect(p.actions().map(b => b.textContent?.trim())).toEqual(['Add doctor']);
    expect(primaries(p.el)).toBe(1);
    hygiene(p.el);
  });

  it('"Add doctor" from the Doctors view creates an independent doctor (hospitals optional)', async () => {
    const p = await render();
    p.api.post.mockReturnValue(of({ id: 'dn', name: 'Dr. New', hospitalId: null, hospitals: [], isActive: true }));
    p.cmp.setView('doctors'); p.f.detectChanges();
    p.actions()[0].click(); p.f.detectChanges();
    expect(p.el.querySelector('.pf-rn-modal pf-select.pf-rn-hospsel')).not.toBeNull();
    p.cmp.doctorEditor.update((e: any) => ({ ...e, name: 'Dr. New' }));
    await p.cmp.saveDoctor();
    expect(p.api.post).toHaveBeenCalledWith('/api/referring-network/doctors',
      expect.objectContaining({ name: 'Dr. New', hospitalIds: [], hospitalId: null }));
    expect(p.cmp.doctorsAll().some((d: any) => d.id === 'dn')).toBe(true);
  });

  it('a doctor can be linked to several hospitals; the current primary is kept', async () => {
    const p = await render();
    p.api.patch.mockReturnValue(of({ ...DOCTORS[1], hospitals: [{ id: 'h1', name: 'Apollo Hospitals' }, { id: 'h2', name: 'Kauvery Hospital' }] }));
    p.cmp.openDoctorEditor(DOCTORS[1], null);
    expect(p.cmp.doctorEditor().hospitalIds).toEqual(['h1']);
    p.cmp.setDoctorHospitals(['h2', 'h1']);
    await p.cmp.saveDoctor();
    expect(p.api.patch).toHaveBeenCalledWith('/api/referring-network/doctors/d2',
      expect.objectContaining({ hospitalIds: ['h2', 'h1'], hospitalId: 'h1' }));
  });

  it('"Add doctor" while the grid is filtered to a hospital pre-links that hospital', async () => {
    const p = await render();
    p.cmp.setHospitalFilter('h2'); p.f.detectChanges();
    const add = p.actions().find(b => /Add doctor/.test(b.textContent ?? ''))!;
    add.click(); p.f.detectChanges();
    expect(p.cmp.doctorEditor().hospitalIds).toEqual(['h2']);
  });

  it('"Add hospital" can attach existing doctors in the same save', async () => {
    const p = await render();
    p.api.post.mockReturnValue(of({ id: 'h3', name: 'MIOT', isActive: true, doctorCount: 1 }));
    p.cmp.openHospitalEditor(null); p.f.detectChanges();
    expect(p.el.querySelector('.pf-rn-modal pf-select.pf-rn-docsel')).not.toBeNull();
    // The picker offers existing doctors, labelled with where they work.
    expect(p.cmp.doctorOptions().find((o: any) => o.value === 'd3').hint).toBe('Independent');
    p.cmp.hospitalEditor.update((e: any) => ({ ...e, name: 'MIOT' }));
    p.cmp.setHospitalDoctors(['d3']);
    await p.cmp.saveHospital();
    expect(p.api.post).toHaveBeenCalledWith('/api/referring-network/hospitals',
      expect.objectContaining({ name: 'MIOT', doctorIds: ['d3'] }));
    expect(p.cmp.selectedHospitalId()).toBe('h3');
  });

  it('editing a hospital attaches added doctors and detaches removed ones', async () => {
    const p = await render();
    p.api.patch.mockReturnValue(of(HOSPITALS[0]));
    p.api.post.mockReturnValue(of(HOSPITALS[0]));
    p.api.delete.mockReturnValue(of(HOSPITALS[0]));
    p.cmp.openHospitalEditor(HOSPITALS[0]);
    expect(p.cmp.hospitalEditor().doctorIds).toEqual(['d1', 'd2']);
    p.cmp.setHospitalDoctors(['d1', 'd3']);
    await p.cmp.saveHospital();
    expect(p.api.post).toHaveBeenCalledWith('/api/referring-network/hospitals/h1/doctors', { doctorIds: ['d3'] });
    expect(p.api.delete).toHaveBeenCalledWith('/api/referring-network/hospitals/h1/doctors/d2');
  });

  it('"Link doctors" offers only doctors not yet at the hospital and posts the picks', async () => {
    const p = await render();
    p.api.post.mockReturnValue(of({ ...HOSPITALS[1], doctorCount: 2 }));
    p.cmp.openLinkEditor(HOSPITALS[1]); p.f.detectChanges();
    expect(p.cmp.linkableDoctorOptions().map((o: any) => o.value)).toEqual(['d2', 'd3']);
    expect(primaries(p.el)).toBe(1);        // the modal's footer owns the one primary
    p.cmp.setLinkDoctors(['d3']);
    await p.cmp.saveLinks();
    expect(p.api.post).toHaveBeenCalledWith('/api/referring-network/hospitals/h2/doctors', { doctorIds: ['d3'] });
    expect(p.cmp.linkEditor()).toBeNull();
  });

  it('removing a doctor from a hospital confirms through DialogService, then detaches', async () => {
    const p = await render(true);
    p.api.delete.mockReturnValue(of(HOSPITALS[1]));
    const dialog = TestBed.inject(DialogService) as any;
    await p.cmp.unlinkDoctor(DOCTORS[0], HOSPITALS[1]);
    expect(dialog.confirm).toHaveBeenCalled();
    expect(dialog.confirm.mock.calls[0][0].message).toContain('still at Apollo Hospitals');
    expect(p.api.delete).toHaveBeenCalledWith('/api/referring-network/hospitals/h2/doctors/d1');
  });

  it('a declined confirm leaves the link alone', async () => {
    const p = await render(false);
    await p.cmp.unlinkDoctor(DOCTORS[0], HOSPITALS[1]);
    expect(p.api.delete).not.toHaveBeenCalled();
  });
});
