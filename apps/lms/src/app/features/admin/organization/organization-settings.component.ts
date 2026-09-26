import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/auth/auth.service';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { ThemeService } from '../../../core/services/theme.service';
import { DialogService } from '../../../core/services/dialog.service';
import { SettingsJumpComponent, SettingsSection } from '../../../shared/components/settings-page/settings-jump.component';
import { SettingAnchorDirective } from '../../../shared/components/settings-page/setting-anchor.directive';



@Component({
  selector: 'pf-organization-settings',
  standalone: true,
  imports: [FormsModule, ScreenHeaderComponent, HeroBandComponent, SelectComponent, SettingsJumpComponent, SettingAnchorDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <!-- ONE scrolling page (ND-PATTERN §19): no pill tabs. The band Save
             saves every section that changed. -->
        <pf-hero-band [back]="true" [tabsOnly]="true">
          <ng-container band-tools>
            <h1 class="nd-band-page">Organization &amp; IDs</h1>
          </ng-container>
          <ng-container band-actions>
            <button type="button" class="pf-hb-btn pf-hb-btn--primary pf-ls__bandsave press"
                    [disabled]="bandSaveDisabled()" (click)="saveAll()" aria-label="Save" title="Save">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>
              {{ bandSaving() ? 'Saving…' : 'Save' }}
            </button>
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="Admin"
        title="Organization & IDs"
        subtitle="Name, sign-in word and ID formats.">
      </pf-screen-header>

      <div class="pf-band-body">
      <div class="nd-setpage nd-setpage--jump">
        <pf-settings-jump [sections]="sections"></pf-settings-jump>
        <div class="nd-setcol">

        <!-- Organization -->
        <section class="nd-card nd-setsec" id="sec-identity" aria-labelledby="sec-identity-h">
          <div class="nd-card__head">
            <span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
            <h2 class="nd-card__label" id="sec-identity-h">Organization</h2>
          </div>
          <div class="nd-set" pfSettingAnchor="org-name">
            <div class="nd-set__text">
              <label class="nd-set__label" id="org-name-l" for="org-name-in">Organization name</label>
              <p class="nd-set__help">Shown on screens, reports and bills.</p>
            </div>
            <div class="nd-set__ctl pf-org__field">
              <input id="org-name-in" class="nd-input" maxlength="80" [ngModel]="orgName()" (ngModelChange)="orgName.set($event)"
                     placeholder="e.g. Arun Labs" />
              <button type="button" class="nd-btn nd-btn--secondary pf-classic-only press"
                      [disabled]="orgNameSaving() || !nameDirty()" (click)="saveOrgName()">
                {{ orgNameSaving() ? 'Saving…' : 'Save name' }}
              </button>
            </div>
          </div>
          <div class="nd-set" pfSettingAnchor="login-handle">
            <div class="nd-set__text">
              <label class="nd-set__label" id="login-handle-l" for="login-handle-in">Sign-in word</label>
              <p class="nd-set__help">Staff type this to sign in. Changing it affects everyone.</p>
            </div>
            <div class="nd-set__ctl pf-org__field">
              <input id="login-handle-in" class="nd-input" maxlength="40" [ngModel]="slug()" (ngModelChange)="onSlugInput($event)"
                     placeholder="e.g. microworld" autocapitalize="off" autocorrect="off" spellcheck="false" />
              <button type="button" class="nd-btn nd-btn--secondary pf-save-slug pf-classic-only press"
                      [disabled]="slugSaving() || !slugDirty()" (click)="saveSlug()">
                {{ slugSaving() ? 'Saving…' : 'Save handle' }}
              </button>
            </div>
          </div>
        </section>

        <!-- Patient ID -->
        <section class="nd-card nd-setsec" id="sec-patient" aria-labelledby="sec-patient-h">
          <div class="nd-card__head">
            <span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M15 8h2M15 12h2M7 16h10"/></svg></span>
            <h2 class="nd-card__label" id="sec-patient-h">Patient ID</h2>
          </div>
          <div class="nd-set" pfSettingAnchor="patient-id">
            <div class="nd-set__text">
              <span class="nd-set__label" id="pid-on-l">Own patient ID format</span>
              <p class="nd-set__help">Off uses the built-in format. Old IDs never change.</p>
            </div>
            <div class="nd-set__ctl">
              <button type="button" class="nd-toggle" role="switch" [attr.aria-checked]="pidEnabled()" aria-labelledby="pid-on-l"
                      (click)="pidEnabled.set(!pidEnabled())"><span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span></button>
            </div>
          </div>
          @if (pidEnabled()) {
            <div class="nd-set nd-set--sub">
              <div class="nd-set__ctl nd-set__ctl--wide pf-org__grid pf-org__grid--4">
                <div class="nd-field">
                  <span class="nd-field__lbl" id="pid-date-l">Date part</span>
                  <pf-select [options]="dateOptions" [value]="pidDate()" (valueChange)="pidDate.set($any($event))"></pf-select>
                </div>
                <div class="nd-field">
                  <label class="nd-field__lbl" for="pid-sep">Separator</label>
                  <input id="pid-sep" class="nd-input nd-num" maxlength="3" [ngModel]="pidSep()" (ngModelChange)="pidSep.set($event)" placeholder="none" />
                </div>
                <div class="nd-field">
                  <label class="nd-field__lbl" for="pid-pad">{{ pidSerial() === 'alpha' ? 'Min number digits' : 'Number digits' }}</label>
                  <input id="pid-pad" class="nd-input nd-num" type="number" min="1" [attr.max]="pidSerial() === 'alpha' ? 6 : 10" [ngModel]="pidPad()" (ngModelChange)="onPidPadChange($event)" (keydown)="preventMinus($event)" />
                </div>
                <div class="nd-field">
                  <label class="nd-field__lbl" for="pid-prefix">Start text</label>
                  <input id="pid-prefix" class="nd-input nd-num" maxlength="16" [ngModel]="pidPrefix()" (ngModelChange)="pidPrefix.set($event)" placeholder="e.g. LAB" />
                </div>
              </div>
            </div>
            <div class="nd-set nd-set--sub">
              <div class="nd-set__text">
                <span class="nd-set__label" id="pid-alpha-l">Add letters</span>
                <p class="nd-set__help">Letters before the number, like AA001.</p>
              </div>
              <div class="nd-set__ctl">
                <button type="button" class="nd-toggle" role="switch" [attr.aria-checked]="pidSerial() === 'alpha'" aria-labelledby="pid-alpha-l"
                        (click)="pidSerial.set(pidSerial() === 'alpha' ? 'numeric' : 'alpha')"><span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span></button>
              </div>
            </div>
            @if (pidSerial() === 'alpha') {
              <div class="nd-set nd-set--sub">
                <div class="nd-set__text">
                  <span class="nd-set__label" id="pid-letters-l">How many letters</span>
                  <p class="nd-set__help">Number goes to 999999, then letters move on.</p>
                </div>
                <div class="nd-set__ctl pf-org__letters">
                  <pf-select [options]="letterOptions" [value]="pidLetters()" (valueChange)="pidLetters.set(+$any($event))"></pf-select>
                </div>
              </div>
            }
            <div class="nd-set nd-set--sub">
              <p class="nd-set__preview">Looks like: <strong class="nd-num">{{ pidPreview() }}</strong></p>
              <button type="button" class="nd-btn nd-btn--secondary pf-classic-only press" [disabled]="pidSaving()" (click)="savePatientId()">
                {{ pidSaving() ? 'Saving…' : 'Save format' }}
              </button>
            </div>
          } @else {
            <div class="nd-set nd-set--sub">
              <p class="nd-set__preview">Looks like: <strong class="nd-num">DEL-2606-000042-7</strong></p>
              <button type="button" class="nd-btn nd-btn--secondary pf-classic-only press" [disabled]="pidSaving()" (click)="savePatientId()">
                {{ pidSaving() ? 'Saving…' : 'Save format' }}
              </button>
            </div>
          }
        </section>

        <!-- Sample ID + Order ID: the same engine, different prefix. -->
        @for (x of idSections; track x.key) {
          <section class="nd-card nd-setsec" [id]="'sec-' + x.key" [attr.aria-labelledby]="'sec-' + x.key + '-h'">
            <div class="nd-card__head">
              <span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="x.icon"/></svg></span>
              <h2 class="nd-card__label" [id]="'sec-' + x.key + '-h'">{{ x.title }}</h2>
            </div>
            <div class="nd-set" [pfSettingAnchor]="x.anchor">
              <div class="nd-set__text">
                <span class="nd-set__label" [id]="x.key + '-fmt-l'">{{ x.label }}</span>
                <p class="nd-set__help">{{ x.help }}</p>
              </div>
              <div class="nd-set__ctl nd-set__ctl--wide pf-org__grid pf-org__grid--3">
                <div class="nd-field">
                  <span class="nd-field__lbl">Date part</span>
                  <pf-select [options]="dateOptions" [value]="x.fmt.date()" (valueChange)="x.fmt.date.set($any($event))"></pf-select>
                </div>
                <div class="nd-field">
                  <label class="nd-field__lbl" [for]="x.key + '-sep'">Separator</label>
                  <input [id]="x.key + '-sep'" class="nd-input nd-num" maxlength="3" [ngModel]="x.fmt.sep()" (ngModelChange)="x.fmt.sep.set($event)" placeholder="none" />
                </div>
                <div class="nd-field">
                  <label class="nd-field__lbl" [for]="x.key + '-pad'">{{ x.fmt.serial() === 'alpha' ? 'Min number digits' : 'Number digits' }}</label>
                  <input [id]="x.key + '-pad'" class="nd-input nd-num" type="number" min="1" [attr.max]="x.fmt.serial() === 'alpha' ? 6 : 10" [ngModel]="x.fmt.pad()" (ngModelChange)="onFormatPadChange(x.fmt, $event)" (keydown)="preventMinus($event)" />
                </div>
              </div>
            </div>
            <div class="nd-set nd-set--sub">
              <div class="nd-set__text">
                <span class="nd-set__label" [id]="x.key + '-alpha-l'">Add letters</span>
                <p class="nd-set__help">Letters before the number, like AA001.</p>
              </div>
              <div class="nd-set__ctl">
                <button type="button" class="nd-toggle" role="switch" [attr.aria-checked]="x.fmt.serial() === 'alpha'" [attr.aria-labelledby]="x.key + '-alpha-l'"
                        (click)="x.fmt.serial.set(x.fmt.serial() === 'alpha' ? 'numeric' : 'alpha')"><span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span></button>
              </div>
            </div>
            @if (x.fmt.serial() === 'alpha') {
              <div class="nd-set nd-set--sub">
                <div class="nd-set__text">
                  <span class="nd-set__label" [id]="x.key + '-letters-l'">How many letters</span>
                </div>
                <div class="nd-set__ctl pf-org__letters">
                  <pf-select [options]="letterShortOptions" [value]="x.fmt.letters()" (valueChange)="x.fmt.letters.set(+$any($event))"></pf-select>
                </div>
              </div>
            }
            <div class="nd-set nd-set--sub">
              <p class="nd-set__preview">Looks like: <strong class="nd-num">{{ x.fmt.preview() }}</strong></p>
              <button type="button" class="nd-btn nd-btn--secondary pf-classic-only press" [disabled]="x.fmt.saving()" (click)="saveIdFormat(x.fmt)">
                {{ x.fmt.saving() ? 'Saving…' : 'Save format' }}
              </button>
            </div>
          </section>
        }

        </div>
      </div>
      </div>
    </section>
  `,
  styles: [`
    .pf-org__field { flex: 1 1 280px; max-width: 30rem; }
    .pf-org__field .nd-input { flex: 1 1 200px; min-width: 0; }
    .pf-org__grid { display: grid; gap: 12px; }
    .pf-org__grid--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .pf-org__grid--4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .pf-org__letters { min-width: 180px; }
    @media (max-width: 1023px) { .pf-org__grid--4 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 640px) {
      .pf-org__grid--3, .pf-org__grid--4 { grid-template-columns: 1fr; }
      .pf-org__field { max-width: none; }
    }
  `]
})
export class OrganizationSettingsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);

  /** "On this page" jump list (desktop). */
  readonly sections: SettingsSection[] = [
    { id: 'sec-identity', label: 'Organization' },
    { id: 'sec-patient', label: 'Patient ID' },
    { id: 'sec-sample', label: 'Sample ID' },
    { id: 'sec-order', label: 'Order ID' },
  ];

  /** pf-select options (no native select). */
  readonly dateOptions: PfSelectOption[] = [
    { value: 'yymmdd', label: 'YYMMDD' }, { value: 'ddmmyy', label: 'DDMMYY' },
    { value: 'mmdd', label: 'MMDD' }, { value: 'yymm', label: 'YYMM' },
    { value: 'mmyy', label: 'MMYY' }, { value: 'yy', label: 'YY' },
    { value: 'dd', label: 'DD' }, { value: 'none', label: 'None' },
  ];
  readonly letterOptions: PfSelectOption<number>[] = [
    { value: 1, label: 'A (1 letter)' }, { value: 2, label: 'AA (2 letters)' },
    { value: 3, label: 'AAA (3 letters)' }, { value: 4, label: 'AAAA (4 letters)' },
  ];
  readonly letterShortOptions: PfSelectOption<number>[] = [
    { value: 1, label: 'A' }, { value: 2, label: 'AA' }, { value: 3, label: 'AAA' }, { value: 4, label: 'AAAA' },
  ];

  // ── Band Save: ONE primary that saves every section that changed ──
  protected readonly nameDirty = computed(() => !!this.orgName().trim() && this.orgName().trim() !== this.orgNameOriginal());
  protected readonly slugDirty = computed(() => !!this.slug() && this.slug() !== this.slugOriginal());
  private readonly pidJson = computed(() => JSON.stringify([
    this.pidEnabled(), this.pidDate(), this.pidSep() ?? '', String(this.pidPad()), (this.pidPrefix() ?? '').trim(),
    this.pidSerial(), this.pidLetters(),
  ]));
  private readonly pidSnap = signal<string | null>(null);
  protected readonly pidDirty = computed(() => this.pidSnap() !== null && this.pidJson() !== this.pidSnap());
  readonly bandSaving = computed(() =>
    this.orgNameSaving() || this.slugSaving() || this.pidSaving() || this.sampleFmt.saving() || this.orderFmt.saving());
  readonly anyDirty = computed(() =>
    this.nameDirty() || this.slugDirty() || this.pidDirty() || this.sampleFmt.dirty() || this.orderFmt.dirty());
  readonly bandSaveDisabled = computed(() => this.bandSaving() || !this.anyDirty());
  /** Saves only the sections that changed (each keeps its own API call). */
  saveAll(): void {
    if (this.nameDirty()) this.saveOrgName();
    if (this.slugDirty()) void this.saveSlug();
    if (this.pidDirty()) this.savePatientId();
    for (const f of this.idFmts()) if (f.dirty()) this.saveIdFormat(f);
  }

  // ── Organization display name ──
  protected readonly orgName = signal('');
  protected readonly orgNameOriginal = signal('');
  protected readonly orgNameSaving = signal(false);

  protected saveOrgName() {
    const name = this.orgName().trim();
    if (!name || name === this.orgNameOriginal()) return;
    this.orgNameSaving.set(true);
    this.api.patch('/api/tenants/current', { name }).subscribe({
      next: () => {
        this.orgNameSaving.set(false);
        this.orgNameOriginal.set(name);
        this.toasts.success('Organization name updated — shown after the next sign-in.');
      },
      error: e => { this.orgNameSaving.set(false); this.toasts.error(ApiError.from(e).message); },
    });
  }

  // ── Login handle (tenant slug) — OPS-13 ──
  protected readonly slug = signal('');
  protected readonly slugOriginal = signal('');
  protected readonly slugSaving = signal(false);

  // ── Patient-ID format ──
  protected readonly pidEnabled = signal(false);
  protected readonly pidDate = signal('ddmmyy');
  protected readonly pidSep = signal('-');
  protected readonly pidPad = signal(4);
  protected readonly pidPrefix = signal('');
  /** 'numeric' → zero-padded number; 'alpha' → alphanumeric odometer
   *  ({LETTERS}{number}, number 1…999999 then the fixed-width uppercase
   *  letters advance, e.g. width 2: AA001 … AA999999, AB001 …). */
  protected readonly pidSerial = signal<'numeric' | 'alpha'>('numeric');
  /** Fixed letter-block width for alpha mode (1–4 → A/AA/AAA/AAAA). */
  protected readonly pidLetters = signal(2);
  protected readonly pidSaving = signal(false);
  protected preventMinus(e: KeyboardEvent) {
    if (e.key === '-' || e.key === '+' || e.key === 'e') {
      e.preventDefault();
    }
  }

  /** Login handle is lowercase letters/numbers/hyphens only — sanitize as typed
   *  (OPS-13). */
  protected onSlugInput(v: string) {
    this.slug.set((v ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40));
  }
  /** Changing the handle changes how staff sign in (owner, 2026-09-25):
   *  confirm first — only when the handle actually changed. */
  protected async saveSlug(): Promise<void> {
    const s = this.slug();
    if (!s || s === this.slugOriginal()) return;
    const ok = await this.dialog.confirm({
      title: 'Change the login handle?',
      message: 'Changing the login handle changes how staff sign in. Continue?',
      confirmLabel: 'Change handle',
      tone: 'danger',
    });
    if (!ok) return;
    this.slugSaving.set(true);
    this.api.patch('/api/tenants/current', { slug: s }).subscribe({
      next: () => {
        this.slugSaving.set(false);
        this.slugOriginal.set(s);
        this.toasts.success('Login handle updated — staff now sign in with this handle.');
      },
      error: e => { this.slugSaving.set(false); this.toasts.error(ApiError.from(e).message); },
    });
  }

  private sanitizePadValue(val: any, isAlpha: boolean): number {
    const maxPad = isAlpha ? 6 : 10;
    const num = Math.abs(parseInt(val, 10));
    if (isNaN(num) || num < 1) return 1;
    return Math.min(num, maxPad);
  }

  protected onPidPadChange(val: any) {
    this.pidPad.set(this.sanitizePadValue(val, this.pidSerial() === 'alpha'));
  }

  protected onFormatPadChange(f: { serial: () => string; pad: { set: (v: number) => void } }, val: any) {
    f.pad.set(this.sanitizePadValue(val, f.serial() === 'alpha'));
  }

  /** Live sample of what a new id looks like with today's date + seq 1. */
  protected readonly pidPreview = computed(() => {
    const n = new Date();
    const dd = String(n.getDate()).padStart(2, '0');
    const mm = String(n.getMonth() + 1).padStart(2, '0');
    const yy = String(n.getFullYear() % 100).padStart(2, '0');
    const date = this.pidDate() === 'yymmdd' ? yy + mm + dd
      : this.pidDate() === 'ddmmyy' ? dd + mm + yy
      : this.pidDate() === 'mmdd' ? mm + dd
      : this.pidDate() === 'yymm' ? yy + mm
      : this.pidDate() === 'mmyy' ? mm + yy
      : this.pidDate() === 'yy' ? yy
      : this.pidDate() === 'dd' ? dd : '';
    // First id (seq 1): the fixed-width UPPERCASE letters + the number, padded
    // to the configured min width (capped at 6 for alpha). e.g. AA001.
    const cleanPad = this.sanitizePadValue(this.pidPad(), this.pidSerial() === 'alpha');
    const serial = this.pidSerial() === 'alpha'
      ? 'A'.repeat(Math.min(Math.max(this.pidLetters(), 1), 4)) + '1'.padStart(cleanPad, '0')
      : '1'.padStart(cleanPad, '0');
    const head = (this.pidPrefix() ?? '') + date;
    // Blank separator → no separator (e.g. mmdd000).
    const sep = this.pidSep() ?? '';
    return head.length ? `${head}${sep}${serial}` : serial;
  });

  // ── Sample-ID & Order-ID formats ──
  // Same engine as Patient ID but with a DYNAMIC prefix: the space code for
  // samples (e.g. MIC-2607-00001), the module code for orders (LAB-2607-000042).
  // The preview uses a stand-in prefix. Counter restarts monthly per space/module.
  protected readonly sampleFmt = this.makeIdFormat('sample', 'MIC', 'yymm', 5);
  protected readonly orderFmt = this.makeIdFormat('order', 'LAB', 'yymm', 6);

  private makeIdFormat(scope: 'sample' | 'order', samplePrefix: string, defaultDate: string, defaultPad: number) {
    const date = signal(defaultDate);
    const sep = signal('-');
    const pad = signal(defaultPad);
    const serial = signal<'numeric' | 'alpha'>('numeric');
    const letters = signal(2);
    const saving = signal(false);
    const preview = computed(() => {
      const n = new Date();
      const dd = String(n.getDate()).padStart(2, '0');
      const mm = String(n.getMonth() + 1).padStart(2, '0');
      const yy = String(n.getFullYear() % 100).padStart(2, '0');
      const d = date() === 'yymmdd' ? yy + mm + dd
        : date() === 'ddmmyy' ? dd + mm + yy
        : date() === 'mmdd' ? mm + dd
        : date() === 'yymm' ? yy + mm
        : date() === 'mmyy' ? mm + yy
        : date() === 'yy' ? yy
        : date() === 'dd' ? dd : '';
      const cleanPad = this.sanitizePadValue(pad(), serial() === 'alpha');
      const ser = serial() === 'alpha'
        ? 'A'.repeat(Math.min(Math.max(letters(), 1), 4)) + '1'.padStart(cleanPad, '0')
        : '1'.padStart(cleanPad, '0');
      // Separator between EVERY non-empty part — mirrors backend GenerateScoped.
      return [samplePrefix, d, ser].filter(p => p.length).join(sep() ?? '');
    });
    const json = computed(() => JSON.stringify([date(), sep() ?? '', String(pad()), serial(), letters()]));
    const snap = signal<string | null>(null);
    const dirty = computed(() => snap() !== null && json() !== snap());
    return { scope, samplePrefix, date, sep, pad, serial, letters, saving, preview, json, snap, dirty };
  }
  private idFmts() { return [this.sampleFmt, this.orderFmt]; }
  /** Sample ID + Order ID sections (same engine, different prefix). */
  protected readonly idSections = [
    { key: 'sample', anchor: 'sample-id', title: 'Sample ID', label: 'Sample ID format', fmt: this.sampleFmt,
      help: 'Space code, date, number. Restarts each month.',
      icon: 'M9 2v17a3 3 0 0 0 6 0V2M8 2h8M9 12h6' },
    { key: 'order', anchor: 'order-id', title: 'Order ID', label: 'Order ID format', fmt: this.orderFmt,
      help: 'Module code, date, number. Restarts each month.',
      icon: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 3h6v4H9zM9 12h6M9 16h4' },
  ];
  /** Identity passthrough so the template can bind a format object via `@if (…; as f)`. */
  protected idSection<T>(f: T): T { return f; }

  ngOnInit() {
    // Baselines so the band Save knows what changed (re-set after each load/save).
    this.pidSnap.set(this.pidJson());
    for (const f of this.idFmts()) f.snap.set(f.json());
    // Current tenant login handle (OPS-13).
    this.api.get<any>('/api/tenants/current').subscribe({
      next: t => {
        const s = (t?.slug ?? '').toLowerCase();
        this.slug.set(s); this.slugOriginal.set(s);
        const n = t?.name ?? '';
        this.orgName.set(n); this.orgNameOriginal.set(n);
      },
    });
    this.api.get<any>('/api/config/patient-id').subscribe({
      next: c => {
        if (!c) return;
        this.pidEnabled.set(!!c.enabled);
        this.pidDate.set(c.datePrefix ?? 'ddmmyy');
        this.pidSep.set(c.separator ?? '-');
        this.pidPad.set(this.sanitizePadValue(c.padding ?? 4, c.serialMode === 'alpha'));
        this.pidPrefix.set(c.prefix ?? '');
        this.pidSerial.set(c.serialMode === 'alpha' ? 'alpha' : 'numeric');
        this.pidLetters.set(Math.min(Math.max(c.letterCount ?? 2, 1), 4));
        this.pidSnap.set(this.pidJson());
      }
    });
    for (const f of this.idFmts()) {
      this.api.get<any>(`/api/config/${f.scope}-id`).subscribe({
        next: c => {
          if (!c) return;
          f.date.set(c.datePrefix ?? f.date());
          f.sep.set(c.separator ?? '-');
          f.pad.set(this.sanitizePadValue(c.padding ?? f.pad(), c.serialMode === 'alpha'));
          f.serial.set(c.serialMode === 'alpha' ? 'alpha' : 'numeric');
          f.letters.set(Math.min(Math.max(c.letterCount ?? 2, 1), 4));
          f.snap.set(f.json());
        }
      });
    }
  }

  saveIdFormat(f: { scope: 'sample' | 'order'; date: any; sep: any; pad: any; serial: any; letters: any; saving: any; json?: any; snap?: any }) {
    const cleanPad = this.sanitizePadValue(f.pad(), f.serial() === 'alpha');
    f.pad.set(cleanPad);
    f.saving.set(true);
    this.api.post(`/api/config/${f.scope}-id`, {
      enabled: true,
      datePrefix: f.date(),
      separator: f.sep() ?? '',
      padding: cleanPad,
      serialMode: f.serial(),
      letterCount: f.letters(),
    }).subscribe({
      next: () => { f.saving.set(false); f.snap?.set(f.json?.()); this.toasts.success(`${f.scope === 'sample' ? 'Sample' : 'Order'} ID format saved`); },
      error: e => { f.saving.set(false); this.toasts.error(ApiError.from(e).message); },
    });
  }

  savePatientId() {
    const cleanPad = this.sanitizePadValue(this.pidPad(), this.pidSerial() === 'alpha');
    this.pidPad.set(cleanPad);
    this.pidSaving.set(true);
    this.api.post('/api/config/patient-id', {
      enabled: this.pidEnabled(),
      datePrefix: this.pidDate(),
      separator: this.pidSep() ?? '',
      padding: cleanPad,
      prefix: this.pidPrefix()?.trim() || null,
      serialMode: this.pidSerial(),
      letterCount: this.pidLetters(),
    }).subscribe({
      next: () => { this.pidSaving.set(false); this.pidSnap.set(this.pidJson()); this.toasts.success('Patient ID format saved'); },
      error: e => { this.pidSaving.set(false); this.toasts.error(ApiError.from(e).message); },
    });
  }

}
