import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin, of, switchMap } from 'rxjs';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { SkeletonFormComponent } from '../../../shared/primitives/skeleton-kit.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { createLoadHold } from '../../../shared/utils/min-duration';
import { plural } from '../../../shared/utils/plural';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import {
  OpdAdminApi, OpdDepartmentRow, OpdDoctorAdminRow, OpdDoctorPriceRow, OpdFormDetail, OpdFormListRow, OpdServiceInput,
} from './opd-admin.api';
import { allQuestions, normalizeSchema, typeName } from './forms/form-schema';
import { daysText, inr, mq, nextServiceCode } from './opd-admin.util';

type Tab = 'basics' | 'price' | 'form' | 'print' | 'cons';
interface DocPriceDraft { doctorUserId: string; name: string; meta: string; room: string; price: number | null; followUpFee: number | null; offered: boolean; }

const TAX = [0, 5, 12, 18];

/**
 * OPD service editor (/admin/opd/services/:id, `new` + ?departmentId=) — the
 * ND editor pattern (like the test editor): band = back · save state · ONE
 * primary Save; context bar = the service's name + its section tabs. The side
 * card is the DESK PREVIEW: what the front desk will charge per doctor for a
 * new visit and a follow-up (the fee rules the server applies in
 * /api/opd/admin/quote — the desk may still override with the exact amount).
 */
