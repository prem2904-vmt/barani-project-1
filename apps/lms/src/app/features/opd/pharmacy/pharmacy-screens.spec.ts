import { signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { DialogService } from '../../../core/services/dialog.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { PharmacyApi, type RxDetail } from './pharmacy.api';
import { PharmacyRxQueuePage } from './rx-queue.page';
import { PharmacyDispensePage } from './dispense.page';
import { PharmacyWalkInCounterPage } from './walk-in-counter.page';
import { PharmacySettingsPage } from './pharmacy-settings.page';
import { PharmacySectionsComponent, PHARMACY_SECTIONS } from './pharmacy-sections.component';

/**
 * Pharmacy screens (ND pattern): band + main card + side card, ONE primary per
 * state, no native select / datalist / confirm, SVG icons only; the dispense
 * cart and the counter cart price exactly like the server (BillMath).
 */
const DRUG_AMC = { id: 'amc', name: 'Amoclav-PF 625', generic: 'Amoxicillin 500 mg + Clavulanic acid 125 mg', strength: '625 mg', form: 'tab', unit: 'tab', schedule: 'H1', hsnCode: '3004', taxSlab: 12, defaultMrp: 22.4, onHand: 46 } as const;
const DRUG_ALT = { ...DRUG_AMC, id: 'alt', name: 'Clinic Amoclav 625', onHand: 20 };
const RX: RxDetail = {
  visitId: 'v1', visitNumber: 'OPD-2609-0142', token: 7,
  patient: { id: 'p1', name: 'Kavitha Ramesh', meta: '42/F · AA0112', phone: '9841022000' },
  doctor: { id: 'd1', name: 'Dr. Ananya Rao' }, doctorRegNo: 'TNMC 77201', completedAt: '2026-09-30T05:22:00Z', consultStatus: 'completed',
  settings: { batchPick: 'earliest_expiry', walkInBillEditable: true, enforceSchedules: true }, dispenses: [],
  lines: [
    {
      rxLineId: 'r1', drugId: 'amc', drugName: 'Amoclav-PF 625', form: 'tab', dose: 1, site: null, schedule: { type: 'times', pat: [1, 0, 1] },
      durationDays: 5, food: 'After', quantity: 10, dispensed: 0, remaining: 10, dispenseStatus: 'pending', notes: null,
      drug: DRUG_AMC as never, substitutes: [DRUG_ALT as never],
      batches: [{ id: 'b-soon', batchNo: 'AC-SOON', expiryDate: '2099-01-28', mrp: 22.4, qtyOnHand: 6 }, { id: 'b-late', batchNo: 'AC-LATE', expiryDate: '2099-12-28', mrp: 22.4, qtyOnHand: 40 }],
    },
  ],
};

function apiMock(over: Partial<Record<keyof PharmacyApi, unknown>> = {}) {
  return {
    rxQueue: vi.fn(() => of([{ visitId: 'v1', visitNumber: 'OPD-2609-0142', token: 7, patientId: 'p1', patientName: 'Kavitha Ramesh', patientMeta: '42/F', doctorUserId: 'd1', doctorName: 'Dr. Ananya Rao', completedAt: new Date().toISOString(), lines: 3, pending: 3, status: 'pending' }])),
    dispenses: vi.fn(() => of([])),
    rx: vi.fn(() => of(RX)),
    dispenseRx: vi.fn(() => of({ id: 'x1', kind: 'rx', number: 'PD-2609-00001', status: 'completed', createdAt: '', editable: false,
      lines: [{ id: 'l1', rxLineId: 'r1', drugId: 'amc', drugName: 'Amoclav-PF 625', form: 'tab', schedule: 'H1', batchId: 'b-soon', batchNo: 'AC-SOON', expiryDate: '2099-01-28', qty: 10, mrp: 22.4, total: 224, returnedQty: 0 }],
      bill: { id: 'bill', invoiceNumber: 'PH-2609-00001', subTotal: 200, discount: 0, totalTaxable: 200, totalCgst: 12, totalSgst: 12, totalTax: 24, roundOff: 0, totalPayable: 224, totalPaid: 224, balance: 0, status: 'paid', payments: [] } })),
    settings: vi.fn(() => of({ batchPick: 'earliest_expiry', walkInBillEditable: true, enforceSchedules: true })),
    saveSettings: vi.fn((s: unknown) => of(s)),
    batches: vi.fn(() => of([])),
    searchDrugs: vi.fn(() => of([])),
    drugMaster: vi.fn(() => of([])),
    suppliers: vi.fn(() => of([])),
    ...over,
  };
}

function render<T>(cmp: Type<T>, api = apiMock(), dialogOk = true) {
  const dialog = { confirm: vi.fn(async () => dialogOk), prompt: vi.fn(async () => null) };
  const toast = { success: vi.fn(), error: vi.fn() };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [cmp],
    providers: [
      provideRouter([]),
      { provide: PharmacyApi, useValue: api },
      { provide: ApiService, useValue: { get: vi.fn(() => of([])) } },
      { provide: ToastService, useValue: toast },
      { provide: DialogService, useValue: dialog },
      { provide: AuthService, useValue: { user: () => ({ id: 'u1', tenantName: 'Micro World Clinic' }) } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World Clinic' }) } },
      { provide: NavBackService, useValue: { showBack: () => true, back: vi.fn(), backTo: vi.fn() } },
      { provide: ThemeService, useValue: { isDark: () => false, isNewDesign: () => true } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ visitId: 'v1' }), queryParamMap: convertToParamMap({}) } } },
    ],
  });
  const f = TestBed.createComponent(cmp);
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance as any, api, dialog, toast };
}

