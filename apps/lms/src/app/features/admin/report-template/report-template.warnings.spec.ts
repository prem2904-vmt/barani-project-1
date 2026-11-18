import { vi } from 'vitest';
import { renderBandPage } from '../admin-band.spec-helpers';
import { ReportTemplateComponent } from './report-template.component';
import { LONG_TEXT_TARGET, type ReportIssueSpot } from '../../../shared/utils/report-issues';

/**
 * Report design — Warnings (owner 2026-11-17, was "Issues"). OWNER BUG: clicking a warning went somewhere else and
 * highlighted nothing. Each warning must land ON its field: the section opens, the field scrolls into view, its control
 * takes focus and both flash an outline. The Preview popup shows the page (A4) and outlines a warning's spot.
 */
const spots: ReportIssueSpot[] = [
  { line: '"Thiruvenkatasamy Subramaniam…" runs into "Ref. by"', page: 1, x: 20, y: 40, w: 90, h: 6, target: LONG_TEXT_TARGET },
  { line: '"Sri Ramachandra Institute of…" runs into "Collected"', page: 1, x: 110, y: 52, w: 80, h: 6, target: LONG_TEXT_TARGET },
];
const make = () => {
  const p = renderBandPage(ReportTemplateComponent, {
    getFor: (url) => url === '/api/config/report-template' ? { labName: 'Micro World Labs' }
      : url === '/api/tenants/departments' ? [{ id: 'd1', name: 'Haematology' }]
      : url.startsWith('/api/workflows/') ? { configJson: '{}' }
      : null,
  });
  // The debounced background render would replace the stubbed warnings with real ones.
  p.cmp.renderPreview = async () => undefined;
  return p;
};
const settle = async (p: { f: { detectChanges(): void; whenStable(): Promise<unknown> } }) => {
  for (let i = 0; i < 4; i++) { p.f.detectChanges(); await p.f.whenStable(); await new Promise((r) => setTimeout(r, 0)); }
  p.f.detectChanges();
};

describe('Report design — Warnings land on their field, highlighted', () => {
  it('the head shows "Warnings n"; it lists each warning in plain words', async () => {
    const p = make();
    p.cmp.issues.set({ count: 2, lines: spots.map(s => s.line), spots });
    await settle(p);
    const chip = p.el.querySelector<HTMLButtonElement>('[data-testid="rt-main-head"] [data-testid="rt-warnings"]')!;
    expect(chip.textContent!.replace(/\s+/g, ' ').trim()).toBe('Warnings 2');
    expect(p.el.textContent).not.toMatch(/\bissues?\b/i);
    chip.click();
    await settle(p);
    const rows = Array.from(p.el.querySelectorAll('[data-testid="rt-warnlist"] .pf-rt-warnlist__go')).map(b => b.textContent!.trim());
    expect(rows).toEqual(spots.map(s => s.line));
  });

  for (const [i, s] of spots.entries()) {
    it(`warning ${i + 1}: switches to Patient strip, scrolls the Long text setting into view, focuses "Fit long text" and flashes it`, async () => {
      const p = make();
      p.cmp.issues.set({ count: 2, lines: spots.map(x => x.line), spots });
      await settle(p);
      expect(p.cmp.tab()).toBe('letterhead');
      // scrollIntoView must never be used: it scrolled the card (head out of view) and the band too.
      const intoView = vi.fn();
      const orig = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = intoView as typeof orig;
      try {
        p.el.querySelector<HTMLButtonElement>('[data-testid="rt-warnings"]')!.click();
        await settle(p);
        p.el.querySelector<HTMLButtonElement>(`[data-testid="rt-warning-${i}"]`)!.click();
        for (let k = 0; k < 10 && !p.cmp.lastScrolledTo; k++) { await settle(p); await new Promise((r) => setTimeout(r, 60)); }
      } finally { Element.prototype.scrollIntoView = orig; }
      expect(intoView).not.toHaveBeenCalled();
      expect(p.cmp.tab()).toBe('patient');
      const anchor = p.el.querySelector<HTMLElement>('#pf-long-text')!;
      expect(anchor).not.toBeNull();
      expect(p.cmp.lastScrolledTo).toBe(anchor);                                  // the exact field, centred in the body
      const sw = anchor.querySelector<HTMLElement>('[aria-label="Fit long text"]')!;
      expect(document.activeElement).toBe(sw);                                    // its control has focus
      expect(anchor.classList.contains('pf-rt-flash')).toBe(true);                // the whole row is outlined + tinted
      expect(p.cmp.hasUnsavedChanges()).toBe(false);                              // navigating never makes the page dirty
      expect(p.cmp.activeWarning()).toEqual(s);
    });
  }

  it('Preview opens the A4 popup (no live preview pane); a warning\'s spot is outlined; closing returns focus', async () => {
    const p = make();
    p.cmp.issues.set({ count: 2, lines: spots.map(s => s.line), spots });
    p.cmp.rawPreviewUrl.set('blob:sample');
    await settle(p);
    expect(p.el.querySelector('.pf-rt-aside')).toBeNull();
    const btn = p.el.querySelector<HTMLButtonElement>('[data-testid="rt-preview"]')!;
    btn.focus();
    btn.click();
    await settle(p);
    expect(p.el.querySelector('[data-testid="rt-preview-popup"] iframe')).not.toBeNull();
    expect(p.el.querySelector('[data-testid="rt-preview-spot"]')).toBeNull();
    p.el.querySelector<HTMLButtonElement>('[data-testid="rt-preview-close"]')!.click();
    await settle(p);
    expect(p.el.querySelector('[data-testid="rt-preview-popup"]')).toBeNull();
    expect(document.activeElement).toBe(btn);
    // From a warning: the long-names page with the spot outlined.
    (p.cmp as { pvStressUrl: { set(v: string): void } }).pvStressUrl.set('blob:stress');
    p.cmp.pvSpot.set(spots[1]);
    p.cmp.previewOpen.set(true);
    await settle(p);
    const spot = p.el.querySelector<HTMLElement>('[data-testid="rt-preview-spot"]')!;
    expect(spot).not.toBeNull();
    expect(parseFloat(spot.style.left)).toBeCloseTo(110 / 2.1, 1);
    expect(parseFloat(spot.style.top)).toBeCloseTo(52 / 2.97, 1);
  });

  it('Alt+P opens and closes the Preview', async () => {
    const p = make();
    p.cmp.rawPreviewUrl.set('blob:sample');
    await settle(p);
    document.dispatchEvent(new KeyboardEvent('keydown', { altKey: true, code: 'KeyP', key: 'p' }));
    await settle(p);
    expect(p.cmp.previewOpen()).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { altKey: true, code: 'KeyP', key: 'p' }));
    await settle(p);
    expect(p.cmp.previewOpen()).toBe(false);
  });
});
