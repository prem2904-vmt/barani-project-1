import { TestBed } from '@angular/core/testing';
import { OpdDeskPage } from './desk.page';
import { OpdVisitDetailPage } from './visit-detail.page';
import { OpdTokenQueuePage, addDays, queueOrder } from '../queue/token-queue.page';
import { OpdVitalsWorkspaceComponent } from '../vitals/vitals-workspace.component';
import { BOARD, DESK, VISIT, flush, harness, row } from './opd-b.spec-helpers';

/** OPD desk list, visit detail, token queue and the vitals station. */
afterEach(() => TestBed.resetTestingModule());
const primaries = (el: HTMLElement) => el.querySelectorAll('.nd-btn--primary, .pf-hb-btn--primary');

describe('OPD desk (/opd/desk)', () => {
  function render() {
    const rows = [row({ id: '1', status: 'waiting', tokenLabel: 'A3' }), row({ id: '2', status: 'in_consult', tokenLabel: 'A2' }), row({ id: '3', status: 'completed', doctorUserId: 'd3' })];
    const h = harness({ get: url => (url.startsWith('/api/opd/queue/board') ? BOARD : url.startsWith('/api/opd/visits') ? rows : null) });
    TestBed.configureTestingModule({ imports: [OpdDeskPage], providers: h.providers });
    const f = TestBed.createComponent(OpdDeskPage); f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance, ...h };
  }
  it('lists today\'s visits with token, full name, status word; ONE primary = New visit', () => {
    const { el } = render();
    const rows = el.querySelectorAll('[data-visit]');
    expect(rows.length).toBe(3);
    expect(rows[0].querySelector('.pf-ob-token')!.textContent).toBe('A3');
    expect(rows[0].textContent).toContain('Patient 1');
    expect(rows[0].querySelector('.pf-ob-status--waiting')!.textContent).toBe('Waiting');
    const p = primaries(el);
    expect(p.length).toBe(1);
    expect(p[0].textContent).toContain('New visit');
  });
  it('filters by status and by the picked doctor; a row opens the visit', () => {
    const { el, f, c, router } = render();
    c.filter.set('waiting'); f.detectChanges();
    expect(el.querySelectorAll('[data-visit]').length).toBe(1);
    c.filter.set('all'); c.pickDoctor('d3'); f.detectChanges();
    expect(el.querySelectorAll('[data-visit]').length).toBe(1);
    (el.querySelector('[data-visit]') as HTMLButtonElement).click();
    expect(router.navigate).toHaveBeenCalledWith(['/opd/visit', '3']);
  });
});

