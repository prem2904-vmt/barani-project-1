import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { AuthService } from '../../../core/auth/auth.service';
import { SetPinDialogService } from '../../../core/services/set-pin-dialog.service';
import { PinDotsComponent } from '../pin-dots.component';

/**
 * Set / change the switch-unlock PIN as a real dialog (OPS-107: the inline
 * popover form never raised the keypad on iPad). Same card language as
 * `pf-dialog-host`. PIN entry is the app's own `pf-pin-dots` (type=tel +
 * inputmode=numeric, 16px so iOS never zooms) - a visible-size 4-dot row
 * whose whole area is the tap target. The server call is unchanged
 * (`auth.setPin(new, current?)`).
 */
@Component({
  selector: 'pf-set-pin-dialog',
  standalone: true,
  imports: [PinDotsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (svc.isOpen()) {
      <div class="pf-sp-root" role="dialog" aria-modal="true" [attr.aria-label]="title()" data-set-pin>
        <div class="pf-sp-backdrop" (click)="cancel()"></div>
        <div class="pf-sp-card">
          <header class="pf-sp-head">
            <span class="pf-sp-icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            </span>
            <div class="pf-sp-text">
              <h2 class="pf-sp-title">{{ title() }}</h2>
              <p class="pf-sp-msg">Four digits. It unlocks this screen and switches between profiles on this device.</p>
            </div>
          </header>

          @if (hasPin()) {
            <p class="pf-sp-lbl" id="pf-sp-cur">Current PIN</p>
            <div class="pf-sp-field" [class.is-on]="step() === 'current'" data-pin-current>
              <pf-pin-dots #cur [autofocus]="false" [disabled]="busy()"
                           (completed)="onCurrent($event)" />
            </div>
          }
          <p class="pf-sp-lbl" id="pf-sp-new">{{ hasPin() ? 'New PIN' : 'PIN' }}</p>
          <div class="pf-sp-field" [class.is-on]="step() === 'new'" data-pin-new>
            <pf-pin-dots #nxt [autofocus]="false" [disabled]="busy()"
                         (completed)="onNew($event)" />
          </div>

          @if (error()) { <p class="pf-sp-err" role="alert">{{ error() }}</p> }

          <footer class="pf-sp-actions">
            <button type="button" class="pf-btn pf-btn--secondary" (click)="cancel()" [disabled]="busy()">Cancel</button>
            <button type="button" class="pf-btn pf-btn--primary" data-set-pin-save (click)="save()" [disabled]="busy() || !ready()">
              @if (saved()) {
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                Saved
              } @else { {{ busy() ? 'Saving…' : 'Save PIN' }} }
            </button>
          </footer>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }
    .pf-sp-root { position: fixed; inset: 0; z-index: 85; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .pf-sp-backdrop { position: absolute; inset: 0; background: rgba(5, 5, 15, 0.72); backdrop-filter: blur(14px) saturate(1.2); -webkit-backdrop-filter: blur(14px) saturate(1.2); }
    .pf-sp-card { position: relative; width: 100%; max-width: 24rem; padding: 24px 24px 20px; border-radius: 20px; background: var(--bg-card-solid); border: 1px solid var(--glass-border); box-shadow: 0 30px 70px rgba(0, 0, 0, 0.45); }
    .pf-sp-head { display: flex; align-items: flex-start; gap: 14px; }
    .pf-sp-icon { flex: none; width: 40px; height: 40px; display: inline-flex; align-items: center; justify-content: center; border-radius: 12px; background: var(--violet-bg, rgba(124, 58, 237, 0.12)); color: var(--violet-text); }
    .pf-sp-text { min-width: 0; }
    .pf-sp-title { margin: 0; font-size: 16px; font-weight: 600; color: var(--text-primary); }
    .pf-sp-msg { margin: 6px 0 0; font-size: 13.5px; line-height: 1.5; color: var(--text-secondary); }
    .pf-sp-lbl { margin: 18px 0 6px; font-size: 12.5px; font-weight: 600; color: var(--text-secondary); }
    /* Visible-size, full-width tap target (44px+): the dots row is the field. */
    .pf-sp-field { display: flex; justify-content: center; min-height: 56px; align-items: center; border-radius: 12px; background: var(--glass-bg); border: 1px solid var(--glass-border); }
    .pf-sp-field.is-on { border-color: var(--violet-text); }
    .pf-sp-err { margin: 12px 0 0; font-size: 13px; color: var(--red-text); }
    .pf-sp-actions { margin-top: 20px; display: flex; justify-content: flex-end; gap: 8px; }
    .pf-sp-actions .pf-btn { min-height: 44px; }
  `],
})
export class SetPinDialogComponent {
  protected readonly svc = inject(SetPinDialogService);
  private readonly auth = inject(AuthService);

  private readonly cur = viewChild<PinDotsComponent>('cur');
  private readonly nxt = viewChild<PinDotsComponent>('nxt');

  protected readonly hasPin = computed(() => !!this.auth.user()?.hasPin);
  protected readonly title = computed(() => (this.hasPin() ? 'Change PIN' : 'Set a 4-digit PIN'));
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly saved = signal(false);
  protected readonly step = signal<'current' | 'new'>('new');
  /** What the two fields hold NOW (a backspace after the 4th digit un-readies Save). */
  private readonly curVal = computed(() => this.cur()?.value() ?? '');
  private readonly newVal = computed(() => this.nxt()?.value() ?? '');
  protected readonly ready = computed(() =>
    /^\d{4}$/.test(this.newVal()) && (!this.hasPin() || /^\d{4}$/.test(this.curVal())));

  constructor() {
    this.svc.focusHook = () => this.focusFirst();
    // Every open starts clean.
    effect(() => {
      if (!this.svc.isOpen()) return;
      untracked(() => {
        this.busy.set(false); this.error.set(null); this.saved.set(false);
        this.step.set(this.hasPin() ? 'current' : 'new');
      });
    });
  }

  /** Called synchronously from the opening tap (see SetPinDialogService.open). */
  focusFirst(): void {
    (this.hasPin() ? this.cur() : this.nxt())?.focus();
  }

  protected onCurrent(_pin: string): void {
    this.step.set('new');
    this.nxt()?.focus();   // still inside the typing gesture: the keypad stays up
  }
  protected onNew(_pin: string): void { this.error.set(null); }

  protected async save(): Promise<void> {
    if (this.busy()) return;
    const fresh = this.newVal(), current = this.curVal();
    if (!/^\d{4}$/.test(fresh)) { this.error.set('PIN must be exactly 4 digits.'); return; }
    if (this.hasPin() && !/^\d{4}$/.test(current)) { this.error.set('Enter your current PIN first.'); return; }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.setPin(fresh, this.hasPin() ? current : undefined);
      this.saved.set(true);
      setTimeout(() => this.svc.close(), 800);
    } catch (e) {
      this.error.set((e as Error).message || 'Could not update the PIN.');
      this.busy.set(false);
      this.nxt()?.clear();
      this.step.set('new');
    }
  }

  protected cancel(): void { if (!this.busy()) this.svc.close(); }

  @HostListener('document:keydown.escape')
  onEscape(): void { if (this.svc.isOpen()) this.cancel(); }
}