const primaries = (el: HTMLElement) => el.querySelectorAll('.nd-btn--primary, .pf-hb-btn--primary');
const noNative = (el: HTMLElement) => {
  expect(el.querySelectorAll('select, datalist').length).toBe(0);
  expect(el.innerHTML).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u); // no emoji icons
};
const flush = () => new Promise(r => setTimeout(r, 0));

describe('Pharmacy screens', () => {
  it('sections: one neutral segmented nav, the current section marked', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [PharmacySectionsComponent], providers: [provideRouter([])] });
    const f = TestBed.createComponent(PharmacySectionsComponent);
    f.componentRef.setInput('active', 'stock');
    f.detectChanges();
    const links = (f.nativeElement as HTMLElement).querySelectorAll('a.nd-seg__item');
    expect(links.length).toBe(PHARMACY_SECTIONS.length);
    const cur = (f.nativeElement as HTMLElement).querySelector('[aria-current="page"]');
    expect(cur?.textContent?.trim()).toBe('Stock');
  });

  it('Rx queue lists waiting prescriptions and opens one', async () => {
    const { el, f, api } = render(PharmacyRxQueuePage);
    await f.whenStable(); f.detectChanges();
    expect(api.rxQueue).toHaveBeenCalled();
    expect(el.textContent).toContain('Kavitha Ramesh');
    expect(el.textContent).toContain('Waiting to dispense');
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    (el.querySelector('.ph-list .ph-row') as HTMLButtonElement).click();
    expect(nav).toHaveBeenCalledWith(['/opd/pharmacy/dispense', 'v1']);
    expect(primaries(el).length).toBe(0);
    noNative(el);
  });

  it("Rx queue Today card: Collect payment on an unpaid dispensed sale (night/money #1)", async () => {
    const today = [
      { id: 's1', kind: 'rx', number: 'PD-1', status: 'completed', createdAt: '', customerName: 'Kavitha', total: 300, paid: 0, lines: 1 },
      { id: 's2', kind: 'walk_in', number: 'PD-2', status: 'completed', createdAt: '', customerName: 'Anand', total: 200, paid: 200, lines: 1 },
    ];
    const api = apiMock({
      dispenses: vi.fn(() => of(today)),
      payDispense: vi.fn(() => of({ id: 's1', kind: 'rx', status: 'completed', createdAt: '', editable: false, lines: [],
        bill: { id: 'b', totalPayable: 300, totalPaid: 300, balance: 0, status: 'paid', payments: [] } })),
    });
    const dialog = { choose: vi.fn(async () => 'cash'), confirm: vi.fn(async () => true), prompt: vi.fn(async () => null) };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [PharmacyRxQueuePage],
      providers: [
        provideRouter([]),
        { provide: PharmacyApi, useValue: api },
        { provide: ApiService, useValue: { get: vi.fn(() => of([])) } },
        { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn() } },
        { provide: DialogService, useValue: dialog },
        { provide: AuthService, useValue: { user: () => ({ id: 'u1', tenantName: 'Micro World Clinic' }) } },
        { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World Clinic' }) } },
        { provide: NavBackService, useValue: { showBack: () => true, back: vi.fn(), backTo: vi.fn() } },
        { provide: ThemeService, useValue: { isDark: () => false, isNewDesign: () => true } },
      ],
    });
    const f = TestBed.createComponent(PharmacyRxQueuePage);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    await f.whenStable(); f.detectChanges();
    const btn = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.includes('Collect payment')) as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    await flush(); f.detectChanges();
    expect(dialog.choose).toHaveBeenCalled();
    expect(api.payDispense).toHaveBeenCalledWith('s1', { mode: 'cash', amount: 300 });
  });

  it('dispense: "bill later" shows the due amount with an inline Collect payment control', async () => {
    const api = apiMock({
      dispenseRx: vi.fn(() => of({
        id: 'x1', kind: 'rx', number: 'PD-2609-00001', status: 'completed', createdAt: '', editable: false,
        lines: [{ id: 'l1', rxLineId: 'r1', drugId: 'amc', drugName: 'Amoclav-PF 625', form: 'tab', schedule: 'H1', batchId: 'b-soon', batchNo: 'AC-SOON', expiryDate: '2099-01-28', qty: 10, mrp: 22.4, total: 224, returnedQty: 0 }],
        bill: { id: 'bill', invoiceNumber: 'PH-2609-00001', subTotal: 200, discount: 0, totalTaxable: 200, totalCgst: 12, totalSgst: 12, totalTax: 24, roundOff: 0, totalPayable: 224, totalPaid: 0, balance: 224, status: 'pending', payments: [] },
      })),
      payDispense: vi.fn(() => of({
        id: 'x1', kind: 'rx', number: 'PD-2609-00001', status: 'completed', createdAt: '', editable: false, lines: [],
        bill: { id: 'bill', invoiceNumber: 'PH-2609-00001', subTotal: 200, discount: 0, totalTaxable: 200, totalCgst: 12, totalSgst: 12, totalTax: 24, roundOff: 0, totalPayable: 224, totalPaid: 224, balance: 0, status: 'paid', payments: [] },
      })),
    });
    const { el, f, c } = render(PharmacyDispensePage, api);
    await f.whenStable(); f.detectChanges();
    c.patientAddress.set('12 MG Road, Chennai');
    f.detectChanges();
    c.give(false); // "Give, bill later"
    await flush(); f.detectChanges();
    expect(el.textContent).toContain('still due');
    expect(el.textContent).toContain('Collect ₹224');
    (el.querySelector('.nd-btn--primary') as HTMLButtonElement).click();
    await flush(); f.detectChanges();
    expect(api.payDispense).toHaveBeenCalledWith('x1', { mode: 'upi', amount: 224 });
    expect(el.textContent).not.toContain('still due');
  });

  it('dispense: the Rx arrives with its quantity + earliest batch, prices like the server, ONE primary', async () => {
    const { el, f, c, api } = render(PharmacyDispensePage);
    await f.whenStable(); f.detectChanges();
    expect(el.textContent).toContain('AC-SOON');           // earliest expiry first
    expect(el.textContent).toContain('AC-LATE');           // 10 = 6 + 4 split
    expect(c.totals().payable).toBe(224);                  // 10 × 22.40 incl. 12% GST
    expect(el.textContent).toContain('Take payment ₹224');
    expect(el.textContent).toContain('covered by this prescription');
    expect(el.textContent).toContain('H1 register');
    expect(primaries(el).length).toBe(0); // H1 register needs the patient's address first (critic #1)
    c.patientAddress.set('12 MG Road, Chennai');
    f.detectChanges();
    expect(primaries(el).length).toBe(1);
    noNative(el);

    // Partial: 4 now, the rest later.
    c.setQty(RX.lines[0], '4');
    f.detectChanges();
    expect(el.textContent).toContain('6 later');

    // Pay → the server call carries the line + payment; the side card becomes the instructions.
    c.give(true);
    await flush(); f.detectChanges();
    expect(api.dispenseRx).toHaveBeenCalledWith('v1', expect.objectContaining({
      lines: [{ rxLineId: 'r1', drugId: 'amc', qty: 4, batchId: null, overrideReason: null }],
      payment: expect.objectContaining({ mode: 'upi' }),
    }));
    expect(el.textContent).toContain('Instructions');
    expect(el.textContent).toContain('Take 1 tablet');
    expect(el.textContent).toContain('Send on WhatsApp');
    const wa = el.querySelector('a[href^="https://wa.me/919841022000"]');
    expect(wa).toBeTruthy();
    expect(primaries(el).length).toBe(1);
  });

  it('dispense: skipping every line disables payment; a substitute is offered from the same generic', async () => {
    const { el, f, c } = render(PharmacyDispensePage);
    await f.whenStable(); f.detectChanges();
    expect(c.subOptions(RX.lines[0]).map((o: { label: string }) => o.label)).toEqual(['Amoclav-PF 625 (prescribed)', 'Clinic Amoclav 625']);
    c.toggleSkip(RX.lines[0]);
    f.detectChanges();
    expect(c.canGive()).toBe(false);
    expect(primaries(el).length).toBe(0);
  });

  it('dispense: pharmacist-pick mode needs a named batch per line', async () => {
    const api = apiMock({ rx: vi.fn(() => of({ ...RX, settings: { ...RX.settings, batchPick: 'pharmacist' } })) });
    const { f, c } = render(PharmacyDispensePage, api);
    await f.whenStable(); f.detectChanges();
    expect(c.canGive()).toBe(false);
    c.setBatch(RX.lines[0], 'b-late');
    expect(c.canGive()).toBe(false); // H1 register still needs the patient's address (critic #1)
    c.patientAddress.set('12 MG Road, Chennai');
    expect(c.canGive()).toBe(true);
    expect(c.takes(RX.lines[0])).toEqual([expect.objectContaining({ batchNo: 'AC-LATE', qty: 10 })]);
  });

  it('counter: OTC sells freely; an H1 drug blocks payment until the prescription + buyer + upload are entered', async () => {
    const { el, f, c } = render(PharmacyWalkInCounterPage);
    await f.whenStable(); f.detectChanges();
    const batches = [{ id: 'b1', batchNo: 'AZ1', expiryDate: '2099-01-28', mrp: 23.8, qtyOnHand: 30 }];
    c.items.set([{ drug: { ...DRUG_AMC, id: 'azi', name: 'Azithro-PF 500', rowId: 'azi', catalogKey: 'k', origin: 'master', isMaster: true, aliases: [], isActive: true }, qty: 3, batchId: null, batches }]);
    f.detectChanges();
    // The register (H1) checks the BUYER first, before the prescriber's name.
    expect(c.gate()).toMatch(/customer/);
    expect(c.ready()).toBe(false);
    expect(primaries(el).length).toBe(0);
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('customer');
    c.name.set('Anand');
    f.detectChanges();
    expect(c.gate()).toMatch(/prescribing doctor/);
    c.prescriber.set('Dr. Menon');
    f.detectChanges();
    expect(c.gate()).toMatch(/registration number/);
    c.regNo.set('TN12345');
    f.detectChanges();
    expect(c.gate()).toMatch(/address/); // H1 register still needs the customer's address (critic #1)
    c.address.set('12 MG Road, Chennai');
    f.detectChanges();
    expect(c.gate()).toBeNull();
    expect(c.ready()).toBe(true);
    // The prescription must also be UPLOADED before payment (owner 2026-10-01) — Save stays available.
    expect(c.canPay()).toBe(false);
    expect(c.payGate()).toMatch(/upload/i);
    expect(primaries(el).length).toBe(0);
    c.rxFile.set('prescription.jpg');
    f.detectChanges();
    expect(c.canPay()).toBe(true);
    expect(c.totals().payable).toBe(71); // 3 × 23.80 = 71.40 → 71
    expect(primaries(el).length).toBe(1);
    noNative(el);
  });

  it('counter: save parks an open bill, then payment completes it', async () => {
    const view = { id: 's1', kind: 'walk_in', status: 'draft', editable: true, createdAt: '', lines: [], bill: { totalPayable: 42, totalPaid: 0, balance: 42 } };
    const api = apiMock({
      counterCreate: vi.fn(() => of(view)),
      counterPay: vi.fn(() => of({ ...view, status: 'completed', editable: false, bill: { ...view.bill, totalPaid: 42, invoiceNumber: 'PH-1' } })),
    });
    const { f, c } = render(PharmacyWalkInCounterPage, api);
    await f.whenStable();
    c.items.set([{ drug: { id: 'ors', name: 'Hydra-PF ORS', form: 'sachet', unit: 'sachet', schedule: 'none', taxSlab: 12, rowId: 'ors', catalogKey: 'k', origin: 'master', isMaster: true, aliases: [], isActive: true }, qty: 2, batchId: null, batches: [{ id: 'b', batchNo: 'OR1', expiryDate: '2099-01-01', mrp: 21, qtyOnHand: 30 }] }]);
    c.pay();
    await flush(); f.detectChanges();
    expect(api.counterCreate).toHaveBeenCalledWith(expect.objectContaining({ lines: [{ drugId: 'ors', qty: 2, batchId: null }] }));
    expect(api.counterPay).toHaveBeenCalledWith('s1', { mode: 'upi', amount: 42 });
    expect(c.paid()).toBeTruthy();
    expect((f.nativeElement as HTMLElement).textContent).toContain('New sale');
  });

  it('dispense: a draft consult shows "waiting on the doctor" with no editable lines (night/money #3)', async () => {
    const api = apiMock({ rx: vi.fn(() => of({ ...RX, consultStatus: 'draft' })) });
    const { el, f, c } = render(PharmacyDispensePage, api);
    await f.whenStable(); f.detectChanges();
    expect(el.textContent).toContain("hasn't completed this consult yet");
    expect(el.textContent).toContain('Waiting on the doctor');
    expect(el.querySelector('input[type="number"]')).toBeNull(); // no qty stepper
    expect(el.querySelector('pf-select')).toBeNull();              // no drug / batch picker
    expect(el.textContent).not.toContain('Billing');
    expect(c.canGive()).toBe(false);
    noNative(el);
  });

  it('settings: switching Schedule enforcement OFF asks first; Save is the one primary once changed', async () => {
    const { el, f, c, dialog, api } = render(PharmacySettingsPage, apiMock(), false);
    await f.whenStable(); f.detectChanges();
    expect(primaries(el).length).toBe(0); // nothing changed yet
    await c.toggleEnforce();
    expect(dialog.confirm).toHaveBeenCalled();
    expect(c.cfg().enforceSchedules).toBe(true); // declined → unchanged
    c.set('batchPick', 'pharmacist');
    f.detectChanges();
    expect(primaries(el).length).toBe(1);
    c.save();
    expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ batchPick: 'pharmacist', enforceSchedules: true }));
    noNative(el);
  });
});

