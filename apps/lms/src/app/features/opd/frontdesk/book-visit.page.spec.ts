import { sameDoctorOpenVisit } from './book-visit.page';
import { TestBed } from '@angular/core/testing';
import { OpdBookVisitPage } from './book-visit.page';
import { DESK, PATIENT, QUOTE_D1, TESTS, VISIT, flush, harness, memoryStorage } from './opd-b.spec-helpers';
import { draftKey } from './desk-rules';

/**
 * OPD → New visit: the order-create shell (band chips + a catalogue card
 * with Doctors / Departments / Lab tests tabs) + the BILLING card that
 * follows every choice, ONE primary, follow-up rule + exact override, lab
 * tests on their own lab bill, workflow-driven vitals, the auto-saving draft
 * and the one checkout. "Any doctor in <department>" is always an explicit
 * tap — never a silent auto-pick from choosing the department.
 */
function render(opts: {
  query?: Record<string, string>; desk?: any; post?: (u: string, b: any) => unknown;
  tests?: any[]; specimens?: any[]; specimenMaster?: any[];
} = {}) {
  const h = harness({
    query: opts.query,
    get: url => {
      if (url === '/api/opd/visits/desk') return opts.desk ?? DESK;
      if (url.startsWith('/api/opd/visits/quote?doctorId=d1')) return QUOTE_D1;
      if (url.startsWith('/api/opd/visits/quote')) return { doctorId: 'x', services: [{ serviceId: 's9', name: 'General consultation', category: 'consultation', priceSource: 'common', price: 500, taxSlab: 0, isFollowUp: false, quoted: 500 }] };
      if (url.startsWith('/api/tests/')) return opts.tests ?? TESTS;
      if (url.startsWith('/api/patients/')) return { patient: PATIENT, history: [] };
      if (url === '/api/config/billing/visibility') return { gstEnabled: false };
      // The specimen picker (choose-mode lab tests) — see opd-specimen-picker.component.ts.
      if (url.startsWith('/api/microbiology/test-specimens')) return opts.specimens ?? [];
      if (url === '/api/microbiology/specimens') return opts.specimenMaster ?? [];
      return null;
    },
    post: opts.post ?? ((u: string) => (u === '/api/opd/visits' ? VISIT : {})),
  });
  TestBed.configureTestingModule({ imports: [OpdBookVisitPage], providers: h.providers });
  const f = TestBed.createComponent(OpdBookVisitPage);
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance as OpdBookVisitPage, ...h };
}
const primaries = (el: HTMLElement) => el.querySelectorAll('.nd-btn--primary, .pf-hb-btn--primary');
const cta = (el: HTMLElement) => el.querySelector('[data-cta]') as HTMLButtonElement;

beforeEach(() => Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true, writable: true }));
afterEach(() => TestBed.resetTestingModule());

