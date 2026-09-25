import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
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

/** Band pill tabs — one per independently-saved identity setting. */
export type OrgSettingsTab = 'identity' | 'patient' | 'sample' | 'order';


@Component({
  selector: 'pf-organization-settings',
  standalone: true,
  imports: [FormsModule, ScreenHeaderComponent, HeroBandComponent, SegmentedComponent, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <!-- Band (owner): no search here — the sections are tabs in a
             tabs-only pill; the open tab's Save is the band's ONE primary. -->
        <pf-hero-band [back]="true" [tabsOnly]="true">
          <ng-container band-tools>
            <pf-segmented class="pf-hb-tabs" size="sm" [options]="tabOptions" [value]="tab()"
                          (valueChange)="tab.set($event)"></pf-segmented>
          </ng-container>
          <ng-container band-actions>
            <button type="button" class="pf-hb-btn pf-hb-btn--primary pf-ls__bandsave press"
                    [disabled]="bandSaveDisabled()" (click)="saveTab()"
                    [attr.aria-label]="bandSaveLabel()" [title]="bandSaveLabel()">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>
              {{ bandSaving() ? 'Saving…' : bandSaveLabel() }}
            </button>
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="Admin"
        title="Organization & Identity"
        subtitle="Patient ID format and tenant data tools.">
      </pf-screen-header>

      <div class="pf-band-body">
      <div class="pf-ls__col">
      @if (showSec('identity')) {
      <!-- Organization display NAME — distinct from the login handle below.
           The page used to show only the handle, so "arun-labs" read as if
           it were the organization's name (UAT item 16). -->
      <section class="nd-card pf-ls__card">
        <div class="nd-card__head">
          <span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
          <h3 class="nd-card__label pf-ls__title">Organization name</h3>
        </div>
        <div class="nd-card__body pf-ls__body">
          <p class="pf-ls__hint">
            The display name shown across the app, on reports and invoices —
            e.g. "Arun Labs". The lowercase sign-in handle below is separate.
          </p>
          <div class="pf-ls__row">
            <label class="nd-field pf-ls__grow">
              <span class="nd-field__lbl">Name</span>
              <input class="nd-input" maxlength="80" [ngModel]="orgName()" (ngModelChange)="orgName.set($event)"
                     placeholder="e.g. Arun Labs" />
            </label>
            <button type="button" class="nd-btn nd-btn--primary pf-ls__save pf-classic-only press"
                    [disabled]="orgNameSaving() || !orgName().trim() || orgName().trim() === orgNameOriginal()"
                    (click)="saveOrgName()">
              {{ orgNameSaving() ? 'Saving…' : 'Save name' }}
            </button>
          </div>
        </div>
      </section>
      }

      @if (showSec('identity')) {
      <!-- Organization login handle (tenant "username") — OPS-13 -->
      <section class="nd-card pf-ls__card">
        <div class="nd-card__head">
          <span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/></svg></span>
          <h3 class="nd-card__label pf-ls__title">Organization login handle</h3>
        </div>
        <div class="nd-card__body pf-ls__body">
          <p class="pf-ls__hint">
            This is the organization name your staff type on the sign-in screen.
            <strong>Changing it changes how everyone logs in</strong> — old links and saved credentials that use the previous handle will stop working.
          </p>
          <div class="pf-ls__row">
            <label class="nd-field pf-ls__grow">
              <span class="nd-field__lbl">Handle</span>
              <input class="nd-input" maxlength="40" [ngModel]="slug()" (ngModelChange)="onSlugInput($event)"
                     placeholder="e.g. microworld" autocapitalize="off" autocorrect="off" spellcheck="false" />
            </label>
            <button type="button" class="nd-btn nd-btn--primary pf-save-slug pf-ls__save pf-classic-only press"
                    [disabled]="slugSaving() || !slug() || slug() === slugOriginal()" (click)="saveSlug()">
              {{ slugSaving() ? 'Saving…' : 'Save handle' }}
            </button>
          </div>
        </div>
      </section>
      }

      @if (showSec('patient')) {
      <!-- Patient ID format -->
      <section class="nd-card pf-ls__card">
        <div class="nd-card__head">
          <span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M15 8h2M15 12h2M7 16h10"/></svg></span>
          <h3 class="nd-card__label pf-ls__title">Patient ID format</h3>
          <span class="nd-card__spacer"></span>
          <button type="button" class="nd-toggle pf-ls__sw" role="switch" [attr.aria-checked]="pidEnabled()" aria-label="Custom patient ID format"
                  (click)="pidEnabled.set(!pidEnabled())"><span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span></button>
        </div>
        <div class="nd-card__body pf-ls__body">
          <p class="pf-ls__hint">
            Choose how new patient IDs are generated. The running number is <strong>continuous</strong>
            (never resets); the date is just a prefix. Existing patient IDs are never changed.
          </p>

        @if (pidEnabled()) {
          <div class="pf-ls__grid pf-ls__grid--4">
            <div class="nd-field">
              <span class="nd-field__lbl">Date prefix</span>
              <pf-select [options]="dateOptions" [value]="pidDate()" (valueChange)="pidDate.set($any($event))"></pf-select>
            </div>
            <label class="nd-field">
              <span class="nd-field__lbl">Separator <span class="pf-ls__opt">(blank = none)</span></span>
              <input class="nd-input nd-num" maxlength="3" [ngModel]="pidSep()" (ngModelChange)="pidSep.set($event)" placeholder="none" />
            </label>
            <label class="nd-field">
              <span class="nd-field__lbl">{{ pidSerial() === 'alpha' ? 'Min number digits' : 'Number digits' }}</span>
              <input class="nd-input nd-num" type="number" min="1" [attr.max]="pidSerial() === 'alpha' ? 6 : 10" [ngModel]="pidPad()" (ngModelChange)="onPidPadChange($event)" (keydown)="preventMinus($event)" />
            </label>
            <label class="nd-field">
              <span class="nd-field__lbl">Prefix <span class="pf-ls__opt">(optional)</span></span>
              <input class="nd-input nd-num" maxlength="16" [ngModel]="pidPrefix()" (ngModelChange)="pidPrefix.set($event)" placeholder="e.g. LAB" />
            </label>
          </div>

          <!-- Letters are optional: ON → alphanumeric odometer, OFF → plain numbers. -->
          <div class="pf-ls__inline-toggle">
            <span class="pf-ls__inline-toggle-text">
              <strong>Include letters</strong> <span class="pf-ls__opt">— alphanumeric IDs (a001 … then b, c …). Off = plain numbers.</span>
            </span>
            <button type="button" class="nd-toggle pf-ls__sw" role="switch" [attr.aria-checked]="pidSerial() === 'alpha'" aria-label="Include letters"
                    (click)="pidSerial.set(pidSerial() === 'alpha' ? 'numeric' : 'alpha')"><span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span></button>
          </div>

          @if (pidSerial() === 'alpha') {
            <div class="nd-field pf-ls__letters">
              <span class="nd-field__lbl">Letters</span>
              <pf-select [options]="letterOptions" [value]="pidLetters()" (valueChange)="pidLetters.set(+$any($event))"></pf-select>
            </div>
            <p class="pf-ls__hint">
              Alphanumeric odometer: the number runs up to <strong>6 digits</strong> (max 999999), then the
              <strong>uppercase</strong> letters advance at the chosen fixed width. Example (AA):
              <span class="nd-num">AA001 … AA999999, AB001 …, ZZ999999</span>.
            </p>
          }
          <p class="pf-ls__preview">Preview: <strong class="nd-num">{{ pidPreview() }}</strong></p>
        } @else {
          <p class="pf-ls__hint">Using the built-in format (e.g. <span class="nd-num">DEL-2606-000042-7</span>).</p>
        }
          <button type="button" class="nd-btn nd-btn--primary pf-ls__save pf-classic-only press" [disabled]="pidSaving()" (click)="savePatientId()">
            {{ pidSaving() ? 'Saving…' : 'Save format' }}
          </button>
        </div>
      </section>
      }

      @if (showSec('sample')) {
      <!-- Sample ID format (prefix = space code) -->
      <section class="nd-card pf-ls__card">
        <div class="nd-card__head">
          <span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2v17a3 3 0 0 0 6 0V2"/><path d="M8 2h8M9 12h6"/></svg></span>
          <h3 class="nd-card__label pf-ls__title">Sample ID format</h3>
        </div>
        <div class="nd-card__body pf-ls__body">
          <p class="pf-ls__hint">
            Every tube's ID is <strong>SPACE-DATE-NUMBER</strong> (e.g. <span class="nd-num">MIC-2607-00001</span>).
            The <strong>space code</strong> comes from Branches → “Departments &amp; lab spaces”. The number restarts <strong>each month per space</strong>.
          </p>
          <div class="pf-ls__grid pf-ls__grid--3">
            <div class="nd-field">
              <span class="nd-field__lbl">Date</span>
              <pf-select [options]="dateOptions" [value]="sampleFmt.date()" (valueChange)="sampleFmt.date.set($any($event))"></pf-select>
            </div>
            <label class="nd-field">
              <span class="nd-field__lbl">Separator <span class="pf-ls__opt">(blank = none)</span></span>
              <input class="nd-input nd-num" maxlength="3" [ngModel]="sampleFmt.sep()" (ngModelChange)="sampleFmt.sep.set($event)" placeholder="none" />
            </label>
            <label class="nd-field">
              <span class="nd-field__lbl">{{ sampleFmt.serial() === 'alpha' ? 'Min number digits' : 'Number digits' }}</span>
              <input class="nd-input nd-num" type="number" min="1" [attr.max]="sampleFmt.serial() === 'alpha' ? 6 : 10" [ngModel]="sampleFmt.pad()" (ngModelChange)="onFormatPadChange(sampleFmt, $event)" (keydown)="preventMinus($event)" />
            </label>
          </div>
          <div class="pf-ls__inline-toggle">
            <span class="pf-ls__inline-toggle-text"><strong>Include letters</strong> <span class="pf-ls__opt">— alphanumeric (AA001 …). Off = plain numbers.</span></span>
            <button type="button" class="nd-toggle pf-ls__sw" role="switch" [attr.aria-checked]="sampleFmt.serial() === 'alpha'" aria-label="Include letters"
                    (click)="sampleFmt.serial.set(sampleFmt.serial() === 'alpha' ? 'numeric' : 'alpha')"><span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span></button>
          </div>
          @if (sampleFmt.serial() === 'alpha') {
            <div class="nd-field pf-ls__letters">
              <span class="nd-field__lbl">Letters</span>
              <pf-select [options]="letterShortOptions" [value]="sampleFmt.letters()" (valueChange)="sampleFmt.letters.set(+$any($event))"></pf-select>
            </div>
          }
          <p class="pf-ls__preview">Preview: <strong class="nd-num">{{ sampleFmt.preview() }}</strong></p>
          <button type="button" class="nd-btn nd-btn--primary pf-ls__save pf-classic-only press" [disabled]="sampleFmt.saving()" (click)="saveIdFormat(sampleFmt)">
            {{ sampleFmt.saving() ? 'Saving…' : 'Save format' }}
          </button>
        </div>
      </section>
      }

      @if (showSec('order')) {
      <!-- Order ID format (prefix = module code) -->
      <section class="nd-card pf-ls__card">
        <div class="nd-card__head">
          <span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg></span>
          <h3 class="nd-card__label pf-ls__title">Order ID format</h3>
        </div>
        <div class="nd-card__body pf-ls__body">
          <p class="pf-ls__hint">
            Each order's ID is <strong>MODULE-DATE-NUMBER</strong> (e.g. <span class="nd-num">LAB-2607-000042</span>).
            The <strong>module</strong> is set automatically (lab orders → <span class="nd-num">LAB</span>; OPD/IPD later). The number restarts <strong>each month per module</strong>.
          </p>
          <div class="pf-ls__grid pf-ls__grid--3">
            <div class="nd-field">
              <span class="nd-field__lbl">Date</span>
              <pf-select [options]="dateOptions" [value]="orderFmt.date()" (valueChange)="orderFmt.date.set($any($event))"></pf-select>
            </div>
            <label class="nd-field">
              <span class="nd-field__lbl">Separator <span class="pf-ls__opt">(blank = none)</span></span>
              <input class="nd-input nd-num" maxlength="3" [ngModel]="orderFmt.sep()" (ngModelChange)="orderFmt.sep.set($event)" placeholder="none" />
            </label>
            <label class="nd-field">
              <span class="nd-field__lbl">{{ orderFmt.serial() === 'alpha' ? 'Min number digits' : 'Number digits' }}</span>
              <input class="nd-input nd-num" type="number" min="1" [attr.max]="orderFmt.serial() === 'alpha' ? 6 : 10" [ngModel]="orderFmt.pad()" (ngModelChange)="onFormatPadChange(orderFmt, $event)" (keydown)="preventMinus($event)" />
            </label>
          </div>
          <div class="pf-ls__inline-toggle">
            <span class="pf-ls__inline-toggle-text"><strong>Include letters</strong> <span class="pf-ls__opt">— alphanumeric (AA001 …). Off = plain numbers.</span></span>
            <button type="button" class="nd-toggle pf-ls__sw" role="switch" [attr.aria-checked]="orderFmt.serial() === 'alpha'" aria-label="Include letters"
                    (click)="orderFmt.serial.set(orderFmt.serial() === 'alpha' ? 'numeric' : 'alpha')"><span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span></button>
          </div>
          @if (orderFmt.serial() === 'alpha') {
            <div class="nd-field pf-ls__letters">
              <span class="nd-field__lbl">Letters</span>
              <pf-select [options]="letterShortOptions" [value]="orderFmt.letters()" (valueChange)="orderFmt.letters.set(+$any($event))"></pf-select>
            </div>
          }
          <p class="pf-ls__preview">Preview: <strong class="nd-num">{{ orderFmt.preview() }}</strong></p>
          <button type="button" class="nd-btn nd-btn--primary pf-ls__save pf-classic-only press" [disabled]="orderFmt.saving()" (click)="saveIdFormat(orderFmt)">
            {{ orderFmt.saving() ? 'Saving…' : 'Save format' }}
          </button>
        </div>
      </section>
      }
      </div>
      </div>
    </section>
  `,
  styles: [`
    /* nd-kit cards in a readable column; the band body scrolls, never the page. */
    .pf-ls__col { display: flex; flex-direction: column; gap: 16px; max-width: 56rem; margin-inline: auto; width: 100%; }
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
  private readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);

  /** Band pill tabs (new design). Classic shows every card, as before. */
  readonly tabOptions: SegmentedOption<OrgSettingsTab>[] = [
    { value: 'identity', label: 'Identity' },
    { value: 'patient', label: 'Patient ID' },
    { value: 'sample', label: 'Sample ID' },
    { value: 'order', label: 'Order ID' },
  ];
  readonly tab = signal<OrgSettingsTab>('identity');
  showSec(key: OrgSettingsTab): boolean {
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
  readonly letterShortOptions: PfSelectOption<number>[] = [
    { value: 1, label: 'A' }, { value: 2, label: 'AA' }, { value: 3, label: 'AAA' }, { value: 4, label: 'AAAA' },
  ];

  // ── Band Save (new design): the open tab's save is the ONE primary ──
  private readonly nameDirty = computed(() => !!this.orgName().trim() && this.orgName().trim() !== this.orgNameOriginal());
  private readonly slugDirty = computed(() => !!this.slug() && this.slug() !== this.slugOriginal());
  readonly bandSaveLabel = computed(() => this.tab() === 'identity' ? 'Save' : 'Save format');
  readonly bandSaving = computed(() => {
    switch (this.tab()) {
      case 'identity': return this.orgNameSaving() || this.slugSaving();
      case 'patient': return this.pidSaving();
      case 'sample': return this.sampleFmt.saving();
      default: return this.orderFmt.saving();
    }
  });
  readonly bandSaveDisabled = computed(() =>
    this.bandSaving() || (this.tab() === 'identity' && !this.nameDirty() && !this.slugDirty()));
  /** Identity saves whichever of name / handle changed (independent PATCHes). */
  saveTab(): void {
    switch (this.tab()) {
      case 'identity':
        if (this.nameDirty()) this.saveOrgName();
        if (this.slugDirty()) this.saveSlug();
        break;
      case 'patient': this.savePatientId(); break;
      case 'sample': this.saveIdFormat(this.sampleFmt); break;
      case 'order': this.saveIdFormat(this.orderFmt); break;
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
  protected saveSlug() {
    const s = this.slug();
    if (!s || s === this.slugOriginal()) return;
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
    return { scope, samplePrefix, date, sep, pad, serial, letters, saving, preview };
  }
  private idFmts() { return [this.sampleFmt, this.orderFmt]; }
  /** Identity passthrough so the template can bind a format object via `@if (…; as f)`. */
  protected idSection<T>(f: T): T { return f; }

  ngOnInit() {
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
        }
      });
    }
  }

  saveIdFormat(f: { scope: 'sample' | 'order'; date: any; sep: any; pad: any; serial: any; letters: any; saving: any }) {
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
      next: () => { f.saving.set(false); this.toasts.success(`${f.scope === 'sample' ? 'Sample' : 'Order'} ID format saved`); },
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
      next: () => { this.pidSaving.set(false); this.toasts.success('Patient ID format saved'); },
      error: e => { this.pidSaving.set(false); this.toasts.error(ApiError.from(e).message); },
    });
  }

}
