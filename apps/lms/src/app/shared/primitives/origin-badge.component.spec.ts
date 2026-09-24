import { TestBed } from '@angular/core/testing';
import { OriginBadgeComponent, originBadgeElement } from './origin-badge.component';

describe('OriginBadge — Master / Customised / Branch / Own test', () => {
  it('component renders the label with an SVG glyph and the origin modifier class', () => {
    const f = TestBed.createComponent(OriginBadgeComponent);
    f.componentRef.setInput('origin', 'customised');
    f.detectChanges();
    const pill = (f.nativeElement as HTMLElement).querySelector('.pf-origin-badge');
    expect(pill?.textContent?.trim()).toBe('Customised');
    expect(pill?.classList.contains('pf-origin-badge--customised')).toBe(true);
    expect(pill?.querySelector('svg path')).not.toBeNull();
  });

  it('renders nothing without an origin', () => {
    const f = TestBed.createComponent(OriginBadgeComponent);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('.pf-origin-badge')).toBeNull();
  });

  it('grid DOM builder renders the identical pill', () => {
    const el = originBadgeElement('local');
    expect(el.className).toBe('pf-origin-badge pf-origin-badge--local');
    expect(el.textContent).toBe('Own test');
    expect(el.querySelector('svg')).not.toBeNull();
    expect(originBadgeElement(null).textContent).toBe('');
  });
});
