import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { WaSender, WaSettings } from '../../../core/services/whatsapp.service';
import { ApiError } from '../../../shared/models/api-response.model';
import {
  FB_SDK_SCRIPT_ID, isFacebookOrigin, parseEmbeddedSignupMessage, resetFacebookSdkForTests,
} from '../../../shared/utils/whatsapp-embedded-signup';
import { WA_INFO_WAIT_MS, WaConnectCardComponent, waLimitLabel } from './wa-connect-card.component';

/**
 * Lab settings → "Your WhatsApp number" (Meta Embedded Signup). Card states
 * (not connected · connecting · connected · action needed), Connect only when
 * the server enables it AND the user is the lab admin (manage_tenant), the
 * Facebook SDK loaded only by this card, the WA_EMBEDDED_SIGNUP postMessage
 * accepted only from facebook.com, and Disconnect behind a DialogService confirm.
 */

const SENDER = (over: Partial<WaSender> = {}): WaSender => ({
  source: 'platform', state: 'not_connected', displayName: 'Prefrontal', status: 'not_connected',
  tokenStored: false, canConnect: false, ...over,
});

const SETTINGS = (sender: WaSender): WaSettings => ({
  autoSendEnabled: true, sendUpdatedReports: false, sender,
  platform: { enabled: true, configured: true, webhookConfigured: true, defaultTemplateName: 'lab_report_ready', defaultTemplateLanguage: 'en' },
});

const CONNECTED = (over: Partial<WaSender> = {}) => SENDER({
  source: 'tenant', state: 'connected', status: 'connected', tokenStored: true, canConnect: true,
  displayName: 'Micro World Labs', verifiedName: 'Micro World Labs', displayPhoneNumber: '+91 98765 43210',
  phoneNumberId: 'pn-1', wabaId: 'waba-1', qualityRating: 'GREEN', messagingLimitTier: 'TIER_2K',
  templates: [
    { kind: 'link', name: 'lab_report_ready', status: 'APPROVED' },
    { kind: 'pdf', name: 'lab_report_pdf', status: 'PENDING' },
  ],
  ...over,
});

const CONFIG = { appId: 'app-1', configId: 'cfg-1', graphVersion: 'v25.0', extras: { version: 'v4', featureType: 'whatsapp_business_app_onboarding', setup: { business: { name: 'Micro World' } } } };

function make(sender: WaSender, opts: { perms?: string[]; confirm?: boolean } = {}) {
  const perms = opts.perms ?? ['manage_tenant'];
  const api = {
    get: vi.fn((url: string) => url === '/api/whatsapp/onboarding/config' ? of(CONFIG) : of(SETTINGS(sender))),
    post: vi.fn((url: string, _body?: unknown) => {
      if (url === '/api/whatsapp/onboarding/start') return of({ state: 'signed-state', expiresAt: '' });
      return of(SETTINGS(CONNECTED()));
    }),
    put: vi.fn(() => of({})),
  };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  const dialog = { confirm: vi.fn(async () => opts.confirm ?? true) };
  TestBed.configureTestingModule({
    imports: [WaConnectCardComponent],
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: toasts },
      { provide: DialogService, useValue: dialog },
      { provide: AuthService, useValue: { hasPermission: (p: string) => perms.includes(p) } },
    ],
  });
  const f = TestBed.createComponent(WaConnectCardComponent);
  f.componentRef.setInput('settings', SETTINGS(sender));
  const changed = vi.fn();
  f.componentInstance.changed.subscribe(changed);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const q = (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  return { f, el, q, api, toasts, dialog, changed, cmp: f.componentInstance };
}

type FakeFb = { init: ReturnType<typeof vi.fn>; login: ReturnType<typeof vi.fn> };
function installFakeFb(): FakeFb {
  const fb = { init: vi.fn(), login: vi.fn() };
  (window as unknown as { FB?: unknown }).FB = fb;
  return fb;
}

async function settle(f: { detectChanges(): void; whenStable(): Promise<unknown> }) {
  await Promise.resolve();
  await Promise.resolve();
  f.detectChanges();
  await f.whenStable();
  f.detectChanges();
}

const fbMessage = (data: unknown, origin = 'https://www.facebook.com') =>
  window.dispatchEvent(new MessageEvent('message', { origin, data: typeof data === 'string' ? data : JSON.stringify(data) }));

