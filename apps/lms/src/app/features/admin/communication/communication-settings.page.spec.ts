import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { renderBandPage } from '../admin-band.spec-helpers';
import { AuthService } from '../../../core/auth/auth.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { CommunicationSettingsPage, emailFormFrom, emailFormProblems, emailInputFrom } from './communication-settings.page';

/** Settings → Communication (2026-11-13): WhatsApp / Email / SMS tabs; email form states (Prefrontal address vs
 *  own mailbox), the write-only password, the test send, ready/problem in plain words; SMS Chat switch. */
const EMAIL = (over: Record<string, unknown> = {}) => ({
  enabled: true, mode: 'platform', fromName: 'Demo Lab', replyTo: 'desk@demo.in', platformAddress: 'reports@prefrontal.health',
  own: null, ready: false, problem: "Prefrontal email isn't set up on this server yet", ...over,
});
const SETTINGS = (email: Record<string, unknown> = {}, sms = true) => ({ whatsapp: { auto: true, chat: true, cloudReady: false }, email: EMAIL(email), sms: { chat: sms } });
const OWN = { host: 'smtp.demo.in', port: 587, security: 'starttls', username: 'lab@demo.in', fromAddress: 'lab@demo.in', passwordSet: true };

function make(settings: unknown, o: { perms?: string[]; switches?: Record<string, boolean> } = {}) {
  const perms = o.perms ?? ['manage_lab_settings'];
  const p = renderBandPage(CommunicationSettingsPage, {
    getFor: (url) => url === '/api/settings/communication' ? settings : url === '/api/whatsapp/settings' ? [] : [],
    providers: [
      { provide: AuthService, useValue: {
        user: () => ({ tenantName: 'Demo Lab', email: 'admin@demo.in', permissions: perms }),
        hasPermission: (x: string) => perms.includes(x), hasAnyPermission: (xs: string[]) => xs.some(x => perms.includes(x)),
        isAuthenticated: () => true, waitForAuth: async () => undefined,
      } },
      { provide: TenantEntitlementsService, useValue: { ensureLoaded: vi.fn(async () => undefined), moduleEnabled: (k: string) => o.switches?.[k] ?? true } },
    ],
  });
  p.cmp.loadHoldDone?.();
  const q = <T extends HTMLElement = HTMLElement>(id: string) => p.el.querySelector<T>(`[data-testid="${id}"]`);
  const tab = async (t: string) => { p.cmp.pickTab(t); p.f.detectChanges(); await p.f.whenStable(); p.f.detectChanges(); };
  const type = (id: string, v: string) => { const i = q<HTMLInputElement>(id)!; i.value = v; i.dispatchEvent(new Event('input')); p.f.detectChanges(); };
  return { ...p, q, tab, type };
}
const settle = async (p: { f: { whenStable: () => Promise<unknown>; detectChanges: () => void } }) => { await new Promise(r => setTimeout(r, 700)); p.f.detectChanges(); };

