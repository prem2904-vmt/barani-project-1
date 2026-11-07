import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { EMPTY, Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { ReportQueueComponent } from './report-queue.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { LiveQueueService } from '../../../core/services/live-queue.service';
import { ThemeService } from '../../../core/services/theme.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { AuthService } from '../../../core/auth/auth.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { ZoomTransitionService } from '../../../core/navigation/zoom-transition';

/**
 * Reports list — LOADING FEEDBACK (PF-PATTERN "Loading feedback"; owner,
 * 2026-09-29: "wherever there is an action that takes time, there needs to
 * be an animation"). A row's Download renders / fetches the stored PDF and
 * the band's Generate posts: each button turns busy (disabled + aria-busy)
 * the same frame, shows the kit's dots after 150ms, and releases on answer.
 */
const PATIENT = { displayName: 'Mr. Sathish Kumaravel', age: 29, sex: 'Male', mrn: 'AA0012', phone: '9876543210' };
const rep = (id: string) => ({
  id, orderId: `o-${id}`, patientId: 'p1', type: 'final', status: 'generated', deliveryStatus: 'pending',
  createdAt: '2026-09-26T13:07:00Z', qrToken: 't',
  order: { id: `o-${id}`, orderNumber: 'LAB-2609-000102', patient: PATIENT },
});

const realMatchMedia = (window as any).matchMedia;
afterEach(() => {
  TestBed.resetTestingModule();
  (window as any).matchMedia = realMatchMedia;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function render(opts: { generate$?: Subject<unknown>; prompt?: string | null; backfill$?: Subject<unknown>; resolve?: unknown } = {}) {
  (window as any).matchMedia = (q: string) => ({
    matches: q.includes('hover'), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
  const api = {
    get: vi.fn((url: string) => {
      if (url.startsWith('/api/reports/queue?view=summary')) return of([rep('r1'), rep('r2')]);
      if (url.startsWith('/api/orders/resolve')) return opts.resolve instanceof Error ? throwError(() => opts.resolve) : of(opts.resolve ?? null);
      return of([]);
    }),
    post: vi.fn((url: string) => (url === '/api/reports/generate' && opts.generate$ ? opts.generate$
      : url === '/api/reports/backfill' && opts.backfill$ ? opts.backfill$ : of({}))),
  };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: HttpClient, useValue: {} },
      { provide: ThemeService, useValue: { isNewDesign: signal(true), isDark: signal(false) } },
      { provide: LiveQueueService, useValue: { on: () => EMPTY } },
      { provide: ToastService, useValue: toasts },
      { provide: DialogService, useValue: { prompt: vi.fn(async () => opts.prompt ?? null), confirm: vi.fn(async () => false) } },
      { provide: NavBackService, useValue: { showBack: () => false, back: vi.fn(), backTo: vi.fn() } },
      { provide: AuthService, useValue: { user: () => ({ id: 'u1', tenantName: 'Micro World' }), hasPermission: () => true, hasAnyPermission: () => true } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World' }), ensureLoaded() {} } },
      { provide: ZoomTransitionService, useValue: { holding: signal(false), tap: () => true, rearm() {}, attachSource() {}, detachSource() {} } },
      { provide: Router, useValue: { url: '/reports', navigate: vi.fn(() => Promise.resolve(true)), events: of() } },
    ],
  });
  const f = TestBed.createComponent(ReportQueueComponent);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  return { f, el, c: f.componentInstance as any, api, toasts };
}

const downloadBtns = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLButtonElement>('button[title="Download PDF"]'));

describe('Reports list — loading feedback', () => {
  it('first open: the list skeleton from the first frame (while the backfill runs), never "No reports here"', () => {
    const backfill$ = new Subject<unknown>();
    const { f, el } = render({ backfill$ });
    expect(el.querySelector('.pf-rq-card--skel')).not.toBeNull();
    expect(el.textContent).not.toContain('No reports here');
    backfill$.next({ generated: 0 });
    backfill$.complete();
    f.detectChanges();
    expect(el.querySelector('.pf-rq-card--skel')).toBeNull();
    expect(downloadBtns(el).length).toBe(2);
  });

  it('Download: that row\'s button is disabled + aria-busy at once, dots after 150ms, released when the PDF answers', async () => {
    vi.useFakeTimers();
    const { f, el, c } = render();
    let fail!: (e: unknown) => void;
    const spy = vi.spyOn(c, 'storedPdf').mockImplementation(() => new Promise((_, rej) => { fail = rej; }));
    const [first, second] = downloadBtns(el);
    expect(first).toBeTruthy();
    first.click();
    f.detectChanges();
    expect(first.disabled).toBe(true);
    expect(first.getAttribute('aria-busy')).toBe('true');
    expect(first.querySelector('pf-busy')).toBeNull();          // no flicker for a fast answer
    expect(second.disabled).toBe(false);                        // only the pressed row
    expect(second.getAttribute('aria-busy')).toBeNull();
    vi.advanceTimersByTime(150);
    f.detectChanges();
    expect(first.querySelector('pf-busy')).not.toBeNull();
    // A repeat press while it runs starts nothing new.
    first.click();
    expect(spy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();                                  // the error path lazy-loads its message helper
    fail(new Error('boom'));
    await vi.waitFor(() => {
      f.detectChanges();
      expect(first.getAttribute('aria-busy')).toBeNull();
    }, { timeout: 5000 });
    expect(first.disabled).toBe(false);
  });

  it('Generate (band): busy while the report is generated, then released', async () => {
    const generate$ = new Subject<unknown>();
    const { f, el } = render({ generate$, prompt: '3f2b8c1e-1111-4222-8333-444455556666' });
    const gen = el.querySelector<HTMLButtonElement>('.pf-rq-generate')!;
    expect(gen.disabled).toBe(false);
    gen.click();
    await Promise.resolve(); await Promise.resolve();        // the order-id prompt answers
    f.detectChanges();
    expect(gen.disabled).toBe(true);
    expect(gen.getAttribute('aria-busy')).toBe('true');
    generate$.error(new Error('no such order'));
    f.detectChanges();
    expect(gen.disabled).toBe(false);
    expect(gen.getAttribute('aria-busy')).toBeNull();
  });

  // OPS-104: the popup text is resolved to a GUID before /api/reports/generate.
  describe('Generate popup (OPS-104)', () => {
    const GUID = '3f2b8c1e-1111-4222-8333-444455556666';
    const generated = (api: any) => (api.post.mock.calls as any[][]).filter(a => a[0] === '/api/reports/generate');

    it('a typed order number is resolved first and the GUID is what gets posted', async () => {
      const { c, api } = render({ prompt: 'lab-2608-000042', resolve: { orderId: GUID } });
      await c.promptGenerate();
      expect(api.get).toHaveBeenCalledWith('/api/orders/resolve?code=lab-2608-000042');
      expect(generated(api)).toEqual([['/api/reports/generate', { orderId: GUID, type: 'final' }]]);
    });

    it('a typed GUID is posted as is, without a lookup', async () => {
      const { c, api } = render({ prompt: GUID });
      await c.promptGenerate();
      expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('/api/orders/resolve'));
      expect(generated(api).length).toBe(1);
    });

    for (const [label, resolve] of [['no match', null], ['lookup error', new Error('x')]] as const) {
      it(`${label}: plain message, nothing is generated, never non-GUID`, async () => {
        const { c, api, toasts } = render({ prompt: 'nope-123', resolve });
        await c.promptGenerate();
        expect(generated(api)).toEqual([]);
        expect(toasts.error).toHaveBeenCalledWith('No order matches "nope-123"');
      });
    }
  });
});
