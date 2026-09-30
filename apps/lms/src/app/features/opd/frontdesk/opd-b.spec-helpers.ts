/**
 * Test harness for the OPD desk / vitals / queue specs (Agent B): fixtures in
 * the server's wire shape and the DI stubs every screen needs. DI stubs only —
 * no vi.mock of relative imports.
 */
import { signal, type Provider } from '@angular/core';
import { Router, ActivatedRoute, convertToParamMap } from '@angular/router';
import { EMPTY, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { ThemeService } from '../../../core/services/theme.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { WorkEventsService } from '../../../core/services/work-events.service';
import { DialogService } from '../../../core/services/dialog.service';
import type { DeskData, DeskQuote, OpdVisitDetail, OpdVisitRow, QueueDoctor } from './desk.models';

export const DESK: DeskData = {
  today: '2026-09-30',
  config: { workflow: { vitals: 'station', labTestsAtDesk: true, billing: 'before_consult' }, queue: { organise: 'per_doctor', doctorUnavailable: 'auto_move' } },
  doctors: [
    { id: 'd1', name: 'Dr. Ananya Rao', department: 'ENT', departmentIds: ['ent'], waiting: 3, estWaitMinutes: 36, fee: 600, tokenPrefix: 'A', nowServing: 'A2' },
    { id: 'd2', name: 'Dr. Karthik Subramanian', department: 'ENT', departmentIds: ['ent'], waiting: 1, estWaitMinutes: 12, fee: 800, tokenPrefix: 'K' },
    { id: 'd3', name: 'Dr. Rohan Mehta', department: 'General Medicine', departmentIds: ['gm'], waiting: 0, estWaitMinutes: 0, fee: 500, tokenPrefix: 'R' },
  ],
  departments: [
    { id: 'ent', name: 'ENT', code: 'ENT', waiting: 4, doctorIds: ['d1', 'd2'] },
    { id: 'gm', name: 'General Medicine', code: 'GM', waiting: 0, doctorIds: ['d3'] },
  ],
};

export const QUOTE_D1: DeskQuote = {
  doctorId: 'd1',
  services: [
    { serviceId: 's1', name: 'ENT consultation', category: 'consultation', priceSource: 'per_doctor', price: 600, taxSlab: 0, isFollowUp: true, followUpFee: 300, followUpWithinDays: 7, quoted: 300 },
    { serviceId: 's2', name: 'Diagnostic nasal endoscopy', category: 'procedure', priceSource: 'common', price: 1500, taxSlab: 0, isFollowUp: false, quoted: 1500 },
  ],
  lastWithDoctor: { visitId: 'v0', visitDate: '2026-09-25', doctorName: 'Dr. Ananya Rao', departmentName: 'ENT' },
};

export const PATIENT = { id: 'p1', firstName: 'Kavitha', fathersName: 'Ramesh', title: 'Mrs.', displayName: 'Mrs. Kavitha Ramesh', age: 42, sex: 'Female', mrn: 'AA0112', phone: '9841022345', abhaId: '91-1234' };

export const TESTS = [
  { id: 't1', name: 'Absolute eosinophil count', shortName: 'AEC', testCode: 'HEM010', price: 150, taxSlab: 0, type: 'individual', isActive: true },
  { id: 't2', name: 'Liver function test', shortName: 'LFT', testCode: 'BIO020', price: 700, taxSlab: 0, type: 'profile', isActive: true },
];

export const VISIT: OpdVisitDetail = {
  id: 'v1', visitNumber: 'OPD-2609-000007', visitDate: '2026-09-30', token: 3, tokenLabel: 'A3', status: 'vitals', purpose: 'Nasal block',
  source: 'follow_up', isFollowUp: true, quotedFee: 300, feeOverride: 200, feeOverrideReason: 'Senior citizen',
  patient: { id: 'p1', name: 'Mrs. Kavitha Ramesh', mrn: 'AA0112', age: '42y', sex: 'Female' },
  doctor: { id: 'd1', name: 'Dr. Ananya Rao', department: 'ENT' }, department: { id: 'ent', name: 'ENT', code: 'ENT' },
  service: { id: 's1', name: 'ENT consultation' },
  bill: { id: 'b1', kind: 'consult', invoiceNumber: 'OPB-2609-000007', lines: [{ sourceType: 'service', description: 'ENT consultation (follow-up) — set at the desk (rule ₹300)', qty: 1, unitPrice: 200, discount: 0, taxSlab: 0, total: 200 }],
    subTotal: 200, discount: 0, taxable: 200, tax: 0, roundOff: 0, totalPayable: 200, totalPaid: 200, balance: 0, status: 'paid',
    payments: [{ amount: 200, mode: 'upi', createdAt: '2026-09-30T04:31:00Z' }] },
  labOrder: { id: 'o1', orderNumber: 'LAB-2609-000090', status: 'billed', tests: 1, invoiceNumber: 'INV-0090', payable: 150, paid: 150, balance: 0 },
  latestVitals: null,
  timeline: [
    { key: 'booked', label: 'Booked at the desk', at: '2026-09-30T04:30:00Z', state: 'done' },
    { key: 'paid', label: 'Paid', at: '2026-09-30T04:31:00Z', state: 'done' },
    { key: 'vitals', label: 'Vitals', state: 'current' },
    { key: 'waiting', label: 'Waiting for the doctor', state: 'upcoming' },
    { key: 'in_consult', label: 'In consult', state: 'upcoming' },
    { key: 'completed', label: 'Completed', state: 'upcoming' },
  ],
  createdAt: '2026-09-30T04:30:00Z',
};

export function row(p: Partial<OpdVisitRow> & { id: string }): OpdVisitRow {
  return {
    patientId: 'p' + p.id, patientName: 'Patient ' + p.id, patientMeta: '40/F · AA00' + p.id, doctorUserId: 'd1', doctorName: 'Dr. Ananya Rao',
    departmentName: 'ENT', serviceName: 'ENT consultation', visitDate: '2026-09-30', token: 1, tokenLabel: 'A1', status: 'waiting',
    isFollowUp: false, charged: 600, billStatus: 'paid', hasLabOrder: false, createdAt: '2026-09-30T04:00:00Z', checkedInAt: '2026-09-30T04:05:00Z',
    vitalsSummary: null, vitalsFlagged: false, ...p,
  };
}

export const BOARD: QueueDoctor[] = [
  { id: 'd1', name: 'Dr. Ananya Rao', department: 'ENT', waiting: 2, vitals: 0, inConsult: 1, done: 2, nowServing: 'A2', next: 'A3' },
  { id: 'd3', name: 'Dr. Rohan Mehta', department: 'General Medicine', waiting: 0, vitals: 0, inConsult: 0, done: 0 },
];

export interface Harness { api: { get: any; post: any }; router: any; toasts: any; dialog: any; providers: Provider[]; }

/** DI stubs. `routes` answers GETs by URL prefix; `posts` answers POSTs. */
export function harness(opts: {
  get?: (url: string) => unknown; post?: (url: string, body: any) => unknown; params?: Record<string, string>; query?: Record<string, string>;
  dialog?: Partial<Record<'choose' | 'prompt' | 'confirm', any>>;
} = {}): Harness {
  const api = {
    get: vi.fn((url: string) => {
      const r = opts.get?.(url);
      if (r instanceof Error) return throwError(() => r);
      return of(r ?? null);
    }),
    post: vi.fn((url: string, body: any) => {
      const r = opts.post?.(url, body);
      if (r instanceof Error) return throwError(() => r);
      return of(r ?? {});
    }),
    patch: vi.fn(() => of({})), put: vi.fn(() => of({})), delete: vi.fn(() => of({})),
  };
  const router = { navigate: vi.fn(() => Promise.resolve(true)), navigateByUrl: vi.fn(), url: '/opd', events: EMPTY };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  const d = opts.dialog ?? {};
  const dialog = {
    choose: vi.fn(d.choose ?? (async () => null)), prompt: vi.fn(d.prompt ?? (async () => null)), confirm: vi.fn(d.confirm ?? (async () => false)),
  };
  const route = {
    snapshot: { queryParamMap: convertToParamMap(opts.query ?? {}), paramMap: convertToParamMap(opts.params ?? {}) },
    paramMap: of(convertToParamMap(opts.params ?? {})), queryParamMap: of(convertToParamMap(opts.query ?? {})),
  };
  const providers: Provider[] = [
    { provide: ApiService, useValue: api },
    { provide: Router, useValue: router },
    { provide: ActivatedRoute, useValue: route },
    { provide: ToastService, useValue: toasts },
    { provide: DialogService, useValue: dialog },
    { provide: ThemeService, useValue: { isNewDesign: () => true, isDark: () => false } },
    { provide: AuthService, useValue: { user: () => ({ id: 'u1', branchId: 'b1', tenantName: 'Micro World Clinic', displayName: 'Nurse Revathi S' }), activeBranchId: () => 'b1', hasPermission: () => true } },
    { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World Clinic' }) } },
    { provide: NavBackService, useValue: { showBack: () => true, back: vi.fn(), backTo: vi.fn() } },
    { provide: WorkEventsService, useValue: { on: () => EMPTY } },
  ];
  return { api, router, toasts, dialog, providers };
}

export const flush = () => new Promise(r => setTimeout(r, 0));

/** In-memory Web Storage for the draft (the runner has none). */
export function memoryStorage(): Storage {
  const mem = new Map<string, string>();
  return {
    get length() { return mem.size; }, key: (i: number) => [...mem.keys()][i] ?? null,
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null), setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k), clear: () => mem.clear(),
  };
}
