import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/auth/auth.service';
import { ApiService } from '../../../core/services/api.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

interface WipeResult { patients: number; orders: number; bills: number; reports: number; appointments: number; }

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
              <input class="pf-input mt-1" type="number" min="1" [attr.max]="pidSerial() === 'alpha' ? 6 : 10" [ngModel]="pidPad()" (ngModelChange)="pidPad.set(+$event)" />
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

      <!-- ─── Danger zone ────────────────────────────────────────
       * Dev-testing tool: wipe every patient + order + bill + report
       * + appointment + notification while leaving tenant config /
       * users / roles / test catalog / workflows intact. Gated on
       * manage_tenant — the same perm that lets you save tenant config.
       * Hidden if the user lacks the perm. -->
      @if (canWipe()) {
        <pf-tile tone="rose" padding="lg" class="block mt-6">
          <div class="pf-ls__danger">
            <div class="flex-1 min-w-0">
              <p class="pf-ls__title pf-ls__danger-title">Danger zone · dev testing</p>
              <p class="pf-ls__hint">
                Wipes every patient, order, sample, bill, payment, report, and appointment from
                the database. Tenant config, branches, departments, users, roles, the test catalog,
                and workflows are kept. Use this to reset the system to a clean state during
                dev testing. <span style="color: #fca5a5;">Cannot be undone.</span>
              </p>
              @if (lastWiped(); as w) {
                <p class="pf-ls__warn">Last wipe: cleared {{ w.patients }} patients · {{ w.orders }} orders · {{ w.bills }} bills · {{ w.reports }} reports.</p>
              }
            </div>
            <pf-touch-btn variant="danger" size="md"
                          [disabled]="wiping()"
                          (pressed)="wipePatientData()">
              @if (wiping()) {
                Wiping…
              } @else {
                <span class="inline-flex items-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>
                  </svg>
                  Wipe Patient Data
                </span>
              }
            </pf-touch-btn>
          </div>
        </pf-tile>
      }
    </section>
  `,
  styles: [`
    .pf-ls__title { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .pf-ls__hint  { margin: 6px 0 0; font-size: 12.5px; color: var(--text-tertiary); line-height: 1.55; }
    .pf-ls__danger {
      display: flex; gap: 16px; align-items: center;
      flex-wrap: wrap;
    }
    .pf-ls__danger-title { color: #fca5a5 !important; }
    .pf-ls__danger > pf-touch-btn { flex-shrink: 0; }
    .pf-ls__warn  { margin: 4px 0 0; font-size: 11.5px; color: #fbbf24; font-style: italic; }

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
      :host .pf-ls__danger { align-items: stretch; }
      :host .pf-ls__danger > pf-touch-btn,
      :host .pf-ls__danger pf-touch-btn button { width: 100%; }

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
  private readonly dialog = inject(DialogService);

  // ── Danger-zone state ──
  protected readonly wiping = signal(false);
  protected readonly lastWiped = signal<WipeResult | null>(null);
  /** Mirrors the backend gate. Hide the danger-zone tile if the user
   *  doesn't hold manage_tenant — they'd 403 on click anyway. */
  readonly canWipe = computed(() => this.auth.hasPermission('manage_tenant'));

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
    const serial = this.pidSerial() === 'alpha'
      ? 'A'.repeat(Math.min(Math.max(this.pidLetters(), 1), 4)) + '1'.padStart(Math.min(Math.max(this.pidPad(), 1), 6), '0')
      : '1'.padStart(Math.min(Math.max(this.pidPad(), 1), 10), '0');
    const head = (this.pidPrefix() ?? '') + date;
    // Blank separator → no separator (e.g. mmdd000).
    const sep = this.pidSep() ?? '';
    return head.length ? `${head}${sep}${serial}` : serial;
  });

  ngOnInit() {
    this.api.get<any>('/api/config/patient-id').subscribe({
      next: c => {
        if (!c) return;
        this.pidEnabled.set(!!c.enabled);
        this.pidDate.set(c.datePrefix ?? 'ddmmyy');
        this.pidSep.set(c.separator ?? '-');
        this.pidPad.set(c.padding ?? 4);
        this.pidPrefix.set(c.prefix ?? '');
        this.pidSerial.set(c.serialMode === 'alpha' ? 'alpha' : 'numeric');
        this.pidLetters.set(Math.min(Math.max(c.letterCount ?? 2, 1), 4));
      }
    });
  }

  savePatientId() {
    this.pidSaving.set(true);
    this.api.post('/api/config/patient-id', {
      enabled: this.pidEnabled(),
      datePrefix: this.pidDate(),
      separator: this.pidSep() ?? '',
      padding: this.pidPad(),
      prefix: this.pidPrefix()?.trim() || null,
      serialMode: this.pidSerial(),
      letterCount: this.pidLetters(),
    }).subscribe({
      next: () => { this.pidSaving.set(false); this.toasts.success('Patient ID format saved'); },
      error: e => { this.pidSaving.set(false); this.toasts.error(ApiError.from(e).message); },
    });
  }

  /**
   * Dev-testing wipe — confirm via DialogService, POST to the admin
   * endpoint, surface the cleared counts in the toast and on the tile so
   * the user can see the action took effect.
   */
  async wipePatientData() {
    if (this.wiping()) return;
    const ok = await this.dialog.confirm({
      title: 'Wipe all patient data?',
      message: 'This deletes every patient, order, sample, bill, payment, report, and appointment. Tenant config, branches, departments, users, roles, the test catalog, and workflows are kept. Cannot be undone.',
      confirmLabel: 'Yes, wipe everything',
      cancelLabel: 'Cancel',
      tone: 'danger'
    });
    if (!ok) return;

    this.wiping.set(true);
    this.api.post<{ wiped: boolean; before: { patientsBefore: number; ordersBefore: number; billsBefore: number; reportsBefore: number; appointmentsBefore: number } }>(
      '/api/admin/wipe-patient-data', {}
    ).subscribe({
      next: r => {
        this.wiping.set(false);
        const b = r?.before;
        if (b) {
          this.lastWiped.set({
            patients: b.patientsBefore,
            orders: b.ordersBefore,
            bills: b.billsBefore,
            reports: b.reportsBefore,
            appointments: b.appointmentsBefore
          });
          this.toasts.success(`Cleared ${b.patientsBefore} patients · ${b.ordersBefore} orders · ${b.billsBefore} bills · ${b.reportsBefore} reports`);
        } else {
          this.toasts.success('Patient data wiped');
        }
      },
      error: e => {
        this.wiping.set(false);
        this.toasts.error(ApiError.from(e).message);
      }
    });
  }
}
