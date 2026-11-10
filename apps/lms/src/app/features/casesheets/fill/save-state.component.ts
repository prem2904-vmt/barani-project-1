import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { PfIconComponent } from '@prefrontal/forms-engine';

export type SaveState = 'saved' | 'pending' | 'saving' | 'offline' | 'error' | 'conflict' | 'final';

/**
 * The band's save cue (plan §6): "Saved ✓ / Saving… / Offline — saved on
 * this tablet". Neutral words, a violet check when saved (PF-PATTERN
 * `.pf-savestate`). A conflict is a button: tap to choose whose copy wins.
 */
@Component({
  selector: 'app-save-state',
  standalone: true,
  imports: [PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state() === 'conflict') {
      <button type="button" class="pf-btn pf-btn--secondary ss-conflict" (click)="resolve.emit()">
        <pf-icon name="alert" [size]="18" /> Changed on another device
      </button>
    } @else {
      <span class="pf-savestate" role="status" aria-live="polite" [attr.data-save]="state()">
        @switch (state()) {
          @case ('saved') {
            <pf-icon name="check" [size]="16" [stroke]="2.4" />
          }
          @case ('offline') {
            <pf-icon name="cloud-off" [size]="16" />
          }
          @case ('error') {
            <pf-icon name="refresh" [size]="16" />
          }
          @case ('final') {
            <pf-icon name="lock" [size]="16" />
          }
          @default {
            <span class="pf-savestate__dot"></span>
          }
        }
        <span class="pf-savestate__text">{{ text() }}</span>
      </span>
    }
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
      }
      .pf-savestate {
        font-size: 13.5px;
      }
      .ss-conflict {
        white-space: normal;
        text-align: left;
      }
    `,
  ],
})
export class SaveStateComponent {
  readonly state = input<SaveState>('saved');
  readonly resolve = output<void>();
  protected readonly text = computed(
    () =>
      ({
        saved: 'Saved',
        pending: 'Saving…',
        saving: 'Saving…',
        offline: 'Offline — saved on this tablet',
        error: 'Not saved yet — trying again',
        conflict: '',
        final: 'Finished',
      })[this.state()],
  );
}