describe('Visit detail (/opd/visit/:id)', () => {
  function render(query: Record<string, string> = {}, dialog: any = {}) {
    const h = harness({
      params: { id: 'v1' }, query, dialog,
      get: url => (url === '/api/opd/visits/v1' ? VISIT : url === '/api/opd/visits/desk' ? DESK : null),
      post: url => (url.includes('/status') ? { ...VISIT, status: 'cancelled', cancelReason: 'Left' } : url.includes('/reassign') ? { ...VISIT, tokenLabel: 'K2' } : {}),
    });
    TestBed.configureTestingModule({ imports: [OpdVisitDetailPage], providers: h.providers });
    const f = TestBed.createComponent(OpdVisitDetailPage); f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance, ...h };
  }
  it('shows the token, the timeline, the OPD bill and the lab order\'s own bill separately', () => {
    const { el } = render({ issued: '1' });
    expect(el.querySelector('[data-token]')!.textContent).toContain('Token issued');
    expect(el.querySelector('.pf-vd-token__n')!.textContent).toBe('A3');
    expect(el.querySelector('[data-token]')!.textContent).toContain('the vitals station');
    expect([...el.querySelectorAll('.pf-vd-tl__step')].map(s => s.getAttribute('data-state'))).toEqual(['done', 'done', 'current', 'upcoming', 'upcoming', 'upcoming']);
    expect(el.textContent).toContain('set at the desk (rule ₹300)');
    expect(el.textContent).toContain('Set at the desk: Senior citizen');
    expect(el.querySelector('[data-box="lab"]')!.textContent).toContain('own lab bill');
    expect(primaries(el).length).toBe(1);
    expect(primaries(el)[0].textContent).toContain('Next patient');
  });
  it('cancel asks for a reason through DialogService, then posts the status (paid bill kept)', async () => {
    const { c, api, dialog } = render({}, { prompt: async () => 'Left', choose: async () => 'keep' });
    await c.cancel(); await flush();
    expect(dialog.prompt).toHaveBeenCalled();
    expect(api.post).toHaveBeenCalledWith('/api/opd/visits/v1/status', { to: 'cancelled', reason: 'Left' });
  });
  it('cancel of a paid visit offers a refund and posts it as a credit note (integrator)', async () => {
    const { c, api, dialog } = render({}, { prompt: async () => 'Left', choose: async () => 'upi' });
    await c.cancel(); await flush();
    expect(dialog.choose.mock.calls[0][0].title).toContain('Refund ₹200');
    expect(api.post).toHaveBeenCalledWith('/api/opd/visits/v1/status', { to: 'cancelled', reason: 'Left', refund: true, refundMode: 'upi' });
  });
  it('dismissing the refund choice keeps the visit (nothing posted)', async () => {
    const { c, api } = render({}, { prompt: async () => 'Left', choose: async () => null });
    await c.cancel(); await flush();
    expect(api.post).not.toHaveBeenCalledWith('/api/opd/visits/v1/status', expect.anything());
  });
  it('change doctor offers the other doctors and posts the reassignment', async () => {
    const { c, api, dialog } = render({}, { choose: async () => 'd2' });
    await c.reassign(); await flush();
    const choices = dialog.choose.mock.calls[0][0].choices.map((x: any) => x.value);
    expect(choices).toEqual(['d2', 'd3']);
    expect(api.post).toHaveBeenCalledWith('/api/opd/queue/v1/reassign', { doctorUserId: 'd2', reason: null });
  });
});

