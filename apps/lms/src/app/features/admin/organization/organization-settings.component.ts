import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/auth/auth.service';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';


@Component({
  selector: 'pf-organization-settings',
  standalone: true,
  imports: [FormsModule, ScreenHeaderComponent, TileComponent, TouchButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10">
      <pf-screen-header
        eyebrow="Admin"
        title="Organization & Identity"
        subtitle="Patient ID format and tenant data tools.">
      </pf-screen-header>

      <!-- Organization display NAME — distinct from the login handle below.
           The page used to show only the handle, so "arun-labs" read as if
           it were the organization's name (UAT item 16). -->
      <pf-tile tone="default" padding="lg" class="block mb-5">
        <h3 class="pf-ls__title">Organization name</h3>
        <p class="pf-ls__hint">
          The display name shown across the app, on reports and invoices —
          e.g. "Arun Labs". The lowercase sign-in handle below is separate.
        </p>
        <div class="flex flex-wrap items-end gap-3 mt-4">
          <label class="block grow max-w-md">
            <span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted);">Name</span>
            <input class="pf-input mt-1 w-full" maxlength="80" [ngModel]="orgName()" (ngModelChange)="orgName.set($event)"
                   placeholder="e.g. Arun Labs" />
          </label>
          <button type="button" class="px-4 py-2 rounded-xl text-sm font-bold text-white"
                  style="background: var(--violet-600, #7c3aed);"
                  [disabled]="orgNameSaving() || !orgName().trim() || orgName().trim() === orgNameOriginal()"
                  (click)="saveOrgName()">
            {{ orgNameSaving() ? 'Saving…' : 'Save name' }}
          </button>
        </div>
      </pf-tile>

      <!-- Organization login handle (tenant "username") — OPS-13 -->
      <pf-tile tone="default" padding="lg" class="block mb-5">
        <h3 class="pf-ls__title">Organization login handle</h3>
        <p class="pf-ls__hint">
          This is the organization name your staff type on the sign-in screen.
          <strong>Changing it changes how everyone logs in</strong> — old links and saved credentials that use the previous handle will stop working.
        </p>
        <div class="flex flex-wrap items-end gap-3 mt-4">
          <label class="block">
            <span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted);">Handle</span>
            <input class="pf-input mt-1" maxlength="40" [ngModel]="slug()" (ngModelChange)="onSlugInput($event)"
                   placeholder="e.g. microworld" autocapitalize="off" autocorrect="off" spellcheck="false" />
          </label>
          <button type="button" class="pf-save-slug px-4 py-2 rounded-xl text-sm font-bold text-white"
                  style="background: var(--violet-600, #7c3aed);"
                  [disabled]="slugSaving() || !slug() || slug() === slugOriginal()" (click)="saveSlug()">
            {{ slugSaving() ? 'Saving…' : 'Save handle' }}
          </button>
        </div>
      </pf-tile>

      <!-- Patient ID format -->
      <pf-tile tone="default" padding="lg" class="block mb-5">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <h3 class="pf-ls__title">Patient ID format</h3>
            <p class="pf-ls__hint">
              Choose how new patient IDs are generated. The running number is <strong>continuous</strong>
              (never resets); the date is just a prefix. Existing patient IDs are never changed.
            </p>
          </div>
          <label class="pf-ls__toggle" [class.pf-ls__toggle--on]="pidEnabled()">
            <input type="checkbox" [checked]="pidEnabled()" (change)="pidEnabled.set($any($event.target).checked)" />
            <span class="pf-ls__toggle-track"><span class="pf-ls__toggle-thumb"></span></span>
          </label>
        </div>

        @if (pidEnabled()) {
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
            <label class="block">
              <span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted);">Date prefix</span>
              <select class="pf-input mt-1" [ngModel]="pidDate()" (ngModelChange)="pidDate.set($event)">
                <option value="yymmdd">YYMMDD</option>
                <option value="ddmmyy">DDMMYY</option>
                <option value="mmdd">MMDD</option>
                <option value="yymm">YYMM</option>
                <option value="mmyy">MMYY</option>
                <option value="yy">YY</option>
                <option value="dd">DD</option>
                <option value="none">None</option>
              </select>
            </label>
            <label class="block">
              <span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted);">Separator <span style="text-transform:none;font-weight:500;opacity:.7">(blank = none)</span></span>
              <input class="pf-input mt-1" maxlength="3" [ngModel]="pidSep()" (ngModelChange)="pidSep.set($event)" placeholder="none" />
            </label>
            <label class="block">
              <span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted);">{{ pidSerial() === 'alpha' ? 'Min number digits' : 'Number digits' }}</span>
              <input class="pf-input mt-1" type="number" min="1" [attr.max]="pidSerial() === 'alpha' ? 6 : 10" [ngModel]="pidPad()" (ngModelChange)="onPidPadChange($event)" (keydown)="preventMinus($event)" />
            </label>
            <label class="block">
              <span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted);">Prefix (optional)</span>
              <input class="pf-input mt-1" maxlength="16" [ngModel]="pidPrefix()" (ngModelChange)="pidPrefix.set($event)" placeholder="e.g. LAB" />
            </label>
          </div>

          <!-- Letters are optional: ON → alphanumeric odometer, OFF → plain numbers. -->
          <label class="pf-ls__inline-toggle mt-4">
            <span class="pf-ls__inline-toggle-text">
              <strong>Include letters</strong> <span style="opacity:.7">— alphanumeric IDs (a001 … then b, c …). Off = plain numbers.</span>
            </span>
            <span class="pf-ls__toggle" [class.pf-ls__toggle--on]="pidSerial() === 'alpha'">
              <input type="checkbox" [checked]="pidSerial() === 'alpha'" (change)="pidSerial.set($any($event.target).checked ? 'alpha' : 'numeric')" />
              <span class="pf-ls__toggle-track"><span class="pf-ls__toggle-thumb"></span></span>
            </span>
          </label>

          @if (pidSerial() === 'alpha') {
            <label class="block mt-4 max-w-[220px]">
              <span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted);">Letters</span>
              <select class="pf-input mt-1" [ngModel]="pidLetters()" (ngModelChange)="pidLetters.set(+$event)">
                <option [ngValue]="1">A (1 letter)</option>
                <option [ngValue]="2">AA (2 letters)</option>
                <option [ngValue]="3">AAA (3 letters)</option>
                <option [ngValue]="4">AAAA (4 letters)</option>
              </select>
            </label>
            <p class="pf-ls__hint mt-3">
              Alphanumeric odometer: the number runs up to <strong>6 digits</strong> (max 999999), then the
              <strong>uppercase</strong> letters advance at the chosen fixed width. Example (AA):
              <span class="font-mono">AA001 … AA999999, AB001 …, ZZ999999</span>.
            </p>
          }
          <p class="mt-3 text-[13px]" style="color: var(--text-secondary);">
            Preview: <strong class="font-mono" style="color: var(--text-primary);">{{ pidPreview() }}</strong>
          </p>
        } @else {
          <p class="pf-ls__hint mt-2">Using the built-in format (e.g. <span class="font-mono">DEL-2606-000042-7</span>).</p>
        }
        <button type="button" class="mt-4 px-4 py-2 rounded-xl text-sm font-bold text-white"
                style="background: var(--violet-600, #7c3aed);" [disabled]="pidSaving()" (click)="savePatientId()">
          {{ pidSaving() ? 'Saving…' : 'Save format' }}
        </button>
      </pf-tile>

      <!-- Sample ID format (prefix = space code) -->
      <pf-tile tone="default" padding="lg" class="block mb-5">
        <div class="min-w-0">
          <h3 class="pf-ls__title">Sample ID format</h3>
          <p class="pf-ls__hint">
            Every tube's ID is <strong>SPACE-DATE-NUMBER</strong> (e.g. <span class="font-mono">MIC-2607-00001</span>).
            The <strong>space code</strong> comes from Branches → “Departments &amp; lab spaces”. The number restarts <strong>each month per space</strong>.
          </p>
        </div>
        @if (idSection(sampleFmt); as f) {
          <div class="grid grid-cols-2 md:grid-cols-3 gap-3 mt-4">
            <label class="block">
              <span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted);">Date</span>
              <select class="pf-input mt-1" [ngModel]="f.date()" (ngModelChange)="f.date.set($event)">
                <option value="yymmdd">YYMMDD</option><option value="ddmmyy">DDMMYY</option>
                <option value="mmdd">MMDD</option><option value="yymm">YYMM</option>
                <option value="mmyy">MMYY</option><option value="yy">YY</option>
                <option value="dd">DD</option><option value="none">None</option>
              </select>
            </label>
            <label class="block">
              <span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted);">Separator <span style="text-transform:none;font-weight:500;opacity:.7">(blank = none)</span></span>
              <input class="pf-input mt-1" maxlength="3" [ngModel]="f.sep()" (ngModelChange)="f.sep.set($event)" placeholder="none" />
            </label>
            <label class="block">
              <span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted);">{{ f.serial() === 'alpha' ? 'Min number digits' : 'Number digits' }}</span>
              <input class="pf-input mt-1" type="number" min="1" [attr.max]="f.serial() === 'alpha' ? 6 : 10" [ngModel]="f.pad()" (ngModelChange)="onFormatPadChange(f, $event)" (keydown)="preventMinus($event)" />
            </label>
          </div>
          <label class="pf-ls__inline-toggle mt-4">
            <span class="pf-ls__inline-toggle-text"><strong>Include letters</strong> <span style="opacity:.7">— alphanumeric (AA001 …). Off = plain numbers.</span></span>
            <span class="pf-ls__toggle" [class.pf-ls__toggle--on]="f.serial() === 'alpha'">
              <input type="checkbox" [checked]="f.serial() === 'alpha'" (change)="f.serial.set($any($event.target).checked ? 'alpha' : 'numeric')" />
              <span class="pf-ls__toggle-track"><span class="pf-ls__toggle-thumb"></span></span>
            </span>
          </label>
          @if (f.serial() === 'alpha') {
            <label class="block mt-4 max-w-[220px]">
              <span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted);">Letters</span>
              <select class="pf-input mt-1" [ngModel]="f.letters()" (ngModelChange)="f.letters.set(+$event)">
                <option [ngValue]="1">A</option><option [ngValue]="2">AA</option><option [ngValue]="3">AAA</option><option [ngValue]="4">AAAA</option>
              </select>
            </label>
          }
          <p class="mt-3 text-[13px]" style="color: var(--text-secondary);">
            Preview: <strong class="font-mono" style="color: var(--text-primary);">{{ f.preview() }}</strong>
          </p>
          <button type="button" class="mt-4 px-4 py-2 rounded-xl text-sm font-bold text-white"
                  style="background: var(--violet-600, #7c3aed);" [disabled]="f.saving()" (click)="saveIdFormat(f)">
            {{ f.saving() ? 'Saving…' : 'Save format' }}
          </button>
        }
      </pf-tile>

      <!-- Order ID format (prefix = module code) -->
      <pf-tile tone="default" padding="lg" class="block mb-5">
        <div class="min-w-0">
          <h3 class="pf-ls__title">Order ID format</h3>
          <p class="pf-ls__hint">
            Each order's ID is <strong>MODULE-DATE-NUMBER</strong> (e.g. <span class="font-mono">LAB-2607-000042</span>).
            The <strong>module</strong> is set automatically (lab orders → <span class="font-mono">LAB</span>; OPD/IPD later). The number restarts <strong>each month per module</strong>.
          </p>
        </div>
        @if (idSection(orderFmt); as f) {
          <div class="grid grid-cols-2 md:grid-cols-3 gap-3 mt-4">
            <label class="block">
              <span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted);">Date</span>
              <select class="pf-input mt-1" [ngModel]="f.date()" (ngModelChange)="f.date.set($event)">
                <option value="yymmdd">YYMMDD</option><option value="ddmmyy">DDMMYY</option>
                <option value="mmdd">MMDD</option><option value="yymm">YYMM</option>
                <option value="mmyy">MMYY</option><option value="yy">YY</option>
                <option value="dd">DD</option><option value="none">None</option>
              </select>
            </label>
            <label class="block">
              <span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted);">Separator <span style="text-transform:none;font-weight:500;opacity:.7">(blank = none)</span></span>
              <input class="pf-input mt-1" maxlength="3" [ngModel]="f.sep()" (ngModelChange)="f.sep.set($event)" placeholder="none" />
            </label>
            <label class="block">
              <span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted);">{{ f.serial() === 'alpha' ? 'Min number digits' : 'Number digits' }}</span>
              <input class="pf-input mt-1" type="number" min="1" [attr.max]="f.serial() === 'alpha' ? 6 : 10" [ngModel]="f.pad()" (ngModelChange)="onFormatPadChange(f, $event)" (keydown)="preventMinus($event)" />
            </label>
          </div>
          <label class="pf-ls__inline-toggle mt-4">
            <span class="pf-ls__inline-toggle-text"><strong>Include letters</strong> <span style="opacity:.7">— alphanumeric (AA001 …). Off = plain numbers.</span></span>
            <span class="pf-ls__toggle" [class.pf-ls__toggle--on]="f.serial() === 'alpha'">
              <input type="checkbox" [checked]="f.serial() === 'alpha'" (change)="f.serial.set($any($event.target).checked ? 'alpha' : 'numeric')" />
              <span class="pf-ls__toggle-track"><span class="pf-ls__toggle-thumb"></span></span>
            </span>
          </label>
          @if (f.serial() === 'alpha') {
            <label class="block mt-4 max-w-[220px]">
              <span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted);">Letters</span>
              <select class="pf-input mt-1" [ngModel]="f.letters()" (ngModelChange)="f.letters.set(+$event)">
                <option [ngValue]="1">A</option><option [ngValue]="2">AA</option><option [ngValue]="3">AAA</option><option [ngValue]="4">AAAA</option>
              </select>
            </label>
          }
          <p class="mt-3 text-[13px]" style="color: var(--text-secondary);">
            Preview: <strong class="font-mono" style="color: var(--text-primary);">{{ f.preview() }}</strong>
          </p>
          <button type="button" class="mt-4 px-4 py-2 rounded-xl text-sm font-bold text-white"
                  style="background: var(--violet-600, #7c3aed);" [disabled]="f.saving()" (click)="saveIdFormat(f)">
            {{ f.saving() ? 'Saving…' : 'Save format' }}
          </button>
        }
      </pf-tile>

    </section>
  `,
  styles: [`
    .pf-ls__title { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .pf-ls__hint  { margin: 6px 0 0; font-size: 12.5px; color: var(--text-tertiary); line-height: 1.55; }

    .pf-ls__toggle { cursor: pointer; display: inline-flex; align-items: center; }
    .pf-ls__toggle input { position: absolute; opacity: 0; pointer-events: none; }
    .pf-ls__toggle-track {
      position: relative; width: 44px; height: 24px; border-radius: 9999px;
      background: var(--border-muted); transition: background 0.2s ease;
    }
    .pf-ls__toggle-thumb {
      position: absolute; top: 3px; left: 3px;
      width: 18px; height: 18px; border-radius: 9999px;
      background: #fff; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
      transition: transform 0.2s ease;
    }
    .pf-ls__toggle--on .pf-ls__toggle-track { background: var(--gradient-primary); }
    .pf-ls__toggle--on .pf-ls__toggle-thumb { transform: translateX(20px); }

    .pf-ls__inline-toggle {
      display: flex; align-items: center; justify-content: space-between;
      gap: 16px; cursor: pointer;
    }
    .pf-ls__inline-toggle-text { font-size: 13px; color: var(--text-secondary); line-height: 1.5; }

    /* ── Cross-platform overrides — additive only, never touch base rules ── */

    /* Coarse-pointer (touch) sizing: make the toggle a >=44px tap target
       without changing its visual track size. Scoped to this page's toggle. */
    @media (pointer: coarse) {
      :host .pf-ls__toggle { min-width: 44px; min-height: 44px; justify-content: flex-end; }
      :host .pf-ls__inline-toggle .pf-ls__toggle { min-width: 0; }

      /* This page's own action button (Save format): the toolbar primitives
         already meet 44px, but this inline button is sized with small Tailwind
         padding — bump its hit area. */
      :host button[type="button"] { min-height: 44px; }
      :host .pf-ls__inline-toggle .pf-ls__toggle { min-height: 44px; align-items: center; }
    }

    /* Phone (<=640): keep iOS from auto-zooming form fields by ensuring
       a >=16px font on this page's own controls. Targets element selectors
       under :host so the shared .pf-input primitive is left untouched. */
    @media (max-width: 640px) {
      :host .px-4 { padding-left: 16px; padding-right: 16px; }
      :host select,
      :host input[type="text"],
      :host input[type="number"],
      :host input:not([type]) { font-size: 16px; }

      /* Patient-ID grid: 2 cols can crowd narrow phones — go single column. */
      :host .grid.grid-cols-2 { grid-template-columns: 1fr; }

      /* Danger zone: stack the button full-width below the copy on phone. */

      /* Header rows: the title/copy + toggle stay on one row but allow
         the copy to shrink so the toggle never gets pushed off-screen. */
      :host .pf-ls__inline-toggle { align-items: flex-start; }
    }

    /* iPad (641–1279): use the width — show the patient-ID fields as a
       2-up grid rather than the desktop 4-up, which would be too tight. */
    @media (min-width: 641px) and (max-width: 1279px) {
      :host .grid.grid-cols-2.md\\:grid-cols-4 { grid-template-columns: repeat(2, 1fr); }
    }
  `]
})
export class OrganizationSettingsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly auth = inject(AuthService);

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

  // ── Danger-zone state ──
  /** Mirrors the backend gate. Hide the danger-zone tile if the user
   *  doesn't hold manage_tenant — they'd 403 on click anyway. */

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
