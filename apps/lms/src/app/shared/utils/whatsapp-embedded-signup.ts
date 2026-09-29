/**
 * Meta WhatsApp Embedded Signup (v4) in the browser — the Facebook JS SDK
 * loader and the `WA_EMBEDDED_SIGNUP` message parser.
 *
 * The SDK is loaded ON DEMAND by the one screen that connects a lab's number
 * (Lab settings → WhatsApp); it is never part of the app bundle or index.html.
 */

export const FB_SDK_SRC = 'https://connect.facebook.net/en_US/sdk.js';
export const FB_SDK_SCRIPT_ID = 'pf-facebook-jssdk';

/** The slice of the Facebook JS SDK we use. */
export interface FacebookSdk {
  init(opts: { appId: string; autoLogAppEvents?: boolean; xfbml?: boolean; version: string }): void;
  login(
    cb: (resp: { authResponse?: { code?: string } | null; status?: string }) => void,
    opts: { config_id: string; response_type: 'code'; override_default_response_type: true; extras: Record<string, unknown> },
  ): void;
}

type FbWindow = Window & { FB?: FacebookSdk; fbAsyncInit?: () => void };

let loading: Promise<FacebookSdk> | null = null;
let initialisedFor: string | null = null;

/** Load (once) and init the SDK for `appId`. Resolves with `window.FB`. */
export function loadFacebookSdk(appId: string, version: string, doc: Document = document): Promise<FacebookSdk> {
  const w = doc.defaultView as FbWindow | null;
  const init = (fb: FacebookSdk) => {
    if (initialisedFor !== appId) {
      fb.init({ appId, autoLogAppEvents: true, xfbml: false, version: version.startsWith('v') ? version : `v${version}` });
      initialisedFor = appId;
    }
    return fb;
  };
  if (w?.FB) return Promise.resolve(init(w.FB));
  if (loading) return loading.then(init);
  loading = new Promise<FacebookSdk>((resolve, reject) => {
    if (!w) { reject(new Error('No window')); return; }
    w.fbAsyncInit = () => { if (w.FB) resolve(w.FB); };
    const s = doc.createElement('script');
    s.id = FB_SDK_SCRIPT_ID;
    s.src = FB_SDK_SRC;
    s.async = true;
    s.defer = true;
    s.crossOrigin = 'anonymous';
    s.onerror = () => { loading = null; s.remove(); reject(new Error('Could not load Facebook sign-in. Check your connection or ad blocker.')); };
    doc.body.appendChild(s);
  }).then(init);
  return loading;
}

/** Test hook: forget the loaded SDK. */
export function resetFacebookSdkForTests() {
  loading = null;
  initialisedFor = null;
}

/** True only for Facebook's own https origins (facebook.com or *.facebook.com).
 *  Stricter than `endsWith('facebook.com')`, which also accepts evilfacebook.com. */
export function isFacebookOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return u.protocol === 'https:' && (u.hostname === 'facebook.com' || u.hostname.endsWith('.facebook.com'));
  } catch {
    return false;
  }
}

export type EmbeddedSignupEvent =
  | 'FINISH' | 'FINISH_ONLY_WABA' | 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'
  | 'CANCEL' | 'ERROR' | string;

export interface EmbeddedSignupMessage {
  event: EmbeddedSignupEvent;
  wabaId: string | null;
  phoneNumberId: string | null;
  /** The Meta Business Portfolio the WABA was created under (billing deep links). */
  businessId: string | null;
  errorMessage: string | null;
  currentStep: string | null;
}

/** The session info Meta posts to the opener. Null for anything else —
 *  wrong origin, wrong type, junk. Never trusts a non-Facebook origin. */
export function parseEmbeddedSignupMessage(ev: Pick<MessageEvent, 'origin' | 'data'>): EmbeddedSignupMessage | null {
  if (!isFacebookOrigin(ev.origin)) return null;
  let d: unknown = ev.data;
  if (typeof d === 'string') {
    try { d = JSON.parse(d); } catch { return null; }
  }
  if (!d || typeof d !== 'object') return null;
  const m = d as { type?: unknown; event?: unknown; data?: Record<string, unknown> };
  if (m.type !== 'WA_EMBEDDED_SIGNUP' || typeof m.event !== 'string') return null;
  const data = (m.data && typeof m.data === 'object' ? m.data : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);
  return {
    event: m.event.toUpperCase(),
    wabaId: str(data['waba_id']),
    phoneNumberId: str(data['phone_number_id']),
    businessId: str(data['business_id']),
    errorMessage: str(data['error_message']),
    currentStep: str(data['current_step']),
  };
}
