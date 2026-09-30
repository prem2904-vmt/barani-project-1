import { TestBed } from '@angular/core/testing';
import { OpdBookVisitPage } from './book-visit.page';
import { DESK, PATIENT, QUOTE_D1, TESTS, VISIT, flush, harness, memoryStorage } from './opd-b.spec-helpers';
import { draftKey } from './desk-rules';

/**
 * OPD → New visit: five aligned steps + the BILLING card that follows every
 * choice, ONE primary, follow-up rule + exact override, lab tests on their own
 * lab bill, workflow-driven vitals, the auto-saving draft and the one checkout.
 */
function render(opts: { query?: Record<string, string>; desk?: any; post?: (u: string, b: any) => unknown } = {}) {
  const h = harness({
    query: opts.query,
    get: url => {
      if (url === '/api/opd/visits/desk') return opts.desk ?? DESK;
      if (url.startsWith('/api/opd/visits/quote?doctorId=d1')) return QUOTE_D1;
      if (url.startsWith('/api/opd/visits/quote')) return { doctorId: 'x', services: [{ serviceId: 's9', name: 'General consultation', category: 'consultation', priceSource: 'common', price: 500, taxSlab: 0, isFollowUp: false, quoted: 500 }] };
      if (url.startsWith('/api/tests/')) return TESTS;
      if (url.startsWith('/api/patients/')) return { patient: PATIENT, history: [] };
      if (url === '/api/config/billing/visibility') return { gstEnabled: false };
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

describe('New visit — steps', () => {
  it('shows the five steps in order when the workflow has lab tests and vitals', () => {
    const { el } = render();
    expect([...el.querySelectorAll('.pf-ob-step')].map(s => s.getAttribute('data-step'))).toEqual(['patient', 'doctor', 'purpose', 'lab', 'vitals']);
    expect([...el.querySelectorAll('.pf-ob-step__n')].map(n => n.textContent!.trim())).toEqual(['1', '2', '3', '4', '5']);
  });

  it('drops the lab and vitals steps when the workflow turns them off', () => {
    const { el } = render({ desk: { ...DESK, config: { ...DESK.config, workflow: { vitals: 'off', labTestsAtDesk: false, billing: 'before_consult' } } } });
    expect([...el.querySelectorAll('.pf-ob-step')].map(s => s.getAttribute('data-step'))).toEqual(['patient', 'doctor', 'purpose']);
  });

  it('opens the patient from ?patientId= (the new-order fork) and shows full name + ids', () => {
    const { el } = render({ query: { patientId: 'p1' } });
    const card = el.querySelector('.pf-ov-patient')!;
    expect(card.textContent).toContain('Mrs. Kavitha Ramesh');
    expect(card.textContent).toContain('AA0112');
    expect(card.textContent).toContain('ABHA linked');
  });

  it('lists doctors as tiles with wait and fee; picking one quotes its services and pre-picks the follow-up', async () => {
    const { el, f, c, api } = render({ query: { patientId: 'p1' } });
    const tiles = el.querySelectorAll('[data-step="doctor"] .pf-ob-tile');
    expect(tiles.length).toBe(3);
    expect(tiles[0].textContent).toContain('3 waiting · ~36 min');
    expect(tiles[0].textContent).toContain('₹600');
    (tiles[0] as HTMLButtonElement).click();
    f.detectChanges(); await flush(); f.detectChanges();
    expect(api.get).toHaveBeenCalledWith('/api/opd/visits/quote?doctorId=d1&patientId=p1');
    expect(tiles[0].getAttribute('aria-checked')).toBe('true');
    expect(c.serviceId()).toBe('s1'); // the follow-up
    const choice = el.querySelector('[data-step="purpose"] .pf-ob-choice[aria-checked="true"]')!;
    expect(choice.textContent).toContain('ENT consultation (follow-up)');
    expect(choice.textContent).toContain('₹300');
  });

  it('by department picks the least-waiting doctor of the department', () => {
    const { c } = render();
    c.setMode('department');
    c.pickDepartment(DESK.departments[0]);
    expect(c.doctorId()).toBe('d2');
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
  it('station workflow: "Take vitals here" toggles the inline form', async () => {
    const { el, f, c } = render();
    expect(el.querySelector('pf-opd-vitals-form')).toBeNull();
    c.vitalsHere.set(true); f.detectChanges();
    expect(el.querySelector('pf-opd-vitals-form')).toBeTruthy();
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
