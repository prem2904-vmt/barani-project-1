import { ChangeDetectionStrategy, Component, EventEmitter, HostBinding, HostListener, Input, Output } from '@angular/core';

export type TileTone = 'default' | 'solid' | 'violet' | 'pink' | 'emerald' | 'amber' | 'rose' | 'sky';
export type TilePadding = 'none' | 'sm' | 'md' | 'lg' | 'xl';

@Component({
  selector: 'pf-tile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content></ng-content>`,
  styles: [`
    :host {
      display: block;
      border-radius: 24px;
      border: 1px solid var(--card-border);
      background: var(--card-bg);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      position: relative;
      overflow: hidden;
      transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.25s ease, box-shadow 0.25s ease, background 0.25s ease;
    }

    :host([tone='solid']) {
      background: var(--bg-card-solid);
      border-color: var(--border-muted);
    }
    :host([tone='violet']) {
      background: linear-gradient(135deg, rgba(124, 58, 237, 0.18), rgba(124, 58, 237, 0.04));
      border-color: rgba(168, 85, 247, 0.28);
    }
    :host([tone='pink']) {
      background: linear-gradient(135deg, rgba(236, 72, 153, 0.18), rgba(236, 72, 153, 0.04));
      border-color: rgba(236, 72, 153, 0.28);
    }
    :host([tone='emerald']) {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.16), rgba(16, 185, 129, 0.04));
      border-color: rgba(16, 185, 129, 0.25);
    }
    :host([tone='amber']) {
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.16), rgba(245, 158, 11, 0.04));
      border-color: rgba(245, 158, 11, 0.25);
    }
    :host([tone='rose']) {
      background: linear-gradient(135deg, rgba(239, 68, 68, 0.14), rgba(239, 68, 68, 0.04));
      border-color: rgba(239, 68, 68, 0.25);
    }
    :host([tone='sky']) {
      background: linear-gradient(135deg, rgba(56, 189, 248, 0.16), rgba(56, 189, 248, 0.04));
      border-color: rgba(56, 189, 248, 0.25);
    }

    :host([data-pad='none']) { padding: 0; }
    :host([data-pad='sm'])   { padding: 0.875rem; }
    :host([data-pad='md'])   { padding: 1.25rem; }
    :host([data-pad='lg'])   { padding: 1.75rem; }
    :host([data-pad='xl'])   { padding: 2.25rem; }

    :host([data-clickable='true']) {
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    :host([data-clickable='true']:active) {
      transform: scale(0.99);
    }
    :host([data-clickable='true']:hover) {
      border-color: var(--card-hover-border);
      box-shadow: var(--shadow-md);
    }
  `]
})
export class TileComponent {
  @Input() @HostBinding('attr.tone') tone: TileTone = 'default';
  @Input() padding: TilePadding = 'md';
  @Input() clickable = false;

  @Output() tapped = new EventEmitter<Event>();

  @HostBinding('attr.data-pad')
  get padAttr(): TilePadding { return this.padding; }

  @HostBinding('attr.data-clickable')
  get clickableAttr(): string { return this.clickable ? 'true' : 'false'; }

  @HostListener('click', ['$event'])
  onHostClick(ev: Event): void {
    if (this.clickable) this.tapped.emit(ev);
  }
}