describe('Communication page', () => {
  it('band: three tabs (WhatsApp, Email, SMS); WhatsApp first', async () => {
    const p = make(SETTINGS());
    await settle(p);
    expect(p.tools()!.textContent).toContain('WhatsApp');
    expect(p.tools()!.textContent).toContain('Email');
    expect(p.tools()!.textContent).toContain('SMS');
    expect(p.headerIsClassicOnly()).toBe(true);
    expect(p.el.querySelector('pf-wa-settings-section')).not.toBeNull();
    expect(p.q('cm-email')).toBeNull();
  });

  it('Email: Prefrontal address by default, the problem in plain words, the sender name + reply-to; no native controls', async () => {
    const p = make(SETTINGS());
    await settle(p);
    await p.tab('email');
    expect(p.q('cm-email-status')!.getAttribute('data-ready')).toBe('no');
    expect(p.q('cm-email-status')!.textContent).toContain("Prefrontal email isn't set up on this server yet");
    expect(p.q('cm-email-platform')!.textContent).toContain('reports@prefrontal.health');
    expect(p.q<HTMLInputElement>('cm-email-fromname')!.value).toBe('Demo Lab');
    expect(p.q('cm-email-own')).toBeNull();
    expect(p.el.querySelector('select, datalist')).toBeNull();
    // Save is disabled until something changes.
    expect(p.q<HTMLButtonElement>('cm-email-save')!.disabled).toBe(true);
  });

  it('ready: says so', async () => {
    const p = make(SETTINGS({ ready: true, problem: null }));
    await settle(p);
    await p.tab('email');
    expect(p.q('cm-email-status')!.getAttribute('data-ready')).toBe('yes');
    expect(p.q('cm-email-status')!.textContent).toContain('Ready');
  });

  it('own mailbox: SMTP fields appear; save PUTs them; a new password goes only when typed', async () => {
    const p = make(SETTINGS());
    await settle(p);
    await p.tab('email');
    p.cmp.patch({ mode: 'own' });
    p.f.detectChanges();
    expect(p.q('cm-email-own')).not.toBeNull();
    p.type('cm-smtp-host', 'smtp.demo.in');
    p.type('cm-smtp-user', 'lab@demo.in');
    p.type('cm-smtp-from', 'lab@demo.in');
    // A username without a password (none saved) is a problem, said in words; Save warns, sends nothing.
    expect(p.q('cm-email-problems')!.textContent).toContain('Add the mailbox password.');
    p.type('cm-smtp-pass', 's3cret');
    expect(p.q('cm-email-problems')).toBeNull();
    p.api.put.mockImplementation((() => of(EMAIL({ mode: 'own', own: { ...OWN }, ready: true, problem: null }))) as never);
    await p.cmp.saveEmail();
    p.f.detectChanges();
    expect(p.api.put).toHaveBeenCalledWith('/api/settings/communication/email', {
      enabled: true, mode: 'own', fromName: 'Demo Lab', replyTo: 'desk@demo.in',
      own: { host: 'smtp.demo.in', port: 587, security: 'starttls', username: 'lab@demo.in', fromAddress: 'lab@demo.in', password: 's3cret' },
    });
    expect(p.toasts.success).toHaveBeenCalledWith('Email settings saved — ready to send');
    // Saved: the password is write-only — a "Saved" state, never the value, and the field is gone.
    expect(p.q('cm-smtp-pass-saved')!.textContent).toContain('Saved');
    expect(p.q('cm-smtp-pass')).toBeNull();
    expect(p.el.innerHTML).not.toContain('s3cret');
  });

  it('a saved password: Change shows an empty field; Keep goes back; saving without typing omits the password', async () => {
    const p = make(SETTINGS({ mode: 'own', own: { ...OWN }, ready: true, problem: null }));
    await settle(p);
    await p.tab('email');
    expect(p.q('cm-smtp-pass-saved')).not.toBeNull();
    p.q<HTMLButtonElement>('cm-smtp-pass-change')!.click();
    p.f.detectChanges();
    expect(p.q<HTMLInputElement>('cm-smtp-pass')!.value).toBe('');
    expect(p.q<HTMLInputElement>('cm-smtp-pass')!.type).toBe('password');
    p.q<HTMLButtonElement>('cm-smtp-pass-keep')!.click();
    p.f.detectChanges();
    expect(p.q('cm-smtp-pass-saved')).not.toBeNull();
    p.type('cm-email-fromname', 'Demo Labs');
    p.api.put.mockImplementation((() => of(EMAIL({ mode: 'own', own: { ...OWN }, fromName: 'Demo Labs', ready: true, problem: null }))) as never);
    await p.cmp.saveEmail();
    const body = (p.api.put.mock.calls as any).at(-1)[1] as { own: Record<string, unknown> };
    expect('password' in body.own).toBe(false);
  });

  it('saved but not ready: a warning with the server\'s reason (never a plain success)', async () => {
    const p = make(SETTINGS());
    await settle(p);
    await p.tab('email');
    p.type('cm-email-replyto', 'front@demo.in');
    p.api.put.mockImplementation((() => of(EMAIL({ replyTo: 'front@demo.in' }))) as never);
    await p.cmp.saveEmail();
    expect(p.toasts.warning).toHaveBeenCalledWith("Email settings saved. Prefrontal email isn't set up on this server yet", 7000);
    expect(p.toasts.success).not.toHaveBeenCalled();
  });

  it('test send: waits for saved changes; POSTs { to }; shows ok / the error in words', async () => {
    const p = make(SETTINGS({ ready: true, problem: null }));
    await settle(p);
    await p.tab('email');
    expect(p.q<HTMLInputElement>('cm-test-to')!.value).toBe('admin@demo.in');
    p.type('cm-email-fromname', 'Other');
    expect(p.q<HTMLButtonElement>('cm-test-send')!.disabled).toBe(true);
    expect(p.q('cm-test-save-first')).not.toBeNull();
    p.type('cm-email-fromname', 'Demo Lab');
    expect(p.q<HTMLButtonElement>('cm-test-send')!.disabled).toBe(false);
    p.api.post.mockImplementation((() => of({ ok: true })) as never);
    await p.cmp.sendTest();
    p.f.detectChanges();
    expect(p.api.post).toHaveBeenCalledWith('/api/settings/communication/email/test', { to: 'admin@demo.in' });
    expect(p.q('cm-test-result')!.getAttribute('data-ok')).toBe('yes');
    p.api.post.mockImplementation((() => of({ ok: false, error: 'Authentication failed (535)' })) as never);
    await p.cmp.sendTest();
    p.f.detectChanges();
    expect(p.q('cm-test-result')!.textContent).toContain('Not sent: Authentication failed (535)');
    p.api.post.mockImplementation((() => throwError(() => new Error('Too many tests — try again in a minute'))) as never);
    await p.cmp.sendTest();
    p.f.detectChanges();
    expect(p.q('cm-test-result')!.getAttribute('data-ok')).toBe('no');
  });

  it('SMS: SMS Chat switch with its one plain line (phone/tablet only) + the "automatic SMS later" note; toggling PUTs', async () => {
    const p = make(SETTINGS({}, true));
    await settle(p);
    await p.tab('sms');
    const sw = p.q<HTMLButtonElement>('cm-sms-chat')!;
    expect(sw.getAttribute('role')).toBe('switch');
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(p.q('cm-sms-explain')!.textContent).toContain('Messages app');
    expect(p.q('cm-sms-explain')!.textContent).toContain('does not show on computers');
    expect(p.q('cm-sms-auto-note')!.textContent).toMatch(/registered SMS provider/);
    p.api.put.mockImplementation((() => of({ chat: false })) as never);
    sw.click();
    p.f.detectChanges();
    expect(p.api.put).toHaveBeenCalledWith('/api/settings/communication/sms', { chat: false });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(p.toasts.success).toHaveBeenCalledWith('SMS Chat is off');
  });

  it('without manage permission everything is read-only', async () => {
    const p = make(SETTINGS(), { perms: ['manage_tests'] });
    await settle(p);
    await p.tab('email');
    expect(p.q('cm-email-save')).toBeNull();
    expect(p.q<HTMLInputElement>('cm-email-fromname')!.disabled).toBe(true);
    await p.tab('sms');
    expect(p.q<HTMLButtonElement>('cm-sms-chat')!.disabled).toBe(true);
  });

  it('Prefrontal switched a channel off: said plainly, switch locked', async () => {
    const p = make(SETTINGS(), { switches: { emailShare: false, smsChat: false } });
    await settle(p);
    await p.tab('email');
    expect(p.q('cm-email-off')).not.toBeNull();
    await p.tab('sms');
    expect(p.q('cm-sms-off')).not.toBeNull();
    expect(p.q<HTMLButtonElement>('cm-sms-chat')!.disabled).toBe(true);
  });

  it('no settings row yet (older server / error): defaults — Prefrontal address, the lab\'s name', async () => {
    const p = make('x');
    p.api.get.mockImplementation(((url: string) => url === '/api/settings/communication' ? throwError(() => new Error('404')) : of([])) as never);
    await settle(p);
    expect(emailFormFrom(null, 'Demo Lab')).toMatchObject({ enabled: true, mode: 'platform', fromName: 'Demo Lab', port: 587, security: 'starttls', password: '' });
  });
});

describe('email form helpers', () => {
  it('problems in plain words', () => {
    const f = { ...emailFormFrom(null, ''), mode: 'own' as const, port: 70000, replyTo: 'nope' };
    expect(emailFormProblems(f, false)).toEqual([
      'Add the name patients see as the sender.', 'The reply-to address is not a valid email.',
      'Add your mail server (SMTP host).', 'The port must be a number from 1 to 65535.', 'Add the address your emails come from.',
    ]);
    expect(emailFormProblems(emailFormFrom(null, 'Lab'), false)).toEqual([]);
  });
  it('platform mode with no own mailbox sends own: null; switching back to platform keeps the saved mailbox (no password)', () => {
    expect(emailInputFrom(emailFormFrom(null, 'Lab'), false).own).toBeNull();
    const f = emailFormFrom({ ...EMAIL({ mode: 'own', own: OWN }) } as never, 'Lab');
    const body = emailInputFrom({ ...f, mode: 'platform' }, true);
    expect(body.mode).toBe('platform');
    expect(body.own).toEqual({ host: 'smtp.demo.in', port: 587, security: 'starttls', username: 'lab@demo.in', fromAddress: 'lab@demo.in' });
  });
});
