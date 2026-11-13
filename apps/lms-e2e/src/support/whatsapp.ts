import { expect, type BrowserContext, type Page } from '@playwright/test';
import { bridgeCalls, formFactor, isDesktopApp, isTouch } from './form-factor';

/**
 * WhatsApp Chat at every form factor (WhatsAppManualService): what ONE click opens.
 *   desktop (web)  → a NEW TAB at https://web.whatsapp.com/send?phone=…&text=…   (via 'tab')
 *   desktop app    → the docked panel: electronAPI.whatsapp.open(<same link>)     (via 'dock')
 *   phone / tablet → the share sheet with the PDF when the device can share files (via 'share'),
 *                    else https://wa.me/<digits>?text=… in a new tab              (via 'wa.me')
 * WhatsApp is never contacted (stub pages). Call `installWhatsAppRecorder` before the first navigation.
 */
export type ChatVia = 'tab' | 'dock' | 'share' | 'wa.me';
export interface ChatOpen { via: ChatVia; phone: string | null; text: string; url: string | null; files: [string, string][] }

/** Record window.open (still opening for real) as window.__opens, and — with `share` — a navigator.share that can
 *  carry files, recorded as window.__shares. Stubs web.whatsapp.com and wa.me on the context. */
export async function installWhatsAppRecorder(page: Page, context: BrowserContext, o: { share?: boolean } = {}): Promise<void> {
  await context.route(/(web\.whatsapp\.com|wa\.me)\//, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>WhatsApp (stub)</title><p>stub</p>' }));
  await page.addInitScript((share: boolean) => {
    const w = window as unknown as { __opens: string[][]; __shares: { files: [string, string][]; text: string }[]; open: typeof window.open };
    w.__opens = []; w.__shares = [];
    const orig = window.open.bind(window);
    w.open = ((...a: unknown[]) => { w.__opens.push(a.map(x => String(x))); return orig(...(a as Parameters<typeof window.open>)); }) as typeof window.open;
    if (share) {
      const nav = navigator as unknown as { canShare: unknown; share: unknown };
      nav.canShare = () => true;
      nav.share = async (d: { files?: File[]; text?: string }) => { w.__shares.push({ files: (d.files || []).map(f => [f.name, f.type] as [string, string]), text: d.text ?? '' }); };
    }
  }, !!o.share);
}

export const opens = (page: Page) => page.evaluate(() => (window as unknown as { __opens?: string[][] }).__opens ?? []);
export const shares = (page: Page) => page.evaluate(() => (window as unknown as { __shares?: { files: [string, string][]; text: string }[] }).__shares ?? []);

function parse(url: string): { phone: string | null; text: string } {
  const u = new URL(url);
  if (u.hostname === 'wa.me') return { phone: u.pathname.replace(/^\//, '') || null, text: u.searchParams.get('text') ?? '' };
  return { phone: u.searchParams.get('phone'), text: u.searchParams.get('text') ?? '' };
}

/** Do `click`, then return what it opened for this form factor (fails if it opened the wrong kind of thing). */
export async function openChat(page: Page, click: () => Promise<void>, timeout = 20_000): Promise<ChatOpen> {
  const ff = formFactor();
  if (isDesktopApp()) {
    const before = (await bridgeCalls(page, 'whatsapp.open')).length;
    await click();
    await expect.poll(async () => (await bridgeCalls(page, 'whatsapp.open')).length, { message: 'desktop app: the dock bridge opened', timeout }).toBeGreaterThan(before);
    const url = String((await bridgeCalls(page, 'whatsapp.open')).slice(-1)[0].args[0]);
    expect(new URL(url).origin, 'the dock gets the click-to-chat link').toBe('https://web.whatsapp.com');
    return { via: 'dock', url, files: [], ...parse(url) };
  }
  if (isTouch()) {
    const s0 = (await shares(page)).length;
    const o0 = (await opens(page)).length;
    const popupP = page.waitForEvent('popup', { timeout }).catch(() => null);
    await click();
    let tabUrl: string | null = null;
    await expect.poll(async () => {
      if ((await shares(page)).length > s0) return 'share';
      const o = (await opens(page)).slice(o0).find(x => /^https:\/\/wa\.me\//.test(x[0] ?? ''));
      if (o) { tabUrl = o[0]; return 'wa.me'; }
      return '';
    }, { message: `${ff}: the share sheet or wa.me opened`, timeout }).not.toBe('');
    if (tabUrl) {
      const tab = await popupP;
      await tab?.close().catch(() => undefined);
      return { via: 'wa.me', url: tabUrl, files: [], ...parse(tabUrl) };
    }
    const sh = (await shares(page)).slice(-1)[0];
    return { via: 'share', url: null, phone: null, text: sh.text, files: sh.files };
  }
  const popupP = page.waitForEvent('popup', { timeout });
  await click();
  const tab = await popupP;
  await tab.waitForURL(/web\.whatsapp\.com\/send/, { timeout });
  const url = tab.url();
  await tab.close().catch(() => undefined);
  return { via: 'tab', url, files: [], ...parse(url) };
}

/** The via this form factor must use (share only where the page can share files). */
export function expectedVia(canShareFiles: boolean): ChatVia {
  if (isDesktopApp()) return 'dock';
  if (isTouch()) return canShareFiles ? 'share' : 'wa.me';
  return 'tab';
}
