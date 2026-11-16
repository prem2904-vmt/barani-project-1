import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, TestRequest } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { vi } from 'vitest';
import { PublicReportComponent } from './public-report.component';
import {
  VerifiedReport, clock, mismatchMessage, reportFileName, safeLogoUrl, summarise, telHref,
} from './public-report.util';
import { appRoutes } from '../../../app.routes';
import { isPublicPatientPath } from '../../../core/navigation/public-paths';

/**
 * PUBLIC patient report page (/reports/public/:token) — the WhatsApp link.
 * Pins: every state renders from the API's answers; nothing about the patient
 * before the server accepts the answer; the attempts / lockout copy; the
 * download file name; no login and no authed shell on this route.
 */

const TOKEN = 'tok123';
const read = (p: string) => readFileSync(resolve(process.cwd(), 'apps/lms/src/app', p), 'utf8');

const SNAP = JSON.stringify({
  patient: { displayName: 'Ravi Kumar', firstName: 'Ravi', fathersName: 'Kumar', age: 29, sex: 'M', phone: '9876543210', mrn: 'MRN-1' },
  order: { orderNumber: 'ORD-2609-0042' },
  type: 'final',
  isPartial: false,
});

function verified(extra: Partial<VerifiedReport> = {}): VerifiedReport {
  return {
    org: 'Micro World',
    patient: 'R••• K••••',
    reportReady: true,
    reportPdfUrl: 'https://files.example/r.pdf?sig=inline',
    reportPdfDownloadUrl: 'https://files.example/r.pdf?sig=attachment',
    fileName: 'Report-Ravi-Kumar-2026-09-29.pdf',
    superseded: false,
    report: { id: 'r1', type: 'final', createdAt: '2026-09-29T08:30:00Z', data: SNAP },
    partnerReports: [],
    ...extra,
  };
}

async function settle(f: ComponentFixture<PublicReportComponent>): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 0));
    f.detectChanges();
  }
}

function setup() {
  TestBed.configureTestingModule({
    imports: [PublicReportComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ token: TOKEN }) } } },
    ],
  });
  const f = TestBed.createComponent(PublicReportComponent);
  const http = TestBed.inject(HttpTestingController);
  current = http;
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const q = (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const linkReq = (): TestRequest => http.expectOne(r => r.method === 'GET' && r.url.endsWith(`/api/public/report/${TOKEN}`));
  const verifyReq = (): TestRequest => http.expectOne(r => r.method === 'POST' && r.url.endsWith(`/api/public/report/${TOKEN}/verify`));
  const type = async (v: string) => {
    const input = q('pr-secret') as HTMLInputElement;
    input.value = v;
    input.dispatchEvent(new Event('input'));
    await settle(f);
  };
  const submit = async () => {
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(f);
  };
  return { f, http, el, q, linkReq, verifyReq, type, submit };
}

const ACTIVE = { success: true, data: { state: 'active', lab: { name: 'Micro World Diagnostics', phone: '+91 98400 12345', logoUrl: null }, attemptsLeft: 5, lockedSeconds: 0 } };

async function toVerify() {
  const t = setup();
  t.linkReq().flush(ACTIVE);
  await t.f.whenStable();
  await settle(t.f);
  return t;
}

async function toReady(extra: Partial<VerifiedReport> = {}) {
  const t = await toVerify();
  await t.type('3210');
  await t.submit();
  t.verifyReq().flush({ success: true, data: verified(extra) });
  await settle(t.f);
  return t;
}

let current: HttpTestingController | null = null;
afterEach(() => {
  current?.verify({ ignoreCancelled: true });
  current = null;
  vi.restoreAllMocks();
});

