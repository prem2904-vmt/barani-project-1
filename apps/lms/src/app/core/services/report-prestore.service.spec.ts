import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { ApiService } from './api.service';
import { ReportPrestoreService } from './report-prestore.service';

describe('ReportPrestoreService — store the final PDF right after validation', () => {
  afterEach(() => TestBed.resetTestingModule());

  function make(report: unknown, fail = false) {
    const api = { get: vi.fn(() => (fail ? throwError(() => new Error('offline')) : of(report))) };
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
    const svc = TestBed.inject(ReportPrestoreService);
    const store = vi.fn(() => Promise.resolve(new Blob(['%PDF'])));
    svc.store = store;
    return { svc, api, store };
  }

  it('renders + stores the live FINAL when nothing is stored yet', async () => {
    const { svc, api, store } = make({ id: 'r1', type: 'final', storedPdfKey: null });
    expect(await svc.run('o1')).toBe(true);
    expect(api.get).toHaveBeenCalledWith('/api/reports/by-order/o1?view=summary');
    expect(store).toHaveBeenCalledWith({ id: 'r1', type: 'final', storedPdfKey: null });
  });

  it('does nothing when the final is already stored', async () => {
    const { svc, store } = make({ id: 'r1', type: 'final', storedPdfKey: 'tenants/t/reports/r1/full.pdf' });
    expect(await svc.run('o1')).toBe(false);
    expect(store).not.toHaveBeenCalled();
  });

  it('never stores for a partial (only the complete report goes to the patient)', async () => {
    const { svc, store } = make({ id: 'p1', type: 'partial', storedPdfKey: null });
    expect(await svc.run('o1')).toBe(false);
    expect(store).not.toHaveBeenCalled();
  });

  it('is silent when there is no report yet or the call fails', async () => {
    const none = make(null);
    expect(await none.svc.run('o1')).toBe(false);
    TestBed.resetTestingModule();
    const failing = make(null, true);
    expect(await failing.svc.run('o1')).toBe(false);
    expect(failing.store).not.toHaveBeenCalled();
  });

  it('afterValidation is fire-and-forget and ignores a missing order id', async () => {
    const { svc, api, store } = make({ id: 'r1', type: 'final' });
    svc.afterValidation(null);
    expect(api.get).not.toHaveBeenCalled();
    svc.afterValidation('o9');
    await vi.waitFor(() => expect(store).toHaveBeenCalled());
  });
});
