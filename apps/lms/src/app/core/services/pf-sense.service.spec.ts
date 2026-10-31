import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { PlatformService } from './platform.service';
import { PfSenseService, parsePfSenseStatus } from './pf-sense.service';

const URL = 'https://api.test/api/pf-sense/status';
const env = (data: unknown) => ({ success: true, data });
const ALL = { ast_disk_read: true, instruments_assistant: true, insights_assistant: true };

function make() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(),
      { provide: PlatformService, useValue: { getApiUrl: () => 'https://api.test' } }],
  });
  return { svc: TestBed.inject(PfSenseService), http: TestBed.inject(HttpTestingController) };
}
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('PfSenseService', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('before any answer everything is on (fail-open) but nothing is "shown" yet', () => {
    const { svc } = make();
    expect(svc.featureOn('ast_disk_read')).toBe(true);
    expect(svc.shown('insights_assistant')).toBe(false);
    expect(svc.limitReached()).toBe(false);
  });

  it('loads the status once (single-flight) and exposes per-feature switches + the limit', async () => {
    const { svc, http } = make();
    const a = svc.ensureLoaded(), b = svc.ensureLoaded();
    const reqs = http.match(URL);
    expect(reqs).toHaveLength(1);
    reqs[0].flush(env({ enabled: true, features: { ...ALL, insights_assistant: false }, limitReached: true }));
    await Promise.all([a, b]);
    await svc.ensureLoaded();                         // cached: no second request
    http.expectNone(URL);
    expect(svc.loaded()).toBe(true);
    expect(svc.featureOn('ast_disk_read')).toBe(true);
    expect(svc.featureOn('insights_assistant')).toBe(false);
    expect(svc.shown('instruments_assistant')).toBe(true);
    expect(svc.limitReached()).toBe(true);
  });

  it('master switch off turns every feature off, including keys the server omitted', async () => {
    const { svc, http } = make();
    const p = svc.ensureLoaded();
    http.expectOne(URL).flush(env({ enabled: false, features: {}, limitReached: false }));
    await p;
    for (const k of ['ast_disk_read', 'instruments_assistant', 'insights_assistant'] as const) expect(svc.featureOn(k)).toBe(false);
  });

  it('a key the server did not send is ON while the master switch is on', async () => {
    const { svc, http } = make();
    const p = svc.ensureLoaded();
    http.expectOne(URL).flush(env({ enabled: true, features: { ast_disk_read: false }, limitReached: false }));
    await p;
    expect(svc.featureOn('ast_disk_read')).toBe(false);
    expect(svc.featureOn('insights_assistant')).toBe(true);
  });

  it('fails open: a 404 (older backend) or a network error keeps every feature shown', async () => {
    for (const fail of [(r: { flush: (b: unknown, o: { status: number; statusText: string }) => void }) => r.flush('nope', { status: 404, statusText: 'Not Found' }),
      (r: { error: (e: ProgressEvent) => void }) => r.error(new ProgressEvent('error'))]) {
      const { svc, http } = make();
      const p = svc.ensureLoaded();
      fail(http.expectOne(URL) as never);
      await p;
      expect(svc.loaded()).toBe(true);
      expect(svc.shown('ast_disk_read')).toBe(true);
      expect(svc.limitReached()).toBe(false);
      TestBed.resetTestingModule();
    }
  });

  it('a garbage body is ignored (fail-open)', async () => {
    const { svc, http } = make();
    const p = svc.ensureLoaded();
    http.expectOne(URL).flush({ success: true, data: { enabled: 'yes' } });
    await p;
    expect(svc.status()).toBeNull();
    expect(svc.shown('insights_assistant')).toBe(true);
  });

  it('refresh() re-reads and the UI converges; a failed refresh keeps the last known state', async () => {
    const { svc, http } = make();
    const p = svc.ensureLoaded();
    http.expectOne(URL).flush(env({ enabled: true, features: ALL, limitReached: false }));
    await p;
    const r = svc.refresh();
    http.expectOne(URL).flush(env({ enabled: true, features: ALL, limitReached: true }));
    await r;
    expect(svc.limitReached()).toBe(true);
    const r2 = svc.refresh();
    http.expectOne(URL).flush('x', { status: 500, statusText: 'err' });
    await r2;
    expect(svc.limitReached()).toBe(true);
  });

  it('noteRefusal re-reads only for pf_sense_off / ai_cap_reached', async () => {
    const { svc, http } = make();
    svc.noteRefusal('ai_failed'); svc.noteRefusal(undefined); svc.noteRefusal('ai_unavailable');
    await tick();
    http.expectNone(URL);
    svc.noteRefusal('pf_sense_off');
    http.expectOne(URL).flush(env({ enabled: false, features: {}, limitReached: false }));
    await tick();
    expect(svc.featureOn('insights_assistant')).toBe(false);
    svc.noteRefusal('ai_cap_reached');
    http.expectOne(URL).flush(env({ enabled: true, features: ALL, limitReached: true }));
    await tick();
    expect(svc.limitReached()).toBe(true);
  });
});

describe('parsePfSenseStatus', () => {
  it('accepts the contract and ignores unknown / non-boolean feature keys', () => {
    expect(parsePfSenseStatus(env({ enabled: true, features: { ...ALL, x: true, ast_disk_read: 'no' }, limitReached: true })))
      .toEqual({ enabled: true, features: { instruments_assistant: true, insights_assistant: true }, limitReached: true });
  });
  it('rejects non-envelopes', () => {
    expect(parsePfSenseStatus(null)).toBeNull();
    expect(parsePfSenseStatus({ success: false })).toBeNull();
    expect(parsePfSenseStatus(env(null))).toBeNull();
  });
});
