import { renderBandPage } from '../admin-band.spec-helpers';
import { ProcessBuilderComponent } from './process-builder.component';

/**
 * Process builder — current ND rules: ONE primary (Save) in the band, the
 * lane / active / dirty marks in the palette (no green / sky lane colours),
 * slate role=switch toggles, SVG icons instead of ⠿ ‹ › × glyphs.
 */
describe('Process builder — ND audit', () => {
  const cfg = {
    categories: [{ id: 'c1', name: 'Front desk', icon: 'desk', color: '#0ea5e9', order: 0 }],
    actions: [{ id: 'a1', type: 'register_patient', categoryId: 'c1', enabled: true, order: 0 }],
  };
  const wfs = [{ id: 'w1', name: 'Main', isActive: true, branchId: null, configJson: JSON.stringify(cfg) }];
  const make = () => renderBandPage(ProcessBuilderComponent, {
    getFor: (u) => (u.startsWith('/api/process-workflows') ? wfs : []),
  });

  it('one primary, in the band', () => {
    const p = make();
    expect(p.el.querySelectorAll('.pf-hb-btn--primary, .nd-btn--primary').length).toBe(1);
    expect(p.el.querySelector('pf-hero-band .pf-hb__actions .pf-hb-btn--primary')).not.toBeNull();
  });

  it('lanes ignore saved decorative colours; active = neutral chip with a violet check', () => {
    const p = make();
    p.f.detectChanges();
    const html = p.el.querySelector('.pf-band-body')!.innerHTML;
    expect(html).not.toMatch(/#0ea5e9|#10b981|#6ee7b7|rgb\(14, 165, 233\)/i);
    const active = p.el.querySelector('.pb-active');
    if (active) {
      expect(active.classList.contains('nd-chip')).toBe(true);
      expect(active.querySelector('svg')).not.toBeNull();
    }
  });

  it('action toggles are slate switches; no glyph icons', () => {
    const p = make();
    p.f.detectChanges();
    const body = p.el.querySelector('.pf-band-body')!;
    body.querySelectorAll('.pb-toggle').forEach(t => {
      expect(t.classList.contains('nd-toggle')).toBe(true);
      expect(t.getAttribute('role')).toBe('switch');
    });
    expect(/[⠿‹›×＋●]/.test(body.textContent ?? '')).toBe(false);
  });

  it('no per-lane colour setting: no colour input / recolour, and a new lane is the primary colour', () => {
    const p = make();
    p.f.detectChanges();
    expect(p.el.querySelector('input[type="color"], .pb-color')).toBeNull();
    expect(typeof (p.cmp as any).recolor).toBe('undefined');
    const before = (p.cmp as any).lanes().length;
    (p.cmp as any).addCategory();
    (p.cmp as any).addCategory();
    const lanes = (p.cmp as any).lanes();
    expect(lanes.length).toBe(before + 2);
    expect(lanes.slice(-2).map((l: any) => l.cat.color)).toEqual(['#7c3aed', '#7c3aed']);
  });
});
