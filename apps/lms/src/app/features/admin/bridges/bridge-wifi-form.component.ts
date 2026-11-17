import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import type { WifiNetwork, WifiSecurity } from '../../../shared/bridges/bridge.models';
import { WifiForm, eapWithoutCaValidation, emptyWifiForm, validateWifi } from '../../../shared/bridges/bridge-wifi';
import { securityWord, signalWord } from '../../../shared/bridges/bridge-status';

const OTHER = '\u0000other';

/**
 * Pick a Wi-Fi network + enter its password — ONE form for both the phone
 * relay (local API) and the remote "Change Wi-Fi" command. Rows are whole-row
 * targets with the neutral selected state; "Other network" types a hidden
 * SSID. Enterprise (PEAP) shows the CA / server-domain fields and a warning
 * when neither is set. The host owns the submit button and reads `formChange`.
 */
@Component({
  selector: 'pf-bridge-wifi-form',
  standalone: true,
  imports: [SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-bwf">
      <ul class="pf-bwf__nets" role="radiogroup" aria-label="Wi-Fi networks the Bridge can see">
        @for (n of networks(); track n.ssid) {
          <li>
            <button type="button" class="pf-row pf-tile-sel pf-bwf__net press" role="radio" [attr.aria-checked]="picked() === n.ssid" (click)="pick(n)">
              <svg class="pf-bwf__wifi" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 20h.01"/>
                <path d="M8.5 16.4a5 5 0 0 1 7 0" [attr.opacity]="bars(n) >= 2 ? 1 : 0.3"/>
                <path d="M5 12.9a10 10 0 0 1 14 0" [attr.opacity]="bars(n) >= 3 ? 1 : 0.3"/>
                <path d="M1.5 9.4a15 15 0 0 1 21 0" [attr.opacity]="bars(n) >= 4 ? 1 : 0.3"/>
              </svg>
              <span class="pf-bwf__net-main">
                <span class="pf-row__name">{{ n.ssid }}</span>
                <span class="pf-row__meta">{{ netMeta(n) }}</span>
              </span>
              @if (n.security !== 'open') {
                <svg class="pf-bwf__lock" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
              }
            </button>
          </li>
        }
        <li>
          <button type="button" class="pf-row pf-tile-sel pf-bwf__net press" role="radio" [attr.aria-checked]="picked() === OTHER" (click)="pickOther()">
            <svg class="pf-bwf__wifi" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
            <span class="pf-bwf__net-main">
              <span class="pf-row__name">Other network</span>
              <span class="pf-row__meta">A hidden network — type its name</span>
            </span>
          </button>
        </li>
      </ul>

      @if (picked()) {
        <div class="pf-bwf__fields">
          @if (picked() === OTHER) {
            <label class="pf-field">
              <span class="pf-field__lbl">Network name</span>
              <input class="pf-input" [class.pf-input--error]="touched() && !!issue('ssid')" [value]="form().ssid" (input)="patch({ ssid: val($event) })"
                     autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="64" />
              @if (touched() && issue('ssid')) { <span class="pf-bwf__err" role="alert">{{ issue('ssid') }}</span> }
            </label>
            <div class="pf-field">
              <span class="pf-field__lbl" id="pf-bwf-sec">Security</span>
              <pf-select aria-labelledby="pf-bwf-sec" [options]="securityOptions" [value]="form().security" (valueChange)="patch({ security: $event })"></pf-select>
            </div>
          }

          @if (form().security === 'wpa2-psk' || form().security === 'wpa3-sae') {
            <label class="pf-field">
              <span class="pf-field__lbl">Wi-Fi password</span>
              <span class="pf-bwf__pw">
                <input class="pf-input" [type]="showPw() ? 'text' : 'password'" [class.pf-input--error]="touched() && !!issue('psk')" [value]="form().psk"
                       (input)="patch({ psk: val($event) })" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="63" />
                <button type="button" class="pf-btn pf-btn--icon pf-bwf__eye" (click)="showPw.set(!showPw())" [attr.aria-label]="showPw() ? 'Hide password' : 'Show password'" [attr.aria-pressed]="showPw()">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>
                </button>
              </span>
              @if (touched() && issue('psk')) { <span class="pf-bwf__err" role="alert">{{ issue('psk') }}</span> }
            </label>
          }

          @if (form().security === 'wpa2-eap') {
            <div class="pf-bwf__grid">
              <label class="pf-field">
                <span class="pf-field__lbl">Username</span>
                <input class="pf-input" [class.pf-input--error]="touched() && !!issue('identity')" [value]="form().identity" (input)="patch({ identity: val($event) })"
                       autocomplete="off" autocapitalize="off" spellcheck="false" />
                @if (touched() && issue('identity')) { <span class="pf-bwf__err" role="alert">{{ issue('identity') }}</span> }
              </label>
              <label class="pf-field">
                <span class="pf-field__lbl">Password</span>
                <input class="pf-input" type="password" [class.pf-input--error]="touched() && !!issue('password')" [value]="form().password" (input)="patch({ password: val($event) })" autocomplete="off" />
                @if (touched() && issue('password')) { <span class="pf-bwf__err" role="alert">{{ issue('password') }}</span> }
              </label>
              <label class="pf-field">
                <span class="pf-field__lbl">Server domain <span class="pf-bwf__opt">recommended</span></span>
                <input class="pf-input" [value]="form().domainSuffixMatch" (input)="patch({ domainSuffixMatch: val($event) })" placeholder="e.g. radius.hospital.in"
                       autocomplete="off" autocapitalize="off" spellcheck="false" />
              </label>
              <label class="pf-field">
                <span class="pf-field__lbl">Anonymous identity <span class="pf-bwf__opt">optional</span></span>
                <input class="pf-input" [value]="form().anonymousIdentity" (input)="patch({ anonymousIdentity: val($event) })" autocomplete="off" autocapitalize="off" spellcheck="false" />
              </label>
              <label class="pf-field pf-bwf__span">
                <span class="pf-field__lbl">CA certificate <span class="pf-bwf__opt">recommended — from IT</span></span>
                <textarea class="pf-input pf-bwf__pem" rows="3" [class.pf-input--error]="touched() && !!issue('caCertPem')" [value]="form().caCertPem" (input)="patch({ caCertPem: val($event) })"
                          placeholder="-----BEGIN CERTIFICATE-----" spellcheck="false"></textarea>
                @if (touched() && issue('caCertPem')) { <span class="pf-bwf__err" role="alert">{{ issue('caCertPem') }}</span> }
              </label>
            </div>
            @if (noCa()) {
              <div class="pf-bwf__warn" role="note">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0ZM12 9v4M12 17h.01"/></svg>
                <span>Without the CA certificate or the server domain, the Bridge can't tell this network from an impostor that copies its name, which could collect this password. Ask IT for one of them.</span>
              </div>
            }
            <p class="pf-field__hint">Enterprise Wi-Fi uses PEAP (MSCHAPv2). Certificate-only (EAP-TLS) networks aren't supported yet.</p>
          }

          @if (form().security === 'open') {
            <p class="pf-field__hint">This network has no password. If it opens a sign-in page (guest Wi-Fi), the Bridge can't use it.</p>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    @use '../../../shared/styles/nd-mixins' as nd;
    :host { display: block; }
    .pf-bwf { display: flex; flex-direction: column; gap: 14px; }
    .pf-bwf__nets { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    .pf-bwf__net { width: 100%; display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 8px 12px; text-align: left; border-radius: 12px;
      border: 1px solid var(--pf-line); background: transparent; color: var(--text-primary); cursor: pointer; }
    /* The kit's neutral selected state (the base rule above would out-rank it). */
    .pf-bwf__net[aria-checked='true'] { @include nd.neutral-selected; }
    .pf-bwf__net-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .pf-bwf__wifi, .pf-bwf__lock { flex: none; color: var(--text-secondary); }
    .pf-bwf__fields { display: flex; flex-direction: column; gap: 12px; }
    .pf-bwf__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .pf-bwf__span { grid-column: 1 / -1; }
    .pf-bwf__pw { position: relative; display: flex; align-items: center; }
    .pf-bwf__pw .pf-input { flex: 1 1 auto; padding-right: 44px; }
    .pf-bwf__eye { position: absolute; right: 2px; }
    .pf-bwf__pem { font-size: 12px; min-height: 72px; }
    .pf-bwf__opt { font-weight: 400; color: var(--text-tertiary); }
    .pf-bwf__err { font-size: 12px; color: var(--red-text, #dc2626); }
    .pf-bwf__warn { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 12px; font-size: 12.5px; line-height: 1.5;
      color: var(--amber-text, #b45309); background: color-mix(in srgb, var(--amber-text, #b45309) 9%, transparent);
      border: 1px solid color-mix(in srgb, var(--amber-text, #b45309) 30%, transparent); }
    .pf-bwf__warn svg { flex: none; margin-top: 2px; }
    @media (max-width: 640px) {
      .pf-bwf__grid { grid-template-columns: minmax(0, 1fr); }
      .pf-bwf .pf-input { font-size: 16px; min-height: 44px; }
    }
  `],
})
export class BridgeWifiFormComponent {
  readonly networks = input<WifiNetwork[]>([]);
  /** Show field errors (the host sets it on the first submit). */
  readonly touched = input(false);
  readonly formChange = output<WifiForm | null>();

  protected readonly OTHER = OTHER;
  readonly picked = signal<string | null>(null);
  readonly form = signal<WifiForm>(emptyWifiForm());
  readonly showPw = signal(false);
  readonly issues = computed(() => validateWifi(this.form()));
  readonly noCa = computed(() => eapWithoutCaValidation(this.form()));

  readonly securityOptions: PfSelectOption<WifiSecurity>[] = [
    { value: 'wpa2-psk', label: 'WPA2 / WPA3 personal (password)' },
    { value: 'wpa3-sae', label: 'WPA3 only' },
    { value: 'wpa2-eap', label: 'Enterprise (username + password)' },
    { value: 'open', label: 'Open (no password)' },
  ];

  constructor() {
    // Pre-pick the network the Bridge is on, or the only one.
    effect(() => {
      const nets = this.networks();
      if (this.picked() || !nets.length) return;
      const first = nets.find((n) => n.inUse) ?? (nets.length === 1 ? nets[0] : null);
      if (first) this.pick(first);
    });
  }

  issue(field: string): string | null { return this.issues().find((i) => i.field === field)?.message ?? null; }

  pick(n: WifiNetwork): void {
    this.picked.set(n.ssid);
    this.form.set({ ...emptyWifiForm(n.ssid, n.security) });
    this.emit();
  }

  pickOther(): void {
    this.picked.set(OTHER);
    this.form.set({ ...emptyWifiForm('', 'wpa2-psk'), hidden: true });
    this.emit();
  }

  patch(p: Partial<WifiForm>): void {
    this.form.update((f) => ({ ...f, ...p }));
    this.emit();
  }

  val(e: Event): string { return (e.target as HTMLInputElement | HTMLTextAreaElement).value; }

  bars(n: WifiNetwork): number {
    const pct = n.signal < 0 ? Math.max(0, Math.min(100, 2 * (n.signal + 100))) : n.signal;
    return pct >= 70 ? 4 : pct >= 45 ? 3 : pct >= 25 ? 2 : 1;
  }

  netMeta(n: WifiNetwork): string {
    return [n.inUse ? 'Connected now' : '', securityWord(n.security), signalWord(n.signal)].filter(Boolean).join(' · ');
  }

  private emit(): void { this.formChange.emit(this.picked() ? this.form() : null); }
}
