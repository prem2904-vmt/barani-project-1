import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { vi } from 'vitest';
import { HttpActivityService, httpActivityInterceptor } from './http-activity.service';

describe('HttpActivityService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([httpActivityInterceptor])), provideHttpClientTesting()],
    });
  });

  it('counts in-flight /api calls only, and releases on completion or cancel', () => {
    const http = TestBed.inject(HttpClient);
    const ctl = TestBed.inject(HttpTestingController);
    const act = TestBed.inject(HttpActivityService);
    http.get('/api/orders').subscribe();
    const sub = http.get('/api/patients').subscribe();
    http.get('https://fonts.example/css').subscribe();
    expect(act.pending()).toBe(2);
    ctl.expectOne('/api/orders').flush([]);
    expect(act.pending()).toBe(1);
    sub.unsubscribe();
    expect(act.pending()).toBe(0);
    ctl.expectOne('https://fonts.example/css').flush('');
  });

  it('whenIdle waits for a quiet window, and never longer than maxMs', async () => {
    vi.useFakeTimers();
    try {
      const act = TestBed.inject(HttpActivityService);
      act.begin();
      let done = false;
      void act.whenIdle({ quietMs: 100, maxMs: 1000 }).then(() => (done = true));
      await vi.advanceTimersByTimeAsync(300);
      expect(done).toBe(false);
      act.end();
      await vi.advanceTimersByTimeAsync(160);
      expect(done).toBe(true);

      act.begin();                                   // stuck call
      let capped = false;
      void act.whenIdle({ quietMs: 100, maxMs: 500 }).then(() => (capped = true));
      await vi.advanceTimersByTimeAsync(560);
      expect(capped).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
