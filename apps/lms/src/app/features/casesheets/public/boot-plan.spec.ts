import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { App } from '../../../app';
import { environment } from '../../../../environments/environment';
import { ThemeService } from '../../../core/services/theme.service';
import { CapacitorService } from '../../../core/services/capacitor.service';
import { PushService } from '../../../core/services/push.service';
import { PlatformService } from '../../../core/services/platform.service';
import { DeviceClassService } from '../../../core/services/device-class.service';
import { VersionService } from '../../../core/services/version.service';
import { LockService } from '../../../core/auth/lock.service';
import { SessionService } from '../../../core/auth/session.service';
import { AuthService } from '../../../core/auth/auth.service';
import { CallRingService } from '../../../core/services/call-ring.service';
import { OpdGateService } from '../../opd/shared/opd-gate.service';
import { CasesheetGateService } from '../shared/casesheet-gate.service';
import { BetaFeaturesService } from '../../../core/services/beta-features.service';
import { DesktopWindowService } from '../../../core/services/desktop-window.service';
import { ElectronMenuActionService } from '../../../core/services/electron-menu-action.service';
import { SupportSessionService } from '../../../shared/instruments/support-session.service';
import { bootPlan } from './boot-plan';

/**
 * Boot guard (plan §4.4): in casesheets mode the root starts NO LMS bootstrap — no idle lock, push registration,
 * call ring / offline calling (SignalR call hand-offs), password gate, beta prefetch or LMS overlays. The LMS
 * shell's hubs / chat / nav loaders are unreachable there (withAppModes; casesheets.routes.spec.ts).
 */
describe('bootPlan', () => {
  it('casesheets mode: everything LMS is off', () => {
    for (const publicPatientPage of [false, true]) {
      expect(bootPlan({ mode: 'casesheets', publicPatientPage })).toEqual({
        idleLock: false, push: false, offlineCalling: false, passwordGate: false, betaPrefetch: false, lmsOverlays: false,
      });
    }
  });

  it('LMS mode is unchanged: full boot; public patient pages skip lock / push / calls as before', () => {
    expect(bootPlan({ mode: 'lms', publicPatientPage: false })).toEqual({
      idleLock: true, push: true, offlineCalling: true, passwordGate: true, betaPrefetch: true, lmsOverlays: true,
    });
    expect(bootPlan({ mode: 'lms', publicPatientPage: true })).toEqual({
      idleLock: false, push: false, offlineCalling: false, passwordGate: true, betaPrefetch: true, lmsOverlays: true,
    });
  });
});

describe('App root in casesheets mode', () => {
  const env = environment as { mode?: string };
  let saved: string | undefined;
  beforeEach(() => { saved = env.mode; env.mode = 'casesheets'; });
  afterEach(() => { env.mode = saved; document.body.innerHTML = ''; });

  it('never creates push / call ring / support, never arms the lock, never loads offline calling', async () => {
    const created: string[] = [];
    const lmsOnly = <T>(name: string, value: T) => ({ useFactory: () => { created.push(name); return value; } });
    const lock = { start: vi.fn(), locked: signal(false) };
    const push = { init: vi.fn(async () => undefined) };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        { provide: ThemeService, useValue: {} },
        { provide: CapacitorService, useValue: { init: async () => undefined } },
        { provide: PlatformService, useValue: { isCapacitor: signal(false), isElectron: signal(false) } },
        { provide: DeviceClassService, useValue: {} },
        { provide: VersionService, useValue: { init: async () => undefined, updateRequired: signal(false) } },
        { provide: LockService, useValue: lock },
        { provide: SessionService, useValue: { ending: signal(false) } },
        { provide: AuthService, useValue: { mustChangePassword: signal(false), isAuthenticated: signal(false) } },
        { provide: OpdGateService, useValue: { install: vi.fn() } },
        { provide: CasesheetGateService, useValue: { install: vi.fn() } },
        { provide: BetaFeaturesService, useValue: { install: vi.fn(), ensureLoaded: vi.fn() } },
        { provide: DesktopWindowService, useValue: {} },
        { provide: ElectronMenuActionService, useValue: {} },
        { provide: PushService, ...lmsOnly('push', push) },
        { provide: CallRingService, ...lmsOnly('ring', {}) },
        { provide: SupportSessionService, ...lmsOnly('support', {}) },
      ],
    });
    const f = TestBed.createComponent(App);
    f.detectChanges();
    await f.componentInstance.ngOnInit();
    await f.whenStable();
    expect(created).toEqual([]);
    expect(lock.start).not.toHaveBeenCalled();
    expect(push.init).not.toHaveBeenCalled();
    // No LMS overlays at the root (lock screen, profile switch, WhatsApp dock).
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('pf-lock-screen, pf-switch-screen, pf-wa-dock')).toBeNull();
  });
});