describe('New visit — band chips + catalogue tabs (order-create shell)', () => {
  it('shows a static "Consultation" chip, then the patient as a removable chip once picked', () => {
    const { el } = render({ query: { patientId: 'p1' } });
    expect(el.querySelector('.pf-bv-chip--type')!.textContent!.trim()).toBe('Consultation');
    const chip = el.querySelector('.pf-bv-chip--patient')!;
    expect(chip.textContent).toContain('Mrs. Kavitha Ramesh');
    expect(chip.querySelector('.pf-bv-chip__x')).toBeTruthy();
  });

  it('before a patient is picked the band searches patients; once picked it becomes the catalogue search', () => {
    const before = render();
    expect(before.el.querySelector('.pf-bv-patientsearch')).toBeTruthy();
    expect(before.el.querySelector('.pf-bv-catsearch')).toBeNull();
    TestBed.resetTestingModule();
    const after = render({ query: { patientId: 'p1' } });
    expect(after.el.querySelector('.pf-bv-patientsearch')).toBeNull();
    const field = after.el.querySelector('.pf-bv-catsearch input')!;
    expect(field.getAttribute('placeholder')).toBe('Search doctors, departments or services');
  });

  it('clearing the patient chip clears the patient', () => {
    const { el, f, c } = render({ query: { patientId: 'p1' } });
    (el.querySelector('.pf-bv-chip__x') as HTMLButtonElement).click();
    f.detectChanges();
    expect(c.patient()).toBeNull();
  });

  it('shows three catalogue tabs — Doctors / Departments / Lab tests — when the workflow has lab tests', () => {
    const { el } = render();
    const tabs = [...el.querySelectorAll('.pf-ov-tabs .nd-seg__item')].map(t => t.textContent!.replace(/\s+/g, ' ').trim());
    expect(tabs).toEqual(['Doctors', 'Departments', 'Lab tests']);
  });

  it('drops the Lab tests tab when the workflow turns it off', () => {
    const { el } = render({ desk: { ...DESK, config: { ...DESK.config, workflow: { vitals: 'off', labTestsAtDesk: false, billing: 'before_consult' } } } });
    const tabs = [...el.querySelectorAll('.pf-ov-tabs .nd-seg__item')].map(t => t.textContent!.trim());
    expect(tabs).toEqual(['Doctors', 'Departments']);
  });

  it('Doctors tab: lists doctors as tiles with wait and fee; picking one quotes its services and pre-picks the follow-up', async () => {
    const { el, f, c, api } = render({ query: { patientId: 'p1' } });
    const tiles = el.querySelectorAll('.pf-ov-main .pf-ob-tile');
    expect(tiles.length).toBe(3);
    expect(tiles[0].textContent).toContain('3 waiting · ~36 min');
    expect(tiles[0].textContent).toContain('₹600');
    (tiles[0] as HTMLButtonElement).click();
    f.detectChanges(); await flush(); f.detectChanges();
    expect(api.get).toHaveBeenCalledWith('/api/opd/visits/quote?doctorId=d1&patientId=p1');
    expect(tiles[0].getAttribute('aria-checked')).toBe('true');
    expect(c.serviceId()).toBe('s1'); // the follow-up
    const choice = el.querySelector('.pf-ov-purposeblock .pf-ob-choice[aria-checked="true"]')!;
    expect(choice.textContent).toContain('ENT consultation (follow-up)');
    expect(choice.textContent).toContain('₹300');
  });

  it('Doctors tab: department chips filter the tile list', () => {
    const { el, f, c } = render();
    const gmChip = [...el.querySelectorAll('.pf-ov-deptpills .nd-chip')].find(b => b.textContent === 'General Medicine') as HTMLButtonElement;
    gmChip.click(); f.detectChanges();
    const tiles = el.querySelectorAll('.pf-ov-main .pf-ob-tile');
    expect(tiles.length).toBe(1);
    expect(tiles[0].textContent).toContain('Dr. Rohan Mehta');
    expect(c.deptFilterId()).toBe('gm');
  });

  it('"Any doctor in <department>" is an EXPLICIT row — picking a department alone never picks a doctor', () => {
    const { el, f, c } = render();
    c.filterByDepartment(DESK.departments[0]); // ENT
    f.detectChanges();
    expect(c.doctorId()).toBeNull(); // filtering ≠ picking
    const anyRow = el.querySelector('.pf-ov-anydept') as HTMLButtonElement;
    expect(anyRow.textContent).toContain('Any doctor in ENT');
    anyRow.click(); f.detectChanges();
    expect(c.doctorId()).toBe('d2'); // least-waiting of ENT
    expect(c.mode()).toBe('department');
    expect(c.departmentId()).toBe('ent');
  });

  it('Departments tab: picking a department switches to the Doctors tab, filtered (never auto-picks)', () => {
    const { el, f, c } = render();
    c.setCatalogTab('departments'); f.detectChanges();
    const depTile = el.querySelector('.pf-ov-main .pf-ob-tile') as HTMLButtonElement;
    expect(depTile.textContent).toContain('ENT');
    depTile.click(); f.detectChanges();
    expect(c.catalogTab()).toBe('doctors');
    expect(c.doctorId()).toBeNull();
    expect(el.querySelector('.pf-ov-anydept')!.textContent).toContain('Any doctor in ENT');
  });

  it('picking a specific doctor directly (no department filter) does not set departmentId', () => {
    const { c } = render();
    c.pickDoctor(DESK.doctors[2]); // Dr. Rohan Mehta, General Medicine
    expect(c.mode()).toBe('doctor');
    expect(c.departmentId()).toBeNull();
  });
});

