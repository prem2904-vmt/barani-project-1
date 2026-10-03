import { navInsets, publishNavInsets } from './nav-insets';

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height });

describe('navInsets — the visible nav footprint', () => {
  it('a docked bottom bar reserves its full height from its top edge (safe area included)', () => {
    expect(navInsets([rect(0, 900 - 71, 1440, 71)], 1440, 900)).toEqual({ bottom: 71, left: 0 });
  });
  it('a floating pill reserves its height plus the gap under it', () => {
    expect(navInsets([rect(400, 900 - 16 - 56, 640, 56)], 1440, 900)).toEqual({ bottom: 72, left: 0 });
  });
  it('fractional edges round UP so the page never ends under the nav', () => {
    expect(navInsets([rect(0, 900 - 70.4, 1440, 70.4)], 1440, 900)).toEqual({ bottom: 71, left: 0 });
  });
  it('a left rail (iPad) reserves its right edge; hidden / top elements reserve nothing', () => {
    expect(navInsets([rect(8, 0, 60, 1024)], 1366, 1024)).toEqual({ bottom: 0, left: 68 });
    expect(navInsets([rect(0, 0, 1440, 64), rect(0, 0, 0, 0)], 1440, 900)).toEqual({ bottom: 0, left: 0 });
  });
});

describe('publishNavInsets — writes the variables on <html>', () => {
  it('measures visible nav elements only', () => {
    document.body.innerHTML = '<div class="pf-chrome"></div><nav class="pf-bottom-nav" style="display:none"></nav>';
    const bar = document.querySelector<HTMLElement>('.pf-chrome')!;
    bar.getBoundingClientRect = () => rect(0, window.innerHeight - 64, window.innerWidth, 64) as DOMRect;
    const out = publishNavInsets(document, window);
    expect(out.bottom).toBe(64);
    expect(document.documentElement.style.getPropertyValue('--pf-nav-h')).toBe('64px');
    expect(document.documentElement.style.getPropertyValue('--pf-nav-left')).toBe('0px');
    document.body.innerHTML = '';
  });
});