beforeEach(() => {
  resetFacebookSdkForTests();
  delete (window as unknown as { FB?: unknown }).FB;
  document.getElementById(FB_SDK_SCRIPT_ID)?.remove();
});
afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { FB?: unknown }).FB;
  document.getElementById(FB_SDK_SCRIPT_ID)?.remove();
});

describe('WhatsApp connect card — states', () => {
  it('not connected, Embedded Signup off: shared number, no Connect button, SDK never loaded', () => {
    const p = make(SENDER());
    expect(p.q('ls-wa-connect-card')!.getAttribute('data-state')).toBe('not_connected');
    expect(p.q('wac-state')!.textContent).toContain('Using Prefrontal number');
    expect(p.el.textContent).toContain("Prefrontal's shared WhatsApp number");
    expect(p.q('wac-connect')).toBeNull();
    expect(p.api.get).not.toHaveBeenCalledWith('/api/whatsapp/onboarding/config');
    expect(document.getElementById(FB_SDK_SCRIPT_ID)).toBeNull();
    expect(p.el.querySelector('select, datalist, input[type="checkbox"]')).toBeNull();
  });

  it('not connected, enabled, lab admin: loads the SDK (only here) and shows the one primary Connect', async () => {
    expect(document.getElementById(FB_SDK_SCRIPT_ID)).toBeNull();
    const p = make(SENDER({ canConnect: true }));
    await settle(p.f);
    expect(p.api.get).toHaveBeenCalledWith('/api/whatsapp/onboarding/config');
    const script = document.getElementById(FB_SDK_SCRIPT_ID) as HTMLScriptElement;
    expect(script).not.toBeNull();
    expect(script.src).toBe('https://connect.facebook.net/en_US/sdk.js');
    const connect = p.q('wac-connect') as HTMLButtonElement;
    expect(connect.textContent).toContain('Connect WhatsApp');
    expect(connect.classList.contains('nd-btn--primary')).toBe(true);
    expect(p.el.querySelectorAll('.nd-btn--primary').length).toBe(1);
    expect(connect.querySelector('svg')).not.toBeNull();   // SVG icon, never emoji
  });

  it('without manage_tenant: no Connect, no SDK, a hint to ask the admin', async () => {
    const p = make(SENDER({ canConnect: true }), { perms: ['manage_lab_settings'] });
    await settle(p.f);
    expect(p.q('wac-connect')).toBeNull();
    expect(document.getElementById(FB_SDK_SCRIPT_ID)).toBeNull();
    expect(p.el.textContent).toContain('Ask your lab admin');
  });

  it('connecting: status line, no buttons', () => {
    const p = make(SENDER({ state: 'connecting', status: 'pending', canConnect: true }));
    expect(p.q('wac-state')!.textContent).toContain('Connecting');
    expect(p.el.textContent).toContain('Finish the steps in the Meta window');
    expect(p.q('wac-connect')).toBeNull();
  });

  it('connected: name, number, quality, limit, template statuses; Disconnect + Check status, no Connect', () => {
    const p = make(CONNECTED());
    expect(p.q('wac-state')!.textContent).toContain('Connected');
    const facts = p.q('wac-facts')!.textContent!;
    expect(facts).toContain('Micro World Labs');
    expect(facts).toContain('+91 98765 43210');
    expect(facts).toContain('High');
    expect(facts).toContain('2,000');
    const tpl = p.q('wac-templates')!.textContent!;
    expect(tpl).toContain('Report link');
    expect(tpl).toContain('Approved');
    expect(tpl).toContain('Report with PDF');
    expect(tpl).toContain('In review');
    expect(p.q('wac-connect')).toBeNull();
    expect(p.q('wac-disconnect')!.classList.contains('nd-btn--danger')).toBe(true);
    expect(p.q('wac-refresh')).not.toBeNull();
    expect(p.el.textContent).not.toMatch(/token/i);
  });

  it('connected but the template is still in review: says reports stay on the shared number', () => {
    const p = make(CONNECTED({ source: 'platform', templates: [{ kind: 'link', name: 'lab_report_ready', status: 'PENDING' }] }));
    expect(p.el.textContent).toContain('Meta is reviewing your report template');
  });

  it('action needed (template rejected): the alert explains it and offers Reconnect + Disconnect', async () => {
    const p = make(CONNECTED({
      state: 'action_needed',
      templates: [{ kind: 'link', name: 'lab_report_ready', status: 'APPROVED' }, { kind: 'pdf', name: 'lab_report_pdf', status: 'REJECTED', reason: 'INVALID_FORMAT' }],
    }));
    await settle(p.f);
    expect(p.q('wac-state')!.textContent).toContain('Action needed');
    expect(p.q('wac-alert')!.textContent).toContain('rejected your report-with-PDF template (INVALID_FORMAT)');
    expect(p.q('wac-connect')!.textContent).toContain('Reconnect WhatsApp');
    expect(p.q('wac-disconnect')).not.toBeNull();
  });

  it('action needed (token dead / number disconnected): shows the server reason and the shared-number fallback', () => {
    const p = make(CONNECTED({ source: 'platform', state: 'action_needed', status: 'error', error: 'Meta access for this number was removed or expired — reconnect WhatsApp.' }));
    const alert = p.q('wac-alert')!.textContent!;
    expect(alert).toContain('removed or expired');
    expect(alert).toContain("reports go from Prefrontal's shared number");
  });
});

