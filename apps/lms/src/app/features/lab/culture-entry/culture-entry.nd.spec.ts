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

describe('AST table — LIGHT mode has no traffic lights', () => {
  it('no green / amber / red in any light rule, except the small dot on a selected R', () => {
    const traffic = /#10b981|#34d399|#f59e0b|#fbbf24|#ef4444|#f87171|#dc2626|16,\s*185,\s*129|245,\s*158,\s*11|239,\s*68,\s*68/i;
    for (const r of lightRules()) {
      if (!traffic.test(r)) continue;
      // Only allowed: the ::after dot on a selected R (wide button or small-screen cell).
      expect(r).toMatch(/(data-v=["']?R["']?\]|cell--r)[^{]*::after/);
      expect(r).toMatch(/width:\s*5px[^}]*height:\s*5px/);
    }
  });

  it('light: headers muted, breakpoint chips neutral, MIC line muted, selection neutral', () => {
    const light = lightRules().join('\n');
    expect(light).toMatch(/\.ce-abx__col--r[^{]*\{[^}]*color:\s*var\(--text-tertiary\)/);
    expect(light).toMatch(/\.ce-abx__bpbox[^{]*\{[^}]*background:\s*var\(--nd-chip-bg\)/);
    expect(light).toMatch(/\.ce-abx__mic[^{]*\{[^}]*color:\s*var\(--text-tertiary\)/);
    expect(light).toMatch(/\.ce-sir-picked\[data-v\][^{]*\{[^}]*background:\s*var\(--nd-card-bg/);
  });

  it('dark keeps its verdict colours (base rules)', () => {
    expect(css()).toMatch(/\.ce-sir-picked\[data-v=["']?S["']?\][^{]*\{[^}]*#10b981/);
    expect(css()).toMatch(/\.ce-sir-picked\[data-v=["']?R["']?\][^{]*\{[^}]*#ef4444/);
  });
});
