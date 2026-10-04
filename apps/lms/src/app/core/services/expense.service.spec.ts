import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ExpenseService } from './expense.service';
import { ApiService } from './api.service';
import { PlatformService } from './platform.service';

/** /api/expenses wiring: query string, JSON calls through ApiService, bills as multipart. */
describe('ExpenseService', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let http: { post: ReturnType<typeof vi.fn> };

  function make() {
    api = { get: vi.fn(() => of({})), post: vi.fn(() => of({})), put: vi.fn(() => of({})), delete: vi.fn(() => of(undefined)), getBlob: vi.fn(() => of(new Blob())) };
    http = { post: vi.fn(() => of({ success: true, data: [{ id: 'a1' }] })) };
    TestBed.configureTestingModule({
      providers: [
        ExpenseService,
        { provide: ApiService, useValue: api },
        { provide: HttpClient, useValue: http },
        { provide: PlatformService, useValue: { getApiUrl: () => 'https://api.test' } },
      ],
    });
    return TestBed.inject(ExpenseService);
  }

  afterEach(() => TestBed.resetTestingModule());

  it('builds the filter query (only what is set)', () => {
    expect(ExpenseService.query({ from: '2026-09-01', to: '2026-09-30' })).toBe('?from=2026-09-01&to=2026-09-30');
    expect(ExpenseService.query({ from: '2026-09-01', to: '2026-09-30', categoryId: 'c1', kind: 'cash_in', mode: 'upi' }))
      .toBe('?from=2026-09-01&to=2026-09-30&categoryId=c1&kind=cash_in&mode=upi');
  });

  it('calls the endpoints', () => {
    const s = make();
    s.book({ from: '2026-09-01', to: '2026-09-30' }).subscribe();
    expect(api['get']).toHaveBeenCalledWith('/api/expenses?from=2026-09-01&to=2026-09-30');
    s.exportCsv({ from: '2026-09-01', to: '2026-09-30' }).subscribe();
    expect(api['getBlob']).toHaveBeenCalledWith('/api/expenses/export.csv?from=2026-09-01&to=2026-09-30');
    s.closeDay('2026-09-29', 'ok').subscribe();
    expect(api['post']).toHaveBeenCalledWith('/api/expenses/days/2026-09-29/close', { note: 'ok' });
    s.setOpening('2026-09-29', null).subscribe();
    expect(api['put']).toHaveBeenCalledWith('/api/expenses/days/2026-09-29/opening', { openingBalance: null });
    s.remove('e1').subscribe();
    expect(api['delete']).toHaveBeenCalledWith('/api/expenses/e1');
  });

  it('My expenses asks for mine=true; Day closing has its own endpoints', () => {
    expect(ExpenseService.query({ from: '2026-09-01', to: '2026-09-30', mine: true })).toBe('?from=2026-09-01&to=2026-09-30&mine=true');
    expect(ExpenseService.query({ from: '2026-09-01', to: '2026-09-30', mine: false })).toBe('?from=2026-09-01&to=2026-09-30');
    const s = make();
    s.closing('2026-09-30').subscribe();
    expect(api['get']).toHaveBeenCalledWith('/api/expenses/closing?date=2026-09-30');
    s.closeClosing('2026-09-30', { countedCash: 1500, openingBalance: null, note: 'ok' }).subscribe();
    expect(api['post']).toHaveBeenCalledWith('/api/expenses/closing/2026-09-30/close', { countedCash: 1500, openingBalance: null, note: 'ok' });
    s.reopenClosing('2026-09-30').subscribe();
    expect(api['post']).toHaveBeenCalledWith('/api/expenses/closing/2026-09-30/reopen', {});
  });

  it('uploads bills as multipart "files"', async () => {
    const s = make();
    const f1 = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    const f2 = new File(['b'], 'b.pdf', { type: 'application/pdf' });
    const out = await s.attach('e1', [f1, f2]);
    expect(out).toEqual([{ id: 'a1' }]);
    const [url, fd] = http.post.mock.calls[0] as [string, FormData];
    expect(url).toBe('https://api.test/api/expenses/e1/attachments');
    expect(fd.getAll('files').length).toBe(2);
    expect(await s.attach('e1', [])).toEqual([]);
  });
});
