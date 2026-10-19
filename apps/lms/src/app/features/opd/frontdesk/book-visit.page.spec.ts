import { defaultPurpose, sameDoctorOpenVisit } from './book-visit.page';
import { TestBed } from '@angular/core/testing';
import { OpdBookVisitPage } from './book-visit.page';
import { DESK, PATIENT, QUOTE_D1, TESTS, VISIT, flush, harness, memoryStorage } from './opd-b.spec-helpers';
import { draftKey } from './desk-rules';
import { ModuleScopeService } from '../../../core/services/module-scope.service';

/**
 * OPD → New visit: the lab Order & Payments screen for a visit — the band
 * (product switcher · Patient · Doctor · one search), the work card's three
 * columns (doctor · visit purpose · add-ons), the BILLING card with the fee
 * editable in its line, ONE primary, lab tests on their own lab bill, the
 * auto-saving draft, and payment → token → Record vitals (vitals are no
 * longer taken in the bill; lab tests are ordered after the consult). "Any doctor in <department>" stays an explicit tap.
 */
function render(opts: {
  query?: Record<string, string>; desk?: any; post?: (u: string, b: any) => unknown;
  tests?: any[]; specimens?: any[]; specimenMaster?: any[]; labUsable?: boolean;
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
  const modules = { labUsable: () => opts.labUsable ?? true, opdUsable: () => true, mode: () => 'choose' };
  TestBed.configureTestingModule({ imports: [OpdBookVisitPage], providers: [...h.providers, { provide: ModuleScopeService, useValue: modules }] });
  const f = TestBed.createComponent(OpdBookVisitPage);
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance as OpdBookVisitPage, ...h };
}
const primaries = (el: HTMLElement) => el.querySelectorAll('.pf-oc-btn--primary:not([disabled]), .pf-btn--primary');
const cta = (el: HTMLElement) => el.querySelector('[data-cta]') as HTMLButtonElement;
/** Doctor tiles, each once (a doctor in two departments shows in both groups). */
const docTiles = (el: HTMLElement) => [...el.querySelectorAll('.pf-ov-grid .pf-ov-doc:not(.pf-ov-anydept)')] as HTMLElement[];

beforeEach(() => Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true, writable: true }));
afterEach(() => TestBed.resetTestingModule());

describe('New visit — the order-create band (product · Patient · Doctor · one search)', () => {
  it('the first tile is the product switcher (OPD); Patient and Doctor follow', () => {
    const { el } = render();
    const tiles = [...el.querySelectorAll('.pf-us__tiles .pf-us__tile-label')].map(t => t.textContent!.trim());
    expect(tiles).toEqual(['OPD', 'Patient', 'Doctor']);
  });

  it('the product tile switches to the lab order screen (carrying the patient)', () => {
    const { el, f, c, router } = render({ query: { patientId: 'p1' } });
    (el.querySelector('[data-product]') as HTMLButtonElement).click(); f.detectChanges();
    const rows = [...el.querySelectorAll('.pf-us__row')];
    expect(rows.map(r => r.querySelector('.pf-us__row-title')!.textContent!.trim())).toEqual(['OPD', 'Tests']);
    c.pickScopeRow(c.scopeRows()[1]);
    expect(router.navigate).toHaveBeenCalledWith(['/frontdesk/order'], { queryParams: { patientId: 'p1' } });
  });

  it('the product tile is static when the lab is not usable', () => {
    const { el, f, c } = render({ labUsable: false });
    (el.querySelector('[data-product]') as HTMLButtonElement).click(); f.detectChanges();
    expect(c.bandMode()).toBe('patient');
    expect(c.productSwitchable()).toBe(false);
  });

  it('the patient lands on the Patient tile; its × clears the patient', () => {
    const { el, f, c } = render({ query: { patientId: 'p1' } });
    const tile = el.querySelector('[data-scope="patient"]')!;
    expect(tile.textContent).toContain('Mrs. Kavitha Ramesh');
    (tile.parentElement!.querySelector('.pf-us__tile-x') as HTMLButtonElement).click(); f.detectChanges();
    expect(c.patient()).toBeNull();
  });

  it('with the Doctor tile the search finds OPD doctors; picking one fills the tile and the bill', async () => {
    const { el, f, c } = render({ query: { patientId: 'p1' } });
    c.selectScope('doctor'); c.onPillInput('karthik'); f.detectChanges();
    const rows = el.querySelectorAll('.pf-us__row');
    expect(rows.length).toBe(1);
    (rows[0] as HTMLButtonElement).click(); f.detectChanges(); await flush(); f.detectChanges();
    expect(c.doctorId()).toBe('d2');
    expect(el.querySelector('[data-scope="doctor"]')!.textContent).toContain('Dr. Karthik Subramanian');
  });
});

