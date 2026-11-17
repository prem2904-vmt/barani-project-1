import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterRenderEffect, inject, input, output } from '@angular/core';
import { BusyDirective } from '../../directives/busy.directive';

/** Every Save bar on screen; the clearance floating things (the Bridge-nearby banner) keep above them. */
const SHOWN = new Set<HTMLElement>();
/** Publishes `--pf-savebar-clear` on <html>: the distance from the viewport's bottom to the top of the highest visible
 *  Save bar (+8px), 0 when none shows. Floating banners add it to their bottom so they never cover Save / Discard. */
export function publishSavebarClearance(): void {
  if (typeof document === 'undefined') return;
  let clear = 0;
  for (const el of SHOWN) {
    const r = el.getBoundingClientRect();
    if (r.height > 0) clear = Math.max(clear, Math.round(window.innerHeight - r.top + 8));
  }
  document.documentElement.style.setProperty('--pf-savebar-clear', `${clear}px`);
}


/**
 * The Save of a settings card, IN the card (owner 2026-11-17: no button in the band's corner): a sticky bar at the
 * card's bottom — "Unsaved changes · Discard · Save" — shown only while something changed. Save is a SECONDARY button,
 * Discard a tertiary one (Settings use no violet primary). Autosave cards do not use it.
 */
@Component({
  selector: 'pf-settings-savebar',
  standalone: true,
  imports: [BusyDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pf-ssb', '[class.pf-ssb--on]': 'dirty() || saving()' },
  template: `
    @if (dirty() || saving()) {
      <div class="pf-ssb__bar" role="status" data-testid="unsaved-state">
        <span class="pf-ssb__state"><span class="pf-ssb__dot" aria-hidden="true"></span>{{ label() }}</span>
        @if (canDiscard()) {
          <button type="button" class="pf-btn pf-btn--tertiary pf-ssb__btn" data-testid="savebar-discard" [disabled]="saving()" (click)="discard.emit()">Discard</button>
        }
        <button type="button" class="pf-btn pf-btn--secondary pf-ssb__btn" [attr.data-testid]="saveTestId()" [disabled]="saving() || !canSave()"
                [pfBusy]="saving()" pfBusyLabel="Saving…" (click)="save.emit()">{{ saving() ? 'Saving…' : 'Save' }}</button>
      </div>
    }
  `,
  styles: [`
    :host { display: block; position: sticky; bottom: 0; z-index: 3; }
    .pf-ssb__bar {
      display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex-wrap: wrap;
      margin: 12px -24px -24px; padding: 10px 24px; border-top: 1px solid var(--pf-line);
      background: var(--pf-card-bg, var(--bg-card-solid));
    }
    .pf-ssb__state { margin-right: auto; display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text-secondary); }
    .pf-ssb__dot { width: 7px; height: 7px; border-radius: 999px; background: var(--color-violet-600, #7c3aed); }
    .pf-ssb__btn { height: 34px; min-height: 34px; padding: 0 14px; }
    @media (max-width: 767px) { .pf-ssb__bar { margin: 12px -14px -16px; padding: 10px 14px; } }
  `],
})
export class SettingsSavebarComponent {
  private readonly el = inject(ElementRef<HTMLElement>);
  private readonly publish = afterRenderEffect(() => {
    const on = this.dirty() || this.saving();
    const bar = (this.el.nativeElement as HTMLElement).querySelector<HTMLElement>('.pf-ssb__bar');
    if (on && bar) SHOWN.add(bar); else for (const b of [...SHOWN]) if (!b.isConnected || this.el.nativeElement.contains(b)) SHOWN.delete(b);
    publishSavebarClearance();
  });
  private readonly cleanup = (() => {
    const onResize = () => publishSavebarClearance();
    if (typeof window !== 'undefined') window.addEventListener('resize', onResize);
    inject(DestroyRef).onDestroy(() => {
      for (const b of [...SHOWN]) if (this.el.nativeElement.contains(b) || !b.isConnected) SHOWN.delete(b);
      publishSavebarClearance();
      if (typeof window !== 'undefined') window.removeEventListener('resize', onResize);
    });
  })();

  readonly dirty = input(false);
  readonly saving = input(false);
  readonly canSave = input(true);
  readonly canDiscard = input(true);
  readonly label = input('Unsaved changes');
  readonly saveTestId = input('savebar-save');
  readonly save = output<void>();
  readonly discard = output<void>();
}
