import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { DEFAULT_PHARMACY_CONFIG, type PharmacyConfig } from '../shared/opd.models';
import { PharmacyApi } from './pharmacy.api';
import { errText } from './pharmacy-math';
import { PharmacyDrugMasterComponent } from './drug-master.component';
import { PHARMACY_VIEW } from './pharmacy-view';

type Tab = 'settings' | 'drugs';


/**
 * Settings → Pharmacy (`/admin/pharmacy`, the drug master at `/admin/pharmacy/drugs`; the old `/admin/opd/pharmacy` redirects here): how the pharmacy works at
 * this lab (opd_settings.PharmacyJson — batch pick: earliest expiry vs the
 * pharmacist picks; walk-in bills editable until paid; Schedule H / H1 / X
 * enforcement) and the DRUG MASTER grid (copy-on-write over the Prefrontal
 * master). `?tab=drugs` opens the drug master directly. The band carries the
 * ONE primary (Save) for whichever tab is open.
 */
@Component({
  selector: 'pf-pharmacy-settings',
  standalone: true,
  imports: [HeroBandComponent, BusyDirective, PharmacyDrugMasterComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./pharmacy.scss'],
  template: `
    <section class="pf-band-page ph">
      <pf-hero-band [back]="true" [backTo]="fixedView() ? '/admin' : '/admin/opd'" [customSearch]="true" [contextBar]="true">
        <div band-search class="pf-ctx ph-ctx">
          <span class="pf-ctx__primary">{{ fixedView() ? (tab() === 'drugs' ? 'Drug master' : 'Pharmacy settings') : 'Pharmacy' }}</span>
          @if (!fixedView()) {
          <div class="pf-seg" role="tablist" aria-label="Pharmacy settings sections">
            <button type="button" class="pf-seg__item" role="tab" [attr.aria-selected]="tab() === 'settings'" [attr.aria-pressed]="tab() === 'settings'" (click)="tab.set('settings')">How it works</button>
            <button type="button" class="pf-seg__item" role="tab" [attr.aria-selected]="tab() === 'drugs'" [attr.aria-pressed]="tab() === 'drugs'" (click)="tab.set('drugs')">Drug master</button>
          </div>
          }
        </div>
        <ng-container band-actions>
          @if (tab() === 'settings') {
            @if (changed()) { <span class="pf-savestate" role="status"><span class="pf-savestate__dot" aria-hidden="true"></span>Unsaved changes</span> }
            <button type="button" class="pf-hb-btn press" [class.pf-hb-btn--primary]="changed()" [class.pf-hb-btn--ghost]="!changed()" [disabled]="!changed() || saving()" [pfBusy]="saving()" pfBusyLabel="Saving…" (click)="save()">Save</button>
          } @else if (master()?.dirtyCount()) {
            <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" (click)="master()?.discard()">Discard</button>
            <button type="button" class="pf-hb-btn pf-hb-btn--primary press" [pfBusy]="!!master()?.saving()" pfBusyLabel="Saving…" (click)="master()?.save()">Save changes ({{ master()?.dirtyCount() }})</button>
          }
        </ng-container>
      </pf-hero-band>

      @if (tab() === 'settings') {
        <div class="ph-body ph-body--one">
          <section class="pf-card" style="max-width:760px;width:100%;justify-self:center" aria-labelledby="ph-set-t">
            <header class="pf-card__head">
              <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg></span>
              <span class="pf-card__label" id="ph-set-t">How the pharmacy works</span>
            </header>
            <div class="pf-card__body" style="gap:18px">
              <div class="pf-field">
                <span class="pf-field__lbl" id="ph-bp">Batch picking</span>
                <div class="pf-seg" role="radiogroup" aria-labelledby="ph-bp">
                  <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="cfg().batchPick === 'earliest_expiry'" (click)="set('batchPick', 'earliest_expiry')">Earliest expiry (automatic)</button>
                  <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="cfg().batchPick === 'pharmacist'" (click)="set('batchPick', 'pharmacist')">Pharmacist picks</button>
                </div>
                <span class="pf-field__hint">{{ cfg().batchPick === 'pharmacist' ? 'The pharmacist names the batch on every line; expired batches can never be sold.' : 'The batch that expires first is sold first, split across batches when one runs out.' }}</span>
              </div>
              <div class="ph-row" style="cursor:default">
                <span class="ph-row__main"><span class="ph-row__name" id="ph-wb">Walk-in bills can be edited until paid</span>
                  <span class="ph-row__meta">Open counter bills can change lines, quantities and discount before payment. A paid bill is always locked — use a return.</span></span>
                <button type="button" class="pf-toggle" role="switch" [attr.aria-checked]="cfg().walkInBillEditable" aria-labelledby="ph-wb" (click)="set('walkInBillEditable', !cfg().walkInBillEditable)"><span class="pf-toggle__track"><span class="pf-toggle__knob"></span></span></button>
              </div>
              <div class="ph-row" style="cursor:default">
                <span class="ph-row__main"><span class="ph-row__name" id="ph-es">Enforce Schedule H / H1 / X</span>
                  <span class="ph-row__meta">No sale of a prescription-only drug without a prescription. Schedule H1 and X sales always go in the H1 register with the buyer and the prescriber, even when this is off.</span></span>
                <button type="button" class="pf-toggle" role="switch" [attr.aria-checked]="cfg().enforceSchedules" aria-labelledby="ph-es" (click)="toggleEnforce()"><span class="pf-toggle__track"><span class="pf-toggle__knob"></span></span></button>
              </div>
            </div>
          </section>
        </div>
      } @else {
        <div class="ph-body ph-body--one"><pf-pharmacy-drug-master></pf-pharmacy-drug-master></div>
      }
    </section>
  `,
})
export class PharmacySettingsPage {
  private readonly api = inject(PharmacyApi);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  protected readonly master = viewChild(PharmacyDrugMasterComponent);
  private readonly route = inject(ActivatedRoute);
  /** 'settings' | 'drugs' when the route pins one view (Settings re-home); null = the old two-tab page. */
  protected readonly fixedView = signal<Tab | null>(this.pinnedView());
  protected readonly tab = signal<Tab>(this.fixedView() ?? (this.route.snapshot.queryParamMap.get('tab') === 'drugs' ? 'drugs' : 'settings'));
  private pinnedView(): Tab | null {
    const v = this.route.snapshot.data?.[PHARMACY_VIEW];
    return v === 'drugs' || v === 'settings' ? v : null;
  }
  protected readonly cfg = signal<PharmacyConfig>({ ...DEFAULT_PHARMACY_CONFIG });
  private readonly saved = signal<PharmacyConfig>({ ...DEFAULT_PHARMACY_CONFIG });
  protected readonly saving = signal(false);
  protected readonly changed = computed(() => JSON.stringify(this.cfg()) !== JSON.stringify(this.saved()));

  constructor() {
    this.api.settings().subscribe({
      next: s => { const c = { ...DEFAULT_PHARMACY_CONFIG, ...s }; this.cfg.set(c); this.saved.set(c); },
      error: e => this.toast.error(errText(e)),
    });
  }
  protected set<K extends keyof PharmacyConfig>(k: K, v: PharmacyConfig[K]) { this.cfg.update(c => ({ ...c, [k]: v })); }
  /** Switching enforcement OFF is a lab-wide safety change — it asks first. */
  protected async toggleEnforce() {
    if (this.cfg().enforceSchedules) {
      const ok = await this.dialog.confirm({
        title: 'Stop enforcing Schedule H?',
        message: 'Prescription-only drugs could then be sold at the counter without a prescription. H1 / X sales still need the buyer and the prescriber for the register.',
        confirmLabel: 'Stop enforcing', cancelLabel: 'Keep enforcing', tone: 'danger',
      });
      if (!ok) return;
    }
    this.set('enforceSchedules', !this.cfg().enforceSchedules);
  }
  protected save() {
    this.saving.set(true);
    this.api.saveSettings(this.cfg()).subscribe({
      next: s => { this.saving.set(false); const c = { ...DEFAULT_PHARMACY_CONFIG, ...s }; this.cfg.set(c); this.saved.set(c); this.toast.success('Pharmacy settings saved'); },
      error: e => { this.saving.set(false); this.toast.error(errText(e)); },
    });
  }
}