// ── Pregnancy-safety guard (night/safety, critic P0 #1d) ───────────────────
const DRUG_CONTRA = { ...DRUG_AMC, id: 'contra', name: 'Itrazole 100', pregnancyRisk: 'contraindicated' as const };
const RX_PREGNANT: RxDetail = {
  ...RX,
  pregnancy: { status: 'pregnant', source: 'form answer', since: '2026-08-01' },
  lines: [{ ...RX.lines[0], drugId: 'contra', drugName: 'Itrazole 100', drug: DRUG_CONTRA as never, substitutes: [] }],
};

describe('Pharmacy screens — pregnancy-safety guard', () => {
  it('dispense: a contraindicated drug on a pregnant patient shows the chip', async () => {
    const api = apiMock({ rx: vi.fn(() => of(RX_PREGNANT)) });
    const { el, f } = render(PharmacyDispensePage, api);
    await f.whenStable(); f.detectChanges();
    expect(el.querySelector('.ph-preg')).toBeTruthy();
    expect(el.querySelector('.ph-preg')!.textContent).toContain('Contraindicated');
  });

  it('dispensing a contraindicated drug to a pregnant patient asks the pharmacist first — accepted proceeds', async () => {
    const api = apiMock({ rx: vi.fn(() => of(RX_PREGNANT)) });
    const { f, c, dialog } = render(PharmacyDispensePage, api, true);
    await f.whenStable(); f.detectChanges();
    c.patientAddress.set('12 MG Road, Chennai');
    f.detectChanges();
    await c.give(true);
    expect(dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Contraindicated in pregnancy', tone: 'danger' }));
    expect(api.dispenseRx).toHaveBeenCalled();
  });

  it('declining the confirmation never dispenses', async () => {
    const api = apiMock({ rx: vi.fn(() => of(RX_PREGNANT)) });
    const { f, c, dialog } = render(PharmacyDispensePage, api, false);
    await f.whenStable(); f.detectChanges();
    c.patientAddress.set('12 MG Road, Chennai');
    f.detectChanges();
    await c.give(true);
    expect(dialog.confirm).toHaveBeenCalled();
    expect(api.dispenseRx).not.toHaveBeenCalled();
  });

  it('a non-pregnant patient never asks, even for a contraindicated-tagged drug', async () => {
    const api = apiMock({ rx: vi.fn(() => of({ ...RX_PREGNANT, pregnancy: undefined })) });
    const { f, c, dialog } = render(PharmacyDispensePage, api, true);
    await f.whenStable(); f.detectChanges();
    c.patientAddress.set('12 MG Road, Chennai');
    f.detectChanges();
    await c.give(true);
    expect(dialog.confirm).not.toHaveBeenCalled();
    expect(api.dispenseRx).toHaveBeenCalled();
  });
});
