import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HeroBandComponent } from '../../shared/components/hero-band/hero-band.component';
import { ScreenHeaderComponent } from '../../shared/primitives/screen-header.component';
import { PasskeyIconComponent } from '../../shared/primitives/passkey-icon.component';
import { BusyComponent } from '../../shared/primitives/skeleton-kit.component';
import { ThemeService } from '../../core/services/theme.service';
import { DialogService } from '../../core/services/dialog.service';
import { ToastService } from '../../core/services/toast.service';
import { PasskeyItem, PasskeyService } from '../../core/auth/passkey.service';
import { PasskeyError, passkeyErrorText } from '../../core/auth/passkey-webauthn';
import { LAB_TIME_ZONE } from '../../shared/utils/lab-clock';

/** "12 Oct 2026" in IST (store UTC, show IST). */
export function passkeyDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: LAB_TIME_ZONE }).format(d);
}

/** The words under a passkey's name: "Added 12 Oct 2026 · Last used 30 Oct 2026". */
export function passkeyMeta(p: PasskeyItem): string {
  const added = passkeyDate(p.createdAt);
  const used = passkeyDate(p.lastUsedAt);
  return [added && `Added ${added}`, used ? `Last used ${used}` : 'Not used yet'].filter(Boolean).join(' · ');
}

/**
 * Account → Passkeys (`/security`). Add a passkey on THIS device (web only),
 * see every passkey on the account, rename, remove (DialogService confirm).
 * Shared-PC rule: the helper says in plain words not to add one on a shared
 * computer login. Hidden entirely while the `passkeys` beta is off.
 */