describe('New visit — work card: Doctor panel | Visit purpose panel', () => {
  it('has a NEW VISIT header like BILLING (date on its right) and two inner panels', () => {
    const { el } = render();
    const head = el.querySelector('.pf-ov-main > .pf-oc-bill__head')!;
    expect(head.querySelector('.pf-oc-bill__title')!.textContent!.trim()).toBe('NEW VISIT');
    expect(head.querySelector('[data-date]')!.textContent).toContain('OPD ·');
    expect(el.querySelector('.pf-ov-ctx')).toBeNull();
    expect([...el.querySelectorAll('.pf-ov-panes > .pf-ov-pane')].length).toBe(2);
  });

  it('no add-ons column, no Urgent switch, no Queue button — lab tests are ordered after the consult', () => {
    const { el } = render();
    expect(el.querySelector('[data-col="addons"]')).toBeNull();
    expect(el.querySelector('[data-urgent]')).toBeNull();
    expect(el.querySelector('a[routerLink="/opd/queue"], a[href="/opd/queue"]')).toBeNull();
  });

  it('tabs are In today / All doctors; department chips show the name once; Free now is a toggle chip', () => {
    const { el } = render();
    expect([...el.querySelectorAll('.pf-tabs__label')].map(t => t.textContent!.trim())).toEqual(['In today', 'All doctors']);
    const chips = [...el.querySelectorAll('.pf-deptpill')].map(b => b.textContent!.replace(/\s+/g, ' ').trim());
    expect(chips).toEqual(['All', 'ENT', 'General Medicine', 'Free now']);
  });

  it('doctors are grouped by department; "Any doctor" leads only a department with more than one doctor', () => {
    const { el } = render();
    const groups = [...el.querySelectorAll('[data-dept-group]')];
    expect(groups.map(g => g.getAttribute('data-dept'))).toEqual(['ent', 'gm']);
    expect(groups[0].querySelector('.pf-ov-grid > .pf-ov-anydept')).toBeTruthy();
    expect(groups[0].querySelector('.pf-ov-grid')!.firstElementChild!.classList).toContain('pf-ov-anydept');
    expect(groups[1].querySelector('.pf-ov-anydept')).toBeNull();
  });

  it('doctor tiles show speciality, wait and fee; picking one quotes its services and pre-picks the follow-up', async () => {
    const { el, f, c, api } = render({ query: { patientId: 'p1' } });
    const tiles = docTiles(el);
    expect(tiles.length).toBe(3);
    expect(tiles[0].textContent).toContain('ENT');
    expect(tiles[0].textContent).toContain('3 waiting · ~36 min');
    expect(tiles[0].textContent).toContain('₹600');
    expect(tiles[2].textContent).toContain('Free now');
    expect(el.querySelector('[data-purpose-empty]')!.textContent).toContain('Pick a doctor to see their visit types');
    (tiles[0].querySelector('.pf-crow__main') as HTMLButtonElement).click();
    f.detectChanges(); await flush(); f.detectChanges();
    expect(api.get).toHaveBeenCalledWith('/api/opd/visits/quote?doctorId=d1&patientId=p1');
    expect(tiles[0].querySelector('[role="radio"]')!.getAttribute('aria-checked')).toBe('true');
    expect(c.serviceId()).toBe('s1'); // the follow-up, pre-picked
    const choice = el.querySelector('[data-purpose] [role="radio"][aria-checked="true"]')!;
    expect(choice.textContent).toContain('ENT consultation (follow-up)');
    expect(choice.textContent).toContain('₹300');
  });

  it('the Free now chip and the department chips filter the doctor grid', () => {
    const { el, f, c } = render();
    (el.querySelector('[data-free]') as HTMLButtonElement).click(); f.detectChanges();
    expect(docTiles(el).map(t => t.textContent)).toEqual([expect.stringContaining('Dr. Rohan Mehta')]);
    c.toggleFreeOnly(); f.detectChanges();
    const gm = [...el.querySelectorAll('.pf-deptpill')].find(b => b.textContent!.includes('General Medicine')) as HTMLButtonElement;
    gm.click(); f.detectChanges();
    expect(docTiles(el).length).toBe(1);
    expect(c.deptFilterId()).toBe('gm');
  });

  it('"Any doctor in <department>" is an EXPLICIT tile — picking a department alone never picks a doctor', () => {
    const { el, f, c } = render();
    c.filterByDepartment(DESK.departments[0]); // ENT
    f.detectChanges();
    expect(c.doctorId()).toBeNull(); // filtering ≠ picking
    const anyRow = el.querySelector('[data-dept="ent"] .pf-ov-anydept .pf-crow__main') as HTMLButtonElement;
    expect(anyRow.textContent).toContain('Any doctor in ENT');
    anyRow.click(); f.detectChanges();
    expect(c.doctorId()).toBe('d2'); // least-waiting of ENT
    expect(c.mode()).toBe('department');
    expect(c.departmentId()).toBe('ent');
  });

  it('picking a specific doctor directly (no department filter) does not set departmentId', () => {
    const { c } = render();
    c.pickDoctor(DESK.doctors[2]);
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

  it('Continue to payment stays disabled until there is a consult line; then it is the one primary', async () => {
    const r0 = render();
    expect(cta(r0.el).disabled).toBe(true);
    expect(primaries(r0.el).length).toBe(0);
    TestBed.resetTestingModule();
    const { el } = await ready();
    expect(primaries(el).length).toBe(1);
    expect(cta(el).textContent!.trim()).toBe('Continue to payment');
  });

  it('the consult fee is editable IN the bill line; the override is noted "set at the desk"', async () => {
    const { el, f, c } = await ready();
    const line = () => el.querySelector('[data-line="consult"]')!;
    expect(line().textContent).toContain('follow-up fee');
    (line().querySelector('[data-fee]') as HTMLButtonElement).click(); f.detectChanges();
    expect(line().querySelector('[data-fee-input]')).toBeTruthy();
    c.onOverride('200'); f.detectChanges();
    expect(line().textContent).toContain('set at the desk (rule ₹300)');
    expect(el.querySelector('[data-total]')!.textContent).toContain('₹200');
    c.onOverride('abc'); f.detectChanges();
    expect(c.overrideRaw()).toBe('');
  });

  it('continue → payment → books once (no vitals in the bill) → token issued → Record vitals goes to the Vitals step', async () => {
    const { el, f, c, api, router } = await ready();
    cta(el).click(); f.detectChanges();
    expect(c.stage()).toBe('pay');
    expect(el.querySelector('pf-inline-payment-panel')).toBeTruthy();
    c.onPaid({ mode: 'upi' });
    await flush(); f.detectChanges();
    const call = api.post.mock.calls.find((x: any[]) => x[0] === '/api/opd/visits');
    expect(call[1]).toMatchObject({ patientId: 'p1', doctorUserId: 'd1', serviceId: 's1', payments: [{ mode: 'upi', amount: 300 }] });
    expect(call[1].vitals).toBeNull();
    expect(c.stage()).toBe('issued');
    expect(el.querySelector('[data-issued]')!.textContent).toContain('Token A3 issued');
    (el.querySelector('[data-vitals]') as HTMLButtonElement).click();
    expect(router.navigate).toHaveBeenCalledWith(['/opd/vitals', 'v1']);
  });

  it('refuses Bill to vendor / Pay later at the OPD desk without calling the server', async () => {
    const { c, api, toasts } = await ready();
    c.onPaid({ mode: 'wallet', vendorId: 'x' });
    expect(api.post).not.toHaveBeenCalledWith('/api/opd/visits', expect.anything());
    expect(toasts.info).toHaveBeenCalled();
  });

  it('shows the server refusal and stays on the screen', async () => {
    const { c, toasts } = (TestBed.resetTestingModule(), await (async () => {
      const r = render({ query: { patientId: 'p1' }, post: () => new Error('Take ₹300 for the consultation before the token is issued') });
      r.c.pickDoctor(DESK.doctors[0]); r.f.detectChanges(); await flush(); r.f.detectChanges();
      return r;
    })());
    c.onPaid({ mode: 'cash' });
    await flush();
    expect(toasts.error).toHaveBeenCalled();
    expect(c.stage()).toBe('build');
  });
});

describe('New visit — vitals moved out of billing + draft', () => {
  it('the BILLING card has no vitals form or "Take vitals here" switch', () => {
    const { el } = render();
    expect(el.querySelector('pf-opd-vitals-form')).toBeNull();
    expect(el.textContent).not.toContain('Take vitals here');
  });

  it('the footer has Save as draft (secondary) next to the primary CTA', async () => {
    const { el, f, c } = render({ query: { patientId: 'p1' } });
    c.pickDoctor(DESK.doctors[0]); f.detectChanges(); await flush(); f.detectChanges();
    const draftBtn = [...el.querySelectorAll('.pf-oc-bill__foot .pf-oc-btn')].find(b => b.textContent!.trim() === 'Save as draft') as HTMLButtonElement;
    expect(draftBtn).toBeTruthy();
    expect(draftBtn.classList).toContain('pf-oc-btn--ghost');
    expect(cta(el).textContent!.trim()).toBe('Continue to payment');
  });

  it('Save as draft confirms and returns to the OPD desk', () => {
    const { el, f, toasts, router } = render({ query: { patientId: 'p1' } });
    const draftBtn = [...el.querySelectorAll('.pf-oc-bill__foot .pf-oc-btn')].find(b => b.textContent!.trim() === 'Save as draft') as HTMLButtonElement;
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

describe('defaultPurpose (pick a doctor → Continue to payment)', () => {
  const svc = (o: any) => ({ serviceId: o.id, name: o.id, category: 'consultation', priceSource: 'common', price: 1, taxSlab: 0, isFollowUp: false, quoted: 1, ...o });
  it('follow-up first, else the consultation, else the first service', () => {
    expect(defaultPurpose([svc({ id: 'p', category: 'procedure' }), svc({ id: 'c' }), svc({ id: 'f', isFollowUp: true })])?.serviceId).toBe('f');
    expect(defaultPurpose([svc({ id: 'p', category: 'procedure' }), svc({ id: 'c' })])?.serviceId).toBe('c');
    expect(defaultPurpose([svc({ id: 'p', category: 'procedure' })])?.serviceId).toBe('p');
    expect(defaultPurpose([])).toBeUndefined();
  });
});
