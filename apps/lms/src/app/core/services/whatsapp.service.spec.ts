import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ApiService } from './api.service';
import { WhatsAppService, waStatusLabel, waStatusTone } from './whatsapp.service';

describe('WhatsApp status words + tones', () => {
  it('maps every message status to a desk-readable word', () => {
    expect(waStatusLabel('queued')).toBe('Queued');
    expect(waStatusLabel('sending')).toBe('Queued');
    expect(waStatusLabel('sent')).toBe('Sent');
    expect(waStatusLabel('delivered')).toBe('Delivered');
    expect(waStatusLabel('read')).toBe('Read');
    expect(waStatusLabel('failed')).toBe('Failed');
    expect(waStatusLabel('skipped')).toBe('Not sent');
    expect(waStatusLabel(null)).toBe('');
  });

  it('delivered/read are good, failed is bad, queued waits', () => {
    expect(waStatusTone('delivered')).toBe('good');
    expect(waStatusTone('read')).toBe('good');
    expect(waStatusTone('sent')).toBe('info');
    expect(waStatusTone('queued')).toBe('wait');
    expect(waStatusTone('failed')).toBe('bad');
    expect(waStatusTone('skipped')).toBe('muted');
  });
});

describe('WhatsAppService endpoints', () => {
  afterEach(() => TestBed.resetTestingModule());

  function make() {
    const api = { get: vi.fn(() => of({})), post: vi.fn(() => of({})), put: vi.fn(() => of({})) };
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
    return { svc: TestBed.inject(WhatsAppService), api };
  }

  it('talks to the /api/whatsapp endpoints', () => {
    const { svc, api } = make();
    svc.settings().subscribe();
    svc.saveSettings({ autoSendEnabled: true, sendUpdatedReports: false }).subscribe();
    svc.reportStatus('r1').subscribe();
    svc.statusBatch(['r1', 'r2']).subscribe();
    svc.resend('r1').subscribe();
    svc.setOptOut('p1', true).subscribe();
    expect(api.get).toHaveBeenCalledWith('/api/whatsapp/settings');
    expect(api.put).toHaveBeenCalledWith('/api/whatsapp/settings', { autoSendEnabled: true, sendUpdatedReports: false });
    expect(api.get).toHaveBeenCalledWith('/api/whatsapp/reports/r1');
    expect(api.post).toHaveBeenCalledWith('/api/whatsapp/status', { reportIds: ['r1', 'r2'] });
    expect(api.post).toHaveBeenCalledWith('/api/whatsapp/reports/r1/resend', {});
    expect(api.put).toHaveBeenCalledWith('/api/whatsapp/patients/p1/opt-out', { optOut: true });
  });
});

import { waSenderLine } from './whatsapp.service';

describe('WhatsApp sender line (Lab settings)', () => {
  it('shared Prefrontal number until the lab connects its own', () => {
    expect(waSenderLine(null)).toBe('Prefrontal (shared)');
    expect(waSenderLine({ source: 'platform', displayName: 'Prefrontal', status: 'not_connected', tokenStored: false, canConnect: false }))
      .toBe('Prefrontal (shared)');
    expect(waSenderLine({ source: 'tenant', displayName: 'Micro World Labs', status: 'connected', tokenStored: true, canConnect: false }))
      .toBe('Micro World Labs (connected)');
  });
});