@Component({
  selector: 'pf-passkeys',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HeroBandComponent, ScreenHeaderComponent, PasskeyIconComponent, BusyComponent],
  template: `
    <section class="pf-band-page mx-auto w-full max-w-2xl px-4 py-4">
      @if (theme.isNewDesign()) {
        <pf-hero-band [back]="true" [tabsOnly]="true">
          <ng-container band-tools>
            <span class="pk-ctx">
              <span class="pf-band-chip"><pf-passkey-icon [size]="14"></pf-passkey-icon>Passkeys</span>
              @if (enabled() && !loading()) {
                <span class="pf-band-chip"><strong>{{ items().length }}</strong>&nbsp;on your account</span>
              }
            </span>
          </ng-container>
          <ng-container band-actions>
            @if (enabled() && canAdd()) {
              <button type="button" class="pf-hb-btn pf-hb-btn--primary press" data-testid="passkey-add-band"
                      [disabled]="adding()" (click)="add()" aria-label="Add a passkey" title="Add a passkey">
                <pf-passkey-icon [size]="15"></pf-passkey-icon>{{ adding() ? 'Adding…' : 'Add a passkey' }}
              </button>
            }
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only" title="Passkeys"
        subtitle="Sign in with this device's fingerprint, face or screen lock instead of your password.">
      </pf-screen-header>

      <div class="pf-band-body">
        <div class="pk-col">
          @if (!enabled()) {
            <div class="pf-card pk-card">
              <div class="pf-card__body"><p class="pk-muted" role="status">Passkeys aren't available here.</p></div>
            </div>
          } @else {
            <div class="pf-card pk-card">
              <div class="pf-card__head">
                <span class="pf-card__icon" aria-hidden="true"><pf-passkey-icon [size]="16"></pf-passkey-icon></span>
                <span class="pf-card__label">Passkeys</span>
                <span class="pf-card__spacer"></span>
                @if (items().length) { <span class="pk-count">{{ items().length }}</span> }
              </div>
              <div class="pf-card__body">
                <p class="pk-lead">
                  A passkey lets you sign in with this device's fingerprint, face or screen lock — no password to type.
                  Your fingerprint or face never leaves the device.
                </p>
                <p class="pk-warn" data-testid="passkey-shared-warning">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>
                  <span>Only add a passkey on a device that is yours. Don't add one on a shared lab computer or a shared computer login — anyone who can unlock that computer could sign in as you, and the audit trail would show your name.</span>
                </p>

                @if (!canAdd()) {
                  <p class="pk-muted" data-testid="passkey-add-unavailable">{{ unavailableText() }}</p>
                }

                @if (loading()) {
                  <p class="pk-muted pk-loading" role="status"><pf-busy label="Loading your passkeys…"></pf-busy> Loading your passkeys…</p>
                } @else if (loadError()) {
                  <p class="pk-error" role="alert">{{ loadError() }}</p>
                  <button type="button" class="pf-btn pf-btn--secondary" (click)="reload()">Try again</button>
                } @else if (!items().length) {
                  <div class="pk-empty" data-testid="passkey-empty">
                    <p class="pk-empty__title">No passkeys yet</p>
                    <p class="pk-muted">You sign in with your password. Add a passkey to sign in faster on this device.</p>
                  </div>
                } @else {
                  <ul class="pk-list" aria-label="Your passkeys">
                    @for (p of items(); track p.id) {
                      <li class="pk-row" data-testid="passkey-row">
                        <span class="pk-row__icon" aria-hidden="true"><pf-passkey-icon [size]="18"></pf-passkey-icon></span>
                        <span class="pk-row__text">
                          <span class="pk-row__name">{{ p.friendlyName || 'Passkey' }}</span>
                          <span class="pk-row__meta">{{ meta(p) }}</span>
                        </span>
                        <span class="pk-row__actions">
                          <button type="button" class="pf-btn pf-btn--quiet pk-act" [disabled]="busyId() === p.id"
                                  (click)="rename(p)" [attr.aria-label]="'Rename ' + (p.friendlyName || 'passkey')">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                            <span class="pk-act__lbl">Rename</span>
                          </button>
                          <button type="button" class="pf-btn pf-btn--danger pk-act" data-testid="passkey-remove" [disabled]="busyId() === p.id"
                                  (click)="remove(p)" [attr.aria-label]="'Remove ' + (p.friendlyName || 'passkey')">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
                            <span class="pk-act__lbl">Remove</span>
                          </button>
                        </span>
                      </li>
                    }
                  </ul>
                }

                @if (addError()) { <p class="pk-error" role="alert">{{ addError() }}</p> }
              </div>
              @if (canAdd()) {
                <div class="pf-card__foot" [class.pf-classic-only]="theme.isNewDesign()">
                  <button type="button" class="pf-btn pf-btn--primary pf-span" data-testid="passkey-add"
                          [disabled]="adding()" (click)="add()">
                    <pf-passkey-icon [size]="16"></pf-passkey-icon>{{ adding() ? 'Waiting for your passkey…' : 'Add a passkey on this device' }}
                  </button>
                </div>
              }
            </div>
          }
        </div>
      </div>
    </section>
  `,
  styles: [`
    .pk-ctx { display: flex; align-items: center; gap: 8px; min-width: 0; padding-inline: 6px; }
    .pk-ctx .pf-band-chip { display: inline-flex; align-items: center; gap: 6px; }
    .pk-col { max-width: 42rem; margin-inline: auto; width: 100%; }
    .pk-card { overflow: visible; }
    .pk-count { font-size: 12.5px; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
    .pk-lead { margin: 0; font-size: 13.5px; line-height: 1.5; color: var(--text-secondary); }
    .pk-warn { display: flex; gap: 8px; align-items: flex-start; margin: 0; padding: 10px 12px; border-radius: 12px;
      font-size: 13px; line-height: 1.5; color: var(--text-secondary);
      background: color-mix(in srgb, var(--amber-text, #b45309) 7%, var(--pf-card-bg));
      border: 1px solid color-mix(in srgb, var(--amber-text, #b45309) 28%, transparent); }
    .pk-warn svg { flex: none; margin-top: 2px; color: var(--amber-text, #b45309); }
    .pk-muted { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-tertiary); }
    .pk-loading { display: flex; align-items: center; gap: 8px; }
    .pk-error { margin: 0; font-size: 13.5px; color: var(--red-text, #dc2626); }
    .pk-empty { padding: 14px 2px 4px; }
    .pk-empty__title { margin: 0 0 4px; font-size: 14px; font-weight: 600; color: var(--text-primary); }
    .pk-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .pk-row { display: flex; align-items: center; gap: 12px; padding: 12px 2px; border-top: 1px solid var(--pf-line); }
    .pk-row:first-child { border-top: 0; }
    .pk-row__icon { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; flex: none;
      border-radius: 10px; background: var(--pf-chip-bg, color-mix(in srgb, var(--text-primary) 6%, transparent)); color: var(--text-secondary); }
    .pk-row__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
    .pk-row__name { font-size: 14px; font-weight: 500; color: var(--text-primary); overflow-wrap: anywhere; }
    .pk-row__meta { font-size: 12.5px; color: var(--text-tertiary); }
    .pk-row__actions { display: flex; gap: 8px; flex: none; }
    .pk-act { height: 36px; min-height: 36px; padding: 0 10px; gap: 6px; }
    :host-context(html.device-touch) .pk-act { height: 44px; min-height: 44px; width: 44px; padding: 0; }
    :host-context(html.device-touch) .pk-act__lbl { display: none; }
    @media (max-width: 480px) {
      .pk-act { width: 44px; height: 44px; min-height: 44px; padding: 0; }
      .pk-act__lbl { display: none; }
    }
  `],
})
export class PasskeysComponent {
  protected readonly theme = inject(ThemeService);
  private readonly passkeys = inject(PasskeyService);
  private readonly dialog = inject(DialogService);
  private readonly toasts = inject(ToastService);

