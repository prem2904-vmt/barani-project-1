import { Component, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TileGridDirective, tileColumns } from './tile-grid.directive';

@Component({
  standalone: true,
  imports: [TileGridDirective],
  template: `<ul [pfTileGrid]="on"><li>a</li><li>b</li><li>c</li></ul>`,
})
class Host { on = true; readonly grid = viewChild.required(TileGridDirective); }

describe('tileColumns — by container width, not window', () => {
  it('3 / 2 / 1 columns at the owner breakpoints', () => {
    expect(tileColumns(1280)).toBe(3);
    expect(tileColumns(1100)).toBe(3);
    expect(tileColumns(900)).toBe(2);
    expect(tileColumns(640)).toBe(2);
    expect(tileColumns(390)).toBe(1);
  });
});

describe('pfTileGrid — column class at three container widths', () => {
  let observed: ((w: number) => void) | null = null;
  beforeEach(() => {
    observed = null;
    (globalThis as any).ResizeObserver = class {
      constructor(private cb: (e: any[]) => void) { observed = (w: number) => this.cb([{ contentRect: { width: w } }]); }
      observe() {}
      disconnect() {}
    };
  });

  function render() {
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    TestBed.tick();
    return { f, ul: f.nativeElement.querySelector('ul') as HTMLElement };
  }

  it('wide pane → pf-tilegrid--c3', () => {
    const { f, ul } = render();
    observed!(1200); f.detectChanges();
    expect(ul.classList.contains('pf-tilegrid')).toBe(true);
    expect(ul.classList.contains('pf-tilegrid--c3')).toBe(true);
  });

  it('medium pane → pf-tilegrid--c2', () => {
    const { f, ul } = render();
    observed!(800); f.detectChanges();
    expect(ul.classList.contains('pf-tilegrid--c2')).toBe(true);
    expect(ul.classList.contains('pf-tilegrid--c3')).toBe(false);
  });

  it('phone-width pane → pf-tilegrid--c1', () => {
    const { f, ul } = render();
    observed!(1200); f.detectChanges();
    observed!(380); f.detectChanges();
    expect(ul.classList.contains('pf-tilegrid--c1')).toBe(true);
    expect(ul.getAttribute('data-cols')).toBe('1');
  });
});

describe('pfTileGrid — off (classic)', () => {
  it('adds no grid classes when disabled', () => {
    (globalThis as any).ResizeObserver = class { observe() {} disconnect() {} };
    const f = TestBed.createComponent(Host);
    f.componentInstance.on = false;
    f.detectChanges();
    const ul = f.nativeElement.querySelector('ul') as HTMLElement;
    expect(ul.classList.contains('pf-tilegrid')).toBe(false);
    expect(ul.hasAttribute('data-cols')).toBe(false);
  });
});
