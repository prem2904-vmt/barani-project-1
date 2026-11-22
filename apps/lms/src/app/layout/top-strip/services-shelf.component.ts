import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { ActionsMenuComponent, ActionsMenuTriggerDirective, PfAction } from '../../shared/components/actions-menu/actions-menu.component';
import { ServiceShelfService } from '../../core/services/service-shelf.service';
import { ServiceChip, ServiceFilter } from '../../core/services/service-shelf';
import { draftCap, draftSplit } from './draft-tray';

/**
 * Frontdesk "Services" shelf on the docked bottom bar (owner 2026-11-19). The Lab Drafts shelf's pattern, copied:
 * after the work areas' hairline, a quiet "Services" label, then compact chips "All 23 · Lab 11 · OPD 7 …"
 * (draftCap / draftSplit decide how many sit inline; the rest go behind a "+N" pf-actions-menu). The selected chip
 * takes the draft chip's aria-current look; a small rose dot = late items in that service. Same `pf-draftshelf*`
 * classes and the same one stylesheet (`_shelf.scss`), so the two shelves can never drift apart.
 *
 * Rendered by the top strip only while ServiceShelfService.visible() — the Frontdesk area, 2+ services. Hidden below
 * 768px with the drafts (the shared stylesheet). A pick filters BOTH Frontdesk panels.
 */
@Component({
  selector: 'pf-services-shelf',
  standalone: true,
  imports: [ActionsMenuComponent, ActionsMenuTriggerDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @let split = chipSplit();
    <div class="pf-draftshelf pf-svcshelf" role="radiogroup" aria-label="Services" data-testid="services-shelf">
      @if (split.shown.length) {
        <span class="pf-draftshelf__head" aria-hidden="true"><span class="pf-draftshelf__head-t">Services</span></span>
        <div class="pf-draftshelf__scroll">
          @for (c of split.shown; track c.id) {
            <button type="button" role="radio" class="pf-draftshelf__chip pf-svcshelf__chip press"
              [attr.aria-checked]="c.selected" [attr.aria-current]="c.selected ? 'true' : null"
              [attr.data-service]="c.id" [attr.aria-label]="chipLabel(c)" [title]="chipLabel(c)"
              (click)="pick(c.id)">
              @if (c.late) { <span class="pf-draftshelf__dot pf-svcshelf__late" aria-hidden="true"></span> }
              <span class="pf-draftshelf__lbl">{{ c.label }}</span>
              <span class="pf-svcshelf__n">{{ c.n }}</span>
            </button>
          }
        </div>
      }
      @if (split.more) {
        <pf-actions-menu class="pf-draftshelf__menu" [actions]="menu()" heading="Services" [checkCurrent]="true"
          (action)="pick($any($event))">
          <button pfActionsTrigger type="button" class="pf-draftshelf__chip pf-draftshelf__more press"
            [attr.data-current]="selectedInOverflow() ? 'true' : null"
            [attr.aria-label]="split.shown.length ? 'More services — ' + split.more : 'Services — ' + split.more"
            [title]="'All services (' + chips().length + ')'">
            @if (split.shown.length) {
              <span class="pf-draftshelf__lbl">+{{ split.more }}</span>
            } @else {
              <span class="pf-draftshelf__more-t">Services</span>
              <span class="pf-draftshelf__lbl">{{ split.more }}</span>
            }
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6" /></svg>
          </button>
        </pf-actions-menu>
      }
    </div>
  `,
  styleUrl: './services-shelf.component.scss',
})
export class ServicesShelfComponent {
  readonly shelf = inject(ServiceShelfService);
  /** Viewport width from the bar (its draftCap rule). */
  readonly viewportW = input(1440);

  readonly chips = this.shelf.chips;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  /** Measured fit — the Drafts shelf's rule: the width cap is the ceiling, then one chip is dropped at a time while
   *  the chips overflow (0 = collapse to "Services N"). Null = not measured yet. */
  private readonly fit = signal<number | null>(null);
  private readonly _refit = effect(() => {
    this.chips().length;
    this.viewportW();
    untracked(() => { this.fit.set(null); this.fitSoon(); });
  });
  readonly chipSplit = computed(() => {
    const fit = this.fit();
    return draftSplit(this.chips(), Math.min(draftCap(this.viewportW()) + 1, fit ?? Infinity), fit !== null);
  });
  private fitSoon(): void {
    afterNextRender(() => {
      const box = this.host.nativeElement.querySelector('.pf-draftshelf__scroll') as HTMLElement | null;
      if (!box) return;
      const cap = this.chipSplit().shown.length;
      if (box.scrollWidth > box.clientWidth + 1 && cap > 0) { this.fit.set(cap - 1); this.fitSoon(); }
    }, { injector: this.injector });
  }
  readonly selectedInOverflow = computed(() => {
    const shown = this.chipSplit().shown;
    return this.chips().some(c => c.selected) && !shown.some(c => c.selected);
  });
  readonly menu = computed<PfAction[]>(() => this.chips().map(c => ({
    id: c.id, label: `${c.label} · ${c.n}`, current: c.selected, hint: c.late ? 'Someone is waiting long' : undefined,
  })));

  chipLabel(c: ServiceChip): string {
    const what = c.id === 'all' ? 'All services' : c.label;
    return `${what}, ${c.n}${c.late ? ', someone is waiting long' : ''}${c.selected ? ' (showing)' : ''}`;
  }

  pick(id: ServiceFilter): void { this.shelf.select(id); }
}