  /** Beta `passkeys` on (dev only, console switch). */
  readonly enabled = computed(() => this.passkeys.enabled());
  /** Adding works only in a supporting browser on an allowed host (not Electron / phone apps). */
  readonly canAdd = computed(() => this.passkeys.available());
  readonly unavailableText = computed(() => {
    const r = this.passkeys.availability().reason;
    if (r === 'desktop') return 'To add a passkey, open Prefrontal in your own web browser (Chrome, Safari or Edge). The desktop lab app uses passwords.';
    if (r === 'native') return 'Adding a passkey in the phone app is coming later. For now, add one from your web browser.';
    return 'This browser or address can’t add a passkey. Open Prefrontal in Chrome, Safari or Edge at your lab’s usual address.';
  });

  readonly items = signal<PasskeyItem[]>([]);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly adding = signal(false);
  readonly addError = signal<string | null>(null);
  readonly busyId = signal<string | null>(null);

  constructor() {
    if (this.passkeys.enabled()) void this.reload();
  }

  meta(p: PasskeyItem): string { return passkeyMeta(p); }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.items.set(await this.passkeys.list());
    } catch (e) {
      this.loadError.set(e instanceof PasskeyError && e.kind !== 'failed' ? e.message : 'Couldn’t load your passkeys. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }

  async add(): Promise<void> {
    if (this.adding() || !this.canAdd()) return;
    this.adding.set(true);
    this.addError.set(null);
    try {
      const item = await this.passkeys.register();
      this.items.update(list => [...list.filter(p => p.id !== item.id), item]);
      this.toasts.success('Passkey added. Next time, choose “Sign in with a passkey”.');
    } catch (e) {
      const kind = e instanceof PasskeyError ? e.kind : 'failed';
      this.addError.set(passkeyErrorText(kind, 'add'));
    } finally {
      this.adding.set(false);
    }
  }

  async rename(p: PasskeyItem): Promise<void> {
    const name = await this.dialog.prompt({
      title: 'Rename passkey',
      message: 'A name that tells you which device this is, like “My laptop”.',
      initialValue: p.friendlyName ?? '',
      placeholder: 'Passkey name',
      confirmLabel: 'Save',
      required: true,
    });
    const trimmed = name?.trim();
    if (!trimmed || trimmed === p.friendlyName) return;
    this.busyId.set(p.id);
    try {
      const updated = await this.passkeys.rename(p.id, trimmed);
      this.items.update(list => list.map(x => (x.id === p.id ? { ...x, friendlyName: updated.friendlyName ?? trimmed } : x)));
      this.toasts.success('Passkey renamed');
    } catch (e) {
      this.toasts.error(e instanceof PasskeyError && e.kind !== 'failed' ? e.message : 'Couldn’t rename the passkey. Please try again.');
    } finally {
      this.busyId.set(null);
    }
  }

  async remove(p: PasskeyItem): Promise<void> {
    const ok = await this.dialog.confirm({
      title: 'Remove this passkey?',
      message: `“${p.friendlyName || 'Passkey'}” will no longer sign you in. You can still sign in with your password.`,
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    this.busyId.set(p.id);
    try {
      await this.passkeys.remove(p.id);
      this.items.update(list => list.filter(x => x.id !== p.id));
      this.toasts.success('Passkey removed');
    } catch (e) {
      this.toasts.error(e instanceof PasskeyError && e.kind !== 'failed' ? e.message : 'Couldn’t remove the passkey. Please try again.');
    } finally {
      this.busyId.set(null);
    }
  }
}
