import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Tablets must work in portrait AND both landscapes in the native app
 * (owner). Phones keep what they have today. These read the native project
 * files, so a later "lock to portrait" can't slip in unnoticed.
 */
const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

/** The <array> of <string>s under a plist key (plain-text plist). */
function plistArray(xml: string, key: string): string[] | null {
  const esc = key.replace(/[.*+?^${}()|[\]\\~]/g, '\\$&');
  const m = new RegExp(`<key>${esc}</key>\\s*<array>([\\s\\S]*?)</array>`).exec(xml);
  if (!m) return null;
  return [...m[1].matchAll(/<string>([^<]+)<\/string>/g)].map((s) => s[1]);
}

describe('iOS / iPadOS orientation (Info.plist)', () => {
  const plist = read('ios/App/App/Info.plist');

  it('iPad supports portrait, upside-down and BOTH landscapes', () => {
    expect(plistArray(plist, 'UISupportedInterfaceOrientations~ipad')?.sort()).toEqual([
      'UIInterfaceOrientationLandscapeLeft',
      'UIInterfaceOrientationLandscapeRight',
      'UIInterfaceOrientationPortrait',
      'UIInterfaceOrientationPortraitUpsideDown',
    ]);
  });

  it('iPhone keeps portrait (unchanged)', () => {
    expect(plistArray(plist, 'UISupportedInterfaceOrientations')).toContain('UIInterfaceOrientationPortrait');
  });

  it('nothing blocks iPad rotation / multitasking (no UIRequiresFullScreen = true)', () => {
    expect(plist).not.toMatch(/<key>UIRequiresFullScreen<\/key>\s*<true\/>/);
  });

  it('no build setting overrides the plist orientations', () => {
    const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
    expect(pbx).not.toMatch(/INFOPLIST_KEY_UISupportedInterfaceOrientations/);
    expect(pbx).not.toMatch(/INFOPLIST_KEY_UIRequiresFullScreen\s*=\s*YES/);
  });

  it('the app delegate does not restrict orientations in code', () => {
    const dir = resolve(ROOT, 'ios/App/App');
    const swift = readdirSync(dir).filter((f) => f.endsWith('.swift')).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
    expect(swift).not.toMatch(/supportedInterfaceOrientationsFor/);
  });
});

describe('Android orientation (AndroidManifest.xml)', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const activity = /<activity[\s\S]*?android:name="\.MainActivity"[\s\S]*?>/.exec(manifest)?.[0] ?? '';

  it('MainActivity is not locked to one orientation (follows the sensor / user rotation)', () => {
    expect(activity).toBeTruthy();
    expect(activity).not.toMatch(/android:screenOrientation="(portrait|landscape|sensorPortrait|sensorLandscape|userPortrait|userLandscape|reversePortrait|reverseLandscape|locked|nosensor)"/);
  });

  it('rotation keeps the WebView alive (no activity restart, no reload of the app)', () => {
    const changes = /android:configChanges="([^"]+)"/.exec(activity)?.[1].split('|') ?? [];
    for (const c of ['orientation', 'screenSize', 'smallestScreenSize', 'screenLayout']) expect(changes).toContain(c);
  });

  it('multi-window / free-form resizing is not disabled', () => {
    expect(manifest).not.toMatch(/android:resizeableActivity="false"/);
  });

  it('no Java/Kotlin code locks the orientation', () => {
    const javaRoot = resolve(ROOT, 'android/app/src/main/java');
    const files: string[] = [];
    const walk = (d: string) => {
      if (!existsSync(d)) return;
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(java|kt)$/.test(n)) files.push(p);
      }
    };
    walk(javaRoot);
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/setRequestedOrientation/);
  });
});

describe('Capacitor WebView does not fake a desktop', () => {
  it('no user-agent override (the Android WebView keeps its Android UA)', () => {
    const cfg = read('capacitor.config.ts');
    expect(cfg).not.toMatch(/overrideUserAgent|appendUserAgent/);
  });

  it('index.html viewport is device-width (no desktop-width viewport)', () => {
    const html = read('apps/lms/src/index.html');
    expect(html).toMatch(/<meta name="viewport" content="width=device-width, initial-scale=1/);
  });
});
