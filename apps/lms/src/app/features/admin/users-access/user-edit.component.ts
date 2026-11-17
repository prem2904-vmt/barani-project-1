import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, input, output, signal, untracked, ElementRef, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LAB_PAGES } from '../../../shared/utils/lab-settings-pages';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { Branch, Department } from '../../../shared/models/tenant.model';
import { Role, User } from '../../../shared/models/user.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { ApiError } from '../../../shared/models/api-response.model';
import { AlphaDirective } from '../../../shared/directives/alpha.directive';
import { NumericDirective } from '../../../shared/directives/numeric.directive';
import { COUNTRY_CODES, getCountryDigitLength, parsePhoneNumber } from '../../../shared/utils/country-codes';
import { NavBackService } from '../../../core/services/nav-back.service';
import { ThemeService } from '../../../core/services/theme.service';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ROLE_INFO } from './permission-catalog';
import { TITLE_OPTIONS } from './user-form.styles';
import { UserAccountActionsService } from './user-account-actions.service';
import { AuthService } from '../../../core/auth/auth.service';
import { rolePickerRows } from './role-assignability';
import { DEPARTMENTS_HINT, UserDepartmentsRow, viaRoleLabels } from './consultant-departments';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { SkeletonCardComponent, SkeletonFormComponent } from '../../../shared/primitives/skeleton-kit.component';
import { createLoadHold } from '../../../shared/utils/min-duration';
import { SettingRowComponent } from '../../../shared/components/setting-row/setting-row.component';
import { SG_NARROW_MQ, sgMedia } from '../../../shared/settings-grid/settings-grid';
import { Permission } from '../../../shared/models/user.model';
import { SCOPE_HINT, applyScopePick, scopeOptions as buildScopeOptions, scopePayload, scopeValuesFromRoles, soleScope } from './branch-scope';

/** Did the admin change the registration number (trim-insensitive)? */
export function regIdChanged(next: string | null | undefined, loaded: string | null | undefined): boolean {
  return (next ?? '').trim() !== (loaded ?? '').trim();
}

interface EditForm {
  /** Honorific ("Dr." for doctors, etc.) — prefixes every mention of the name. */
  title: string;
  firstName: string;
  fathersName: string;
  phone: string;
  /** Medical council / registration number — prints under the user's
   *  signature on reports (users.RegistrationId, the one home). */
  registrationId: string;
  roleIds: string[];
  /** Branch scope: 'all' | 'b:<id>' | 'sb:<id>' (see branch-scope.ts). */
  scope: string[];
}