describe('Public report page — states', () => {
  it('loading: a skeleton while the link is read (no patient data requested yet)', () => {
    const t = setup();
    expect(t.q('pr-skeleton')).not.toBeNull();
    expect(t.q('pr-skeleton')!.getAttribute('aria-busy')).toBe('true');
    t.linkReq().flush(ACTIVE);
  });

  it('verify: lab identity only — no patient details before the server accepts the answer', async () => {
    const t = await toVerify();
    expect(t.q('pr-verify')).not.toBeNull();
    expect(t.q('pr-lab-name')!.textContent).toContain('Micro World Diagnostics');
    const text = t.el.textContent ?? '';
    expect(text).not.toContain('Ravi');
    expect(text).not.toMatch(/ORD-|MRN|Male|Female/);
    expect(t.q('pr-download')).toBeNull();
  });

  it('verify field: numeric keypad, no autofill, ≥16px, labelled; invoice mode switches to text', async () => {
    const t = await toVerify();
    const input = t.q('pr-secret') as HTMLInputElement;
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('pattern')).toBe('[0-9]*');
    expect(t.el.querySelector('label[for="pr-secret"]')).not.toBeNull();
    t.q('pr-mode')!.click();
    await settle(t.f);
    expect((t.q('pr-secret') as HTMLInputElement).getAttribute('inputmode')).toBe('text');
    const scss = read('features/reports/public-report/public-report.component.scss');
    expect(scss).toMatch(/\.pr-input \{[^}]*font-size: 18px/);
  });

  it('wrong answer: rejected, attempts counted down from the server', async () => {
    const t = await toVerify();
    await t.type('0000');
    await t.submit();
    t.verifyReq().flush({ success: false, error: 'verify_failed', message: 'x', data: { attemptsLeft: 3 } });
    await settle(t.f);
    expect(t.q('pr-verify')).not.toBeNull();
    expect(t.q('pr-error')!.textContent).toContain("That doesn't match — 3 attempts left");
    expect(t.q('pr-error')!.getAttribute('role')).toBe('alert');
    expect((t.q('pr-secret') as HTMLInputElement).getAttribute('aria-invalid')).toBe('true');
  });

  it('wrong answer on an older API (no counter) still says it did not match', async () => {
    const t = await toVerify();
    await t.type('0000');
    await t.submit();
    t.verifyReq().flush({ success: false, error: 'verify_failed', message: 'x' });
    await settle(t.f);
    expect(t.q('pr-error')!.textContent).toContain("That doesn't match");
  });

  it('lockout: the server says locked → countdown + call the lab; unlocks when it runs out', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const t = await toVerify();
      await t.type('0000');
      await t.submit();
      t.verifyReq().flush({ success: false, error: 'locked', message: 'x', data: { retryAfterSeconds: 32, attemptsLeft: 0 } });
      await settle(t.f);
      expect(t.q('pr-locked')).not.toBeNull();
      expect(t.q('pr-lock-clock')!.textContent).toBe('0:32');
      expect(t.q('pr-call')!.getAttribute('href')).toBe('tel:+919840012345');
      expect(t.q('pr-secret')).toBeNull();
      vi.advanceTimersByTime(32_000);
      await settle(t.f);
      expect(t.q('pr-verify')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('lockout already running when the page opens', async () => {
    const t = setup();
    t.linkReq().flush({ success: true, data: { ...ACTIVE.data, attemptsLeft: 0, lockedSeconds: 120 } });
    await settle(t.f);
    expect(t.q('pr-locked')).not.toBeNull();
    expect(t.q('pr-lock-clock')!.textContent).toBe('2:00');
  });

  it('expired link: says so, names the lab and offers its phone', async () => {
    const t = setup();
    t.linkReq().flush({ success: true, data: { state: 'expired', lab: { name: 'Micro World Diagnostics', phone: '044 2345 6789' }, attemptsLeft: 0, lockedSeconds: 0 } });
    await settle(t.f);
    expect(t.q('pr-expired')).not.toBeNull();
    expect(t.q('pr-expired')!.textContent).toContain('This link has expired');
    expect(t.q('pr-expired')!.textContent).toContain('Micro World Diagnostics');
    expect(t.q('pr-call')!.getAttribute('href')).toBe('tel:04423456789');
    expect(t.q('pr-secret')).toBeNull();
  });

  it('invalid link', async () => {
    const t = setup();
    t.linkReq().flush({ success: true, data: { state: 'invalid', attemptsLeft: 0, lockedSeconds: 0 } });
    await settle(t.f);
    expect(t.q('pr-invalid')).not.toBeNull();
  });

  it('works with the current API shape: no link endpoint (404) → straight to the identity step', async () => {
    const t = setup();
    t.linkReq().flush('not found', { status: 404, statusText: 'Not Found' });
    await settle(t.f);
    expect(t.q('pr-verify')).not.toBeNull();
    expect(t.q('pr-lab-name')!.textContent).toContain('Your lab');
  });

  it('ready: the report card — name, age/sex, order, date, Ready, one primary', async () => {
    const t = await toReady();
    expect(t.q('pr-ready')).not.toBeNull();
    expect(t.q('pr-name')!.textContent).toContain('Ravi Kumar');
    expect(t.el.textContent).toContain('29 y · Male');
    expect(t.el.textContent).toContain('ORD-2609-0042');
    expect(t.q('pr-status')!.textContent).toContain('Ready');
    expect(t.q('pr-date')!.textContent).toMatch(/2026/);
    expect(t.el.querySelectorAll('.pf-btn--primary').length).toBe(1);
    expect(t.q('pr-download')!.classList.contains('pf-btn--primary')).toBe(true);
    expect(t.q('pr-view')!.getAttribute('href')).toBe('https://files.example/r.pdf?sig=inline');
    expect(t.q('pr-view')!.getAttribute('target')).toBe('_blank');
    expect(t.q('pr-superseded')).toBeNull();
  });

  it('partial report: status Partial + the in-progress note', async () => {
    const t = await toReady({ report: { id: 'r2', type: 'partial', createdAt: '2026-09-29T08:30:00Z', data: SNAP } });
    expect(t.q('pr-status')!.textContent).toContain('Partial');
    expect(t.q('pr-partial-note')).not.toBeNull();
  });

  it('superseded link: shows the latest version and says so', async () => {
    const t = await toReady({ superseded: true });
    expect(t.q('pr-superseded')!.textContent).toContain('latest version');
  });

  it('payment pending: verified, a balance is owed → no report, the amount and a call to the lab', async () => {
    const t = await toVerify();
    await t.type('3210');
    await t.submit();
    t.verifyReq().flush({
      success: false, error: 'payment_due', message: 'Payment pending — please contact Micro World Diagnostics to collect your report.',
      data: { state: 'payment_due', lab: { name: 'Micro World Diagnostics', phone: '+91 98400 12345' }, balanceDue: 300 },
    });
    await settle(t.f);
    const box = t.q('pr-payment-due');
    expect(box).not.toBeNull();
    expect(box!.textContent).toContain('Payment pending');
    expect(box!.textContent).toContain('Micro World Diagnostics');
    expect(t.q('pr-balance')!.textContent).toContain('300');
    expect(t.q('pr-call')!.getAttribute('href')).toContain('tel:');
    // Nothing about the report: no download, no viewer, no patient name.
    expect(t.q('pr-download')).toBeNull();
    expect(t.q('pr-name')).toBeNull();
    expect(t.q('pr-verify')).toBeNull();
  });

  it('payment pending on an unbilled order: no amount, still points at the lab', async () => {
    const t = await toVerify();
    await t.type('3210');
    await t.submit();
    t.verifyReq().flush({ success: false, error: 'payment_due', message: 'x', data: { state: 'payment_due', lab: { name: 'Micro World Diagnostics' } } });
    await settle(t.f);
    expect(t.q('pr-payment-due')!.textContent).toContain('your bill');
    expect(t.q('pr-balance')).toBeNull();
  });

  it('paid: the same link opens the report', async () => {
    const t = await toReady();
    expect(t.q('pr-payment-due')).toBeNull();
    expect(t.q('pr-download')).not.toBeNull();
  });

  it('not ready yet: verified, but no PDF and no snapshot', async () => {
    const t = await toReady({ reportReady: false, reportPdfUrl: null, reportPdfDownloadUrl: null, report: { id: 'r3', type: 'final', data: null } });
    expect(t.q('pr-not-ready')).not.toBeNull();
    expect(t.q('pr-download')).toBeNull();
  });
});

describe('Public report page — download', () => {
  it('Download follows the signed attachment URL (real file, readable name), no new tab', async () => {
    const t = await toReady();
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this); });
    t.q('pr-download')!.click();
    expect(clicked).toHaveLength(1);
    expect(clicked[0].href).toBe('https://files.example/r.pdf?sig=attachment');
    expect(clicked[0].target).toBe('');
    expect(t.q('pr-filename')!.textContent).toBe('Report-Ravi-Kumar-2026-09-29.pdf');
  });

  it('older API without the attachment URL: file name derived here, PDF opens in the viewer', async () => {
    const t = await toReady({ reportPdfDownloadUrl: undefined, fileName: undefined });
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this); });
    t.q('pr-download')!.click();
    expect(clicked[0].href).toBe('https://files.example/r.pdf?sig=inline');
    expect(clicked[0].target).toBe('_blank');
    expect(t.q('pr-filename')!.textContent).toMatch(/^Report-Ravi-Kumar-2026-09-\d{2}\.pdf$/);
  });
});

