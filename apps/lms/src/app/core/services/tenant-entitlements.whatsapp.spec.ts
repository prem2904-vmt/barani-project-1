import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { ApiService } from './api.service';
import { OpdGateService } from '../../features/opd/shared/opd-gate.service';
import { DEFAULT_ON_WHEN_ABSENT, TenantEntitlementsService, platformSwitchOn } from './tenant-entitlements.service';

/** WhatsApp Auto / WhatsApp Chat: platform switches that are ON when absent. */
function setup(moduleConfig: unknown) {
  const api = {
    get: vi.fn((url: string) => url === '/api/tenants/module-config'
      ? (moduleConfig === 'error' ? throwError(() => new Error('500')) : of(moduleConfig))
      : of({ modulesJson: null, legacy: { inventory: true, messages: false, homeCollection: true, reports: true } })),
  };
  TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }, { provide: OpdGateService, useValue: { visible: () => false } }] });
  return TestBed.inject(TenantEntitlementsService);
}
afterEach(() => TestBed.resetTestingModule());

describe('platformSwitchOn / DEFAULT_ON_WHEN_ABSENT', () => {
  it('absent, null, a non-boolean or an older server ⇒ ON; only an explicit false is off', () => {
    expect(DEFAULT_ON_WHEN_ABSENT).toEqual(['whatsappAuto', 'whatsappChat', 'emailShare', 'smsChat']);
    for (const wire of [null, undefined, {}, { inventory: true }, { whatsappAuto: null }, { whatsappAuto: 'no' }])
      expect(platformSwitchOn(wire as never, 'whatsappAuto')).toBe(true);
    expect(platformSwitchOn({ whatsappAuto: false }, 'whatsappAuto')).toBe(false);
    expect(platformSwitchOn({ whatsappAuto: false }, 'whatsappChat')).toBe(true);
  });
});

describe('TenantEntitlementsService — whatsappAuto / whatsappChat', () => {
  it('fail-open ON while loading', () => {
    const s = setup({});
    expect(s.moduleEnabled('whatsappAuto')).toBe(true);
    expect(s.moduleEnabled('whatsappChat')).toBe(true);
  });

  it('follows GET /api/tenants/module-config', async () => {
    const s = setup({ messages: false, whatsappAuto: false, whatsappChat: true });
    await s.ensureLoaded();
    expect(s.moduleEnabled('whatsappAuto')).toBe(false);
    expect(s.moduleEnabled('whatsappChat')).toBe(true);
    expect(s.moduleEnabled('messages')).toBe(false);   // the legacy keys still come from the two-level model
  });

  it('a lab whose config row predates the keys keeps both on; an error keeps both on; reset puts them back on', async () => {
    const a = setup({ inventory: true, messages: false, homeCollection: false, reports: false });
    await a.ensureLoaded();
    expect([a.moduleEnabled('whatsappAuto'), a.moduleEnabled('whatsappChat')]).toEqual([true, true]);
    TestBed.resetTestingModule();
    const b = setup('error');
    await b.ensureLoaded();
    expect([b.moduleEnabled('whatsappAuto'), b.moduleEnabled('whatsappChat')]).toEqual([true, true]);
    TestBed.resetTestingModule();
    const c = setup({ whatsappAuto: false, whatsappChat: false });
    await c.ensureLoaded();
    c.reset();
    expect([c.moduleEnabled('whatsappAuto'), c.moduleEnabled('whatsappChat')]).toEqual([true, true]);
  });
});

describe('TenantEntitlementsService — emailShare / smsChat (2026-11-13)', () => {
  it('default ON when absent or loading; an explicit false (camel or snake case) turns each off', async () => {
    const a = setup({});
    expect([a.moduleEnabled('emailShare'), a.moduleEnabled('smsChat')]).toEqual([true, true]);
    await a.ensureLoaded();
    expect([a.moduleEnabled('emailShare'), a.moduleEnabled('smsChat')]).toEqual([true, true]);
    TestBed.resetTestingModule();
    const b = setup({ emailShare: false, sms_chat: false });
    await b.ensureLoaded();
    expect([b.moduleEnabled('emailShare'), b.moduleEnabled('smsChat')]).toEqual([false, false]);
    expect(b.moduleEnabled('whatsappChat')).toBe(true);
    b.reset();
    expect([b.moduleEnabled('emailShare'), b.moduleEnabled('smsChat')]).toEqual([true, true]);
  });
});
