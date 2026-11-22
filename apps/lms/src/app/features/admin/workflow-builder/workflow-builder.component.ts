import { NO_CHANGES_TITLE } from '../../../shared/utils/save-state';
import { bindSaveShortcut } from '../../../shared/utils/save-shortcut';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { WorkflowRendererComponent } from '../../../shared/components/workflow-renderer/workflow-renderer.component';
import {
  ConditionRule,
  ConditionalRoute,
  WorkflowConfigRecord,
  WorkflowContext,
  WorkflowField,
  WorkflowStep
} from '../../../shared/models/workflow.model';
import { ApiError } from '../../../shared/models/api-response.model';
import { ChipTone } from '../../../shared/primitives/chip.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { ConditionBuilderComponent } from './condition-builder.component';
import { WorkflowBuilderService } from './workflow-builder.service';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ThemeService } from '../../../core/services/theme.service';
import { bandFilter } from '../../../shared/utils/band-search';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';
import { SkeletonRowsComponent } from '../../../shared/primitives/skeleton-kit.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { SettingsSiblingsComponent } from '../settings/settings-siblings.component';

interface HistoryRow {
  id: string;
  changedAt: string;
  changedBy?: string;
  changeSummary?: string;
  configJson: string;
}

@Component({
  selector: 'pf-workflow-builder',
  standalone: true,
  imports: [SettingsSiblingsComponent, BusyDirective, SkeletonRowsComponent,
    FormsModule,
    DragDropModule,
    DatePipe,
    ConditionBuilderComponent,
    WorkflowRendererComponent,
    ScreenHeaderComponent,
    SelectComponent,
    TouchButtonComponent,
    HeroBandComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!screenName()) {
      <section class="pf-band-page px-4 md:px-8 pt-6 pb-10">
        @if (theme.isNewDesign()) {
          <!-- Band pill (owner): search the screen forms. -->
          <pf-hero-band [back]="true" placeholder="Search forms — patient register, order create…"
                        [value]="q()" (valueChange)="q.set($event)"><ng-container band-tools><pf-settings-siblings></pf-settings-siblings></ng-container>
        </pf-hero-band>
        }
        <pf-screen-header class="pf-classic-only"
          eyebrow="Admin"
          title="Workflow Builder"
          subtitle="Every LMS screen is driven by one of these configs. Edit a workflow to reshape its steps and fields.">
        </pf-screen-header>

        <div class="pf-band-body">
        @if (screens().length === 0) {
          <div class="pf-card pf-wf-empty"><p>No workflows yet.</p></div>
        } @else if (visibleScreens().length === 0) {
          <p class="pf-band-empty">No forms match "{{ q() }}".</p>
        } @else {
          <ul class="pf-wf-list">
            @for (r of visibleScreens(); track r.screenName) {
              <li class="pf-row pf-wf-row" (click)="openBuilder(r.screenName)">
                <span class="pf-card__icon pf-wf-icon" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/>
                    <rect width="7" height="7" x="3" y="14" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/>
                  </svg>
                </span>
                <span class="pf-wf-main">
                  <span class="pf-wf-titlerow">
                    <span class="pf-row__name pf-wf-name">{{ prettify(r.screenName) }}</span>
                    <span class="pf-chip pf-chip--static pf-wf-status" [attr.data-status]="r.status">
                      @if (r.status === 'published') {
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                        Published
                      } @else { {{ r.status }} }
                    </span>
                  </span>
                  <span class="pf-row__meta pf-num pf-wf-meta">v{{ r.version }} · {{ stepCount(r) }} steps · {{ fieldCount(r) }} fields</span>
                </span>
                <button type="button" class="pf-rowact pf-wf-edit" [class.pf-rowact--icon]="!web()"
                        (click)="$event.stopPropagation(); openBuilder(r.screenName)"
                        [attr.aria-label]="'Edit ' + prettify(r.screenName)" title="Edit">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                  <span class="pf-rowact__t">Edit</span>
                </button>
              </li>
            }
          </ul>
        }
        </div>
      </section>
    }

    @if (screenName() && builder.workflow(); as wf) {
      <section class="px-4 md:px-6 pt-6 pb-10 pf-wfe" [class.pf-band-page]="theme.isNewDesign()">
        @if (theme.isNewDesign()) {
          <!-- ND "Editors": band = back · tenant · actions (Save draft
               secondary, Publish = the ONE primary); pill = CONTEXT BAR. -->
          <pf-hero-band class="pf-wfe-band" [back]="true" backTo="/admin/workflows" [customSearch]="true" [contextBar]="true">
            <ng-container band-actions>
              <span class="pf-savestate pf-wfe-savestate" role="status" aria-live="polite"
                    [attr.aria-label]="builder.isDirty() ? 'Unsaved changes' : 'All changes saved'">
                @if (builder.isDirty()) {
                  <span class="pf-savestate__dot" aria-hidden="true"></span><span class="pf-wfe-savestate__t">Unsaved changes</span>
                } @else {
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg><span class="pf-wfe-savestate__t">All changes saved</span>
                }
              </span>
              <span class="pf-wfe-more">
                <button type="button" class="pf-hb-btn pf-hb-btn--ghost pf-wfe-act" (click)="openPreview()" aria-label="Preview" title="Preview">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                  Preview
                </button>
                <button type="button" class="pf-hb-btn pf-hb-btn--ghost pf-wfe-act" (click)="openHistory()" aria-label="History" title="Version history">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>
                  History
                </button>
                <button type="button" class="pf-hb-btn pf-hb-btn--ghost pf-wfe-act" (click)="resetWorkflow()" aria-label="Reload from server" title="Reload from server">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>
                  Reset
                </button>
              </span>
              <!-- Phones: the three utilities fold into a "More" menu. -->
              <span class="pf-wfe-morewrap">
                <button type="button" class="pf-hb-btn pf-hb-btn--ghost pf-wfe-morebtn" (click)="moreOpen.set(!moreOpen())"
                        aria-label="More actions" title="More" aria-haspopup="menu" [attr.aria-expanded]="moreOpen()">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>
                  More
                </button>
                @if (moreOpen()) {
                  <div class="pf-card pf-wfe-menu pf-anim-in" role="menu">
                    <button type="button" role="menuitem" class="pf-wfe-menu__item" (click)="moreOpen.set(false); openPreview()">Preview</button>
                    <button type="button" role="menuitem" class="pf-wfe-menu__item" (click)="moreOpen.set(false); openHistory()">Version history</button>
                    <button type="button" role="menuitem" class="pf-wfe-menu__item" (click)="moreOpen.set(false); resetWorkflow()">Reload from server</button>
                  </div>
                }
              </span>
              <button type="button" class="pf-hb-btn pf-hb-btn--ghost pf-wfe-draft" data-testid="wf-save-draft" [disabled]="!builder.isDirty() || saving()" [pfBusy]="savingKind() === 'draft'" pfBusyLabel="Saving draft…"
                      [pfBusyInactive]="!builder.isDirty() || saving()"
                      (click)="saveDraft()" aria-label="Save draft" [title]="builder.isDirty() || saving() ? 'Save draft' : NO_CHANGES">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>
                Save draft
              </button>
              <button type="button" class="pf-hb-btn pf-hb-btn--primary pf-wfe-publish" [disabled]="saving()" [pfBusy]="savingKind() === 'publish'" pfBusyLabel="Publishing…"
                      (click)="publish()" [attr.aria-label]="saving() ? 'Publishing' : 'Publish'" title="Publish">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>
                {{ saving() ? 'Publishing…' : 'Publish' }}
              </button>
            </ng-container>

            <!-- The pill = [workflow title ✎ · "Published v4"] | [step tabs]
                 (PF-PATTERN §14). Nothing else: the step card shows the rest. -->
            <div band-search class="pf-ctx pf-wfe-ctx">
              <span class="pf-ctx__primary pf-wfe-ctx__name">
                @if (titleEditing()) {
                  <input #titleIn class="pf-input pf-wfe-titlein" [value]="wf.title" aria-label="Workflow title"
                         (keydown.enter)="commitTitle(titleIn.value)" (keydown.escape)="titleEditing.set(false)"
                         (blur)="commitTitle(titleIn.value)" />
                } @else {
                  <span class="pf-wfe-ctx__nametext">{{ wf.title }}</span>
                  <span class="pf-wfe-ctx__badge pf-num" [title]="'Version ' + (builder.record()?.version ?? '—') + ' · ' + (builder.record()?.status ?? '')">{{ statusBadge() }}</span>
                  <button type="button" class="pf-ctx__edit press" (click)="editTitle()" aria-label="Edit workflow title" title="Edit title">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                  </button>
                }
              </span>
              <span class="pf-wfe-ctx__div" aria-hidden="true"></span>
              <!-- Steps: a neutral segmented control with a sliding indicator. -->
              <div class="pf-wfe-tabs" role="tablist" aria-label="Steps" #tabsEl>
                <span class="pf-wfe-tabs__ind" aria-hidden="true"
                      [style.transform]="'translateX(' + tabInd().x + 'px)'" [style.width.px]="tabInd().w"
                      [style.opacity]="tabInd().w ? 1 : 0"></span>
                @for (s of wf.steps; track s.id) {
                  <button type="button" class="pf-wfe-tab" role="tab"
                          [attr.aria-selected]="builder.selectedStepId() === s.id" [attr.data-step]="s.id"
                          [attr.aria-label]="s.title + ', ' + s.fields.length + ' fields'"
                          (click)="builder.selectStep(s.id)">
                    <span>{{ s.title }}</span>
                    <span class="pf-num pf-wfe-tab__n" aria-hidden="true">{{ s.fields.length }}</span>
                  </button>
                }
              </div>
              <button type="button" class="pf-ctx__edit pf-wfe-addstep press" (click)="addStep()" aria-label="Add step" title="Add step">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
              </button>
            </div>
          </pf-hero-band>
        }

        <pf-screen-header
          class="pf-builder-hdr pf-classic-only"
          [eyebrow]="'Workflow · v' + (builder.record()?.version ?? '—') + ' · ' + (builder.record()?.status ?? '—')"
          [title]="wf.title"
          [subtitle]="builder.isDirty() ? 'Unsaved changes — save draft or publish to commit.' : 'Live configuration.'">
          <pf-touch-btn actions size="sm" variant="ghost" (pressed)="openPreview()">Preview</pf-touch-btn>
          <pf-touch-btn actions size="sm" variant="ghost" (pressed)="openHistory()">History</pf-touch-btn>
          <pf-touch-btn actions size="sm" variant="ghost" (pressed)="resetWorkflow()">Reset</pf-touch-btn>
          <pf-touch-btn actions size="sm" variant="secondary" [disabled]="!builder.isDirty() || saving()" [busy]="savingKind() === 'draft'" busyLabel="Saving draft…" (pressed)="saveDraft()">Save draft</pf-touch-btn>
          <pf-touch-btn actions size="sm" variant="primary" [disabled]="saving()" [busy]="savingKind() === 'publish'" busyLabel="Publishing…" (pressed)="publish()">{{ saving() ? 'Publishing…' : 'Publish' }}</pf-touch-btn>
        </pf-screen-header>

        <div class="pf-wfe-body" [class.pf-band-body]="theme.isNewDesign()">
        <div class="pf-wfe-grid" [class.pf-wfe-grid--nd]="theme.isNewDesign()">
          @if (!theme.isNewDesign()) {
          <!-- ──────── Steps panel (classic rail) ──────── -->
          <div class="pf-card pf-wfe-rail">
            <div class="pf-card__head">
              <span class="pf-card__label">Steps</span><span class="pf-card__spacer"></span>
              <button type="button" class="pf-btn pf-btn--tertiary pf-wfe-mini" (click)="addStep()">+ Add</button>
            </div>
            <ul cdkDropList (cdkDropListDropped)="onStepDrop($event)" class="pf-wfe-steps">
              @for (s of wf.steps; track s.id) {
                <li cdkDrag class="pf-row pf-step-item" [class.pf-row--in]="builder.selectedStepId() === s.id"
                    (click)="builder.selectStep(s.id)">
                  <span class="pf-drag-handle" cdkDragHandle aria-hidden="true">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>
                  </span>
                  <span class="pf-wfe-rowtext">
                    <span class="pf-row__name">{{ s.title }}</span>
                    <span class="pf-row__meta pf-num">{{ s.type }} · {{ s.fields.length }} fields</span>
                  </span>
                </li>
              }
            </ul>
          </div>
          }

          <!-- ──────── Detail: stacked pf-cards ──────── -->
          @if (builder.selectedStep(); as step) {
            <div class="pf-wfe-detail" role="tabpanel">
              <section class="pf-card pf-wfe-card">
                <div class="pf-card__head">
                  <span class="pf-card__icon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/></svg>
                  </span>
                  <span class="pf-card__label">Step</span>
                  <span class="pf-card__note pf-num">{{ stepIndex(step.id) + 1 }} of {{ wf.steps.length }}</span>
                  <span class="pf-card__spacer"></span>
                  <button type="button" class="pf-rowact pf-wfe-mv" [class.pf-rowact--icon]="!web()" [disabled]="stepIndex(step.id) === 0"
                          (click)="moveStep(step.id, -1)" aria-label="Move step earlier" title="Move earlier">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
                    <span class="pf-rowact__t">Move earlier</span>
                  </button>
                  <button type="button" class="pf-rowact pf-wfe-mv" [class.pf-rowact--icon]="!web()" [disabled]="stepIndex(step.id) === wf.steps.length - 1"
                          (click)="moveStep(step.id, 1)" aria-label="Move step later" title="Move later">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
                    <span class="pf-rowact__t">Move later</span>
                  </button>
                  <button type="button" class="pf-rowact pf-wfe-delstep" [class.pf-rowact--icon]="!web()"
                          (click)="deleteStep(step.id)" aria-label="Delete step" title="Delete step">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
                    <span class="pf-rowact__t">Delete step</span>
                  </button>
                </div>
                <div class="pf-card__body pf-wfe-cardbody">
                  <div class="pf-wfe-grid2">
                    <label class="pf-field">
                      <span class="pf-field__lbl">Title</span>
                      <input type="text" class="pf-input" [ngModel]="step.title"
                             (ngModelChange)="builder.updateStep(step.id, { title: $event })" />
                    </label>
                    <label class="pf-field">
                      <span class="pf-field__lbl">Name</span>
                      <input type="text" class="pf-input pf-num" [ngModel]="step.name"
                             (ngModelChange)="builder.updateStep(step.id, { name: $event })" />
                    </label>
                  </div>
                  <div class="pf-wfe-grid3">
                    <div class="pf-field">
                      <span class="pf-field__lbl">Type</span>
                      <pf-select [options]="stepTypeSelectOptions" [value]="step.type"
                                 (valueChange)="builder.updateStep(step.id, { type: $any($event) })"></pf-select>
                    </div>
                    <button type="button" class="pf-toggle pf-wfe-toggle" role="switch" [attr.aria-checked]="step.isRequired"
                            (click)="builder.updateStep(step.id, { isRequired: !step.isRequired })">
                      <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                      <span>Required</span>
                    </button>
                    <button type="button" class="pf-toggle pf-wfe-toggle" role="switch" [attr.aria-checked]="step.canSkip"
                            (click)="builder.updateStep(step.id, { canSkip: !step.canSkip })">
                      <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                      <span>Can be skipped</span>
                    </button>
                  </div>
                </div>
              </section>

              <section class="pf-card pf-wfe-card">
                <div class="pf-card__head">
                  <span class="pf-card__icon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>
                  </span>
                  <span class="pf-card__label">Fields</span>
                  <span class="pf-card__note pf-num">{{ step.fields.length }} {{ step.fields.length === 1 ? 'field' : 'fields' }}</span>
                  <button type="button" class="pf-btn pf-btn--tertiary pf-wfe-mini" (click)="openAddField(step.id)">+ Add field</button>
                </div>
                <div class="pf-card__body pf-wfe-cardbody">
                  <ul cdkDropList (cdkDropListDropped)="onFieldDrop(step.id, $event)" class="pf-wfe-fields">
                    @for (f of step.fields; track f.id) {
                      <li cdkDrag class="pf-row pf-field-item">
                        <span class="pf-drag-handle" cdkDragHandle aria-hidden="true">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>
                        </span>
                        <span class="pf-wfe-rowtext">
                          <span class="pf-row__name">
                            {{ f.title }}
                            @if (f.isRequired) { <span class="pf-wfe-req" aria-label="required">*</span> }
                          </span>
                          <span class="pf-row__meta">
                            <span class="pf-num">{{ f.storageKey }}</span> · {{ f.type }}
                            @if (f.showWhen && f.showWhen.length > 0) { · conditional }
                          </span>
                        </span>
                        <button type="button" class="pf-rowact pf-field-action" [class.pf-rowact--icon]="!web()"
                                (click)="openEditField(step.id, f)" [attr.aria-label]="'Edit ' + f.title" title="Edit field">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                          <span class="pf-rowact__t">Edit</span>
                        </button>
                        <button type="button" class="pf-rowact pf-field-delete" [class.pf-rowact--icon]="!web()"
                                (click)="deleteField(step.id, f.id)" [attr.aria-label]="'Delete ' + f.title" title="Delete field">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                          <span class="pf-rowact__t">Delete</span>
                        </button>
                      </li>
                    } @empty {
                      <li class="pf-wfe-empty">No fields yet.</li>
                    }
                  </ul>
                </div>
              </section>

              <section class="pf-card pf-wfe-card">
                <div class="pf-card__head">
                  <span class="pf-card__icon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
                  </span>
                  <span class="pf-card__label">Visibility</span>
                </div>
                <div class="pf-card__body pf-wfe-cardbody">
                  <h3 class="pf-wfe-h">Show this step when</h3>
                  <pf-condition-builder [rules]="step.showWhen ?? []" [fields]="builder.allFields()" emptyLabel="Always shown."
                    (rulesChange)="builder.setStepShowConditions(step.id, $event.length === 0 ? undefined : $event)"></pf-condition-builder>
                  <h3 class="pf-wfe-h">Skip this step when</h3>
                  <pf-condition-builder [rules]="step.skipWhen ?? []" [fields]="builder.allFields()" emptyLabel="Never auto-skipped."
                    (rulesChange)="builder.setStepSkipConditions(step.id, $event.length === 0 ? undefined : $event)"></pf-condition-builder>
                </div>
              </section>

              <section class="pf-card pf-wfe-card">
                <div class="pf-card__head">
                  <span class="pf-card__icon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                  </span>
                  <span class="pf-card__label">After this step</span>
                </div>
                <div class="pf-card__body pf-wfe-cardbody">
                  <div class="pf-route-row">
                    <span class="pf-field__lbl">Default next step</span>
                    <pf-select [options]="defaultNextOptions(step.id)" [value]="step.afterStep.defaultNextStep ?? ''"
                               placeholder="— Finish workflow —"
                               (valueChange)="setDefaultNext(step.id, $any($event) || null)"></pf-select>
                  </div>
                  @for (route of step.afterStep.conditionalRoutes ?? []; let i = $index; track i) {
                    <div class="pf-route-card">
                      <div class="pf-route-card__head">
                        <span class="pf-wfe-h">Conditional route <span class="pf-num">{{ i + 1 }}</span></span>
                        <button type="button" class="pf-rowact pf-route-remove" [class.pf-rowact--icon]="!web()"
                                (click)="removeRoute(step.id, i)" aria-label="Remove route" title="Remove route">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                          <span class="pf-rowact__t">Remove</span>
                        </button>
                      </div>
                      <pf-condition-builder [rules]="route.conditions" [fields]="builder.allFields()"
                        emptyLabel="Add rules to trigger this route." (rulesChange)="updateRouteConditions(step.id, i, $event)"></pf-condition-builder>
                      <div class="pf-route-row">
                        <span class="pf-field__lbl">Go to step</span>
                        <pf-select [options]="goToStepOptions(step.id)" [value]="route.goToStep"
                                   (valueChange)="updateRouteTarget(step.id, i, $any($event))"></pf-select>
                      </div>
                    </div>
                  }
                  <button type="button" class="pf-btn pf-btn--tertiary pf-wfe-mini" (click)="addRoute(step.id)">+ Add conditional route</button>
                </div>
              </section>
            </div>
          } @else {
            <div class="pf-card pf-wfe-empty"><p>{{ theme.isNewDesign() ? 'Pick a step in the bar above.' : 'Select a step on the left.' }}</p></div>
          }
        </div>
        </div>
      </section>

      <!-- ──────── Undo toast ──────── -->
      @if (builder.lastDeletedField(); as del) {
        <div class="pf-undo-toast" role="status">
          Field <strong>{{ del.field.title }}</strong> deleted
          <button class="pf-undo-btn" (click)="builder.undoDeleteField()">Undo</button>
        </div>
      }
      @if (builder.lastDeletedStep(); as del) {
        <div class="pf-undo-toast" role="status">
          Step <strong>{{ del.step.title }}</strong> deleted
          <button class="pf-undo-btn" (click)="builder.undoDeleteStep()">Undo</button>
        </div>
      }

      <!-- ──────── Preview modal (above the always-visible navbar) ──────── -->
      @if (previewOpen()) {
        <div class="pf-wfe-overlay pf-preview-overlay" role="dialog" aria-modal="true" aria-label="Preview">
          <div class="pf-wfe-scrim" (click)="closePreview()"></div>
          <div class="pf-card pf-preview-modal pf-anim-in">
            <header class="pf-card__head pf-preview-header">
              <span class="pf-card__icon" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
              </span>
              <span class="pf-card__label">Preview</span>
              <span class="pf-card__note">{{ builder.workflow()!.title }}</span>
              <button type="button" class="pf-btn pf-btn--icon pf-close-btn" (click)="closePreview()" aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </header>
            <div class="pf-card__body pf-preview-body">
              <pf-workflow-renderer
                [config]="builder.workflow()!"
                [context]="previewContext()"
                [resources]="previewResources"
                [finishLabel]="'(preview only)'"></pf-workflow-renderer>
              <p class="pf-wfe-hint">Running against mocked context — age 34 Male, standard permissions. No writes occur.</p>
            </div>
          </div>
        </div>
      }

      <!-- ──────── Version history slide-over ──────── -->
      @if (historyOpen()) {
        <div class="pf-wfe-overlay pf-wfe-overlay--side" role="dialog" aria-modal="true" aria-label="Version history">
          <div class="pf-wfe-scrim" (click)="closeHistory()"></div>
          <aside class="pf-card pf-history-panel">
            <header class="pf-card__head pf-history-header">
              <span class="pf-card__icon" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>
              </span>
              <span class="pf-card__label">Version history</span>
              <span class="pf-card__spacer"></span>
              <button type="button" class="pf-btn pf-btn--icon pf-close-btn" (click)="closeHistory()" aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </header>
            <section class="pf-card__body">
              @if (historyLoading()) {
                <div class="flex justify-center py-3">
                  <pf-skeleton-rows [rows]="3" [dense]="true" [avatar]="false" label="Loading history…"></pf-skeleton-rows>
                </div>
              } @else if (historyRows().length === 0) {
                <p class="pf-wfe-hint">No prior versions yet. Save or publish to create one.</p>
              } @else {
                <ul class="pf-wfe-fields">
                  @for (h of historyRows(); track h.id) {
                    <li class="pf-row pf-history-row">
                      <span class="pf-wfe-rowtext">
                        <span class="pf-row__name">{{ h.changeSummary ?? '(no summary)' }}</span>
                        <span class="pf-row__meta pf-num">{{ h.changedAt | date:'short' }}</span>
                      </span>
                      <button type="button" class="pf-rowact" [class.pf-rowact--icon]="!web()" (click)="restoreFromHistory(h)"
                              aria-label="Restore this version" title="Restore this version">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/></svg>
                        <span class="pf-rowact__t">Restore</span>
                      </button>
                    </li>
                  }
                </ul>
              }
            </section>
            <footer class="pf-history-footer">Restoring writes a new history entry — nothing is lost.</footer>
          </aside>
        </div>
      }
    }
  `,
  styles: [`
    /* ═══ PF-PATTERN: list rows, editor (band + context bar + step tabs),
       stacked pf-cards; overlays sit above the always-visible navbar. ═══ */
    .pf-wf-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .pf-wf-row { cursor: pointer; gap: 12px; padding: 10px 12px; transition: border-color var(--pf-dur-fast) ease; }
    .pf-wf-row:hover { border-color: var(--pf-sel-border); }
    .pf-wf-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .pf-wf-titlerow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .pf-wf-name { flex: 0 1 auto; font-size: 14.5px; font-weight: 600; }
    .pf-wf-status { height: 24px; font-size: 11.5px; text-transform: capitalize; }
    .pf-wf-status svg { color: var(--violet-text, #7c3aed); }
    .pf-wf-empty, .pf-wfe-empty { padding: 28px 16px; text-align: center; font-size: 13.5px; color: var(--text-secondary); list-style: none; }

    /* Editor */
    .pf-wfe-body { display: flex; flex-direction: column; gap: 14px; }
    /* The pill: [title ✎ · badge] | [step tabs] + — one line on web; phones
       stack the name over a sideways-scrolling tabs row (PF-PATTERN §14). */
    .pf-wfe-ctx.pf-ctx { flex-wrap: nowrap; gap: 12px; padding: 2px 0; overflow: visible; }
    .pf-wfe-ctx__name { flex: 0 1 auto; min-width: 120px; max-width: 40%; }
    .pf-wfe-ctx__badge { flex: none; margin-left: 4px; padding: 1px 6px; border-radius: 6px; border: 1px solid var(--pf-line);
      background: var(--pf-chip-bg); font-size: 11px; font-weight: 500; line-height: 1.4; color: var(--text-tertiary); text-transform: capitalize; }
    .pf-wfe-titlein { min-width: 220px; font-size: 15px; font-weight: 600; }
    .pf-wfe-ctx__div { flex: none; width: 1px; align-self: stretch; margin: 4px 0; background: var(--pf-line); }
    .pf-wfe-tabs { position: relative; flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 2px; padding: 3px;
      border-radius: 12px; background: var(--pf-chip-bg); border: 1px solid var(--pf-line);
      overflow-x: auto; overflow-y: hidden; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
    .pf-wfe-tabs::-webkit-scrollbar { display: none; }
    .pf-wfe-tabs__ind { position: absolute; top: 3px; bottom: 3px; left: 0; z-index: 0; border-radius: 9px;
      background: var(--pf-card-bg); box-shadow: 0 1px 2px rgba(15, 23, 42, 0.18);
      transition: transform var(--pf-dur) var(--pf-spring), width var(--pf-dur) var(--pf-spring), opacity var(--pf-dur-fast) ease; }
    .pf-wfe-tab { position: relative; z-index: 1; flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px;
      height: 34px; padding: 0 12px; border: 0; border-radius: 9px; background: transparent; color: var(--text-secondary);
      font: inherit; font-size: 13px; font-weight: 500; white-space: nowrap; cursor: pointer; transition: color var(--pf-dur-fast) ease; }
    .pf-wfe-tab:hover { color: var(--text-primary); }
    .pf-wfe-tab[aria-selected='true'] { color: var(--text-primary); font-weight: 600; }
    .pf-wfe-tab:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 1px; }
    .pf-wfe-tab__n { font-size: 11.5px; color: var(--text-tertiary); }
    .pf-wfe-addstep { flex: none; align-self: center; }
    .pf-wfe-mv { flex: none; }
    @media (prefers-reduced-motion: reduce) { .pf-wfe-tabs__ind, .pf-wfe-tab { transition: none; } }
    @media (max-width: 640px) {
      .pf-wfe-ctx.pf-ctx { flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 0 6px; overflow: visible; }
      .pf-wfe-ctx__name { flex: 1 1 100%; max-width: none; min-width: 0; }
      .pf-wfe-ctx__div { display: none; }
      .pf-wfe-tabs { flex: 1 1 0; }
      .pf-wfe-tab { height: 38px; }
      .pf-wfe-titlein { min-width: 0; width: 100%; }
    }
    .pf-wfe-grid { display: grid; grid-template-columns: 1fr; gap: 16px; }
    @media (min-width: 768px) { .pf-wfe-grid:not(.pf-wfe-grid--nd) { grid-template-columns: 240px minmax(0, 1fr); } }
    .pf-wfe-rail { align-self: start; }
    .pf-wfe-steps, .pf-wfe-fields { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .pf-wfe-steps { padding: 8px; }
    .pf-step-item { cursor: pointer; }
    .pf-wfe-detail { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
    .pf-wfe-card .pf-card__body { overflow: visible; }
    .pf-wfe-cardbody { gap: 14px; padding: 14px 16px 16px; }
    .pf-wfe-grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 16px; }
    .pf-wfe-grid3 { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 12px 20px; align-items: end; }
    .pf-wfe-toggle { min-height: 40px; font-size: 13px; }
    .pf-wfe-rowtext { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .pf-wfe-rowtext .pf-row__meta { flex: none; }
    .pf-wfe-req { color: var(--red-text, #b91c1c); }
    .pf-wfe-h { margin: 0; font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .pf-wfe-hint { margin: 12px 0 0; font-size: 12px; color: var(--text-tertiary); }
    .pf-wfe-mini { height: 32px; min-height: 32px; font-size: 12.5px; }
    .pf-drag-handle { display: inline-flex; color: var(--text-muted); cursor: move; flex: none; }
    .pf-field-item { gap: 8px; }
    .pf-route-row { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 12px; align-items: center; }
    .pf-route-card { display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; border-radius: var(--pf-radius);
      border: 1px solid var(--pf-line); background: var(--pf-card-bg); }
    .pf-route-card__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }

    /* Band: phone = icons; the three utility actions fold behind Save draft/Publish. */
    .pf-wfe-more { display: inline-flex; gap: 8px; }
    .pf-wfe-savestate { margin-right: 2px; }
    .pf-wfe-morewrap { display: none; position: relative; }
    .pf-wfe-menu { position: absolute; right: 0; top: calc(100% + 6px); z-index: 70; min-width: 200px; padding: 6px; gap: 2px; }
    .pf-wfe-menu__item { display: flex; align-items: center; min-height: 44px; padding: 0 12px; border: 0; border-radius: 8px;
      background: transparent; color: var(--text-primary); font: inherit; font-size: 14px; text-align: left; cursor: pointer; }
    .pf-wfe-menu__item:hover { background: var(--pf-chip-bg); }

    /* Undo toast: above the navbar. */
    .pf-undo-toast {
      position: fixed; left: 50%; transform: translateX(-50%); z-index: 50;
      bottom: calc(var(--pf-nav-h, 0px) + 16px);
      padding: 10px 16px; border-radius: 14px; background: rgba(15, 23, 42, 0.95); color: #ffffff; font-size: 13px;
      display: flex; align-items: center; gap: 12px; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.45);
    }
    .pf-undo-btn { padding: 3px 10px; border-radius: 8px; background: rgba(255, 255, 255, 0.15); color: #ffffff;
      font-size: 12px; font-weight: 500; border: none; cursor: pointer; }
    .pf-undo-btn:hover { background: rgba(255, 255, 255, 0.25); }

    /* Overlays: end ABOVE the always-visible navbar. */
    .pf-wfe-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: var(--pf-nav-h, 0px); z-index: 60;
      display: flex; align-items: center; justify-content: center; padding: 16px; }
    .pf-wfe-overlay--side { justify-content: flex-end; padding: 0; }
    .pf-wfe-scrim { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.45); }
    .pf-preview-modal { position: relative; width: 100%; max-width: 56rem; max-height: 100%; }
    .pf-preview-header { position: sticky; top: 0; z-index: 1; }
    .pf-preview-body { padding: 18px 20px; }
    .pf-history-panel { position: relative; height: 100%; width: 100%; max-width: 28rem; border-radius: 0;
      animation: pf-wfe-slide var(--pf-dur) var(--pf-spring) both; }
    .pf-history-footer { flex: none; padding: 12px 16px; border-top: 1px solid var(--pf-line); font-size: 12px; color: var(--text-tertiary); }
    .pf-close-btn { width: 36px; height: 36px; min-height: 36px; margin-left: auto; }
    @keyframes pf-wfe-slide { from { transform: translateX(24px); opacity: 0; } to { transform: none; opacity: 1; } }

    @media (max-width: 1023px) {
      .pf-wfe-grid3 { grid-template-columns: 1fr 1fr; }
      .pf-wfe-grid3 > .pf-field { grid-column: 1 / -1; }
    }
    @media (max-width: 640px) {
      .pf-wfe-savestate__t { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
      /* Phones: Preview / History / Reset fold into the "More" menu so the
         band keeps More · Save draft · Publish as 44px icons. */
      .pf-wfe-more { display: none; }
      .pf-wfe-morewrap { display: inline-flex; }
      .pf-wfe-grid2, .pf-route-row { grid-template-columns: 1fr; }
      .pf-wfe-overlay { padding: 0; align-items: flex-end; }
      .pf-preview-modal { border-radius: 20px 20px 0 0; max-height: 92%; }
      .pf-wf-row { padding: 8px 10px; }
      .pf-wf-icon { display: none; }
    }
    @media (prefers-reduced-motion: reduce) { .pf-history-panel { animation: none; } }
    :host-context(html.cap-native) .pf-history-header { padding-top: calc(12px + env(safe-area-inset-top, 0px)); }
    :host-context(html.cap-native) .pf-preview-header { padding-top: calc(12px + env(safe-area-inset-top, 0px)); }
  `]
})
export class WorkflowBuilderComponent implements OnInit, OnDestroy {
  protected readonly builder = inject(WorkflowBuilderService);
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(DialogService);

  private readonly _screens = signal<WorkflowConfigRecord[]>([]);
  readonly screens = this._screens.asReadonly();
  protected readonly theme = inject(ThemeService);
  /** Row actions: text on web, icons on touch (PF-PATTERN). */
  protected readonly web = webPointerSignal();
  /** Phones: Preview / History / Reset live in a "More" menu in the band. */
  protected readonly moreOpen = signal(false);

  // ── Pill: title ✎ + step tabs with a sliding indicator (PF-PATTERN §14) ──
  protected readonly titleEditing = signal(false);
  private readonly titleIn = viewChild<ElementRef<HTMLInputElement>>('titleIn');
  editTitle(): void {
    this.titleEditing.set(true);
    setTimeout(() => { const el = this.titleIn()?.nativeElement; if (el) { el.focus(); el.select(); } });
  }
  commitTitle(v: string): void {
    if (!this.titleEditing()) return;
    this.titleEditing.set(false);
    const t = (v ?? '').trim();
    if (t && t !== this.builder.workflow()?.title) this.builder.updateWorkflow({ title: t });
  }
  /** "Published v4" / "Draft v3" — the one tiny muted badge on the name. */
  readonly statusBadge = computed(() => {
    const r = this.builder.record();
    const st = (r?.status ?? '').toString();
    return `${st ? st[0].toUpperCase() + st.slice(1) : ''} v${r?.version ?? '—'}`.trim();
  });
  private readonly tabsEl = viewChild<ElementRef<HTMLElement>>('tabsEl');
  readonly tabInd = signal<{ x: number; w: number }>({ x: 0, w: 0 });
  private readonly _tabIndFx = effect(() => {
    this.builder.selectedStepId(); this.builder.workflow(); this.tabsEl();
    if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(() => this.measureTab());
    else this.measureTab();
  });
  @HostListener('window:resize')
  onResizeTabs(): void {
    if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(() => this.measureTab());
  }
  measureTab(): void {
    const box = this.tabsEl()?.nativeElement;
    const on = box?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!box || !on) { this.tabInd.set({ x: 0, w: 0 }); return; }
    this.tabInd.set({ x: on.offsetLeft, w: on.offsetWidth });
    const l = on.offsetLeft, r = l + on.offsetWidth;
    if (l < box.scrollLeft) box.scrollLeft = Math.max(0, l - 8);
    else if (r > box.scrollLeft + box.clientWidth) box.scrollLeft = r - box.clientWidth + 8;
  }
  stepIndex(stepId: string): number {
    return (this.builder.workflow()?.steps ?? []).findIndex(s => s.id === stepId);
  }
  /** Reorder from the Step card (the pill tabs don't drag). */
  moveStep(stepId: string, dir: -1 | 1): void {
    const i = this.stepIndex(stepId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= (this.builder.workflow()?.steps.length ?? 0)) return;
    this.builder.reorderSteps(i, j);
  }
  /** Band pill search over the screen forms (name, status). */
  readonly q = signal('');
  readonly visibleScreens = computed(() =>
    bandFilter(this._screens(), this.q(), r => [r.screenName, this.prettify(r.screenName), r.status]));

  readonly screenName = signal<string | null>(null);

  readonly saving = signal(false);

  // Preview + history state
  protected readonly previewOpen = signal(false);
  protected readonly historyOpen = signal(false);
  protected readonly historyLoading = signal(false);
  private readonly _historyRows = signal<HistoryRow[]>([]);
  readonly historyRows = this._historyRows.asReadonly();

  readonly previewContext = computed<WorkflowContext>(() => ({
    userId: 'preview',
    tenantId: 'preview',
    branchId: 'preview',
    patientAge: 34,
    patientSex: 'Male',
    'user.permissions': ['*']
  }));

  readonly previewResources = {
    testParameters: [],
    dataSources: {
      tests: [],
      patients: [],
      doctors: [],
      available_slots: ['09:00', '09:30', '10:00'].map(s => ({ value: s, label: s }))
    }
  };

  readonly stepTypeSelectOptions: PfSelectOption<string>[] = [
    { value: 'entry', label: 'Entry' },
    { value: 'summary', label: 'Summary' },
    { value: 'payment', label: 'Payment' },
    { value: 'confirmation', label: 'Confirmation' }
  ];

  defaultNextOptions(currentStepId: string): PfSelectOption<string>[] {
    return [
      { value: '', label: '— Finish workflow —' },
      ...this.otherSteps(currentStepId).map(s => ({ value: s.name, label: s.title }))
    ];
  }

  goToStepOptions(currentStepId: string): PfSelectOption<string>[] {
    return this.otherSteps(currentStepId).map(s => ({ value: s.name, label: s.title }));
  }

  private readonly _paramSub = effect(() => {
    // Route-driven load.
    const name = this.screenName();
    if (name && this.builder.record()?.screenName !== name) {
      this.builder.loadWorkflow(name).subscribe({ error: e => this.toasts.error(ApiError.from(e).message) });
    }
  });

  ngOnInit() {
    // Listen to :screen param.
    this.route.paramMap.subscribe(map => {
      const name = map.get('screen');
      this.screenName.set(name);
      if (!name) {
        this.loadScreens();
        this.builder.clear();
      }
    });
  }

  ngOnDestroy() { /* effect cleanup automatic */ }

  private loadScreens() {
    this.api.get<WorkflowConfigRecord[]>('/api/workflows/').subscribe({
      next: l => this._screens.set(l ?? [])
    });
  }

  prettify(name: string): string {
    return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  stepCount(r: WorkflowConfigRecord): number {
    try { return (JSON.parse(r.configJson)?.steps ?? []).length; } catch { return 0; }
  }

  fieldCount(r: WorkflowConfigRecord): number {
    try {
      const steps = JSON.parse(r.configJson)?.steps ?? [];
      return steps.reduce((sum: number, s: { fields?: unknown[] }) => sum + (s.fields?.length ?? 0), 0);
    } catch { return 0; }
  }

  statusTone(status: string): ChipTone {
    return status === 'published' ? 'emerald' : 'amber';
  }

  openBuilder(screen: string) {
    this.router.navigate(['/admin/workflows', screen]);
  }
  closeBuilder() {
    this.router.navigateByUrl('/admin/workflows');
  }

  otherSteps(currentStepId: string): WorkflowStep[] {
    return (this.builder.workflow()?.steps ?? []).filter(s => s.id !== currentStepId);
  }

  // Step ops
  addStep() {
    this.builder.addStep('New step');
  }

  deleteStep(stepId: string) {
    this.builder.deleteStep(stepId);
  }

  onStepDrop(event: CdkDragDrop<unknown>) {
    this.builder.reorderSteps(event.previousIndex, event.currentIndex);
  }

  // Field ops
  openAddField(stepId: string) {
    const screen = this.screenName();
    if (!screen) return;
    this.router.navigate(['/admin/workflows', screen, 'steps', stepId, 'fields', 'new']);
  }

  openEditField(stepId: string, field: WorkflowField) {
    const screen = this.screenName();
    if (!screen) return;
    this.router.navigate(['/admin/workflows', screen, 'steps', stepId, 'fields', field.id, 'edit']);
  }

  deleteField(stepId: string, fieldId: string) {
    this.builder.deleteField(stepId, fieldId);
  }

  onFieldDrop(stepId: string, event: CdkDragDrop<unknown>) {
    this.builder.reorderFields(stepId, event.previousIndex, event.currentIndex);
  }

  // Routing
  setDefaultNext(stepId: string, next: string | null) {
    const step = this.builder.workflow()?.steps.find(s => s.id === stepId);
    if (!step) return;
    this.builder.updateStepTransition(stepId, { ...step.afterStep, defaultNextStep: next });
  }

  addRoute(stepId: string) {
    const step = this.builder.workflow()?.steps.find(s => s.id === stepId);
    if (!step) return;
    const firstOther = this.otherSteps(stepId)[0];
    if (!firstOther) {
      this.toasts.warning('Add another step before adding a conditional route.');
      return;
    }
    const next = [...(step.afterStep.conditionalRoutes ?? []), {
      conditions: [],
      conditionLogic: 'AND' as const,
      goToStep: firstOther.name
    }];
    this.builder.setConditionalRoutes(stepId, next);
  }

  removeRoute(stepId: string, i: number) {
    const step = this.builder.workflow()?.steps.find(s => s.id === stepId);
    if (!step) return;
    const next = (step.afterStep.conditionalRoutes ?? []).filter((_, idx) => idx !== i);
    this.builder.setConditionalRoutes(stepId, next);
  }

  updateRouteConditions(stepId: string, i: number, rules: ConditionRule[]) {
    const step = this.builder.workflow()?.steps.find(s => s.id === stepId);
    if (!step) return;
    const routes: ConditionalRoute[] = (step.afterStep.conditionalRoutes ?? []).map((r, idx) =>
      idx === i ? { ...r, conditions: rules } : r);
    this.builder.setConditionalRoutes(stepId, routes);
  }

  updateRouteTarget(stepId: string, i: number, goToStep: string) {
    const step = this.builder.workflow()?.steps.find(s => s.id === stepId);
    if (!step) return;
    const routes: ConditionalRoute[] = (step.afterStep.conditionalRoutes ?? []).map((r, idx) =>
      idx === i ? { ...r, goToStep } : r);
    this.builder.setConditionalRoutes(stepId, routes);
  }

  // Save / publish
  /** Which of Save draft / Publish is running (its button shows the dots). */
  readonly savingKind = signal<'draft' | 'publish' | null>(null);
  protected readonly NO_CHANGES = NO_CHANGES_TITLE;
  /** Ctrl/Cmd+S = Save draft, only when the workflow changed. */
  private readonly _saveKey = bindSaveShortcut({ canSave: () => this.builder.isDirty() && !this.saving(), save: () => this.saveDraft() });
  saveDraft() {
    this.saving.set(true);
    this.savingKind.set('draft');
    this.builder.saveDraft('Manual edit').subscribe({
      next: () => { this.saving.set(false); this.savingKind.set(null); this.toasts.success('Draft saved'); },
      error: e => { this.saving.set(false); this.savingKind.set(null); this.toasts.error(ApiError.from(e).message); }
    });
  }

  publish() {
    this.saving.set(true);
    this.savingKind.set('publish');
    this.builder.publish('Manual edit').subscribe({
      next: () => { this.saving.set(false); this.savingKind.set(null); this.toasts.success('Published'); },
      error: e => { this.saving.set(false); this.savingKind.set(null); this.toasts.error(ApiError.from(e).message); }
    });
  }

  async resetWorkflow() {
    const name = this.screenName();
    if (!name) return;
    const ok = await this.dialog.confirm({
      title: 'Reload from server?',
      message: 'Unsaved changes will be lost.',
      tone: 'danger',
      confirmLabel: 'Discard & reload'
    });
    if (!ok) return;
    this.builder.resetToDefault().subscribe({
      next: () => this.toasts.info('Reloaded from server'),
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }

  // ── Preview ──────────────────────────────────────────────────
  openPreview() {
    if (!this.builder.workflow()) return;
    this.previewOpen.set(true);
  }
  closePreview() { this.previewOpen.set(false); }

  // ── History ──────────────────────────────────────────────────
  openHistory() {
    const name = this.screenName();
    if (!name) return;
    this.historyOpen.set(true);
    this.historyLoading.set(true);
    this.api.get<HistoryRow[]>(`/api/workflows/${name}/history`).subscribe({
      next: rows => { this._historyRows.set(rows ?? []); this.historyLoading.set(false); },
      error: e => { this._historyRows.set([]); this.historyLoading.set(false); this.toasts.error(ApiError.from(e).message); }
    });
  }
  closeHistory() { this.historyOpen.set(false); }

  async restoreFromHistory(row: HistoryRow) {
    const name = this.screenName();
    if (!name) return;
    const ok = await this.dialog.confirm({
      title: 'Restore this version?',
      message: 'A new history entry will be written. Nothing is lost.',
      confirmLabel: 'Restore version'
    });
    if (!ok) return;
    this.api.post(`/api/workflows/${name}/restore/${row.id}`, {}).subscribe({
      next: () => {
        this.toasts.success('Version restored');
        this.closeHistory();
        this.builder.loadWorkflow(name).subscribe();
      },
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }
}