describe('New visit — BILLING card', () => {
  async function ready() {
    const r = render({ query: { patientId: 'p1' } });
    r.c.pickDoctor(DESK.doctors[0]);
    r.f.detectChanges(); await flush(); r.f.detectChanges();
    return r;
  }

  it('has no primary until patient, doctor and purpose are chosen; then exactly one: Continue to payment', async () => {
    const r0 = render();
    expect(primaries(r0.el).length).toBe(0);
    expect(cta(r0.el).textContent).toContain('Find the patient first');
    TestBed.resetTestingModule();
    const { el } = await ready();
    expect(primaries(el).length).toBe(1);
    expect(cta(el).textContent!.trim()).toBe('Continue to payment');
  });

  it('shows the follow-up line with "rule ₹300 · Override", and an exact override is noted on the line', async () => {
    const { el, f, c } = await ready();
    const box = el.querySelector('[data-box="fee"]')!;
    expect(box.textContent).toContain('Follow-up fee');
    expect(box.textContent).toContain('rule ₹300');
    c.openOverride(); c.onOverride('200'); f.detectChanges();
    expect(el.querySelector('[data-line="consult"]')!.textContent).toContain('set at the desk (rule ₹300)');
    expect(el.querySelector('[data-total]')!.textContent).toContain('₹200');
    c.onOverride('abc'); f.detectChanges();
    expect(c.overrideRaw()).toBe('');
  });

  it('lab tests found by short name go on their own lab bill; the total adds both', async () => {
    const { el, f, c } = await ready();
    c.setCatalogTab('labs'); f.detectChanges();
    c.labQuery.set('aec'); f.detectChanges();
    const res = el.querySelectorAll('.pf-ov-labrow');
    expect(res.length).toBe(1);
    (res[0] as HTMLButtonElement).click(); f.detectChanges();
    expect(el.querySelectorAll('[data-line="lab"]').length).toBe(1);
    expect(el.querySelector('.pf-ob-sum')!.textContent).toContain('Lab tests · lab bill');
    expect(el.querySelector('[data-total]')!.textContent).toContain('₹450');
    // Panel abbreviations match too.
    c.labQuery.set('LFT'); f.detectChanges();
    expect(el.querySelector('.pf-ov-labrow')!.textContent).toContain('Liver function test');
  });

  it('continue → payment panel → confirm books once with the payment split parts', async () => {
    const { el, f, c, api, router } = await ready();
    c.labIds.set(['t1']); f.detectChanges();
    cta(el).click(); f.detectChanges();
    expect(c.stage()).toBe('pay');
    expect(el.querySelector('pf-inline-payment-panel')).toBeTruthy();
    c.onPaid({ mode: 'upi' });
    await flush();
    const call = api.post.mock.calls.find((x: any[]) => x[0] === '/api/opd/visits');
    expect(call[1]).toMatchObject({ patientId: 'p1', doctorUserId: 'd1', serviceId: 's1', labTestIds: ['t1'], payments: [{ mode: 'upi', amount: 450 }] });
    expect(call[1].vitals).toBeNull(); // station workflow, not taken here
    expect(router.navigate).toHaveBeenCalledWith(['/opd/visit', 'v1'], { queryParams: { issued: 1 } });
  });

  it('refuses Bill to vendor / Pay later at the OPD desk without calling the server', async () => {
    const { c, api, toasts } = await ready();
    c.onPaid({ mode: 'wallet', vendorId: 'x' });
    expect(api.post).not.toHaveBeenCalledWith('/api/opd/visits', expect.anything());
    expect(toasts.info).toHaveBeenCalled();
  });

  it('shows the server refusal and stays on the screen', async () => {
    const { c, toasts, router } = (TestBed.resetTestingModule(), await (async () => {
      const r = render({ query: { patientId: 'p1' }, post: () => new Error('Take ₹300 for the consultation before the token is issued') });
      r.c.pickDoctor(DESK.doctors[0]); r.f.detectChanges(); await flush(); r.f.detectChanges();
      return r;
    })());
    c.onPaid({ mode: 'cash' });
    await flush();
    expect(toasts.error).toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });
});

