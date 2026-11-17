import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output } from '@angular/core';
import { BusyDirective } from '../../directives/busy.directive';
import { SettingsSaveService } from '../../utils/settings-save';

/** The Save no longer sits at the bottom (band corner): floating banners need no clearance. Kept for callers. */
export function publishSavebarClearance(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--pf-savebar-clear', '0px');
}


/**
 * The Save of a settings card. Owner 2026-11-17 (supersedes the card-footer bar): Save lives in the band's TOP-RIGHT
 * corner — this component REGISTERS the card's save with SettingsSaveService and renders nothing; the band shows ONE
 * Save for the whole page (disabled until dirty) + Discard. Only without a band (unit fixtures) it renders in place.
 */
@Component({
  selector: 'pf-settings-savebar',
  standalone: true,
  imports: [BusyDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pf-ssb', '[class.pf-ssb--on]': '(dirty() || saving()) && !inBand()' },
  template: `
    @if (!inBand() && (dirty() || saving())) {
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
    :host { display: block; }
    :host(.pf-ssb--on) { position: sticky; bottom: 0; z-index: 3; }
    .pf-ssb__bar {
      display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex-wrap: wrap;
      margin: 12px 0 0; padding: 10px 0; border-top: 1px solid var(--pf-line);
      background: var(--pf-card-bg, var(--bg-card-solid));
    }
    .pf-ssb__state { margin-right: auto; display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text-secondary); }
    .pf-ssb__dot { width: 7px; height: 7px; border-radius: 999px; background: var(--color-violet-600, #7c3aed); }
    .pf-ssb__btn { height: 34px; min-height: 34px; padding: 0 14px; }
  `],
})
export class SettingsSavebarComponent {
  private readonly svc = inject(SettingsSaveService);
  /** A band on screen hosts the Save: nothing renders here. */
  readonly inBand = computed(() => this.svc.bands() > 0);

  readonly dirty = input(false);
  readonly saving = input(false);
  readonly canSave = input(true);
  readonly canDiscard = input(true);
  readonly label = input('Unsaved changes');
  readonly saveTestId = input('savebar-save');
  readonly save = output<void>();
  readonly discard = output<void>();

  private readonly reg = (() => {
    const off = this.svc.register({
      dirty: () => this.dirty(), saving: () => this.saving(), canSave: () => this.canSave(), canDiscard: () => this.canDiscard(),
      testId: () => this.saveTestId(), save: () => this.save.emit(), discard: () => this.discard.emit(),
    });
    inject(DestroyRef).onDestroy(off);
    return off;
  })();
}

/**
 * The band-corner Save (owner 2026-11-17): ONE per page, always present while the page has something to save —
 * disabled until dirty so it never jumps — with "Unsaved changes" + Discard (tertiary) beside it while dirty.
 * Rendered by every non-hosted pf-hero-band (the Settings shell / overview band, a full-screen page's own band).
 */
@Component({
  selector: 'pf-settings-save',
  standalone: true,
  imports: [BusyDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (svc.present()) {
      <div class="pf-ssv" data-testid="band-save">
        @if (svc.dirty() || svc.saving()) {
          <span class="pf-ssv__state" role="status" data-testid="unsaved-state"><span class="pf-ssv__dot" aria-hidden="true"></span>Unsaved changes</span>
          @if (svc.canDiscard()) {
            <button type="button" class="pf-btn pf-btn--tertiary pf-ssv__btn" data-testid="savebar-discard" [disabled]="svc.saving()" (click)="svc.discardAll()">Discard</button>
          }
        }
        <button type="button" class="pf-btn pf-btn--secondary pf-ssv__btn pf-ssv__save" [attr.data-testid]="svc.testId()"
                [disabled]="svc.saving() || !svc.canSave()" [pfBusy]="svc.saving()" pfBusyLabel="Saving…" (click)="svc.saveAll()">{{ svc.saving() ? 'Saving…' : 'Save' }}</button>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }
    .pf-ssv { display: inline-flex; align-items: center; gap: 8px; }
    .pf-ssv__state { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--text-secondary); white-space: nowrap; }
    .pf-ssv__dot { width: 7px; height: 7px; border-radius: 999px; background: var(--color-violet-600, #7c3aed); }
    .pf-ssv__btn { height: 38px; min-height: 38px; padding: 0 16px; }
    .pf-ssv__save { min-width: 84px; }
    @media (max-width: 640px) { .pf-ssv__state { display: none; } .pf-ssv__btn { height: 40px; min-height: 40px; padding: 0 12px; } }
  `],
})
export class SettingsSaveComponent {
  protected readonly svc = inject(SettingsSaveService);
}
