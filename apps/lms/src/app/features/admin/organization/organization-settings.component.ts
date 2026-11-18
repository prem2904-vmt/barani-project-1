import { SettingsSavebarComponent } from '../../../shared/components/setting-row/settings-savebar.component';
import { SettingGroupComponent, SettingRowComponent } from '../../../shared/components/setting-row/setting-row.component';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ORG_SETTINGS_TABS } from '../../../shared/utils/settings-catalog';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/auth/auth.service';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { ThemeService } from '../../../core/services/theme.service';
import { DialogService } from '../../../core/services/dialog.service';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { bindTabQuery, injectSettingsHosted } from '../../../shared/utils/settings-host';

/** Band pill tabs — one per independently-saved identity setting. (The Order ID moved to Lab › Sample numbers, OPD and Pharmacy.) */
export type OrgSettingsTab = 'identity' | 'patient';


@Component({
  selector: 'pf-organization-settings',
  standalone: true,
  imports: [SettingsSavebarComponent, SettingRowComponent, SettingGroupComponent, BusyDirective, FormsModule, ScreenHeaderComponent, HeroBandComponent, SegmentedComponent, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <!-- Band (owner): no search here — the sections are tabs in a
             tabs-only pill; the open tab's Save is the band's ONE primary. -->
        <pf-hero-band [back]="true" [tabsOnly]="true">
          <ng-container band-tools>
            <pf-segmented class="pf-hb-tabs" size="sm" [options]="tabOptions" [value]="tab()"
                          (valueChange)="pickTab($event)"></pf-segmented>
          </ng-container>
          <ng-container band-actions>
            @if (!hosted) {
            <button type="button" class="pf-hb-btn pf-hb-btn--primary pf-ls__bandsave press"
                    [disabled]="bandSaveDisabled()" [pfBusy]="bandSaving()" pfBusyLabel="Saving…" (click)="saveTab()"
                    [attr.aria-label]="bandSaveLabel()" [title]="bandSaveLabel()">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>
              {{ bandSaving() ? 'Saving…' : bandSaveLabel() }}
            </button>
            }
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="Admin"
        title="Organization & Identity"
        subtitle="Patient ID format and tenant data tools.">
      </pf-screen-header>

      <div class="pf-band-body">
      <div class="pf-ls__col" [class.pf-sgrid]="hosted">
      @if (showSec('identity')) {
      <!-- Organization display NAME — distinct from the login handle below.
           The page used to show only the handle, so "arun-labs" read as if
           it were the organization's name (UAT item 16). -->
      <section class="pf-card pf-ls__card">
        <div class="pf-card__head">
          <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
          <h3 class="pf-card__label pf-ls__title">Organization name</h3>
        </div>
        <div class="pf-card__body pf-ls__body">
          <p class="pf-ls__hint">
            The display name shown across the app, on reports and invoices —
            e.g. "Arun Labs". The lowercase sign-in handle below is separate.
          </p>
          <div class="pf-ls__row">
            <label class="pf-field pf-ls__grow">
              <span class="pf-field__lbl">Name</span>
              <input class="pf-input" maxlength="80" [ngModel]="orgName()" (ngModelChange)="orgName.set($event)"
                     placeholder="e.g. Arun Labs" />
            </label>
            <button type="button" class="pf-btn pf-btn--primary pf-ls__save pf-classic-only press"
                    [disabled]="orgNameSaving() || !orgName().trim() || orgName().trim() === orgNameOriginal()" [pfBusy]="orgNameSaving()"
                    (click)="saveOrgName()">
              {{ orgNameSaving() ? 'Saving…' : 'Save name' }}
            </button>
          </div>
        </div>
      </section>
      }

      @if (showSec('identity')) {
      <!-- Organization login handle (tenant "username") — OPS-13 -->
      <section class="pf-card pf-ls__card">
        <div class="pf-card__head">
          <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/></svg></span>
          <h3 class="pf-card__label pf-ls__title">Organization login handle</h3>
        </div>
        <div class="pf-card__body pf-ls__body">
          <p class="pf-ls__hint">
            This is the organization name your staff type on the sign-in screen.
            <strong>Changing it changes how everyone logs in</strong> — old links and saved credentials that use the previous handle will stop working.
          </p>
          <div class="pf-ls__row">
            <label class="pf-field pf-ls__grow">
              <span class="pf-field__lbl">Handle</span>
              <input class="pf-input" maxlength="40" [ngModel]="slug()" (ngModelChange)="onSlugInput($event)"
                     placeholder="e.g. microworld" autocapitalize="off" autocorrect="off" spellcheck="false" />
            </label>
            <button type="button" class="pf-btn pf-btn--primary pf-save-slug pf-ls__save pf-classic-only press"
                    [disabled]="slugSaving() || !slug() || slug() === slugOriginal()" [pfBusy]="slugSaving()" (click)="saveSlug()">
              {{ slugSaving() ? 'Saving…' : 'Save handle' }}
            </button>
          </div>
        </div>
      </section>
      }

      @if (showSec('patient')) {
      <!-- Patient ID format: ONE row (DESIGN-V2) — Custom switch, then the fields → preview → Save. -->
      <pf-setting-group [id]="hosted ? 'patient' : null" label="Patient ID" scope="never resets" [wide]="true" icon="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM9 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM15 8h2M15 12h2M7 16h10">
        <pf-setting-row class="pf-ls__card" data-testid="fmt-row" label="Custom format"
                        [hint]="pidEnabled() ? 'The running number never resets; existing IDs never change.' : 'Built-in format (e.g. DEL-2606-000042-7).'">
          <button type="button" class="pf-toggle pf-ls__sw" role="switch" [attr.aria-checked]="pidEnabled()" aria-label="Custom patient ID format"
                  (click)="pidEnabled.set(!pidEnabled())"><span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span></button>
        </pf-setting-row>
        @if (pidEnabled()) {
          <pf-setting-row label="Prefix" hint="Optional.">
            <input class="pf-input pf-num pf-org__in" maxlength="16" [ngModel]="pidPrefix()" (ngModelChange)="pidPrefix.set($event)" placeholder="e.g. LAB" aria-label="Prefix" />
          </pf-setting-row>
          <pf-setting-row label="Date">
            <pf-select class="pf-org__sel" [options]="dateOptions" [value]="pidDate()" (valueChange)="pidDate.set($any($event))" aria-label="Date prefix"></pf-select>
          </pf-setting-row>
          <pf-setting-row label="Separator" hint="Blank = none.">
            <input class="pf-input pf-num pf-org__in" maxlength="3" [ngModel]="pidSep()" (ngModelChange)="pidSep.set($event)" placeholder="none" aria-label="Separator" />
          </pf-setting-row>
          <pf-setting-row [label]="pidSerial() === 'alpha' ? 'Minimum digits' : 'Digits'">
            <input class="pf-input pf-num pf-org__in" type="number" min="1" [attr.max]="pidSerial() === 'alpha' ? 6 : 10" [ngModel]="pidPad()" (ngModelChange)="onPidPadChange($event)" (keydown)="preventMinus($event)" aria-label="Number digits" />
          </pf-setting-row>
          <pf-setting-row label="Letters" hint="Alphanumeric odometer: up to 6 digits, then the letters advance.">
            @if (pidSerial() === 'alpha') {
              <pf-select class="pf-org__sel pf-ls__letters" [options]="letterOptions" [value]="pidLetters()" (valueChange)="pidLetters.set(+$any($event))" aria-label="Letters"></pf-select>
            }
            <button type="button" class="pf-toggle pf-ls__sw" role="switch" [attr.aria-checked]="pidSerial() === 'alpha'" aria-label="Include letters"
                    (click)="pidSerial.set(pidSerial() === 'alpha' ? 'numeric' : 'alpha')"><span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span></button>
          </pf-setting-row>
          <pf-setting-row label="Preview">
            <strong class="pf-fmt__value pf-num pf-ls__preview">{{ pidPreview() }}</strong>
          </pf-setting-row>
        }
        @if (hosted) {
          <pf-settings-savebar label="Patient ID changed" [dirty]="pidDirty()" [saving]="pidSaving()" (save)="savePatientId()" (discard)="discardPid()"></pf-settings-savebar>
        }
      </pf-setting-group>
      }

      </div>
      </div>
    </section>
  `,
  styles: [`
    /* pf-kit cards in a readable column; the band body scrolls, never the page. */
    .pf-ls__col { display: flex; flex-direction: column; gap: 16px; max-width: 56rem; margin-inline: auto; width: 100%; }
    .pf-org__sel { width: 160px; }
    .pf-org__in { width: 110px; height: 34px; min-height: 34px; }
    .pf-ls__card { overflow: visible; }
    .pf-ls__body { overflow: visible; gap: 14px; padding: 14px 16px 18px; }
    .pf-ls__title { margin: 0; }
    .pf-ls__hint  { margin: 0; font-size: 12.5px; color: var(--text-tertiary); line-height: 1.55; }
    .pf-ls__opt { font-weight: 400; color: var(--text-tertiary); }
    .pf-ls__row { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; }
    .pf-ls__grow { flex: 1 1 260px; max-width: 28rem; }
    .pf-ls__grid { display: grid; gap: 12px; }
    .pf-ls__grid--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .pf-ls__grid--4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .pf-ls__letters { max-width: 220px; }
    .pf-ls__preview { margin: 0; font-size: 13px; color: var(--text-secondary); }
    .pf-ls__preview strong { color: var(--text-primary); font-weight: 600; }
    .pf-ls__save { align-self: flex-start; }
    .pf-ls__sw { flex-shrink: 0; }
    .pf-ls__link { align-self: flex-start; font-size: 13px; font-weight: 600; color: var(--violet-text, #7c3aed); text-decoration: none; }
    .pf-ls__link:hover { text-decoration: underline; }
    .pf-ls__inline-toggle { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    .pf-ls__inline-toggle-text { font-size: 13px; color: var(--text-secondary); line-height: 1.5; }
    .pf-ls__inline-toggle-text strong { color: var(--text-primary); font-weight: 600; }

    /* iPad: the 4-up grid goes 2-up; phones stack. */
    @media (max-width: 1023px) { .pf-ls__grid--4 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 640px) {
      .pf-ls__grid--3, .pf-ls__grid--4 { grid-template-columns: 1fr; }
      .pf-ls__inline-toggle { align-items: flex-start; }
      .pf-ls__grow { max-width: none; }
    }
  `]
})
export class OrganizationSettingsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);

  /** Band pill tabs (new design). Classic shows every card, as before. */
  private readonly route = inject(ActivatedRoute);
  /** Settings re-home: `/admin/org/numbers` shows only these tabs (route `data.orgTabs`); the old
   *  `/admin/organization` has no data and shows all of them, as before. */
  private readonly onlyTabs = (this.route.snapshot.data?.['orgTabs'] as OrgSettingsTab[] | undefined) ?? null;
  readonly tabOptions: SegmentedOption<OrgSettingsTab>[] = ([
    { value: 'identity', label: 'Identity' },
    { value: 'patient', label: 'Patient ID' },
  ] as SegmentedOption<OrgSettingsTab>[]).filter(o => !this.onlyTabs || this.onlyTabs.includes(o.value));
  readonly tab = signal<OrgSettingsTab>(this.onlyTabs?.[0] ?? 'identity');
  /** Inside the Settings shell the left panel lists the tabs: the URL's `?tab=` drives this page. */
  protected readonly hosted = injectSettingsHosted();
  private readonly followTab = bindTabQuery(ORG_SETTINGS_TABS, (t) => { if (!this.onlyTabs || this.onlyTabs.includes(t)) this.tab.set(t); });
  private readonly router = inject(Router);
  /** Switch tab and keep it in the URL (`?tab=`, replacing this history
   *  entry) so a reload, a shared link and back all return to it. */
  pickTab(t: OrgSettingsTab): void {
    this.tab.set(t);
    void this.router.navigate([], { queryParams: { tab: t }, queryParamsHandling: 'merge', replaceUrl: true });
  }
  showSec(key: OrgSettingsTab): boolean {
    // In the Settings shell the page is ONE card: every section it owns is shown (its rows); elsewhere the tab picks.
    if (this.hosted) return !this.onlyTabs || this.onlyTabs.includes(key);
    return !this.theme.isNewDesign() || this.tab() === key;
  }

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

  // ── Band Save (new design): the open tab's save is the ONE primary ──
  private readonly nameDirty = computed(() => !!this.orgName().trim() && this.orgName().trim() !== this.orgNameOriginal());
  private readonly slugDirty = computed(() => !!this.slug() && this.slug() !== this.slugOriginal());
  readonly bandSaveLabel = computed(() => this.hosted || this.tab() === 'identity' ? 'Save' : 'Save format');
  readonly bandSaving = computed(() => {
    if (this.hosted) return this.pidSaving();
    switch (this.tab()) {
      case 'identity': return this.orgNameSaving() || this.slugSaving();
      default: return this.pidSaving();
    }
  });
  readonly bandSaveDisabled = computed(() =>
    this.bandSaving() || (!this.hosted && this.tab() === 'identity' && !this.nameDirty() && !this.slugDirty()));
  /** Identity saves whichever of name / handle changed (independent PATCHes). */
  saveTab(): void {
    if (this.hosted) {
      if (this.showSec('patient')) this.savePatientId();
      return;
    }
    switch (this.tab()) {
      case 'identity':
        if (this.nameDirty()) this.saveOrgName();
        if (this.slugDirty()) this.saveSlug();
        break;
      case 'patient': this.savePatientId(); break;
    }
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

  ngOnInit() {
    // Deep link: …/organization?tab=<identity|patient|sample|order> (the
    // settings search and Lab settings link straight to a card).
    const t = this.router.parseUrl(this.router.url).queryParams['tab'];
    if ((ORG_SETTINGS_TABS as readonly string[]).includes(t) && (!this.onlyTabs || this.onlyTabs.includes(t))) this.tab.set(t as OrgSettingsTab);
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
        if (!c) { this.pidBase.set(this.pidSnap()); return; }
        this.pidEnabled.set(!!c.enabled);
        this.pidDate.set(c.datePrefix ?? 'ddmmyy');
        this.pidSep.set(c.separator ?? '-');
        this.pidPad.set(this.sanitizePadValue(c.padding ?? 4, c.serialMode === 'alpha'));
        this.pidPrefix.set(c.prefix ?? '');
        this.pidSerial.set(c.serialMode === 'alpha' ? 'alpha' : 'numeric');
        this.pidLetters.set(Math.min(Math.max(c.letterCount ?? 2, 1), 4));
        this.pidBase.set(this.pidSnap());
      }
    });
  }

  // ── Unsaved changes: each format's Save bar in its card (owner: Save sits in the pane, never the band) ──
  private pidSnap(): string { return JSON.stringify([this.pidEnabled(), this.pidDate(), this.pidSep(), this.pidPad(), this.pidPrefix(), this.pidSerial(), this.pidLetters()]); }
  private readonly pidBase = signal('');
  readonly pidDirty = computed(() => !!this.pidBase() && this.pidSnap() !== this.pidBase());
  readonly unsavedLabel = 'the patient number format';
  hasUnsavedChanges(): boolean { return this.hosted && this.pidDirty(); }
  discardPid(): void {
    const [e, d, s, p, pr, se, l] = JSON.parse(this.pidBase());
    this.pidEnabled.set(e); this.pidDate.set(d); this.pidSep.set(s); this.pidPad.set(p); this.pidPrefix.set(pr); this.pidSerial.set(se); this.pidLetters.set(l);
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
      next: () => { this.pidSaving.set(false); this.pidBase.set(this.pidSnap()); this.toasts.success('Patient ID format saved'); },
      error: e => { this.pidSaving.set(false); this.toasts.error(ApiError.from(e).message); },
    });
  }

}