describe('Public report page — helpers', () => {
  it('reportFileName: ASCII, readable, dated', () => {
    const d = new Date(2026, 8, 29);
    expect(reportFileName('Ravi Kumar', d)).toBe('Report-Ravi-Kumar-2026-09-29.pdf');
    expect(reportFileName("  O'Brien  Anne-Marie ", d)).toBe('Report-OBrien-AnneMarie-2026-09-29.pdf');
    expect(reportFileName('ரவி', d)).toBe('Report-2026-09-29.pdf');
    expect(reportFileName(null, d)).toBe('Report-2026-09-29.pdf');
    expect(reportFileName('A B C D', d)).toBe('Report-A-B-C-2026-09-29.pdf');
  });

  it('summarise: only what the printed report shows', () => {
    const s = summarise(verified());
    expect(s).toMatchObject({ name: 'Ravi Kumar', ageSex: '29 y · Male', orderNumber: 'ORD-2609-0042', partial: false });
    expect(summarise(verified({ report: { id: 'x', type: 'final', data: 'not json' } })).name).toBe('R••• K••••');
  });

  it('OPS-137: a baby shows months / days in full, never "0 y"', () => {
    const snap = (patient: object) => verified({ report: { id: 'b', type: 'final', createdAt: '2026-11-15T08:00:00Z', data: JSON.stringify({ patient: { displayName: 'Baby S', sex: 'F', ...patient }, order: { orderNumber: 'O-1' } }) } });
    expect(summarise(snap({ age: 0, ageDisplay: '6 M', ageYears: 0.5 })).ageSex).toBe('6 months · Female');
    expect(summarise(snap({ age: 0, ageDisplay: '1 M' })).ageSex).toBe('1 month · Female');
    expect(summarise(snap({ age: 0, ageDisplay: '12 D' })).ageSex).toBe('12 days · Female');
    expect(summarise(snap({ age: 0, ageDisplay: '1 D' })).ageSex).toBe('1 day · Female');
    // grown-ups, a year-old, and older snapshots with no display are unchanged
    expect(summarise(snap({ age: 1, ageDisplay: '1 Y' })).ageSex).toBe('1 y · Female');
    expect(summarise(snap({ age: 29, ageDisplay: '29 Y' })).ageSex).toBe('29 y · Female');
    expect(summarise(snap({ age: 29 })).ageSex).toBe('29 y · Female');
    expect(summarise(snap({ ageDisplay: '6 M' })).ageSex).toBe('6 months · Female');
    expect(summarise(snap({ age: 0, ageDisplay: 'garbage' })).ageSex).toBe('0 y · Female');
  });

  it('copy + links', () => {
    expect(mismatchMessage(3)).toBe("That doesn't match — 3 attempts left.");
    expect(mismatchMessage(1)).toBe("That doesn't match — 1 attempt left.");
    expect(clock(65)).toBe('1:05');
    expect(telHref('+91 98400 12345 / 044-2345')).toBe('tel:+919840012345');
    expect(telHref('n/a')).toBeNull();
    expect(safeLogoUrl('/uploads/t/logo.png?exp=1&sig=2', 'https://api.x/')).toBe('https://api.x/uploads/t/logo.png?exp=1&sig=2');
    expect(safeLogoUrl('javascript:alert(1)', 'https://api.x')).toBeNull();
    expect(safeLogoUrl('data:image/svg+xml;base64,AAA', 'https://api.x')).toBeNull();
  });
});

