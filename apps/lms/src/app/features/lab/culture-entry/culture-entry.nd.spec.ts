import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { CultureEntryComponent } from './culture-entry.component';
import { ApiService } from '../../../core/services/api.service';
import { PlatformService } from '../../../core/services/platform.service';

/** AST table (owner): light mode drops the traffic lights (eye strain) —
 *  neutral headers / breakpoint chips / muted MIC line / neutral S·I·R
 *  selection, a small red dot on a selected R the only colour. Dark keeps
 *  its verdict colours. Kit restyle in both themes. */

const css = () => ((CultureEntryComponent as any).ɵcmp.styles as string[]).join('\n');
/** Only the LIGHT-mode rules (host-context(.light) compiles to .light[_nghost…]). */
const lightRules = () => css().split('}').filter(r => /\.light/.test(r)).map(r => r + '}');

function render() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true, writable: true,
    value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  });
  TestBed.configureTestingModule({
    imports: [CultureEntryComponent],
    providers: [
      { provide: ApiService, useValue: { get: () => of([]), post: () => of({}) } },
      { provide: PlatformService, useValue: { isCapacitor: () => false, isNative: () => false } },
    ],
  });
  const f = TestBed.createComponent(CultureEntryComponent);
  const c = f.componentInstance as any;
  c.embedded = true;
  c.value = { organisms: [{ name: 'Abiotrophia spp.', antibiotics: [
    { name: 'Penicillin', zoneSize: 18, interpretation: 'R' },
    { name: 'Vancomycin', zoneSize: null, interpretation: null },
  ] }] };
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement, c };
}

describe('AST table — kit restyle (both themes)', () => {
  it('reading method: a normal-case label + the kit segmented control', () => {
    const { el } = render();
    const lbl = el.querySelector('.ce-modebar__lbl')!;
    expect(lbl.textContent?.trim()).toBe('Reading method');
    const seg = el.querySelector('.ce-modeseg')!;
    expect(seg.classList.contains('nd-seg')).toBe(true);
    const items = seg.querySelectorAll('.nd-seg__item');
    expect(items.length).toBe(2);
    expect(items[0].getAttribute('aria-checked')).toBe('true');
    expect(css()).toMatch(/\.ce-modebar__lbl[^{]*\{[^}]*text-transform:\s*none/);
  });

  it('S / I / R is a segmented radio group, state by class (no inline colours)', () => {
    const { el } = render();
    const segs = el.querySelectorAll('.ce-sirseg');
    expect(segs.length).toBe(2);
    const r = segs[0].querySelector('[data-v="R"]') as HTMLElement;
    expect(r.classList.contains('ce-sir-picked')).toBe(true);
    expect(r.getAttribute('aria-checked')).toBe('true');
    expect(r.getAttribute('style') ?? '').not.toMatch(/background|color/);
  });

  it('the remove × is a quiet labelled icon button; the zone field is a kit field', () => {
    const { el } = render();
    const x = el.querySelector('.ce-abx__x')!;
    expect(x.getAttribute('aria-label')).toBe('Remove Penicillin');
    expect(x.querySelector('svg')).toBeTruthy();
    expect(css()).toMatch(/\.ce-abx__zone[^{]*\{[^}]*font-family:\s*inherit[^}]*var\(--nd-line/);
  });
});

describe('AST table — picked result subtle colour, breakpoints neutral (both themes)', () => {
  const traffic = /#10b981|#34d399|#f59e0b|#fbbf24|#ef4444|#f87171|#dc2626|16,\s*185,\s*129|245,\s*158,\s*11|239,\s*68,\s*68|52,\s*211,\s*153/i;

  it('traffic colours appear ONLY in the picked-result tint rules (no R dot any more)', () => {
    for (const r of css().split('}')) {
      if (!traffic.test(r)) continue;
      expect(r).toMatch(/ce-sir--[sir]|ce-abx__cell--[sir]\.ce-abx__cell--on/);
      expect(r).not.toMatch(/::after/);
    }
  });

  it('the picked result carries its subtle tint class in BOTH themes', () => {
    const { el } = render();
    const r = el.querySelector('.ce-sirseg [data-v="R"]')!;
    expect(r.classList.contains('ce-sir--r')).toBe(true);
    expect(el.querySelector('.ce-sirseg [data-v="S"]')!.classList.contains('ce-sir--s')).toBe(false);
    const s = css();
    for (const theme of ['light', 'dark']) {
      for (const v of ['s', 'i', 'r']) {
        expect(s).toMatch(new RegExp('\\.' + theme + '[^{]*\\.ce-sir--' + v + '[^{]*\\{[^}]*background:\\s*rgba\\([^)]*0\\.(1[0-4]|2\\d?)\\)[^}]*color:\\s*#'));
      }
    }
  });

  it('breakpoints / headers / MIC line stay neutral (not theme-scoped)', () => {
    const s = css();
    expect(s).toMatch(/\.ce-abx__col--r[^{]*\{[^}]*color:\s*var\(--text-tertiary\)/);
    expect(s).toMatch(/\.ce-abx__bpbox[^{]*\{[^}]*background:\s*var\(--nd-chip-bg\)/);
    expect(s).toMatch(/\.ce-abx__mic[^{]*\{[^}]*color:\s*var\(--text-tertiary\)/);
  });

  it('every row is a subtle card in BOTH themes (radius, gap, fill, stronger hover)', () => {
    const s = css();
    expect(s).toMatch(/\.ce-abx__row\[_ngcontent-%COMP%\]\s*\{[^}]*border-radius:\s*10px/);
    expect(s).toMatch(/\.light[^{]*\.ce-abx__row\[_ngcontent-%COMP%\]\s*\{[^}]*background:\s*#f6f7f9/);
    expect(s).toMatch(/\.light[^{]*\.ce-abx__row[^{]*:hover[^{]*\{[^}]*background:\s*#eef0f3/);
    expect(s).toMatch(/\.dark[^{]*\.ce-abx__row\[_ngcontent-%COMP%\]\s*\{[^}]*background:\s*var\(--glass-bg\)/);
  });
});