@Component({
  selector: 'pf-opd-service-editor',
  standalone: true,
  imports: [NgTemplateOutlet, HeroBandComponent, ScreenHeaderComponent, SelectComponent, SkeletonFormComponent, BusyDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./opd-admin.shared.scss'],
  styles: [`
    .se-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 16px; }
    .se-span { grid-column: 1 / -1; }
    @media (max-width: 640px) { .se-grid { grid-template-columns: minmax(0, 1fr); } }
    .se-unit { display: flex; align-items: center; gap: 8px; }
    .se-unit .pf-input { max-width: 140px; }
    .se-unit span { font-size: 12.5px; color: var(--text-secondary); white-space: nowrap; }
    .se-fu { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
    .se-dec { display: inline-flex; gap: 8px; align-items: flex-start; padding: 10px 12px; border-radius: var(--pf-radius, 12px); font-size: 12.5px; line-height: 1.5;
      color: var(--text-secondary); background: var(--pf-chip-bg); border: 1px solid var(--pf-line); }
    .se-dec b { color: var(--text-primary); }
    .se-docs { width: 100%; border-collapse: collapse; font-size: 13px; }
    .se-docs th { text-align: left; padding: 8px; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--text-tertiary); border-bottom: 1px solid var(--pf-line); }
    .se-docs td { padding: 8px; border-bottom: 1px solid var(--pf-line); vertical-align: middle; }
    .se-docs .r { text-align: right; }
    .se-docs .pf-input { width: 110px; min-height: 36px; text-align: right; margin-left: auto; }
    .se-docs__n { font-weight: 600; color: var(--text-primary); }
    .se-docs__m { font-size: 12px; color: var(--text-tertiary); }
    .se-wrap { overflow-x: auto; border: 1px solid var(--pf-line); border-radius: 12px; }
    .se-qs { display: flex; flex-direction: column; gap: 6px; }
    .se-q { display: flex; gap: 10px; align-items: center; min-height: 44px; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--pf-line); }
    .se-q__t { display: flex; flex-direction: column; gap: 2px; font-size: 13px; color: var(--text-primary); }
    .se-q__t small { font-size: 12px; color: var(--text-tertiary); }
    .se-q--built { background: var(--pf-chip-bg); }
    .se-lock { margin-left: auto; color: var(--text-tertiary); }
    .se-pv { display: flex; flex-direction: column; gap: 10px; }
    .se-pv__row { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; padding: 10px 0; border-bottom: 1px solid var(--pf-line); font-size: 13px; }
    .se-pv__row b { font-weight: 600; }
    .se-pv__who { display: flex; flex-direction: column; gap: 2px; }
    .se-pv__who small { font-size: 12px; color: var(--text-tertiary); }
    .se-pv__amt { text-align: right; display: flex; flex-direction: column; gap: 2px; }
    .se-pv__amt small { font-size: 12px; color: var(--text-tertiary); }
    .se-tabs { display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none; }
    .se-soon { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 18px; border: 1px dashed var(--pf-line); border-radius: 12px; font-size: 13px; color: var(--text-secondary); }
    .se-ctx__name { display: inline-flex; align-items: center; gap: 6px; }
    .se-body-main { display: flex; flex-direction: column; gap: 14px; }
  `],
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <pf-hero-band [back]="true" backTo="/admin/opd/departments" [customSearch]="true" [contextBar]="true">
          <ng-container band-actions><ng-container *ngTemplateOutlet="actions"></ng-container></ng-container>
          <div band-search class="pf-ctx">
            <span class="pf-ctx__primary se-ctx__name">
              {{ d().name || 'New service' }}
              <button type="button" class="pf-ctx__edit press" (click)="tab.set('basics'); focusName()" aria-label="Edit name" title="Edit name">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
              </button>
            </span>
            <span class="pf-seg se-tabs" role="tablist" aria-label="Sections">
              @for (t of tabs; track t.id) {
                <button type="button" class="pf-seg__item" role="tab" [attr.aria-selected]="tab() === t.id" [attr.aria-pressed]="tab() === t.id" (click)="tab.set(t.id)">{{ t.label }}</button>
              }
            </span>
          </div>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only" eyebrow="OPD · Service" [title]="d().name || 'New service'" parentRoute="/admin/opd/departments">
        <div actions class="oa-actions"><ng-container *ngTemplateOutlet="actions"></ng-container></div>
      </pf-screen-header>
      @if (!theme.isNewDesign()) {
        <div class="pf-seg se-tabs" role="tablist" aria-label="Sections" style="margin-bottom:12px">
          @for (t of tabs; track t.id) {
            <button type="button" class="pf-seg__item" role="tab" [attr.aria-pressed]="tab() === t.id" (click)="tab.set(t.id)">{{ t.label }}</button>
          }
        </div>
      }

      <div class="pf-band-body pf-band-body--fill">
        <div class="oa-panels oa-panels--right" [class.oa-panels--narrow]="narrow()">
          <section class="pf-card oa-main" [attr.aria-label]="tabLabel()">
            <header class="pf-card__head">
              <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"/></svg></span>
              <span class="pf-card__label">{{ tabLabel() }}</span>
              <span class="pf-card__note oa-hint">{{ tabNote() }}</span>
            </header>
            <div class="pf-card__body se-body-main">
              @if (skeleton()) {
                <pf-skeleton-form [fields]="6" [cols]="2" label="Loading the service…"></pf-skeleton-form>
              } @else {
                @switch (tab()) {
                  @case ('basics') {
                    <div class="se-grid">
                      <label class="oa-field se-span"><span class="oa-field__lbl">Name</span>
                        <input id="se-name" class="pf-input" [value]="d().name" maxlength="160" (input)="patch({ name: $any($event.target).value })" autocomplete="off"></label>
                      <div class="oa-field"><span class="oa-field__lbl">Department</span>
                        <pf-select [options]="deptOptions()" [value]="d().departmentId" (valueChange)="patch({ departmentId: $event })"></pf-select></div>
                      <div class="oa-field"><span class="oa-field__lbl">Category</span>
                        <span class="pf-seg" role="radiogroup" aria-label="Category">
                          <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="d().category === 'consultation'" (click)="patch({ category: 'consultation' })">Consultation</button>
                          <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="d().category === 'procedure'" (click)="patch({ category: 'procedure' })">Procedure</button>
                        </span></div>
                      <label class="oa-field"><span class="oa-field__lbl">Service code</span>
                        <input class="pf-input pf-num" [value]="d().code" maxlength="32" (input)="patch({ code: $any($event.target).value.toUpperCase() })" autocomplete="off"></label>
                      <label class="oa-field"><span class="oa-field__lbl">Slot length</span>
                        <span class="se-unit"><input class="pf-input pf-num" inputmode="numeric" [value]="d().durationMinutes ?? ''" (input)="patch({ durationMinutes: intOrNull($any($event.target).value) })"><span>min</span></span></label>
                      <div class="oa-field"><span class="oa-field__lbl">GST</span>
                        <span class="pf-seg" role="radiogroup" aria-label="GST slab">
                          @for (t of tax; track t) {
                            <button type="button" class="pf-seg__item pf-num" role="radio" [attr.aria-checked]="d().taxSlab === t" (click)="patch({ taxSlab: t })">{{ t }}%</button>
                          }
                        </span>
                        <span class="oa-field__hint">Consultations are GST-exempt healthcare services (0%).</span></div>
                      <label class="oa-field"><span class="oa-field__lbl">SAC code</span>
                        <input class="pf-input pf-num" [value]="d().hsnSacCode ?? ''" maxlength="16" (input)="patch({ hsnSacCode: $any($event.target).value || null })"></label>
                      <div class="oa-field se-span">
                        <button type="button" class="pf-toggle" role="switch" [attr.aria-checked]="d().isActive" (click)="patch({ isActive: !d().isActive })">
                          <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>Offered at the desk</button>
                      </div>
                    </div>
                    <div class="oa-sec">Follow-up</div>
                    <div class="se-fu">
                      <button type="button" class="pf-toggle" role="switch" [attr.aria-checked]="!!d().followUpWithinDays"
                              (click)="patch({ followUpWithinDays: d().followUpWithinDays ? null : 7 })">
                        <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>Follow-up visits within</button>
                      @if (d().followUpWithinDays) {
                        <span class="se-unit"><input class="pf-input pf-num" inputmode="numeric" aria-label="Follow-up window in days" [value]="d().followUpWithinDays"
                               (input)="patch({ followUpWithinDays: intOrNull($any($event.target).value) })"><span>days are billed</span></span>
                        <span class="se-unit"><input class="pf-input pf-num" inputmode="decimal" aria-label="Follow-up fee" placeholder="0 = free" [value]="d().followUpFee ?? ''"
                               (input)="patch({ followUpFee: numOrNull($any($event.target).value) })"><span>₹{{ d().priceMode === 'per_doctor' ? ' (a doctor may set their own)' : '' }}</span></span>
                        @if (d().followUpFee == null) {
                          <span class="se-unit"><input class="pf-input pf-num" inputmode="decimal" aria-label="Follow-up discount percent" placeholder="or % off" [value]="d().followUpPercent ?? ''"
                                 (input)="patch({ followUpPercent: numOrNull($any($event.target).value) })"><span>% off the visit price</span></span>
                        }
                      }
                    </div>
                    <span class="se-dec"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3"/></svg>
                      <span><b>Decided:</b> the follow-up fee is this rule (per doctor when set); the front desk can override it with the exact amount. Counted from the patient's last visit with the same doctor.</span></span>
                  }
                  @case ('price') {
                    <div class="oa-field"><span class="oa-field__lbl">Price mode</span>
                      <span class="pf-seg" role="radiogroup" aria-label="Price mode">
                        <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="d().priceMode === 'common'" (click)="patch({ priceMode: 'common' })">Common price</button>
                        <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="d().priceMode === 'per_doctor'" (click)="patch({ priceMode: 'per_doctor' })">Per doctor</button>
                      </span></div>
                    @if (d().priceMode === 'common') {
                      <label class="oa-field"><span class="oa-field__lbl">Price</span>
                        <span class="se-unit"><input class="pf-input pf-num" inputmode="decimal" [value]="d().commonPrice" (input)="patch({ commonPrice: numOrNull($any($event.target).value) ?? 0 })"><span>₹ for every doctor</span></span></label>
                    } @else {
                      @if (docRows().length) {
                        <div class="se-wrap"><table class="se-docs">
                          <thead><tr><th>Doctor</th><th>Room</th><th class="r">Consultation fee</th><th class="r">Follow-up fee</th><th>Offered</th></tr></thead>
                          <tbody>
                            @for (r of docRows(); track r.doctorUserId; let i = $index) {
                              <tr>
                                <td><span class="se-docs__n">{{ r.name }}</span><br><span class="se-docs__m">{{ r.meta }}</span></td>
                                <td>{{ r.room || '—' }}</td>
                                <td class="r"><input class="pf-input pf-num" inputmode="decimal" [value]="r.price ?? ''" [attr.aria-label]="'Fee ' + r.name"
                                       (input)="setDoc(i, { price: numOrNull($any($event.target).value), offered: true })"></td>
                                <td class="r"><input class="pf-input pf-num" inputmode="decimal" placeholder="—" [value]="r.followUpFee ?? ''" [attr.aria-label]="'Follow-up fee ' + r.name"
                                       (input)="setDoc(i, { followUpFee: numOrNull($any($event.target).value) })"></td>
                                <td><button type="button" class="pf-toggle" role="switch" [attr.aria-checked]="r.offered" [attr.aria-label]="'Offered by ' + r.name"
                                            (click)="setDoc(i, { offered: !r.offered })"><span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span></button></td>
                              </tr>
                            }
                          </tbody>
                        </table></div>
                      } @else {
                        <p class="oa-empty">No doctors yet — create a user with a Doctor-type role and they appear here.</p>
                      }
                      <p class="oa-field__hint">A doctor switched off here isn't offered this service at the desk — there is no fallback price.</p>
                    }
                    <p class="oa-note"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                      <span>The front desk sees the chosen doctor's fee in the cart automatically.</span></p>
                  }
                  @case ('form') {
                    <div class="oa-field"><span class="oa-field__lbl">{{ isProc() ? 'Procedure form' : 'Consultation form' }}</span>
                      <pf-select [options]="formOptions()" [value]="d().formId ?? ''" [searchable]="forms().length > 8" (valueChange)="setForm($event)"></pf-select>
                      <span class="oa-field__hint">{{ isProc()
                        ? (d().formId ? 'The doctor fills this form each time the procedure is done (e.g. a laser session: area, fluence, spot size). The last session’s values show beside each field.' : 'No form — pick one to record readings each time this procedure is done.')
                        : (d().formId ? "This service overrides its department's form." : "Uses the department's form — pick one to override it for this service only.") }}</span></div>
                    <div class="oa-actions">
                      <button type="button" class="pf-btn pf-btn--secondary oa-btn press" [disabled]="!effectiveFormId()" (click)="openBuilder()">Open in form builder</button>
                    </div>
                    <div class="oa-sec">What the doctor fills</div>
                    <div class="se-qs">
                      @if (!isProc()) {
                      <div class="se-q se-q--built"><span class="se-q__t">Vitals (prefill)<small>Built in — BP, pulse, temperature, SpO₂, weight, height, BMI</small></span>
                        <svg class="se-lock" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Built-in"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>
                      }
                      @for (q of formQuestions(); track q.key) {
                        <div class="se-q"><span class="se-q__t">{{ q.label }}<small>{{ typeName(q) }}{{ q.required ? ' · required' : '' }}</small></span></div>
                      } @empty { <p class="oa-field__hint">{{ effectiveFormId() ? 'This form has no questions yet.' : 'No form chosen yet.' }}</p> }
                    </div>
                  }
                  @default {
                    <div class="se-soon">
                      <b>{{ tab() === 'print' ? 'Printed note' : 'Consumables' }} — not built yet</b>
                      <span>{{ tab() === 'print' ? 'Letterhead, vitals, signature and QR options for the consultation sheet come in a later phase. Form questions already choose "Print on the report" in the form builder.' : 'Deducting inventory items each time this service is billed comes in a later phase.' }}</span>
                    </div>
                  }
                }
              }
            </div>
          </section>

          @if (!narrow() || previewOpen()) {
            @if (narrow()) { <div class="oa-sheet-backdrop" (click)="previewOpen.set(false)"></div> }
            <aside class="pf-card oa-side" [class.oa-side--sheet]="narrow()" aria-label="Desk preview" [attr.role]="narrow() ? 'dialog' : null" (keydown.escape)="previewOpen.set(false)">
              <header class="pf-card__head">
                <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg></span>
                <span class="pf-card__label">Desk preview</span>
                <span class="pf-card__spacer"></span>
                @if (narrow()) {
                  <button type="button" class="pf-btn pf-btn--icon oa-side__collapse" (click)="previewOpen.set(false)" aria-label="Close preview">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
                }
              </header>
              <div class="pf-card__body se-pv">
                <p class="oa-field__hint">What the front desk charges for <b>{{ d().name || 'this service' }}</b>.</p>
                @for (p of preview(); track p.who) {
                  <div class="se-pv__row">
                    <span class="se-pv__who"><b>{{ p.who }}</b><small>{{ p.meta }}</small></span>
                    <span class="se-pv__amt pf-num"><b>{{ p.price }}</b>@if (p.fu) {<small>{{ p.fu }}</small>}</span>
                  </div>
                } @empty { <p class="oa-empty">No doctor is offered this service yet.</p> }
                <div class="oa-sec">Form</div>
                <p class="oa-field__hint">{{ formLine() }}</p>
              </div>
            </aside>
          }
        </div>
      </div>
    </section>

    <ng-template #actions>
      <span class="pf-savestate" role="status" aria-live="polite">
        @if (dirty()) { <span class="pf-savestate__dot" aria-hidden="true"></span><span>Unsaved changes</span> }
        @else if (!isNew()) { <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg><span>All changes saved</span> }
      </span>
      @if (narrow()) {
        <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" (click)="previewOpen.set(true)" aria-label="Preview" title="Desk preview">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
          Preview</button>
      }
      <button type="button" class="pf-hb-btn pf-hb-btn--primary press" [disabled]="saving() || skeleton() || (!dirty() && !isNew())" [pfBusy]="saving()" pfBusyLabel="Saving…"
              (click)="save()" [attr.aria-label]="isNew() ? 'Create' : 'Save'" [title]="isNew() ? 'Create' : 'Save'" [pfBusyInactive]="saving() || skeleton() || (!dirty() && !isNew())">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>
        {{ saving() ? 'Saving…' : isNew() ? 'Create' : 'Save' }}
      </button>
    </ng-template>
  `,
})
export class OpdServiceEditorPage {
  private readonly api = inject(OpdAdminApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);
  protected readonly theme = inject(ThemeService);
  protected readonly typeName = typeName;
  readonly tax = TAX;
  readonly tabs: { id: Tab; label: string }[] = [
    { id: 'basics', label: 'Basics' }, { id: 'price', label: 'Price & doctors' }, { id: 'form', label: 'Form' },
    { id: 'print', label: 'Printed note' }, { id: 'cons', label: 'Consumables' },
  ];

  readonly id = signal<string | null>(null);
  readonly isNew = computed(() => !this.id());
  readonly tab = signal<Tab>('basics');
  readonly d = signal<OpdServiceInput>(this.blank(''));
  private saved = '';
  private savedDocs = '';
  readonly docRows = signal<DocPriceDraft[]>([]);
  readonly depts = signal<OpdDepartmentRow[]>([]);
  readonly forms = signal<OpdFormListRow[]>([]);
  readonly doctors = signal<OpdDoctorAdminRow[]>([]);
  readonly formDetail = signal<OpdFormDetail | null>(null);
  readonly saving = signal(false);
  readonly narrow = signal(false);
  readonly previewOpen = signal(false);
  private readonly hold = createLoadHold(true);
  readonly skeleton = this.hold.active;
  private allCodes: string[] = [];

  readonly dirty = computed(() => JSON.stringify(this.d()) !== this.saved || JSON.stringify(this.docRows()) !== this.savedDocs);
  readonly deptOptions = computed<PfSelectOption<string>[]>(() => this.depts().map((x) => ({ value: x.id, label: x.name, hint: x.isActive ? undefined : 'Off' })));
  readonly dept = computed(() => this.depts().find((x) => x.id === this.d().departmentId) ?? null);
  /** A procedure's form is its own (a session form) — never the department's consultation form. */
  readonly isProc = computed(() => this.d().category === 'procedure');
  readonly effectiveFormId = computed(() => this.d().formId || (this.isProc() ? null : this.dept()?.defaultFormId) || null);
  readonly formOptions = computed<PfSelectOption<string>[]>(() => [
    this.isProc()
      ? { value: '', label: 'No form' }
      : { value: '', label: 'Department default', hint: this.forms().find((f) => f.id === this.dept()?.defaultFormId)?.name ?? 'No form' },
    ...this.forms().filter((f) => f.isActive).map((f) => ({ value: f.id, label: f.name, hint: f.publishedVersion ? 'v' + f.publishedVersion : 'new' })),
  ]);
  readonly formQuestions = computed(() => {
    const f = this.formDetail();
    const v = f?.draft ?? f?.published;
    return v ? allQuestions(normalizeSchema(v.schema)) : [];
  });
  readonly formLine = computed(() => {
    const f = this.forms().find((x) => x.id === this.effectiveFormId());
    if (!f) return this.isProc() ? 'No procedure form.' : 'No consultation form yet.';
    return `${f.name} · ${f.publishedVersion ? 'v' + f.publishedVersion : 'not published yet'} · ${this.isProc() ? 'filled each time it is done' : this.d().formId ? 'overrides the department form' : 'the department form'}`;
  });
  readonly tabLabel = computed(() => this.tabs.find((t) => t.id === this.tab())?.label ?? '');
  readonly tabNote = computed(() => ({
    basics: "The service's name, department and codes.", price: 'One price for everyone, or a fee per doctor.',
    form: 'The form its doctors fill — the department’s, or its own.', print: 'What prints on the consultation sheet.', cons: 'Deducted from inventory when billed.',
  } as Record<Tab, string>)[this.tab()]);
  readonly preview = computed(() => {
    const d = this.d();
    // Mirrors Admin.OpdFeeRules.FollowUpFee: doctor fee → service fee → % off the price → free.
    const fu = (fee: number | null | undefined, price: number | null | undefined) => {
      if (!d.followUpWithinDays) return '';
      const pct = fee == null && d.followUpPercent != null ? Math.min(100, Math.max(0, d.followUpPercent)) : null;
      const amount = fee ?? (pct != null && price != null ? Math.round((price * (100 - pct)) / 100) : null);
      return `Follow-up within ${plural(d.followUpWithinDays, 'day')}: ${amount ? inr(amount) + (pct != null ? ` (${pct}% off)` : '') : 'free'}`;
    };
    if (d.priceMode === 'common')
      return [{ who: 'Every doctor', meta: 'Common price', price: inr(d.commonPrice), fu: fu(d.followUpFee, d.commonPrice) }];
    return this.docRows().filter((r) => r.offered && r.price != null)
      .map((r) => ({ who: r.name, meta: r.meta, price: inr(r.price), fu: fu(r.followUpFee ?? d.followUpFee, r.price) }));
  });

  constructor() {
    const ref = inject(DestroyRef);
    this.narrow.set(mq('(max-width: 1023px)', ref, (m) => this.narrow.set(m)));
    const idParam = this.route.snapshot.paramMap.get('id');
    const deptParam = this.route.snapshot.queryParamMap.get('departmentId');
    this.id.set(idParam && idParam !== 'new' ? idParam : null);
    forkJoin({
      depts: this.api.departments(), forms: this.api.forms(), doctors: this.api.doctors(), services: this.api.services(),
      svc: this.id() ? this.api.service(this.id()!) : of(null),
    }).subscribe({
      next: ({ depts, forms, doctors, services, svc }) => {
        this.hold.done();
        this.depts.set(depts); this.forms.set(forms); this.doctors.set(doctors);
        this.allCodes = services.filter((s) => s.id !== svc?.id).map((s) => s.code);
        if (svc) {
          const { id: _id, doctorPrices: _p, ...rest } = svc;
          this.d.set({ ...rest, id: svc.id });
        } else {
          const dep = depts.find((x) => x.id === deptParam) ?? depts[0];
          this.d.set(this.blank(dep?.id ?? ''));
          if (dep) this.patch({ code: nextServiceCode(dep.code, 'consultation', this.allCodes) });
        }
        this.docRows.set(this.buildDocRows(doctors, svc?.doctorPrices ?? []));
        this.saved = JSON.stringify(this.d());
        this.savedDocs = JSON.stringify(this.docRows());
        this.loadForm();
      },
      error: () => { this.hold.done(); this.toasts.error('Could not load the service'); },
    });
  }

  private blank(departmentId: string): OpdServiceInput {
    return { departmentId, name: '', code: '', category: 'consultation', priceMode: 'common', commonPrice: 0, taxSlab: 0, hsnSacCode: '999312',
      followUpWithinDays: 7, followUpFee: null, formId: null, durationMinutes: 15, sortOrder: 99, isActive: true };
  }

  private buildDocRows(doctors: OpdDoctorAdminRow[], prices: OpdDoctorPriceRow[]): DocPriceDraft[] {
    return doctors.map((doc) => {
      const p = prices.find((x) => x.doctorUserId === doc.userId);
      return { doctorUserId: doc.userId, name: doc.name, room: doc.room ?? '',
        meta: [doc.specializations?.[0] ?? doc.department, daysText(doc.days)].filter((x) => x && x !== '—').join(' · '),
        price: p ? p.price : null, followUpFee: p?.followUpFee ?? null, offered: p ? p.isActive : false };
    });
  }

  private loadForm(): void {
    const fid = this.effectiveFormId();
    if (!fid) { this.formDetail.set(null); return; }
    this.api.form(fid).subscribe({ next: (f) => this.formDetail.set(f), error: () => this.formDetail.set(null) });
  }

  patch(p: Partial<OpdServiceInput>): void {
    const prev = this.d();
    this.d.update((x) => ({ ...x, ...p }));
    if ('departmentId' in p || 'formId' in p || 'category' in p) this.loadForm();
    // A new service follows its department / category in its code until the admin types one.
    if (this.isNew() && ('departmentId' in p || 'category' in p)) {
      const dep = this.depts().find((x) => x.id === this.d().departmentId);
      const was = this.depts().find((x) => x.id === prev.departmentId);
      if (dep && (!prev.code || prev.code === nextServiceCode(was?.code ?? '', prev.category, this.allCodes)))
        this.d.update((x) => ({ ...x, code: nextServiceCode(dep.code, x.category, this.allCodes) }));
    }
  }
  setDoc(i: number, p: Partial<DocPriceDraft>): void { this.docRows.update((rows) => rows.map((r, k) => (k === i ? { ...r, ...p } : r))); }
  setForm(v: string): void { this.patch({ formId: v || null }); }
  intOrNull(v: string): number | null { const s = String(v ?? '').trim(); if (!s) return null; const n = Math.round(Number(s)); return Number.isFinite(n) ? n : null; }
  numOrNull(v: string): number | null { const s = String(v ?? '').trim(); if (!s) return null; const n = Number(s); return Number.isFinite(n) && n >= 0 ? n : null; }
  focusName(): void { setTimeout(() => (document.getElementById('se-name') as HTMLInputElement | null)?.focus(), 0); }
  openBuilder(): void { const f = this.effectiveFormId(); if (f) this.router.navigate(['/admin/opd/forms', f]); }

  async save(): Promise<void> {
    const d = this.d();
    if (!d.name.trim()) { this.tab.set('basics'); this.toasts.error('Give the service a name'); this.focusName(); return; }
    if (!d.departmentId) { this.tab.set('basics'); this.toasts.error('Pick a department'); return; }
    if (d.priceMode === 'per_doctor' && !this.docRows().some((r) => r.offered && r.price != null)) {
      const ok = await this.dialog.confirm({ title: 'No doctor offers this yet', message: 'With a per-doctor price and no doctor switched on, the desk can’t book this service. Save anyway?', confirmLabel: 'Save anyway' });
      if (!ok) { this.tab.set('price'); return; }
    }
    this.saving.set(true);
    this.api.saveServices([d]).pipe(
      switchMap((saved) => {
        const svc = saved[0];
        if (d.priceMode !== 'per_doctor') return of(svc);
        const rows = this.docRows().filter((r) => r.price != null)
          .map((r) => ({ doctorUserId: r.doctorUserId, price: r.price!, followUpFee: r.followUpFee, isActive: r.offered }));
        return this.api.saveDoctorPrices(svc.id, rows);
      }),
    ).subscribe({
      next: (svc) => {
        this.saving.set(false);
        const { id: _id, doctorPrices, ...rest } = svc;
        this.d.set({ ...rest, id: svc.id });
        this.docRows.set(this.buildDocRows(this.doctors(), doctorPrices));
        this.saved = JSON.stringify(this.d());
        this.savedDocs = JSON.stringify(this.docRows());
        this.toasts.success(this.isNew() ? `${svc.name} created` : 'Service saved');
        if (this.isNew()) { this.id.set(svc.id); this.router.navigate(['/admin/opd/services', svc.id], { replaceUrl: true }); }
      },
      error: (e: Error) => { this.saving.set(false); this.toasts.error(e.message || 'Could not save the service'); },
    });
  }
}