describe('Public report page — no login, no app chrome', () => {
  it('the route is public (no guard) and lazy', () => {
    const r = appRoutes.find(x => x.path === 'reports/public/:token')!;
    expect(r).toBeTruthy();
    expect(r.canActivate ?? []).toHaveLength(0);
    expect(typeof r.loadComponent).toBe('function');
    expect(r.component).toBeUndefined();
  });

  it('the authed shell is lazy — never in the bundle that boots the public page', () => {
    const shell = appRoutes.find(x => x.path === '' && (x.canActivate?.length ?? 0) > 0)!;
    expect(shell.component).toBeUndefined();
    expect(typeof shell.loadComponent).toBe('function');
    const routes = read('app.routes.ts');
    expect(routes).not.toMatch(/^import .*layout\/shell\/shell\.component/m);
  });

  it('the page imports nothing from auth, the shell or heavy libs (jsPDF only lazily, as a fallback)', () => {
    const src = read('features/reports/public-report/public-report.component.ts');
    const statics = src.split('\n').filter(l => /^import /.test(l)).join('\n');
    expect(statics).not.toMatch(/core\/auth|layout\/|report-pdf|jspdf|pdfjs|ag-grid|qrcode|@angular\/forms/i);
    expect(src).toMatch(/await import\('\.\.\/\.\.\/\.\.\/shared\/utils\/report-pdf'\)/);
  });

  it('only anonymous /api/public calls, never an auth header', async () => {
    const t = await toVerify();
    await t.type('3210');
    await t.submit();
    const req = t.verifyReq();
    expect(req.request.headers.has('Authorization')).toBe(false);
    expect(req.request.body).toEqual({ secret: '3210' });
    req.flush({ success: false, error: 'verify_failed', data: { attemptsLeft: 4 } });
    await settle(t.f);
  });

  it('app root skips the idle lock / push / calling boot on the public pages', () => {
    expect(isPublicPatientPath('/reports/public/abc123')).toBe(true);
    expect(isPublicPatientPath('/track/xyz')).toBe(true);
    expect(isPublicPatientPath('/reports')).toBe(false);
    expect(isPublicPatientPath('/reports/view/abc')).toBe(false);
  });

  it('noindex + no-referrer while the page is open; no emoji; SVG icons', async () => {
    const t = await toVerify();
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toContain('noindex');
    expect(document.querySelector('meta[name="referrer"]')?.getAttribute('content')).toBe('no-referrer');
    const html = read('features/reports/public-report/public-report.component.html');
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(html).not.toMatch(/<select|<datalist|confirm\(/);
    t.f.destroy();
    expect(document.querySelector('meta[name="robots"]')).toBeNull();
  });
});
