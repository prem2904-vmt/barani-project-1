/**
 * Share a patient report LINK from any screen — one ladder, per platform:
 *
 *  1. Native app (iOS / Android) WITH the Capacitor `Share` plugin present →
 *     the OS share sheet via the plugin. (The plugin is looked up at runtime:
 *     `@capacitor/share` is not bundled today, so this rung activates by
 *     itself once the native projects ship it — no JS change.)
 *  2. The Web Share API (`navigator.share`) → the system share sheet. This is
 *     what iPad / iPhone (WKWebView and Safari), Android Chrome and Edge /
 *     Safari on desktop get today.
 *  3. Otherwise (Android WebView, Firefox / Chrome desktop) → copy the link
 *     to the clipboard and say so.
 *
 * A dismissed share sheet (AbortError) is a cancel, not an error, and never
 * falls through to copying.
 */

export type ShareRoute = 'capacitor' | 'web-share' | 'copy';
export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

export interface SharePayload { title: string; text: string; url: string }

interface CapacitorLike {
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (name: string) => boolean;
  Plugins?: Record<string, { share?: (o: { title?: string; text?: string; url?: string; dialogTitle?: string }) => Promise<unknown> } | undefined>;
}

/** The environment the ladder reads — injectable so specs can fake each platform. */
export interface ShareEnv {
  capacitor?: CapacitorLike | null;
  navigator?: Pick<Navigator, 'share'> & { clipboard?: Pick<Clipboard, 'writeText'> } | null;
  document?: Document | null;
}

export function defaultShareEnv(): ShareEnv {
  const w = typeof window !== 'undefined' ? (window as unknown as { Capacitor?: CapacitorLike }) : undefined;
  return {
    capacitor: w?.Capacitor ?? null,
    navigator: typeof navigator !== 'undefined' ? navigator : null,
    document: typeof document !== 'undefined' ? document : null,
  };
}

/** Which rung this device takes (for the menu hint and the specs). */
export function shareRoute(env: ShareEnv = defaultShareEnv()): ShareRoute {
  const cap = env.capacitor;
  if (cap?.isNativePlatform?.() && cap.isPluginAvailable?.('Share') && typeof cap.Plugins?.['Share']?.share === 'function') {
    return 'capacitor';
  }
  if (typeof env.navigator?.share === 'function') return 'web-share';
  return 'copy';
}

/** Human hint for the menu row: what "Share…" will do on this device. */
export function shareHint(route: ShareRoute): string {
  return route === 'copy' ? 'Copies the patient link' : 'Opens the share sheet';
}

function isAbort(err: unknown): boolean {
  const e = err as { name?: string; message?: string; errorMessage?: string } | null;
  const msg = `${e?.message ?? ''} ${e?.errorMessage ?? ''}`.toLowerCase();
  return e?.name === 'AbortError' || msg.includes('cancel');
}

/** Copy text: async Clipboard API, then the legacy execCommand path. */
export async function copyText(text: string, env: ShareEnv = defaultShareEnv()): Promise<boolean> {
  try {
    if (env.navigator?.clipboard?.writeText) { await env.navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through to the legacy path */ }
  const doc = env.document;
  if (!doc?.body) return false;
  try {
    const ta = doc.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    doc.body.appendChild(ta);
    ta.select();
    const ok = typeof doc.execCommand === 'function' && doc.execCommand('copy');
    ta.remove();
    return !!ok;
  } catch { return false; }
}

/** Walk the ladder once. */
export async function shareLink(p: SharePayload, env: ShareEnv = defaultShareEnv()): Promise<ShareOutcome> {
  const route = shareRoute(env);
  if (route === 'capacitor') {
    try {
      await env.capacitor!.Plugins!['Share']!.share!({ title: p.title, text: p.text, url: p.url, dialogTitle: p.title });
      return 'shared';
    } catch (err) {
      if (isAbort(err)) return 'cancelled';
      /* plugin failed — try the next rung */
    }
  }
  if (route !== 'copy' && typeof env.navigator?.share === 'function') {
    try {
      await env.navigator.share({ title: p.title, text: p.text, url: p.url });
      return 'shared';
    } catch (err) {
      if (isAbort(err)) return 'cancelled';
      /* NotAllowedError / unsupported payload — copy instead */
    }
  }
  return (await copyText(p.url, env)) ? 'copied' : 'failed';
}
