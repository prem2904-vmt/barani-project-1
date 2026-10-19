import { Directive, ElementRef, OnDestroy, OnInit, computed, inject, input } from '@angular/core';
import { ZoomEndpoint, ZoomKeys, ZoomTransitionService, zoomKeys } from './zoom-transition';

/**
 * `[pfZoomSource]="[tube.sampleId]"` on any list tile / row that opens a
 * detail. A tap (click, Enter or Space anywhere inside it) arms the zoom for
 * the navigation it starts; a double tap is swallowed here, before the
 * component's own (click) handler runs. The tile is never named until the
 * zoom actually starts (zoom-transition.ts).
 */
@Directive({
  selector: '[pfZoomSource]',
  standalone: true,
  host: { '[attr.data-zoom-src]': 'firstKey()' },
})
export class ZoomSourceDirective implements OnInit, OnDestroy, ZoomEndpoint {
  readonly pfZoomSource = input<ZoomKeys>(null);
  readonly el = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
  private readonly zoom = inject(ZoomTransitionService);
  private readonly _keys = computed(() => zoomKeys(this.pfZoomSource()));
  protected readonly firstKey = computed(() => this._keys()[0] ?? null);
  keys(): string[] { return this._keys(); }

  private readonly onTap = (ev: Event): void => {
    if (ev.type === 'keydown') {
      const k = (ev as KeyboardEvent).key;
      if (k !== 'Enter' && k !== ' ') return;
      const tag = (ev.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    }
    if (!this.zoom.tap(this.el, this.keys())) {
      ev.stopImmediatePropagation();
      ev.preventDefault();
    }
  };

  ngOnInit(): void {
    // Capture phase on the host: runs before any (click) inside the tile.
    this.el.addEventListener('click', this.onTap, true);
    this.el.addEventListener('keydown', this.onTap, true);
    this.zoom.attachSource(this);
  }
  ngOnDestroy(): void {
    this.el.removeEventListener('click', this.onTap, true);
    this.el.removeEventListener('keydown', this.onTap, true);
    this.zoom.detachSource(this);
  }
}

/**
 * `[pfZoomTarget]="[sampleId]"` on the detail's main card AND on its loading
 * skeleton (render the skeleton while `zoom.holding()` too, so the named
 * element is never swapped mid-morph). Named only while a zoom runs.
 */
@Directive({
  selector: '[pfZoomTarget]',
  standalone: true,
  host: { '[attr.data-zoom-target]': 'firstKey()' },
})
export class ZoomTargetDirective implements OnInit, OnDestroy, ZoomEndpoint {
  readonly pfZoomTarget = input<ZoomKeys>(null);
  readonly el = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
  private readonly zoom = inject(ZoomTransitionService);
  private readonly _keys = computed(() => zoomKeys(this.pfZoomTarget()));
  protected readonly firstKey = computed(() => this._keys()[0] ?? '');
  keys(): string[] { return this._keys(); }

  ngOnInit(): void { this.zoom.attachTarget(this); }
  ngOnDestroy(): void { this.zoom.detachTarget(this); }
}