describe('New visit — vitals + draft', () => {
  it('station workflow: "Take vitals here" lives in the BILLING header, like Urgent', () => {
    const { el } = render();
    const header = el.querySelector('.pf-ov-bill .nd-card__head')!;
    expect(header.textContent).toContain('Take vitals here');
  });

  it('station workflow: "Take vitals here" toggles the inline form', async () => {
    const { el, f, c } = render();
    expect(el.querySelector('pf-opd-vitals-form')).toBeNull();
    c.vitalsHere.set(true); f.detectChanges();
    expect(el.querySelector('pf-opd-vitals-form')).toBeTruthy();
  });

  it('the footer has Save as draft (secondary) next to the primary CTA', async () => {
    const { el, f, c } = render({ query: { patientId: 'p1' } });
    c.pickDoctor(DESK.doctors[0]); f.detectChanges(); await flush(); f.detectChanges();
    const draftBtn = [...el.querySelectorAll('.pf-ob-foot .nd-btn')].find(b => b.textContent!.trim() === 'Save as draft') as HTMLButtonElement;
    expect(draftBtn).toBeTruthy();
    expect(draftBtn.classList).toContain('nd-btn--secondary');
    expect(cta(el).textContent!.trim()).toBe('Continue to payment');
  });

  it('Save as draft confirms and returns to the OPD desk', () => {
    const { el, f, c, toasts, router } = render({ query: { patientId: 'p1' } });
    const draftBtn = [...el.querySelectorAll('.pf-ob-foot .nd-btn')].find(b => b.textContent!.trim() === 'Save as draft') as HTMLButtonElement;
    draftBtn.click(); f.detectChanges();
    expect(toasts.success).toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/opd/desk');
  });

  it('saves the draft per user × branch and restores it on the next open', async () => {
    const r = render({ query: { patientId: 'p1' } });
    r.c.pickDoctor(DESK.doctors[0]); r.f.detectChanges(); await flush(); r.f.detectChanges();
    r.c.purpose.set('Nasal block'); r.f.detectChanges();
    const saved = JSON.parse(localStorage.getItem(draftKey('u1', 'b1'))!);
    expect(saved).toMatchObject({ patientId: 'p1', doctorId: 'd1', purpose: 'Nasal block' });
    TestBed.resetTestingModule();
    const r2 = render();
    expect(r2.c.doctorId()).toBe('d1');
    expect(r2.c.purpose()).toBe('Nasal block');
    expect(r2.c.patient()?.id).toBe('p1');
    r2.c.discardDraft(); r2.f.detectChanges();
    expect(localStorage.getItem(draftKey('u1', 'b1'))).toBeNull();
  });
});

/** A choose-mode lab test (KOH Mount) — Test Master's own row carries
 *  `specimenMode: 'choose'`, exactly what a real "KOH Mount" / "Bacterial
 *  Culture & Sensitivity" catalogue row has. The fix under test: booking
 *  with one of these picked, but no specimen chosen, must be BLOCKED on the
 *  screen (never sent), and once chosen, `labTestSpecimens` rides the
 *  checkout call the same way the server's `CreateOrderInput.Specimens`
 *  expects it. */
const KOH = {
  id: 'tKoh', name: 'KOH Mount', shortName: 'KOH', testCode: 'MIC030', price: 300, taxSlab: 0, type: 'individual', isActive: true,
  parameters: JSON.stringify({ specimenMode: 'choose' }),
};
const KOH_SPECIMENS = [{ testId: 'tKoh', specimens: [{ code: 'SKN', name: 'Skin scraping', isDefault: false }, { code: 'NAIL', name: 'Nail clipping', isDefault: false }] }];