describe('WhatsApp connect card — actions', () => {
  it('Disconnect asks through DialogService (danger) and posts only when confirmed', async () => {
    const no = make(CONNECTED(), { confirm: false });
    (no.q('wac-disconnect') as HTMLButtonElement).click();
    await settle(no.f);
    expect(no.dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger', confirmLabel: 'Disconnect' }));
    expect(no.api.post).not.toHaveBeenCalledWith('/api/whatsapp/onboarding/disconnect', {});
    TestBed.resetTestingModule();

    const yes = make(CONNECTED(), { confirm: true });
    yes.api.post.mockImplementation(((url: string) => of(SETTINGS(SENDER({ canConnect: true })))) as never);
    (yes.q('wac-disconnect') as HTMLButtonElement).click();
    await settle(yes.f);
    expect(yes.api.post).toHaveBeenCalledWith('/api/whatsapp/onboarding/disconnect', {});
    expect(yes.changed).toHaveBeenCalledWith(expect.objectContaining({ sender: expect.objectContaining({ state: 'not_connected' }) }));
  });

  it('Check status refreshes from Meta', async () => {
    const p = make(CONNECTED());
    (p.q('wac-refresh') as HTMLButtonElement).click();
    await settle(p.f);
    expect(p.api.post).toHaveBeenCalledWith('/api/whatsapp/onboarding/refresh', {});
    expect(p.toasts.success).toHaveBeenCalledWith('WhatsApp status updated');
  });
});

describe('WhatsApp connect card — Embedded Signup (FB.login + postMessage)', () => {
  async function ready() {
    const fb = installFakeFb();
    const p = make(SENDER({ canConnect: true }));
    await settle(p.f);
    expect(fb.init).toHaveBeenCalledWith(expect.objectContaining({ appId: 'app-1', version: 'v25.0' }));
    return { ...p, fb };
  }
  const completeCalls = (api: { post: ReturnType<typeof vi.fn> }) =>
    api.post.mock.calls.filter(c => c[0] === '/api/whatsapp/onboarding/complete').map(c => c[1]);

  it('Connect calls FB.login in the click with the config, then posts code + ids from the facebook.com message', async () => {
    const p = await ready();
    (p.q('wac-connect') as HTMLButtonElement).click();
    expect(p.fb.login).toHaveBeenCalledTimes(1);   // synchronously, inside the click
    const [cb, opts] = p.fb.login.mock.calls[0];
    expect(opts).toEqual({ config_id: 'cfg-1', response_type: 'code', override_default_response_type: true, extras: CONFIG.extras });
    expect(p.api.post).toHaveBeenCalledWith('/api/whatsapp/onboarding/start', {});
    p.f.detectChanges();
    expect(p.q('ls-wa-connect-card')!.getAttribute('data-state')).toBe('connecting');

    // A look-alike origin is ignored…
    fbMessage({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { waba_id: 'evil', phone_number_id: 'evil' } }, 'https://evilfacebook.com');
    // …Meta's own message is taken.
    fbMessage({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { waba_id: 'waba-9', phone_number_id: 'pn-9', business_id: 'b' }, version: 3 });
    cb({ authResponse: { code: 'code-9' }, status: 'connected' });
    await settle(p.f);

    expect(completeCalls(p.api)).toEqual([{
      state: 'signed-state', code: 'code-9', wabaId: 'waba-9', phoneNumberId: 'pn-9', event: 'FINISH', errorMessage: null,
    }]);
    expect(p.toasts.success).toHaveBeenCalledWith('Your WhatsApp number is connected');
    expect(p.changed).toHaveBeenCalled();
  });

  it('code but no session message: waits briefly, then completes with the code alone (coexistence)', async () => {
    const p = await ready();
    vi.useFakeTimers();
    (p.q('wac-connect') as HTMLButtonElement).click();
    const [cb] = p.fb.login.mock.calls[0];
    cb({ authResponse: { code: 'code-x' } });
    expect(completeCalls(p.api)).toEqual([]);
    vi.advanceTimersByTime(WA_INFO_WAIT_MS + 10);
    expect(completeCalls(p.api)).toEqual([{ state: 'signed-state', code: 'code-x', wabaId: null, phoneNumberId: null, event: 'FINISH', errorMessage: null }]);
  });

  it('CANCEL from Meta closes the attempt without a code and without an error toast', async () => {
    const p = await ready();
    p.api.post.mockImplementation(((url: string) => url === '/api/whatsapp/onboarding/start'
      ? of({ state: 'signed-state', expiresAt: '' })
      : url === '/api/whatsapp/onboarding/complete'
        ? throwError(() => new ApiError('The WhatsApp connection was cancelled.', 'cancelled'))
        : of({})) as never);
    (p.q('wac-connect') as HTMLButtonElement).click();
    fbMessage({ type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL', data: { current_step: 'PHONE_NUMBER_SETUP' } });
    await settle(p.f);
    expect(completeCalls(p.api)).toEqual([{ state: 'signed-state', code: null, wabaId: null, phoneNumberId: null, event: 'CANCEL', errorMessage: null }]);
    expect(p.toasts.error).not.toHaveBeenCalled();
    expect(p.q('ls-wa-connect-card')!.getAttribute('data-state')).toBe('not_connected');
  });

  it('a message with no attempt in flight is ignored', async () => {
    const p = await ready();
    fbMessage({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { waba_id: 'w', phone_number_id: 'p' } });
    await settle(p.f);
    expect(completeCalls(p.api)).toEqual([]);
  });
});

describe('Embedded Signup helpers', () => {
  it('accepts only https facebook.com origins', () => {
    expect(isFacebookOrigin('https://www.facebook.com')).toBe(true);
    expect(isFacebookOrigin('https://facebook.com')).toBe(true);
    expect(isFacebookOrigin('https://business.facebook.com')).toBe(true);
    expect(isFacebookOrigin('https://evilfacebook.com')).toBe(false);
    expect(isFacebookOrigin('http://www.facebook.com')).toBe(false);
    expect(isFacebookOrigin('https://facebook.com.evil.io')).toBe(false);
    expect(isFacebookOrigin('null')).toBe(false);
  });

  it('parses the WA_EMBEDDED_SIGNUP message (string or object), rejects everything else', () => {
    const ok = parseEmbeddedSignupMessage({ origin: 'https://www.facebook.com', data: JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', data: { waba_id: '123' } }) });
    expect(ok).toEqual({ event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', wabaId: '123', phoneNumberId: null, errorMessage: null, currentStep: null });
    const err = parseEmbeddedSignupMessage({ origin: 'https://www.facebook.com', data: { type: 'WA_EMBEDDED_SIGNUP', event: 'ERROR', data: { error_message: 'Boom' } } });
    expect(err!.errorMessage).toBe('Boom');
    expect(parseEmbeddedSignupMessage({ origin: 'https://evil.example', data: { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH' } })).toBeNull();
    expect(parseEmbeddedSignupMessage({ origin: 'https://www.facebook.com', data: 'not json' })).toBeNull();
    expect(parseEmbeddedSignupMessage({ origin: 'https://www.facebook.com', data: { type: 'OTHER', event: 'FINISH' } })).toBeNull();
  });

  it('labels the messaging limit tier', () => {
    expect(waLimitLabel('TIER_2K')).toBe('2,000 business-initiated / day');
    expect(waLimitLabel('TIER_100K')).toBe('1,00,000 business-initiated / day');
    expect(waLimitLabel('TIER_UNLIMITED')).toBe('Unlimited');
    expect(waLimitLabel(null)).toBe('Not known yet');
  });
});
