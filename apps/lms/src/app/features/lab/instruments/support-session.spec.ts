import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AuthService } from '../../../core/auth/auth.service';
import { BetaFeaturesService } from '../../../core/services/beta-features.service';
import { INSTRUMENT_BRIDGE_SOURCE } from '../../../shared/instruments/instrument-bridge.service';
import { ElectronInstrumentsApi, SupportSessionState } from '../../../shared/instruments/instrument.models';
import {
  SupportSessionService, countdownText, endedText, normaliseSupportState, spacedCode,
} from '../../../shared/instruments/support-session.service';
import { SupportSessionCardComponent, outcomeWord } from './support-session-card.component';

/**
 * "Allow Prefrontal support" (beta `support`): the Instruments card + the
 * renderer service. Desktop only (web says "available in the desktop app");
 * start sends minutes + the CURRENT token to main; every refreshed token is
 * handed on while a session runs; sign-out / another profile stops it; the
 * card shows the code, countdown, live log and the "answer on this PC" note.
 */
function supportDouble(initial: Partial<SupportSessionState> = {}) {
  let listener: ((s: SupportSessionState) => void) | null = null;
  const state: SupportSessionState = { active: false, status: 'idle', log: [], ...initial } as SupportSessionState;
  const api = {
    start: vi.fn(async (p: { minutes: number; token: string; apiUrl: string }) => ({
      ok: true,
      state: { active: true, status: 'waiting', code: '482913', expiresAt: new Date(Date.now() + p.minutes * 60000).toISOString(), log: [] } as SupportSessionState,
    })),
    stop: vi.fn(async () => ({ ok: true, state: { active: false, status: 'ended', endedReason: 'lab', log: [] } as SupportSessionState })),
    status: vi.fn(async () => state),
    setToken: vi.fn(async () => ({ ok: true })),
    onChange: vi.fn((cb: (s: SupportSessionState) => void) => { listener = cb; return () => { listener = null; }; }),
    emit: (s: Partial<SupportSessionState>) => listener?.({ active: false, status: 'idle', log: [], ...s } as SupportSessionState),
  };
  return api;
}

function setup(o: { desktop?: boolean; beta?: boolean; initial?: Partial<SupportSessionState> } = {}) {
  TestBed.resetTestingModule();
  const support = supportDouble(o.initial);
  const token = signal<string | null>('tok-1');
  const user = signal<{ id: string } | null>({ id: 'u1' });
  const auth = { accessToken: token, user, getAccessToken: vi.fn(async () => token()) };
  const bridge = { list: async () => [], support } as unknown as ElectronInstrumentsApi;
  TestBed.configureTestingModule({
    imports: [SupportSessionCardComponent],
    providers: [
      { provide: AuthService, useValue: auth },
      { provide: BetaFeaturesService, useValue: { enabled: (k: string) => k === 'support' && (o.beta ?? true) } },
      { provide: INSTRUMENT_BRIDGE_SOURCE, useValue: () => (o.desktop === false ? undefined : bridge) },
    ],
  });
  return { support, token, user, auth };
}

async function render(o: Parameters<typeof setup>[0] = {}) {
  const r = setup(o);
  const f = TestBed.createComponent(SupportSessionCardComponent);
  document.body.appendChild(f.nativeElement);
  const settle = async () => { for (let i = 0; i < 4; i++) { f.detectChanges(); await f.whenStable(); await Promise.resolve(); } f.detectChanges(); };
  await settle();
  const el = f.nativeElement as HTMLElement;
  return { ...r, f, el, settle, svc: TestBed.inject(SupportSessionService) };
}

afterEach(() => { document.body.innerHTML = ''; vi.useRealTimers(); });

describe('support session — pure helpers', () => {
  it('code, countdown, ended words, outcome words', () => {
    expect(spacedCode('482913')).toBe('482 913');
    expect(countdownText(new Date(10_000 + 2 * 3600e3 - 1000).toISOString(), 10_000)).toBe('1:59:59');
    expect(countdownText(new Date(10_000 + 65_000).toISOString(), 10_000)).toBe('1:05');
    expect(countdownText(undefined, 0)).toBe('—');
    expect(endedText('expired')).toContain('ran out of time');
    expect(endedText(null)).toBeNull();
    expect(outcomeWord('approved')).toBe('Allowed');
    expect(outcomeWord('denied')).toBe('Denied');
    expect(outcomeWord('ok')).toBeNull();
    expect(normaliseSupportState(null).status).toBe('idle');
    expect(normaliseSupportState({ active: true, status: 'weird', log: 'x' })).toEqual({ active: true, status: 'idle', log: [] });
  });
});

