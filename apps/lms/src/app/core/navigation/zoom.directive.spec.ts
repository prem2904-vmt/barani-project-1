import { vi } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ZoomSourceDirective, ZoomTargetDirective } from './zoom.directive';
import { ZOOM_NAME, ZoomTransitionService } from './zoom-transition';

@Component({
  standalone: true,
  imports: [ZoomSourceDirective, ZoomTargetDirective],
  template: `
    <ul>
      @for (id of ids; track id) {
        <li [pfZoomSource]="id"><div class="main" (click)="opened.push(id)">{{ id }}</div></li>
      }
    </ul>
    @if (showTarget()) { <section [pfZoomTarget]="['ot-9', 's2']">card</section> }
  `,
})
class Host {
  ids = ['s1', 's2', 's3'];
  opened: string[] = [];
  readonly showTarget = signal(false);
}

function fakeTransition() {
  let finish!: () => void;
  return {
    info: { transition: {
      updateCallbackDone: new Promise<void>(() => {}), ready: new Promise<void>(() => {}),
      finished: new Promise<void>(r => (finish = r)), skipTransition: vi.fn(),
    } },
    finish: () => finish(),
  };
}

describe('[pfZoomSource] / [pfZoomTarget]', () => {
  let zoom: ZoomTransitionService;
  let clock = 1000;

  beforeEach(() => {
    vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
      return (this.isConnected ? [{}] : []) as unknown as DOMRectList;
    });
    zoom = TestBed.inject(ZoomTransitionService);
    zoom._reset();
    clock = 1000;
    zoom.now = () => clock;
  });
  afterEach(() => { document.documentElement.className = ''; vi.restoreAllMocks(); });

  function render() {
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    const tiles = Array.from(f.nativeElement.querySelectorAll('li')) as HTMLElement[];
    return { f, tiles };
  }

  it('marks tiles with a data attribute but names none of them at rest', () => {
    const { tiles } = render();
    expect(tiles.map(t => t.getAttribute('data-zoom-src'))).toEqual(['s1', 's2', 's3']);
    expect(tiles.every(t => t.style.getPropertyValue('view-transition-name') === '')).toBe(true);
  });

  it('a tap names ONLY the tapped tile when the zoom starts, and clears it afterwards', async () => {
    const { f, tiles } = render();
    (tiles[1].querySelector('.main') as HTMLElement).click();
    expect(f.componentInstance.opened).toEqual(['s2']);
    const t = fakeTransition();
    expect(zoom.onRouterTransition(t.info, '/lab/my-work', '/lab/sample/s2')).toBe(true);
    expect(tiles.map(el => el.style.getPropertyValue('view-transition-name'))).toEqual(['', ZOOM_NAME, '']);

    // The detail renders its target: it takes the name, the tile lets go.
    f.componentInstance.showTarget.set(true);
    f.detectChanges();
    const card = f.nativeElement.querySelector('section') as HTMLElement;
    expect(card.style.getPropertyValue('view-transition-name')).toBe(ZOOM_NAME);
    expect(tiles[1].style.getPropertyValue('view-transition-name')).toBe('');

    t.finish(); await new Promise(r => setTimeout(r, 0));
    expect(card.style.getPropertyValue('view-transition-name')).toBe('');
    expect(document.querySelectorAll('[data-pf-zoom-named]').length).toBe(0);
  });

  it('a double tap reaches the component ONCE (swallowed in the capture phase)', () => {
    const { f, tiles } = render();
    const main = tiles[0].querySelector('.main') as HTMLElement;
    main.click();
    clock += 120;
    main.click();
    expect(f.componentInstance.opened).toEqual(['s1']);
    clock += 1000;
    main.click();
    expect(f.componentInstance.opened).toEqual(['s1', 's1']);
  });

  it('a quick tap on ANOTHER tile right after is a misfire too', () => {
    const { f, tiles } = render();
    (tiles[0].querySelector('.main') as HTMLElement).click();
    clock += 100;
    (tiles[2].querySelector('.main') as HTMLElement).click();
    expect(f.componentInstance.opened).toEqual(['s1']);
  });

  it('Enter on a focused tile arms the zoom like a click', () => {
    const { tiles } = render();
    tiles[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(zoom.onRouterTransition(fakeTransition().info, '/lab/my-work', '/lab/sample/s3')).toBe(true);
    expect(tiles[2].style.getPropertyValue('view-transition-name')).toBe(ZOOM_NAME);
  });
});