describe('New visit — choose-mode specimen (the KOH Mount / C&S fix)', () => {
  async function readyWithKoh() {
    const r = render({ query: { patientId: 'p1' }, tests: [...TESTS, KOH], specimens: KOH_SPECIMENS });
    r.c.pickDoctor(DESK.doctors[0]);
    r.f.detectChanges(); await flush(); r.f.detectChanges();
    r.c.setCatalogTab('labs'); r.f.detectChanges();
    r.c.labQuery.set('KOH'); r.f.detectChanges();
    const res = r.el.querySelectorAll('.pf-ov-labrow');
    (res[0] as HTMLButtonElement).click();
    r.f.detectChanges(); await flush(); r.f.detectChanges();
    return r;
  }

  it('shows a specimen picker (pf-select, never a native select) for the picked choose-mode test', async () => {
    const { el } = await readyWithKoh();
    const picker = el.querySelector('pf-opd-specimen-picker');
    expect(picker).toBeTruthy();
    expect(picker!.querySelector('select')).toBeNull();
    expect(el.querySelector('pf-select')).toBeTruthy();
  });

  it('Continue to payment is BLOCKED (no server call) while the specimen is unchosen, and errors the toast', async () => {
    const { el, f, c, api, toasts } = await readyWithKoh();
    api.post.mockClear();
    cta(el).click(); f.detectChanges();
    expect(c.stage()).toBe('build'); // never advanced to pay
    expect(toasts.error).toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalledWith('/api/opd/visits', expect.anything());
    expect(c.specimenInvalid('tKoh')).toBe(true);
  });

  it('choosing the specimen clears the block and the booking carries labTestSpecimens', async () => {
    const { el, f, c, api, router } = await readyWithKoh();
    c.setSpecimen('tKoh', 'SKN');
    f.detectChanges();
    expect(c.specimenInvalid('tKoh')).toBe(false);
    cta(el).click(); f.detectChanges();
    expect(c.stage()).toBe('pay');
    c.onPaid({ mode: 'upi' });
    await flush();
    const call = api.post.mock.calls.find((x: any[]) => x[0] === '/api/opd/visits');
    expect(call[1]).toMatchObject({ labTestIds: ['tKoh'], labTestSpecimens: { tKoh: 'SKN' } });
    expect(router.navigate).toHaveBeenCalled();
  });

  it('a "none"-mode test (no parameters, like the existing fixtures) never shows a picker and never blocks', async () => {
    const r = render({ query: { patientId: 'p1' } });
    r.c.pickDoctor(DESK.doctors[0]);
    r.f.detectChanges(); await flush(); r.f.detectChanges();
    r.c.labIds.set(['t1']); r.f.detectChanges();
    expect(r.el.querySelector('pf-opd-specimen-picker pf-select')).toBeNull();
    r.c.onPaid({ mode: 'upi' });
    await flush();
    expect(r.router.navigate).toHaveBeenCalled();
  });
});

describe('sameDoctorOpenVisit (duplicate-visit nudge)', () => {
  const row = (o: Partial<import('./desk.models').OpdVisitRow>) => ({ id: 'v', patientId: 'p', patientName: 'P', doctorUserId: 'd1', doctorName: 'Dr. A',
    visitDate: '2026-09-30', token: 3, tokenLabel: 'E3', status: 'waiting', isFollowUp: false, charged: 0, hasLabOrder: false, createdAt: '', vitalsFlagged: false, ...o }) as import('./desk.models').OpdVisitRow;
  it('finds an open visit with the same doctor', () => expect(sameDoctorOpenVisit([row({})], 'd1')?.tokenLabel).toBe('E3'));
  it('ignores other doctors, closed visits and no doctor', () => {
    expect(sameDoctorOpenVisit([row({ doctorUserId: 'd2' })], 'd1')).toBeNull();
    expect(sameDoctorOpenVisit([row({ status: 'completed' })], 'd1')).toBeNull();
    expect(sameDoctorOpenVisit([row({ status: 'cancelled' })], 'd1')).toBeNull();
    expect(sameDoctorOpenVisit([row({})], null)).toBeNull();
  });
});
