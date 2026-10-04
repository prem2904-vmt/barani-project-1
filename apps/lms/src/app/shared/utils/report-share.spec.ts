import { vi } from 'vitest';
import { copyText, shareHint, shareLink, shareRoute, type ShareEnv } from './report-share';

/** The share ladder per platform: Capacitor Share plugin (native, when the
 *  plugin is present) → Web Share API → copy the link. */
const P = { title: 'Lab report', text: 'Lab report for Priya', url: 'https://lab.example/track/abc' };

function env(o: {
  native?: boolean; plugin?: boolean; pluginShare?: () => Promise<unknown>;
  webShare?: ((d: ShareData) => Promise<void>) | null; clip?: ((t: string) => Promise<void>) | null;
} = {}): ShareEnv {
  const share = o.pluginShare ?? vi.fn(async () => ({}));
  return {
    capacitor: o.native === undefined ? null : {
      isNativePlatform: () => !!o.native,
      isPluginAvailable: (n: string) => n === 'Share' && !!o.plugin,
      Plugins: o.plugin ? { Share: { share } } : {},
    },
    navigator: {
      share: o.webShare === null ? undefined as never : (o.webShare ?? undefined) as never,
      clipboard: o.clip === null ? undefined : { writeText: o.clip ?? vi.fn(async () => {}) },
    } as never,
    document: null,
  };
}

describe('shareRoute — which rung a device takes', () => {
  it('native app with the Capacitor Share plugin → capacitor', () => {
    expect(shareRoute(env({ native: true, plugin: true, webShare: vi.fn() }))).toBe('capacitor');
  });
  it('native app WITHOUT the plugin but with navigator.share (iOS WKWebView) → web-share', () => {
    expect(shareRoute(env({ native: true, plugin: false, webShare: vi.fn() }))).toBe('web-share');
  });
  it('native Android WebView (no plugin, no navigator.share) → copy', () => {
    expect(shareRoute(env({ native: true, plugin: false, webShare: null }))).toBe('copy');
  });
  it('a browser with the Web Share API (Safari, Android Chrome) → web-share', () => {
    expect(shareRoute(env({ webShare: vi.fn() }))).toBe('web-share');
  });
  it('a desktop browser without it (Firefox, Chrome desktop) → copy', () => {
    expect(shareRoute(env({ webShare: null }))).toBe('copy');
  });
  it('the menu hint says what will happen', () => {
    expect(shareHint('copy')).toMatch(/copies/i);
    expect(shareHint('web-share')).toMatch(/share sheet/i);
  });
});

describe('shareLink — walks the ladder once', () => {
  it('capacitor: the plugin gets title, text and url', async () => {
    const pluginShare = vi.fn(async () => ({}));
    expect(await shareLink(P, env({ native: true, plugin: true, pluginShare }))).toBe('shared');
    expect(pluginShare).toHaveBeenCalledWith(expect.objectContaining({ url: P.url, title: P.title, text: P.text }));
  });

  it('web-share: navigator.share with the link', async () => {
    const webShare = vi.fn(async () => {});
    expect(await shareLink(P, env({ webShare }))).toBe('shared');
    expect(webShare).toHaveBeenCalledWith({ title: P.title, text: P.text, url: P.url });
  });

  it('a dismissed sheet is a cancel — nothing is copied', async () => {
    const clip = vi.fn(async () => {});
    const webShare = vi.fn(async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); });
    expect(await shareLink(P, env({ webShare, clip }))).toBe('cancelled');
    expect(clip).not.toHaveBeenCalled();
  });

  it('a failing share sheet (NotAllowedError) falls back to copying the link', async () => {
    const clip = vi.fn(async () => {});
    const webShare = vi.fn(async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); });
    expect(await shareLink(P, env({ webShare, clip }))).toBe('copied');
    expect(clip).toHaveBeenCalledWith(P.url);
  });

  it('a failing native plugin falls through to navigator.share', async () => {
    const webShare = vi.fn(async () => {});
    const pluginShare = vi.fn(async () => { throw new Error('UNIMPLEMENTED'); });
    expect(await shareLink(P, env({ native: true, plugin: true, pluginShare, webShare }))).toBe('shared');
    expect(webShare).toHaveBeenCalled();
  });

  it('copy route: the link goes to the clipboard', async () => {
    const clip = vi.fn(async () => {});
    expect(await shareLink(P, env({ webShare: null, clip }))).toBe('copied');
    expect(clip).toHaveBeenCalledWith(P.url);
  });

  it('nothing works (no share, clipboard blocked, no document) → failed', async () => {
    const clip = vi.fn(async () => { throw new Error('denied'); });
    expect(await shareLink(P, env({ webShare: null, clip }))).toBe('failed');
  });
});

describe('copyText', () => {
  it('uses the legacy execCommand path when the Clipboard API is missing', async () => {
    const exec = vi.fn(() => true);
    (document as any).execCommand = exec;
    const ok = await copyText('hello', { navigator: {} as never, document });
    expect(ok).toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
    delete (document as any).execCommand;
  });
});