describe('SupportSessionCardComponent', () => {
  it('beta off ⇒ renders nothing at all', async () => {
    const { el } = await render({ beta: false });
    expect(el.querySelector('[data-testid="support-card"]')).toBeNull();
  });

  it('web ⇒ "available in the desktop app", no start button', async () => {
    const { el } = await render({ desktop: false });
    expect(el.textContent).toContain('Remote support is available in the desktop app');
    expect(el.querySelector('[data-testid="support-start"]')).toBeNull();
  });

  it('desktop idle: duration pick (pf-select, never a native select) + "Allow Prefrontal support" (secondary)', async () => {
    const { el } = await render();
    expect(el.querySelector('pf-select')).toBeTruthy();
    expect(el.querySelector('select')).toBeNull();
    const btn = el.querySelector('[data-testid="support-start"]') as HTMLButtonElement;
    expect(btn.textContent).toContain('Allow Prefrontal support');
    expect(btn.classList.contains('pf-btn--secondary')).toBe(true);
  });

  it('start → main gets the minutes, the current token and the API base; the card shows the code + countdown', async () => {
    const { el, support, settle } = await render();
    (el.querySelector('[data-testid="support-start"]') as HTMLButtonElement).click();
    await settle();
    expect(support.start).toHaveBeenCalledWith(expect.objectContaining({ minutes: 120, token: 'tok-1' }));
    expect((support.start.mock.calls[0][0] as { apiUrl: string }).apiUrl).toMatch(/^https?:\/\//);
    expect(el.querySelector('[data-testid="support-code"]')?.textContent).toContain('482 913');
    expect(el.querySelector('[data-testid="support-countdown"]')?.textContent).toMatch(/^1:59:5\d|2:00:00$/);
    expect(el.querySelector('[data-testid="support-stop"]')).toBeTruthy();
  });

  it('live: approval-waiting note + activity log with words, Stop ends it', async () => {
    const { el, support, settle } = await render({ initial: { active: true, status: 'connected', code: '482913', supportJoined: true, expiresAt: new Date(Date.now() + 3600e3).toISOString() } });
    support.emit({
      active: true, status: 'connected', code: '482913', supportJoined: true, expiresAt: new Date(Date.now() + 3600e3).toISOString(),
      approval: { message: 'Prefrontal support wants to open port 5603 for the iCARE in the Windows firewall. Allow?' },
      log: [
        { at: new Date().toISOString(), actor: 'lab', text: 'Opened port 5603 in the firewall — approved', outcome: 'approved' },
        { at: new Date().toISOString(), actor: 'pc', text: 'Looked at the firewall', outcome: 'ok' },
      ],
    });
    await settle();
    expect(el.querySelector('[data-testid="support-approval"]')?.textContent).toContain('open port 5603 for the iCARE');
    const log = el.querySelector('[data-testid="support-log"]')!.textContent!;
    expect(log).toContain('Looked at the firewall');
    expect(log).toContain('Allowed');
    expect(el.textContent).toContain('Prefrontal support is connected');
    support.emit({ active: true, status: 'connected', code: '482913', supportJoined: true, joinedBy: 'eng@prefrontal.health', log: [] });
    await settle();
    expect(el.querySelector('[data-testid="support-status"]')?.textContent).toContain('Support joined: eng@prefrontal.health');
    (el.querySelector('[data-testid="support-stop"]') as HTMLButtonElement).click();
    await settle();
    expect(support.stop).toHaveBeenCalled();
    expect(el.textContent).toContain('You stopped the last support session.');
  });
});

describe('SupportSessionService — token + sign-out', () => {
  it('hands every refreshed token to main while active; signing out stops the session', async () => {
    const { svc, support, token, settle } = await render({ initial: { active: true, status: 'waiting', code: '482913', log: [] } });
    await settle();
    expect(svc.active()).toBe(true);
    token.set('tok-2');
    await settle();
    expect(support.setToken).toHaveBeenLastCalledWith('tok-2');
    token.set(null);
    await settle();
    expect(support.stop).toHaveBeenCalled();
  });

  it('another profile taking over stops a session this user started', async () => {
    const { svc, support, user, settle } = await render();
    await svc.start(60);
    await settle();
    user.set({ id: 'u2' });
    await settle();
    expect(support.stop).toHaveBeenCalled();
  });

  it('idle: no token traffic at all', async () => {
    const { support, token, settle } = await render();
    token.set('tok-9');
    await settle();
    expect(support.setToken).not.toHaveBeenCalled();
    expect(support.stop).not.toHaveBeenCalled();
  });

  it('beta off: start refuses without calling main', async () => {
    const { svc, support } = await render({ beta: false });
    expect(await svc.start(60)).toMatch(/isn’t switched on/);
    expect(support.start).not.toHaveBeenCalled();
  });
});