describe('Token queue (/opd/queue)', () => {
  const rows = [row({ id: '1', token: 3, tokenLabel: 'A3', status: 'waiting' }), row({ id: '2', token: 2, tokenLabel: 'A2', status: 'in_consult', vitalsSummary: 'BP 142/90', vitalsFlagged: true }),
    row({ id: '4', token: 4, tokenLabel: 'A4', status: 'vitals' }), row({ id: '9', token: 1, tokenLabel: 'R1', doctorUserId: 'd3' })];
  function render(dialog: any = {}) {
    const h = harness({
      dialog,
      get: url => (url.startsWith('/api/opd/queue/board') ? BOARD : url.startsWith('/api/opd/queue') ? rows : url === '/api/opd/visits/desk' ? DESK : null),
      post: url => (url.endsWith('/call-next') ? { ...VISIT, tokenLabel: 'A3' } : url.endsWith('/doctor-unavailable') ? { policy: 'auto_move', moved: [{}, {}], unmoved: [] } : { ...VISIT, visitDate: '2026-10-01' }),
    });
    TestBed.configureTestingModule({ imports: [OpdTokenQueuePage], providers: h.providers });
    const f = TestBed.createComponent(OpdTokenQueuePage); f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance, ...h };
  }
  it('orders a doctor\'s queue: in consult, waiting by token, then at vitals', () => {
    expect(queueOrder(rows.slice(0, 3)).map(r => r.tokenLabel)).toEqual(['A2', 'A3', 'A4']);
    expect(addDays('2026-09-30', 2)).toBe('2026-10-02');
  });
  it('opens the first busy doctor, shows their tiles only, and the band has "Call next · A3"', () => {
    const { el } = render();
    const tiles = el.querySelectorAll('.pf-tq-tile');
    expect([...tiles].map(t => t.querySelector('.pf-ob-token')!.textContent)).toEqual(['A2', 'A3', 'A4']);
    expect(tiles[0].textContent).toContain('Vitals · BP 142/90');
    expect(tiles[0].querySelector('.pf-tq-flag')).toBeTruthy();
    expect(tiles[1].textContent).toContain('Vitals pending');
    const btn = el.querySelector('[data-cta]') as HTMLButtonElement;
    expect(btn.textContent).toContain('Call next · A3');
  });
  it('call next posts for the doctor', async () => {
    const { c, api } = render();
    await c.callNext();
    expect(api.post).toHaveBeenCalledWith('/api/opd/queue/call-next', { doctorUserId: 'd1' });
  });
  it('doctor unavailable asks which policy (default from settings) and applies it', async () => {
    const { c, api, dialog } = render({ choose: async (req: any) => req.initialChoice });
    await c.doctorUnavailable();
    expect(dialog.choose.mock.calls[0][0].initialChoice).toBe('auto_move');
    expect(api.post).toHaveBeenCalledWith('/api/opd/queue/doctor-unavailable', { doctorUserId: 'd1', policy: 'auto_move', rescheduleTo: null });
  });
  it('reschedule picks a later day through DialogService', async () => {
    const { c, api } = render({ choose: async (req: any) => req.initialChoice });
    await c.reschedule(rows[0]);
    const call = api.post.mock.calls.find((x: any[]) => x[0] === '/api/opd/queue/1/reschedule');
    expect(call[1].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('Vitals station (/opd/vitals)', () => {
  const q = [row({ id: 'v1', status: 'vitals', tokenLabel: 'A3', patientName: 'Mrs. Kavitha Ramesh' }), row({ id: 'v2', status: 'vitals', tokenLabel: 'E5', patientName: 'Mr. Suresh Babu' })];
  function render() {
    const h = harness({
      get: url => (url === '/api/opd/vitals/queue' ? q : url.startsWith('/api/opd/visits/') ? { ...VISIT, id: url.split('/').pop() } : null),
      post: () => ({ id: 'x', visitId: 'v1', flags: [], recordedAt: '', recordedBy: 'u1' }),
    });
    TestBed.configureTestingModule({ imports: [OpdVitalsWorkspaceComponent], providers: h.providers });
    const f = TestBed.createComponent(OpdVitalsWorkspaceComponent); f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance, ...h };
  }
  it('opens the oldest patient; ONE primary = Save & send to doctor', () => {
    const { el, c } = render();
    expect(c.selectedId()).toBe('v1');
    expect(el.querySelectorAll('.pf-ob-row').length).toBe(2);
    expect(el.querySelector('pf-opd-vitals-form')).toBeTruthy();
    const p = primaries(el);
    expect(p.length).toBe(1);
    expect(p[0].textContent).toContain('Save & send to doctor');
  });
  it('BMI updates as you type; an impossible reading blocks the save', async () => {
    const { el, f, c, api } = render();
    const set = (k: string, v: string) => { const i = el.querySelector(`[data-vital="${k}"]`) as HTMLInputElement; i.value = v; i.dispatchEvent(new Event('input')); };
    set('weightKg', '68'); set('heightCm', '161'); f.detectChanges();
    expect(el.querySelector('.pf-vf__bmi-n')!.textContent).toBe('26.2');
    expect(el.querySelector('.pf-vf__bmi-band')!.textContent).toBe('Overweight');
    set('spo2', '140'); f.detectChanges();
    await c.save(); f.detectChanges();
    expect(api.post).not.toHaveBeenCalled();
    expect(el.querySelector('[data-vital="spo2"]')!.getAttribute('aria-invalid')).toBe('true');
    set('spo2', '98'); f.detectChanges();
    await c.save(); await flush(); f.detectChanges();
    expect(api.post).toHaveBeenCalledWith('/api/opd/vitals/v1', expect.objectContaining({ weightKg: 68, heightCm: 161, spo2: 98, sendToDoctor: true }));
    expect(c.selectedId()).toBe('v2'); // on to the next patient
  });
  it('skip sends the patient to the doctor without vitals', async () => {
    const { c, api } = render();
    await c.skip();
    expect(api.post).toHaveBeenCalledWith('/api/opd/vitals/v1/skip', {});
  });
});
