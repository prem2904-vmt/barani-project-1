import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiService } from '../../core/services/api.service';
import { BridgesApiService, bridgesUrl } from './bridges-api.service';

function setup() {
  const api = { get: vi.fn(() => of([])), post: vi.fn(() => of({})), patch: vi.fn(() => of({})), put: vi.fn(() => of({})), delete: vi.fn(() => of({})) };
  TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
  return { api, svc: TestBed.inject(BridgesApiService) };
}

describe('BridgesApiService — the B.2 user API', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('list / get / patch / remove', () => {
    const { api, svc } = setup();
    svc.list().subscribe(); svc.list('br 1').subscribe(); svc.get('b/1').subscribe();
    svc.patch('b1', { name: 'N' }).subscribe(); svc.remove('b1').subscribe();
    expect(api.get.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['/api/bridges', '/api/bridges?branchId=br%201', '/api/bridges/b%2F1']);
    expect(api.patch).toHaveBeenCalledWith('/api/bridges/b1', { name: 'N' });
    expect(api.delete).toHaveBeenCalledWith('/api/bridges/b1');
    expect(bridgesUrl(null)).toBe('/api/bridges');
  });

  it('nearby / nonce / claim', () => {
    const { api, svc } = setup();
    svc.nearby().subscribe(); svc.claimNonce().subscribe();
    svc.claim({ method: 'secret', claimSecret: '7K2QF-9MXRT', serial: '10000000ABCD1234' }).subscribe();
    expect(api.get).toHaveBeenCalledWith('/api/bridges/nearby');
    expect(api.post).toHaveBeenCalledWith('/api/bridges/claim/nonce', {});
    expect(api.post).toHaveBeenCalledWith('/api/bridges/claim', { method: 'secret', claimSecret: '7K2QF-9MXRT', serial: '10000000ABCD1234' });
  });

  it('commands: {type, payload}; limit clamped; one command by id', () => {
    const { api, svc } = setup();
    svc.sendCommand('b1', 'wifi.set', { ssid: 'X', keepPrevious: true }).subscribe();
    svc.commands('b1', 999).subscribe(); svc.command('b1', 'c1').subscribe();
    expect(api.post).toHaveBeenCalledWith('/api/bridges/b1/commands', { type: 'wifi.set', payload: { ssid: 'X', keepPrevious: true } });
    expect(api.get).toHaveBeenCalledWith('/api/bridges/b1/commands?limit=100');
    expect(api.get).toHaveBeenCalledWith('/api/bridges/b1/commands/c1');
  });

  it('detected sources + instrument assignment', () => {
    const { api, svc } = setup();
    svc.detectedSources('b1').subscribe(); svc.detectedSources('b1', 'all').subscribe();
    svc.linkSource('b1', 's1', { instrumentId: 'i1' }).subscribe();
    svc.linkSource('b1', 's1', { create: { name: 'XN' } }).subscribe();
    svc.ignoreSource('b1', 's1').subscribe();
    svc.assignInstrument('i1', 'b1').subscribe(); svc.assignInstrument('i1', null).subscribe();
    expect(api.get).toHaveBeenCalledWith('/api/bridges/b1/detected-sources?state=new');
    expect(api.get).toHaveBeenCalledWith('/api/bridges/b1/detected-sources?state=all');
    expect(api.post).toHaveBeenCalledWith('/api/bridges/b1/detected-sources/s1/link', { instrumentId: 'i1' });
    expect(api.post).toHaveBeenCalledWith('/api/bridges/b1/detected-sources/s1/link', { create: { name: 'XN' } });
    expect(api.post).toHaveBeenCalledWith('/api/bridges/b1/detected-sources/s1/ignore', {});
    expect(api.put).toHaveBeenCalledWith('/api/instruments/i1/bridge', { bridgeId: 'b1' });
    expect(api.put).toHaveBeenCalledWith('/api/instruments/i1/bridge', { bridgeId: null });
  });
});