@Component({
  selector: 'pf-user-edit',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    ScreenHeaderComponent,
    SelectComponent,
    TouchButtonComponent,
    HeroBandComponent,
    AlphaDirective,
    NumericDirective,
    BusyDirective,
    SkeletonFormComponent,
    SkeletonCardComponent,
    SettingRowComponent,
    NgTemplateOutlet,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (panel()) {
      <!-- PANEL (owner 2026-11-17: "too many clicks"): the whole user on ONE scrolling form beside the grid —
           account actions in the head, Save at the foot. Same payloads and validation as the page. -->
      <div class="ue-panel" data-testid="ue-panel">
        <header class="pf-card__head ue-panel__head">
          <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
          <span class="ue-panel__title">
            <span class="ue-strip__name pf-uf-ctx__text">{{ displayPreview() || loadedName() || 'User' }}</span>
            <span class="ue-strip__meta">{{ username() }}@if (username()) { · }{{ isActive() ? 'Active' : 'Inactive' }}</span>
          </span>
          <span class="pf-card__spacer"></span>
          @if (loaded()) {
            <button type="button" class="pf-rowact pf-rowact--icon pf-sg-rowact-sm pf-ue-reset press" [disabled]="accountBusy()" [pfBusy]="accountAction() === 'reset'"
                    (click)="resetPassword()" aria-label="Reset password" title="Reset password">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></svg>
              <span class="pf-rowact__t">Reset password</span>
            </button>
            <button type="button" class="pf-rowact pf-rowact--icon pf-sg-rowact-sm pf-ue-active press" [disabled]="accountBusy()" [pfBusy]="accountAction() === 'active'"
                    (click)="toggleActive()" [attr.aria-label]="isActive() ? 'Deactivate' : 'Reactivate'" [title]="isActive() ? 'Deactivate' : 'Reactivate'">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><path d="M12 2v10"/></svg>
              <span class="pf-rowact__t">{{ isActive() ? 'Deactivate' : 'Reactivate' }}</span>
            </button>
          }
          <button type="button" class="pf-btn pf-btn--icon ue-panel__close" (click)="closed.emit()" aria-label="Close" title="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </header>
        <div class="pf-card__body ue-panel__body">
          @if (recordSkeleton()) {
            <pf-skeleton-form [fields]="6" [cols]="1" label="Loading user…"></pf-skeleton-form>
          } @else {
            <h3 class="ue-panel__sec">Profile</h3>
            <ng-container *ngTemplateOutlet="secProfile"></ng-container>
            <h3 class="ue-panel__sec">Branches</h3>
            <ng-container *ngTemplateOutlet="secBranches"></ng-container>
            <h3 class="ue-panel__sec">Roles <span class="ue-panel__note" data-testid="ue-perm-note">{{ permSummary() }}</span></h3>
            <ng-container *ngTemplateOutlet="secRoles"></ng-container>
            <h3 class="ue-panel__sec">Validates for</h3>
            <ng-container *ngTemplateOutlet="secValidates"></ng-container>
          }
        </div>
        <div class="pf-card__foot ue-panel__foot">
          <button type="button" class="pf-btn pf-btn--tertiary press" (click)="closed.emit()">Cancel</button>
          <button type="button" class="pf-btn pf-btn--primary pf-uf-primary press" [disabled]="!canSave() || saving() || recordSkeleton()"
                  [pfBusy]="saving()" pfBusyLabel="Saving…" (click)="save()">{{ saving() ? 'Saving…' : 'Save changes' }}</button>
        </div>
      </div>
    } @else {
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <!-- ND "Editors": band = back · tenant · the ONE primary; the pill is
             the CONTEXT BAR (the user being edited as read-only chips). -->
        <pf-hero-band [back]="true" [backTo]="'/admin?section=people'" [customSearch]="true" [contextBar]="true"
                      [backAction]="narrow() && sectionPicked() ? backToSections : null">
          <ng-container band-actions>
            <!-- Account actions (owner): the list's row actions + their
                 confirms, as band secondaries. Icons on phones. -->
            @if (loaded()) {
              <button type="button" class="pf-hb-btn pf-hb-btn--ghost pf-ue-reset press"
                      [disabled]="accountBusy()" [pfBusy]="accountAction() === 'reset'" pfBusyLabel="Resetting…" (click)="resetPassword()"
                      aria-label="Reset password" title="Reset password">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></svg>
                Reset password
              </button>
              <button type="button" class="pf-hb-btn pf-hb-btn--ghost pf-ue-active press"
                      [disabled]="accountBusy()" [pfBusy]="accountAction() === 'active'" pfBusyLabel="Updating…" (click)="toggleActive()"
                      [attr.aria-label]="isActive() ? 'Deactivate' : 'Reactivate'" [title]="isActive() ? 'Deactivate' : 'Reactivate'">
                @if (isActive()) {
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/></svg>
                  Deactivate
                } @else {
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/></svg>
                  Reactivate
                }
              </button>
            }
            <button type="button" class="pf-hb-btn pf-hb-btn--primary pf-uf-primary press"
                    [disabled]="!canSave() || saving() || recordSkeleton()" [pfBusy]="saving()" pfBusyLabel="Saving…" (click)="save()"
                    [attr.aria-label]="saving() ? 'Saving' : 'Save changes'" title="Save changes">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>
              {{ saving() ? 'Saving…' : 'Save changes' }}
            </button>
          </ng-container>
          <div band-search class="pf-ctx pf-uf-ctx">
            <!-- ND §14: the pill = the record's name (full, quiet pencil) — no fact chips. -->
            <span class="pf-ctx__primary pf-uf-ctx__name">
              <span class="pf-uf-ctx__text">{{ displayPreview() || loadedName() || 'User' }}</span>
              
              <button type="button" class="pf-ctx__edit press" (click)="editName()" aria-label="Edit name" title="Edit name">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
              </button>
            </span>
          </div>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="Admin · Users"
        [title]="'Edit ' + (loadedName() || 'user')"
        parentRoute="/admin/users?tab=users"
        subtitle="Update the user's details, roles and branch scope.">
        <pf-touch-btn actions size="sm" variant="primary" [disabled]="!canSave() || saving() || recordSkeleton()" [busy]="saving()" busyLabel="Saving…" (pressed)="save()">
          {{ saving() ? 'Saving…' : 'Save changes' }}
        </pf-touch-btn>
      </pf-screen-header>

      <div class="pf-band-body pf-band-body--fill ue-body">
        @if (recordSkeleton()) {
          <!-- Opening a user: the editor's own shape until the record lands — never a blank form. -->
          <div class="pf-uf-body pf-ue-loading ue-loading">
            <section class="pf-card ue-strip"><div class="pf-card__body"><pf-skeleton-form [fields]="2" [cols]="2" label="Loading user…"></pf-skeleton-form></div></section>
            <section class="pf-card ue-loading__main"><div class="pf-card__body"><pf-skeleton-card [lines]="6" [boxed]="false" label="Loading roles…"></pf-skeleton-card></div></section>
          </div>
        } @else {
          <!-- SUMMARY strip: who this is, at a glance. -->
          <section class="pf-card ue-strip" aria-label="User">
            <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
            <span class="ue-strip__name">{{ displayPreview() || loadedName() || 'User' }}</span>
            @if (username()) { <span class="ue-strip__meta pf-num">{{ username() }}</span> }
            <span class="pf-sg-pill" [class.pf-sg-pill--on]="isActive()" data-testid="ue-status">{{ isActive() ? 'Active' : 'Inactive' }}</span>
            <span class="ue-strip__meta" data-testid="ue-branch-summary">{{ scopeSummary() }}</span>
            <span class="pf-card__spacer"></span>
            <span class="ue-strip__meta">{{ permSummary() }}</span>
          </section>

          <div class="pf-sg-panels ue-panels" [class.pf-sg-panels--narrow]="narrow()">
            <!-- SIDE card (LEFT): the editor's sections. -->
            @if (!narrow() || !sectionPicked()) {
              <aside class="pf-card pf-sg-side ue-side" aria-label="Sections">
                <header class="pf-card__head">
                  <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg></span>
                  <span class="pf-card__label">Edit user</span>
                </header>
                <ul class="pf-card__body ue-secs">
                  @for (sec of sections(); track sec.id) {
                    <li>
                      <button type="button" class="ue-sec" [attr.aria-pressed]="section() === sec.id" [attr.data-testid]="'ue-sec-' + sec.id" (click)="pickSection(sec.id)">
                        <span class="ue-sec__name">{{ sec.label }}@if (sec.req) {<span class="pf-uf-req">*</span>}</span>
                        <span class="ue-sec__note" [class.ue-sec__note--err]="sec.err">{{ sec.note }}</span>
                      </button>
                    </li>
                  }
                </ul>
              </aside>
            }

            <!-- MAIN card (RIGHT): the selected section. -->
            @if (!narrow() || sectionPicked()) {
            <section class="pf-card pf-sg-main ue-main" [attr.aria-label]="sectionLabel()">
              <header class="pf-card__head pf-sg-main__head">
                <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path [attr.d]="sectionIcon()"/></svg></span>
                <span class="pf-card__label">{{ sectionLabel() }}</span>
                @switch (section()) {
                  @case ('profile') { <span class="pf-card__note"><span class="pf-uf-req">*</span> required</span> }
                  @case ('roles') { <span class="pf-card__note" data-testid="ue-perm-note">{{ permSummary() }} · combined from every role switched on</span> }
                  @case ('validates') { <span class="pf-card__note">For consultants who validate results</span> }
                }
              </header>
              <div class="pf-card__body ue-main__body">
                @switch (section()) {
                  @case ('profile') { <ng-container *ngTemplateOutlet="secProfile"></ng-container> }
                  @case ('branches') { <ng-container *ngTemplateOutlet="secBranches"></ng-container> }
                  @case ('roles') { <ng-container *ngTemplateOutlet="secRoles"></ng-container> }
                  @case ('validates') { <ng-container *ngTemplateOutlet="secValidates"></ng-container> }
                }
              </div>
            </section>
            }
          </div>
        }
      </div>
    </section>
    }

    <!-- The editor's sections: shown one at a time on the page, all on one scrolling form in the panel. -->
    <ng-template #secProfile>
                    <pf-setting-row label="Title">
                      <pf-select class="ue-ctl ue-ctl--s" [options]="titleOptions" [value]="form().title" placeholder="—"
                                 (valueChange)="patch({ title: $any($event) ?? '' })"></pf-select>
                    </pf-setting-row>
                    <pf-setting-row label="First name *">
                      <span class="ue-ctlwrap">
                        <input type="text" pfAlpha #nameInput class="pf-input ue-ctl" [class.pf-input--error]="!!fieldError()['firstName']"
                               placeholder="e.g. Prem" aria-label="First name" [ngModel]="form().firstName" (ngModelChange)="patch({ firstName: $event })" />
                        @if (fieldError()['firstName']; as msg) { <p class="pf-uf-err">{{ msg }}</p> }
                      </span>
                    </pf-setting-row>
                    <pf-setting-row label="Last name *">
                      <span class="ue-ctlwrap">
                        <input type="text" pfAlpha class="pf-input ue-ctl" [class.pf-input--error]="!!fieldError()['fathersName']"
                               placeholder="e.g. Kumar" aria-label="Last name" [ngModel]="form().fathersName" (ngModelChange)="patch({ fathersName: $event })" />
                        @if (fieldError()['fathersName']; as msg) { <p class="pf-uf-err">{{ msg }}</p> }
                      </span>
                    </pf-setting-row>
                    @if (username()) {
                      <pf-setting-row label="Username" hint="The login handle can't be changed. Reset password issues a new password.">
                        <span class="ue-ro pf-num">{{ username() }}</span>
                      </pf-setting-row>
                    }
                    <pf-setting-row label="Phone">
                      <span class="ue-ctlwrap">
                        <div class="pf-uf-phone ue-ctl ue-ctl--phone" [class.pf-uf-phone--error]="!!fieldError()['phone']">
                          <pf-select class="pf-uf-phone__cc" [options]="countryOptions" [value]="countryCode()"
                                     [searchable]="true" (valueChange)="onCountryCodeChange($any($event))"></pf-select>
                          <span class="pf-uf-phone__sep" aria-hidden="true"></span>
                          <input type="tel" pfNumeric [maxDigits]="phoneMaxDigits()" [attr.maxlength]="phoneMaxDigits()"
                                 class="pf-num pf-uf-phone__num" aria-label="Mobile number"
                                 [class.pf-input--error]="!!fieldError()['phone']"
                                 [placeholder]="phoneMaxDigits() + '-digit mobile number'"
                                 [ngModel]="phoneDigits()" (ngModelChange)="onPhoneChange($event)" />
                        </div>
                        @if (fieldError()['phone']; as msg) { <p class="pf-uf-err">{{ msg }}</p> }
                      </span>
                    </pf-setting-row>
                    <pf-setting-row label="Registration number" hint="Medical council registration for doctors and consultants — prints under their signature on reports. They can also add it in My signature.">
                      <span class="ue-ctlwrap">
                        <input type="text" class="pf-input pf-num pf-ue-regno ue-ctl" maxlength="64" autocomplete="off"
                               [class.pf-input--error]="!!fieldError()['registrationId']"
                               placeholder="e.g. TN-12345" aria-label="Registration number"
                               [ngModel]="form().registrationId" (ngModelChange)="patch({ registrationId: $event })" />
                        @if (fieldError()['registrationId']; as msg) { <p class="pf-uf-err">{{ msg }}</p> }
                      </span>
                    </pf-setting-row>
    </ng-template>
    <ng-template #secBranches>
                    <pf-setting-row label="Branches *" [hint]="scopeHint">
                      <span class="ue-ctlwrap">
                        <pf-select class="pf-uf-scope ue-ctl ue-ctl--l" [multiple]="true" [searchable]="true"
                                   [options]="scopeOptions()" [values]="form().scope" placeholder="Pick branches"
                                   (valuesChange)="onScopeChange($event)"></pf-select>
                        @if (rolesLoaded() && !form().scope.length) { <p class="pf-uf-err">Pick at least one branch, or All branches.</p> }
                      </span>
                    </pf-setting-row>
    </ng-template>
    <ng-template #secRoles>
                    <!-- Roles: a compact Test Master-style list (Role | what it means | switch). -->
                    <div class="pf-uf-roles ue-roles" role="list">
                      @for (r of roleOptions(); track r.value) {
                        <div class="ue-role" role="listitem" [class.ue-role--on]="hasRole(r.value)">
                          <span class="ue-role__name">{{ r.label }}</span>
                          <span class="ue-role__what">{{ r.locked ? 'Kept — you can\'t assign or remove this role' : (r.hint || '') }}</span>
                          <button type="button" class="pf-toggle pf-uf-sw ue-role__sw press" role="switch" [attr.aria-checked]="hasRole(r.value)"
                                  [class.pf-uf-sw--locked]="r.locked" [attr.aria-disabled]="r.locked || null"
                                  [attr.aria-label]="r.label" [title]="r.locked ? lockedHint : ''"
                                  (click)="toggleRole(r.value)">
                            <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                          </button>
                        </div>
                      }
                    </div>
                    @if (!form().roleIds.length) { <p class="pf-uf-err ue-pad">Switch on at least one role.</p> }
                    @if (hasLocked()) { <p class="pf-field__hint pf-uf-lock-note ue-pad">{{ lockedHint }}</p> }
    </ng-template>
    <ng-template #secValidates>
                    <!-- Read-only here: validator pools are edited in ONE place, Lab › Collection and queues. -->
                    <div class="pf-ue-depts">
                      <pf-setting-row label="Validates for" [hint]="deptHint">
                        <div class="pf-ue-deptlist" data-testid="ue-validates-for">
                          @for (n of deptNames(); track n) { <span class="pf-chip pf-chip--static">{{ n }}</span> }
                          @empty { <span class="pf-ue-deptall">All departments</span> }
                        </div>
                      </pf-setting-row>
                      @if (viaRoles().length) {
                        <p class="pf-field__hint pf-ue-via ue-pad">Also through a role: {{ viaRoles().join(', ') }}</p>
                      }
                      <a class="pf-ue-deptlink ue-pad" [routerLink]="validatorPoolsPath" [queryParams]="{ tab: 'assign' }" data-testid="ue-validates-link">
                        Change who validates which department
                      </a>
                    </div>
    </ng-template>
  `,
  styleUrls: ['./user-form.styles.scss', '../../../shared/settings-grid/settings-grid.scss', './user-edit.component.scss']
})
export class UserEditComponent implements OnInit {
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');
  /** The pill's pencil: put the caret in the name field. */
  editName(): void {
    if (this.section() !== 'profile') { this.pickSection('profile'); setTimeout(() => this.editName()); return; }
    const el = this.nameInput()?.nativeElement;
    if (el) { el.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); el.focus(); el.select(); }
  }

  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly navBack = inject(NavBackService);
  protected readonly theme = inject(ThemeService);
  private readonly route = inject(ActivatedRoute);
  /** Panel mode: the user to edit (the Users grid opens the editor beside itself); else the route's :id. */
  readonly panelId = input<string | null>(null);
  readonly panel = computed(() => !!this.panelId());
  readonly closed = output<void>();
  readonly saved = output<void>();
  private readonly routeId = this.route.snapshot.paramMap.get('id');
  private get id(): string { return this.panelId() ?? this.routeId ?? ''; }

  private readonly _roles = signal<Role[]>([]);
  private readonly _branches = signal<Branch[]>([]);
  private readonly _form = signal<EditForm>({ title: '', firstName: '', fathersName: '', phone: '', registrationId: '', roleIds: [], scope: [] });
  private readonly _saving = signal(false);
  /** The user's role rows have landed (so a sole-branch default won't be
   *  overwritten by — or overwrite — the loaded scope). */
  readonly rolesLoaded = signal(false);
  private readonly _username = signal('');
  private readonly _loadedName = signal('');
  /** The loaded user's account state (band: Reset password / (De|Re)activate). */
  private readonly accountActions = inject(UserAccountActionsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly _loadedUser = signal<User | null>(null);
  readonly loaded = computed(() => !!this._loadedUser());
  readonly isActive = computed(() => this._loadedUser()?.isActive !== false);
  readonly accountBusy = signal(false);
  /** Which account action is running (its band button shows the dots). */
  readonly accountAction = signal<'reset' | 'active' | null>(null);
  /** Opening the editor: skeleton until the user record lands (held, no flash). */
  private readonly recordHold = createLoadHold(true);
  readonly recordSkeleton = this.recordHold.active;
  async resetPassword(): Promise<void> {
    const u = this._loadedUser();
    if (!u || this.accountBusy()) return;
    this.accountBusy.set(true);
    this.accountAction.set('reset');
    try { await this.accountActions.resetPassword(u); } finally { this.accountBusy.set(false); this.accountAction.set(null); }
  }
  async toggleActive(): Promise<void> {
    const u = this._loadedUser();
    if (!u || this.accountBusy()) return;
    this.accountBusy.set(true);
    this.accountAction.set('active');
    try {
      const active = u.isActive !== false;
      const done = active ? await this.accountActions.deactivate(u) : await this.accountActions.reactivate(u);
      if (done) this._loadedUser.set({ ...u, isActive: !active });
    } finally { this.accountBusy.set(false); this.accountAction.set(null); }
  }
  private readonly _fieldError = signal<Record<string, string>>({});

  readonly countryCodes = COUNTRY_CODES;
  readonly countryCode = signal<string>('+91');
  readonly phoneDigits = signal<string>('');
  readonly phoneMaxDigits = computed(() => getCountryDigitLength(this.countryCode()));

  readonly form = this._form.asReadonly();
  readonly saving = this._saving.asReadonly();
  readonly username = this._username.asReadonly();
  readonly loadedName = this._loadedName.asReadonly();
  readonly fieldError = this._fieldError.asReadonly();

  /** The roles the user held when the page loaded (the locked ones stay). */
  private readonly _heldIds = signal<string[]>([]);
  private readonly auth = inject(AuthService);
  /** Editing your own account: the server holds self-assignment to the subset
   *  rule even with manage_tenant, so the picker uses assignableToSelf. */
  private readonly isSelf = computed(() => this.auth.user()?.id === this.id);
  /** Only roles THIS caller may assign (server flags, role-assignability.ts),
   *  plus the user's held roles they can't — shown ON and read-only. */
  readonly roleOptions = computed<(PfSelectOption<string> & { locked: boolean })[]>(() =>
    rolePickerRows(this._roles(), this._heldIds(), this.isSelf())
      .map(r => ({ ...r, hint: ROLE_INFO[r.label] ?? undefined })));
  readonly hasLocked = computed(() => this.roleOptions().some(r => r.locked));
  readonly lockedHint = 'Roles you can\'t assign stay as they are. Widening this user\'s branches with them needs someone who can assign them.';
  readonly titleOptions: PfSelectOption<string>[] = TITLE_OPTIONS;
  /** Country codes as pf-select options (code + country; no flag emoji). */
  readonly countryOptions: PfSelectOption<string>[] = COUNTRY_CODES.map(c => ({ value: c.code, label: c.code, hint: c.country }));

  // ── Context bar (new design) ──
  readonly displayPreview = computed(() => {
    const f = this._form();
    return [f.title, f.firstName, f.fathersName].map(x => (x ?? '').trim()).filter(Boolean).join(' ');
  });

  readonly scopeOptions = computed<PfSelectOption<string>[]>(() => buildScopeOptions(this._branches()));
  readonly scopeHint = SCOPE_HINT;

  // ── Departments (consultant scope) ──
  private readonly _departments = signal<Department[]>([]);
  private readonly _deptRow = signal<UserDepartmentsRow | null>(null);
  readonly deptIds = signal<string[]>([]);
  readonly deptHint = DEPARTMENTS_HINT;
  readonly viaRoles = computed(() => viaRoleLabels(
    this._deptRow(),
    new Map(this._departments().map(d => [d.id, d.name])),
    new Map(this._roles().map(r => [r.id, r.name]))));
  /** The departments this user validates for (direct picks), by name — read-only here. */
  readonly deptNames = computed(() => {
    const names = new Map(this._departments().map(d => [d.id, d.name] as const));
    return this.deptIds().map(id => names.get(id)).filter((n): n is string => !!n).sort((a, b) => a.localeCompare(b));
  });
  /** The ONE home of the validator pools. */
  protected readonly validatorPoolsPath = LAB_PAGES.collection.path;

  // ── Two-panel editor (owner 2026-11-17): sections LEFT, the selected section RIGHT ──
  readonly narrow = sgMedia(SG_NARROW_MQ);
  readonly section = signal<'profile' | 'branches' | 'roles' | 'validates'>('profile');
  /** Phone: the sections list first, then the picked section. */
  readonly sectionPicked = signal(false);
  readonly sections = computed(() => {
    const f = this._form();
    const fe = this._fieldError();
    const nRoles = f.roleIds.length;
    return [
      { id: 'profile' as const, label: 'Profile', req: true, note: this.displayPreview() || 'Name, phone, registration', err: !!(fe['firstName'] || fe['fathersName'] || fe['phone'] || fe['registrationId']) },
      { id: 'branches' as const, label: 'Branches', req: true, note: f.scope.length ? this.scopeSummary() : 'None picked', err: this.rolesLoaded() && !f.scope.length },
      { id: 'roles' as const, label: 'Roles', req: true, note: nRoles ? `${nRoles} ${nRoles === 1 ? 'role' : 'roles'}` : 'None on', err: !nRoles },
      { id: 'validates' as const, label: 'Validates for', req: false, note: this.deptNames().length ? this.deptNames().join(', ') : 'All departments', err: false },
    ];
  });
  readonly sectionLabel = computed(() => this.sections().find(x => x.id === this.section())?.label ?? '');
  readonly sectionIcon = computed(() => ({
    profile: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
    branches: 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6',
    roles: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
    validates: 'M9 2v17.5a2.5 2.5 0 0 1-5 0V2M20 2v17.5a2.5 2.5 0 0 1-5 0V2M3 2h7M14 2h7',
  })[this.section()]);
  pickSection(id: 'profile' | 'branches' | 'roles' | 'validates') { this.section.set(id); this.sectionPicked.set(true); }
  /** Phone: the band's ONE back returns from a section to the sections list first. */
  readonly backToSections = (): void => this.sectionPicked.set(false);
  /** A field error (server or validation) brings its section forward. */
  private readonly showErrors = effect(() => {
    const fe = this._fieldError();
    if (fe['firstName'] || fe['fathersName'] || fe['phone'] || fe['registrationId']) untracked(() => this.section.set('profile'));
  });
  /** "All branches" / "Main, Annex" — the scope's labels. */
  readonly scopeSummary = computed(() => {
    const opts = this.scopeOptions();
    const labels = this._form().scope.map(v => opts.find(o => o.value === v)?.label ?? v);
    return labels.length ? labels.join(', ') : 'No branch';
  });
  /** Combined permissions of the roles switched on ("8 of 70 permissions from 1 role"). */
  private readonly _permTotal = signal<number | null>(null);
  private readonly _rolePerms = signal<Map<string, string[]>>(new Map());
  readonly permSummary = computed(() => {
    const ids = this._form().roleIds;
    const map = this._rolePerms();
    const n = ids.length;
    const roles = `${n} ${n === 1 ? 'role' : 'roles'}`;
    if (this._permTotal() == null || ids.some(id => !map.has(id))) return n ? `From ${roles}` : 'No role on';
    const set = new Set(ids.flatMap(id => map.get(id) ?? []));
    return `${set.size} of ${this._permTotal()} permissions from ${roles}`;
  });
  private readonly loadRolePerms = effect(() => {
    const ids = this._form().roleIds;
    const have = untracked(() => this._rolePerms());
    for (const id of ids) {
      if (have.has(id) || this.pendingPerms.has(id)) continue;
      this.pendingPerms.add(id);
      this.api.get<string[]>(`/api/roles/${id}/permissions`).subscribe({
        next: l => { this.pendingPerms.delete(id); this._rolePerms.update(m => new Map(m).set(id, l ?? [])); },
        error: () => this.pendingPerms.delete(id),
      });
    }
  });
  private readonly pendingPerms = new Set<string>();

  readonly canSave = computed(() => this._form().roleIds.length > 0 && this._form().scope.length > 0);

  ngOnInit() {
    this.destroyRef.onDestroy(() => this.recordHold.cancel());
    this.api.get<Role[]>('/api/roles/').subscribe({ next: l => this._roles.set(l ?? []) });
    this.api.get<Permission[]>('/api/permissions').subscribe({ next: l => this._permTotal.set((l ?? []).length), error: () => {} });
    this.api.get<Branch[]>('/api/tenants/branches').subscribe({
      next: l => {
        const branches = l ?? [];
        this._branches.set(branches);
        // One-branch tenant: that branch is the only possible scope.
        const sole = soleScope(branches);
        if (sole && this.rolesLoaded() && !this._form().scope.length) this.patch({ scope: [sole] });
      }
    });
    this.api.get<Department[]>('/api/tenants/departments').subscribe({ next: l => this._departments.set(l ?? []), error: () => {} });
    this.api.get<UserDepartmentsRow>(`/api/users/${this.id}/departments`).subscribe({
      next: r => { this._deptRow.set(r ?? null); this.deptIds.set(r?.departmentIds ?? []); },
      error: () => { /* older server: the card stays empty */ },
    });
    // No single-user GET endpoint — read the list + this user's role assignments.
    forkJoin({
      users: this.api.get<User[]>('/api/users/'),
      roles: this.api.get<{ roleId: string; branchId?: string }[]>(`/api/users/${this.id}/roles`),
    }).subscribe({
      next: ({ users, roles }) => {
        const u = (users ?? []).find(x => x.id === this.id);
        if (u) {
          this._loadedUser.set(u);
          this._loadedName.set(u.displayName || u.firstName || u.username || '');
          this._username.set(u.username || '');
          this._form.update(v => ({ ...v, title: u.title ?? '', firstName: u.firstName ?? '', fathersName: u.fathersName ?? '', phone: u.phone ?? '', registrationId: u.registrationId ?? '' }));

          if (u.phone) {
            const parsed = parsePhoneNumber(u.phone);
            this.countryCode.set(parsed.code);
            this.phoneDigits.set(parsed.digits);
          }
        }
        const rs = roles ?? [];
        let scope = scopeValuesFromRoles(rs);
        const sole = soleScope(this._branches());
        if (!scope.length && sole) scope = [sole];
        this.rolesLoaded.set(true);
        const held = [...new Set(rs.map(r => r.roleId))];
        this._heldIds.set(held);
        this._form.update(v => ({ ...v, roleIds: held, scope }));
        this.recordHold.done();
      },
      error: () => this.recordHold.done(),
    });
  }

  onCountryCodeChange(code: string) {
    this.countryCode.set(code);
    const maxLen = getCountryDigitLength(code);
    if (this.phoneDigits().length > maxLen) {
      this.phoneDigits.set(this.phoneDigits().substring(0, maxLen));
    }
    this.updateFullPhone();
  }

  onPhoneChange(v: string) {
    const maxLen = getCountryDigitLength(this.countryCode());
    const clean = (v || '').replace(/\D/g, '').substring(0, maxLen);
    this.phoneDigits.set(clean);
    this.updateFullPhone();
  }

  private updateFullPhone() {
    const digits = this.phoneDigits().trim();
    if (!digits) {
      this.patch({ phone: '' });
    } else {
      this.patch({ phone: `${this.countryCode()} ${digits}` });
    }
  }

  patch(p: Partial<EditForm>) {
    this._form.update(v => ({ ...v, ...p }));
    // Editing a field clears its stale inline error.
    const keys = Object.keys(p);
    if (keys.length) this._fieldError.update(fe => { const n = { ...fe }; for (const k of keys) delete n[k]; return n; });
  }
  back() { this.navBack.backTo('/admin?section=people'); }
  /** Saved: the panel tells its grid (and closes); the page goes back where the person came from. */
  private finish() { if (this.panel()) { this.saved.emit(); this.closed.emit(); } else this.back(); }
  hasRole(id: string) { return this._form().roleIds.includes(id); }
  toggleRole(id: string) {
    if (this.roleOptions().find(r => r.value === id)?.locked) return;
    this._form.update(v => ({ ...v, roleIds: v.roleIds.includes(id) ? v.roleIds.filter(r => r !== id) : [...v.roleIds, id] }));
  }
  onScopeChange(next: string[]) {
    this.patch({ scope: applyScopePick(this._form().scope, next ?? [], this._branches()) });
  }

  save() {
    if (!this.canSave()) return;
    const i = this._form();
    this._saving.set(true);
    this._fieldError.set({});
    // Details first, then roles (full-replace). Both must land for a clean save.
    this.api.patch<User>(`/api/users/${this.id}`, {
      title: i.title, firstName: i.firstName, fathersName: i.fathersName, phone: i.phone || undefined,
      // Only when changed (blank clears); the server audit-logs the change.
      ...(regIdChanged(i.registrationId, this._loadedUser()?.registrationId) ? { registrationId: i.registrationId.trim() } : {}),
    }).subscribe({
      next: () => {
        // Roles apply at every selected branch (one assignment per role × branch).
        this.api.put(`/api/users/${this.id}/roles`, {
          roleIds: i.roleIds, ...scopePayload(i.scope, this._branches()),
        }).subscribe({
          next: () => { this._saving.set(false); this.toasts.success('User updated'); this.finish(); },
          error: e => { this._saving.set(false); this.showError(e); },
        });
      },
      error: e => { this._saving.set(false); this.showError(e); },
    });
  }

  /** Route field-named backend failures to the offending input; toast the rest. */
  private showError(e: unknown) {
    const err = ApiError.from(e);
    const inputs = ['firstName', 'fathersName', 'phone', 'registrationId'];
    if (err.field && inputs.includes(err.field)) {
      this._fieldError.update(fe => ({ ...fe, [err.field!]: err.message }));
    } else {
      this.toasts.error(err.message);
    }
  }
}
