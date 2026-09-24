import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
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
import { ChipComponent, ChipTone } from '../../../shared/primitives/chip.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { ToggleComponent } from '../../../shared/primitives/toggle.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { LoadingLogoComponent } from '../../../shared/components/loading-logo/loading-logo.component';
import { ConditionBuilderComponent } from './condition-builder.component';
import { WorkflowBuilderService } from './workflow-builder.service';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ThemeService } from '../../../core/services/theme.service';
import { bandFilter } from '../../../shared/utils/band-search';

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
  imports: [
    FormsModule,
    DragDropModule,
    DatePipe,
    ConditionBuilderComponent,
    WorkflowRendererComponent,
    ChipComponent,
    ScreenHeaderComponent,
    SelectComponent,
    TileComponent,
    ToggleComponent,
    TouchButtonComponent,
    LoadingLogoComponent,
    HeroBandComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!screenName()) {
      <section class="pf-band-page px-4 md:px-8 pt-6 pb-10">
        @if (theme.isNewDesign()) {
          <!-- Band pill (owner): search the screen forms (LIST mode only; the
               one-screen editor below is exempt and keeps its header). -->
          <pf-hero-band [back]="true" placeholder="Search forms — patient register, order create…"
                        [value]="q()" (valueChange)="q.set($event)"></pf-hero-band>
        }
        <pf-screen-header class="pf-classic-only"
          eyebrow="Admin"
          title="Workflow Builder"
          subtitle="Every LMS screen is driven by one of these configs. Edit a workflow to reshape its steps and fields.">
        </pf-screen-header>

        <div class="pf-band-body">
        @if (screens().length === 0) {
          <pf-tile tone="default" padding="xl">
            <div class="text-center py-6">
              <p class="text-[14px]" style="color: var(--text-secondary);">No workflows yet.</p>
            </div>
          </pf-tile>
        } @else if (visibleScreens().length === 0) {
          <p class="pf-band-empty">No forms match "{{ q() }}".</p>
        } @else {
          <div class="space-y-2.5">
            @for (r of visibleScreens(); track r.screenName) {
              <pf-tile [tone]="r.status === 'published' ? 'default' : 'amber'" padding="md">
                <div class="pf-wf-row flex items-center gap-3 flex-wrap md:flex-nowrap" (click)="openBuilder(r.screenName)">
                  <div class="pf-wf-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <rect width="7" height="7" x="3" y="3" rx="1"/>
                      <rect width="7" height="7" x="14" y="3" rx="1"/>
                      <rect width="7" height="7" x="3" y="14" rx="1"/>
                      <rect width="7" height="7" x="14" y="14" rx="1"/>
                    </svg>
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="pf-wf-titlerow flex items-center gap-2 flex-wrap">
                      <p class="pf-wf-name font-semibold text-[15px] min-w-0 truncate" style="color: var(--text-primary);">{{ prettify(r.screenName) }}</p>
                      @if (r.status === 'published') {
                        <pf-chip tone="emerald" size="sm">published</pf-chip>
                      } @else {
                        <pf-chip tone="amber" size="sm">{{ r.status }}</pf-chip>
                      }
                    </div>
                    <p class="text-[12px] mt-0.5 font-mono" style="color: var(--text-tertiary);">
                      v{{ r.version }} · {{ stepCount(r) }} steps · {{ fieldCount(r) }} fields
                    </p>
                  </div>
                  <pf-touch-btn class="pf-wf-edit" size="sm" variant="primary" (pressed)="openBuilder(r.screenName)">Edit</pf-touch-btn>
                </div>
              </pf-tile>
            }
          </div>
        }
        </div>
      </section>
    }

    @if (screenName() && builder.workflow(); as wf) {
      <section class="px-4 md:px-6 pt-6 pb-10">
        <pf-screen-header
          class="pf-builder-hdr"
          [eyebrow]="'Workflow · v' + (builder.record()?.version ?? '—') + ' · ' + (builder.record()?.status ?? '—')"
          [title]="wf.title"
          [subtitle]="builder.isDirty() ? 'Unsaved changes — save draft or publish to commit.' : 'Live configuration.'">
          <pf-touch-btn actions class="pf-tab-back" size="sm" variant="ghost" (pressed)="closeBuilder()">
            <span icon-left aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m15 18-6-6 6-6"/>
              </svg>
            </span>
            <span class="pf-tab-full">All workflows</span>
            <span class="pf-tab-short">Back</span>
          </pf-touch-btn>
          <pf-touch-btn actions size="sm" variant="ghost" (pressed)="openPreview()">
            <span icon-left class="pf-tab-icon" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>
              </svg>
            </span>
            <span class="pf-tab-full">Preview</span>
            <span class="pf-tab-short">Preview</span>
          </pf-touch-btn>
          <pf-touch-btn actions size="sm" variant="ghost" (pressed)="openHistory()">
            <span icon-left class="pf-tab-icon" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>
              </svg>
            </span>
            <span class="pf-tab-full">History</span>
            <span class="pf-tab-short">History</span>
          </pf-touch-btn>
          <pf-touch-btn actions size="sm" variant="ghost" (pressed)="resetWorkflow()">
            <span icon-left class="pf-tab-icon" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>
              </svg>
            </span>
            <span class="pf-tab-full">Reset</span>
            <span class="pf-tab-short">Reset</span>
          </pf-touch-btn>
          <pf-touch-btn actions size="sm" variant="secondary"
                        [disabled]="!builder.isDirty() || saving()"
                        (pressed)="saveDraft()">
            <span icon-left class="pf-tab-icon" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>
              </svg>
            </span>
            <span class="pf-tab-full">Save draft</span>
            <span class="pf-tab-short">Save</span>
          </pf-touch-btn>
          <pf-touch-btn actions size="sm" variant="primary"
                        [disabled]="saving()"
                        (pressed)="publish()">
            <span icon-left class="pf-tab-icon" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>
              </svg>
            </span>
            <span class="pf-tab-full">{{ saving() ? 'Publishing…' : 'Publish' }}</span>
            <span class="pf-tab-short">{{ saving() ? 'Publishing…' : 'Publish' }}</span>
          </pf-touch-btn>
        </pf-screen-header>

        <!-- md (iPad Mini, 768px): introduce a narrower 200px steps rail so
             the field editor on the right has breathing room. lg (1024px+)
             goes back to the full 280px panel. Below md the layout stacks. -->
        <div class="grid grid-cols-1 md:grid-cols-[200px_1fr] lg:grid-cols-[280px_1fr] gap-5">

          <!-- ──────── Steps panel ──────── -->
          <pf-tile tone="default" padding="none" class="block h-fit">
            <div class="pf-panel-header">
              <h3 class="text-[11px] font-mono uppercase tracking-[0.16em]"
                  style="color: var(--text-muted);">Steps</h3>
              <button type="button" class="pf-inline-link" (click)="addStep()">+ Add</button>
            </div>
            <ul cdkDropList (cdkDropListDropped)="onStepDrop($event)" class="p-2 space-y-1.5">
              @for (s of wf.steps; track s.id) {
                <li cdkDrag
                    class="pf-step-item group"
                    [class.pf-step-selected]="builder.selectedStepId() === s.id"
                    (click)="builder.selectStep(s.id)">
                  <span class="pf-drag-handle" cdkDragHandle aria-hidden="true">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/>
                      <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
                      <circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
                    </svg>
                  </span>
                  <div class="flex-1 min-w-0">
                    <p class="text-[13px] font-medium truncate" [attr.title]="s.title" style="color: var(--text-primary);">{{ s.title }}</p>
                    <p class="text-[11px] font-mono" style="color: var(--text-muted);">{{ s.type }} · {{ s.fields.length }} fields</p>
                  </div>
                  <button type="button" class="pf-step-delete opacity-0 group-hover:opacity-100"
                          (click)="$event.stopPropagation(); deleteStep(s.id)" aria-label="Delete step">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M18 6 6 18"/>
                      <path d="m6 6 12 12"/>
                    </svg>
                  </button>
                </li>
              }
            </ul>
          </pf-tile>

          <!-- ──────── Detail panel ──────── -->
          @if (builder.selectedStep(); as step) {
            <pf-tile tone="default" padding="lg" class="block">
              <div class="space-y-5">

                <!-- Step header -->
                <div class="grid grid-cols-2 gap-3 pf-step-titlegrid">
                  <div>
                    <label class="pf-label">Title</label>
                    <input type="text" class="pf-input"
                          [ngModel]="step.title"
                          (ngModelChange)="builder.updateStep(step.id, { title: $event })" />
                  </div>
                  <div>
                    <label class="pf-label">Name</label>
                    <input type="text" class="pf-input font-mono"
                          [ngModel]="step.name"
                          (ngModelChange)="builder.updateStep(step.id, { name: $event })" />
                  </div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label class="pf-label">Type</label>
                    <pf-select
                      [options]="stepTypeSelectOptions"
                      [value]="step.type"
                      (valueChange)="builder.updateStep(step.id, { type: $any($event) })"></pf-select>
                  </div>
                  <div class="pf-toggle-row">
                    <span class="text-[13px]" style="color: var(--text-primary);">Required</span>
                    <pf-toggle size="sm"
                               [checked]="step.isRequired"
                               (checkedChange)="builder.updateStep(step.id, { isRequired: $event })">
                    </pf-toggle>
                  </div>
                  <div class="pf-toggle-row">
                    <span class="text-[13px]" style="color: var(--text-primary);">Can be skipped</span>
                    <pf-toggle size="sm"
                               [checked]="step.canSkip"
                               (checkedChange)="builder.updateStep(step.id, { canSkip: $event })">
                    </pf-toggle>
                  </div>
                </div>

                <!-- Fields panel -->
                <div class="pt-5" style="border-top: 1px solid var(--border-muted);">
                  <div class="flex items-center justify-between mb-3">
                    <h3 class="text-[11px] font-mono uppercase tracking-[0.16em]"
                        style="color: var(--text-muted);">Fields</h3>
                    <button type="button" class="pf-inline-link" (click)="openAddField(step.id)">+ Add field</button>
                  </div>
                  <ul cdkDropList (cdkDropListDropped)="onFieldDrop(step.id, $event)"
                      class="space-y-1.5">
                    @for (f of step.fields; track f.id) {
                      <li cdkDrag
                          class="pf-field-item group">
                        <span class="pf-drag-handle" cdkDragHandle aria-hidden="true">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/>
                            <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
                            <circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
                          </svg>
                        </span>
                        <div class="flex-1 min-w-0">
                          <p class="text-[13px] font-medium truncate" style="color: var(--text-primary);">
                            {{ f.title }}
                            @if (f.isRequired) { <span style="color: var(--red-text);">*</span> }
                            <span class="ml-1 text-[11px] font-mono" style="color: var(--text-muted);">({{ f.type }})</span>
                          </p>
                          <p class="text-[11px] font-mono" style="color: var(--text-tertiary);">
                            {{ f.storageKey }}
                            @if (f.showWhen && f.showWhen.length > 0) {
                              <span class="ml-2" style="color: var(--amber-text);">· conditional</span>
                            }
                          </p>
                        </div>
                        <div class="flex items-center gap-1">
                          <button type="button" class="pf-field-action opacity-0 group-hover:opacity-100"
                                  (click)="openEditField(step.id, f)" aria-label="Edit field">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <path d="M12 20h9"/>
                              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                            </svg>
                          </button>
                          <button type="button" class="pf-field-delete opacity-0 group-hover:opacity-100"
                                  (click)="deleteField(step.id, f.id)" aria-label="Delete field">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <path d="M18 6 6 18"/>
                              <path d="m6 6 12 12"/>
                            </svg>
                          </button>
                        </div>
                      </li>
                    } @empty {
                      <li class="text-[12px] text-center py-4" style="color: var(--text-tertiary);">No fields yet.</li>
                    }
                  </ul>
                </div>

                <!-- Step show-when -->
                <div class="pt-5" style="border-top: 1px solid var(--border-muted);">
                  <h3 class="text-[11px] font-mono uppercase tracking-[0.16em] mb-2"
                      style="color: var(--text-muted);">Show this step when</h3>
                  <pf-condition-builder
                    [rules]="step.showWhen ?? []"
                    [fields]="builder.allFields()"
                    emptyLabel="Always shown."
                    (rulesChange)="builder.setStepShowConditions(step.id, $event.length === 0 ? undefined : $event)">
                  </pf-condition-builder>
                </div>

                <!-- Step skip-when -->
                <div class="pt-5" style="border-top: 1px solid var(--border-muted);">
                  <h3 class="text-[11px] font-mono uppercase tracking-[0.16em] mb-2"
                      style="color: var(--text-muted);">Skip this step when</h3>
                  <pf-condition-builder
                    [rules]="step.skipWhen ?? []"
                    [fields]="builder.allFields()"
                    emptyLabel="Never auto-skipped."
                    (rulesChange)="builder.setStepSkipConditions(step.id, $event.length === 0 ? undefined : $event)">
                  </pf-condition-builder>
                </div>

                <!-- Step routing -->
                <div class="pt-5" style="border-top: 1px solid var(--border-muted);">
                  <h3 class="text-[11px] font-mono uppercase tracking-[0.16em] mb-3"
                      style="color: var(--text-muted);">After this step</h3>

                  <div class="grid grid-cols-[180px_1fr] gap-3 items-center mb-3 pf-route-row">
                    <label class="text-[13px]" style="color: var(--text-secondary);">Default next step</label>
                    <pf-select
                      [options]="defaultNextOptions(step.id)"
                      [value]="step.afterStep.defaultNextStep ?? ''"
                      placeholder="— Finish workflow —"
                      (valueChange)="setDefaultNext(step.id, $any($event) || null)"></pf-select>
                  </div>

                  <div class="space-y-2">
                    @for (route of step.afterStep.conditionalRoutes ?? []; let i = $index; track i) {
                      <div class="pf-route-card">
                        <div class="flex items-center justify-between mb-2">
                          <p class="text-[11px] font-mono uppercase tracking-[0.16em]"
                             style="color: var(--text-muted);">Conditional route {{ i + 1 }}</p>
                          <button type="button" class="pf-field-delete"
                                  (click)="removeRoute(step.id, i)" aria-label="Remove route">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <path d="M18 6 6 18"/>
                              <path d="m6 6 12 12"/>
                            </svg>
                          </button>
                        </div>
                        <pf-condition-builder
                          [rules]="route.conditions"
                          [fields]="builder.allFields()"
                          emptyLabel="Add rules to trigger this route."
                          (rulesChange)="updateRouteConditions(step.id, i, $event)">
                        </pf-condition-builder>
                        <div class="mt-2 grid grid-cols-[100px_1fr] items-center gap-2 pf-goto-row">
                          <span class="text-[12px]" style="color: var(--text-tertiary);">Go to step</span>
                          <pf-select
                            [options]="goToStepOptions(step.id)"
                            [value]="route.goToStep"
                            (valueChange)="updateRouteTarget(step.id, i, $any($event))"></pf-select>
                        </div>
                      </div>
                    }
                    <button type="button" class="pf-inline-link"
                            (click)="addRoute(step.id)">+ Add conditional route</button>
                  </div>
                </div>

              </div>
            </pf-tile>
          } @else {
            <pf-tile tone="default" padding="xl" class="block">
              <div class="text-center py-10">
                <p class="text-[14px]" style="color: var(--text-secondary);">
                  Select a step on the left.
                </p>
              </div>
            </pf-tile>
          }

        </div>
      </section>

      <!-- ──────── Undo toast ──────── -->
      @if (builder.lastDeletedField(); as del) {
        <div class="pf-undo-toast">
          Field <strong>{{ del.field.title }}</strong> deleted
          <button class="pf-undo-btn" (click)="builder.undoDeleteField()">Undo</button>
        </div>
      }
      @if (builder.lastDeletedStep(); as del) {
        <div class="pf-undo-toast">
          Step <strong>{{ del.step.title }}</strong> deleted
          <button class="pf-undo-btn" (click)="builder.undoDeleteStep()">Undo</button>
        </div>
      }

      <!-- ──────── Preview modal ──────── -->
      @if (previewOpen()) {
        <div class="fixed inset-0 z-40 flex items-center justify-center pf-preview-overlay">
          <div class="absolute inset-0" style="background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px);"
               (click)="closePreview()"></div>
          <div class="pf-preview-modal">
            <header class="pf-preview-header">
              <div>
                <p class="text-[11px] font-mono uppercase tracking-[0.16em]"
                   style="color: var(--text-muted);">Preview</p>
                <p class="text-[15px] font-semibold" style="color: var(--text-primary);">{{ builder.workflow()!.title }}</p>
              </div>
              <pf-touch-btn size="sm" variant="ghost" (pressed)="closePreview()">Close</pf-touch-btn>
            </header>
            <div class="p-6">
              <pf-workflow-renderer
                [config]="builder.workflow()!"
                [context]="previewContext()"
                [resources]="previewResources"
                [finishLabel]="'(preview only)'"></pf-workflow-renderer>
              <p class="text-[11px] mt-4" style="color: var(--text-muted);">
                Running against mocked context — age 34 Male, standard permissions. No writes occur.
              </p>
            </div>
          </div>
        </div>
      }

      <!-- ──────── Version history slide-over ──────── -->
      @if (historyOpen()) {
        <div class="fixed inset-0 z-50 flex">
          <div class="absolute inset-0" style="background: rgba(0, 0, 0, 0.5);"
               (click)="closeHistory()"></div>
          <aside class="pf-history-panel">
            <header class="pf-history-header">
              <h2 class="text-[15px] font-semibold" style="color: var(--text-primary);">Version history</h2>
              <button type="button" class="pf-close-btn"
                      (click)="closeHistory()" aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 6 6 18"/>
                  <path d="m6 6 12 12"/>
                </svg>
              </button>
            </header>
            <section class="flex-1 overflow-y-auto px-5 py-3">
              @if (historyLoading()) {
                <div class="flex justify-center py-3">
                  <pf-loading-logo size="sm" color="purple"
                                   [showText]="true" text="Loading…"></pf-loading-logo>
                </div>
              } @else if (historyRows().length === 0) {
                <p class="text-[13px]" style="color: var(--text-tertiary);">No prior versions yet. Save or publish to create one.</p>
              } @else {
                <ul class="space-y-3">
                  @for (h of historyRows(); track h.id) {
                    <li class="pf-history-row">
                      <p class="text-[13px] font-medium" style="color: var(--text-primary);">{{ h.changeSummary ?? '(no summary)' }}</p>
                      <p class="text-[11px] font-mono mt-0.5" style="color: var(--text-muted);">{{ h.changedAt | date:'short' }}</p>
                      <div class="mt-2">
                        <pf-touch-btn size="sm" variant="ghost" (pressed)="restoreFromHistory(h)">Restore this version</pf-touch-btn>
                      </div>
                    </li>
                  }
                </ul>
              }
            </section>
            <footer class="pf-history-footer">
              Restoring writes a new history entry — nothing is lost.
            </footer>
          </aside>
        </div>
      }
    }
  `,
  styles: [`
    .pf-wf-icon {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, rgba(124, 58, 237, 0.22), rgba(236, 72, 153, 0.08));
      border: 1px solid rgba(168, 85, 247, 0.3);
      color: var(--violet-text);
      flex-shrink: 0;
    }
    .pf-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      border-bottom: 1px solid var(--border-muted);
    }
    .pf-inline-link {
      font-size: 12px;
      font-weight: 600;
      color: var(--violet-text);
      background: none;
      border: none;
      cursor: pointer;
      padding: 0;
    }
    .pf-inline-link:hover { text-decoration: underline; }

    /* Header action tabs: by default only the full label shows (desktop is
       byte-identical). The leading icon + short label are surfaced only on
       phone via the <=640 override below. */
    .pf-tab-icon { display: none; }
    .pf-tab-short { display: none; }
    /* The shared header now renders a leading back chevron at every width, so the
       in-page "All workflows" back action is redundant — hide it on all widths. */
    .pf-tab-back { display: none !important; }

    .pf-step-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-radius: 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .pf-step-item:hover { background: var(--bg-hover); }
    .pf-step-selected {
      background: linear-gradient(135deg, rgba(124, 58, 237, 0.22), rgba(236, 72, 153, 0.08)) !important;
      border-color: rgba(168, 85, 247, 0.4) !important;
      box-shadow: 0 4px 14px rgba(124, 58, 237, 0.2);
    }

    .pf-field-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-radius: 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      transition: border-color 0.15s ease;
    }
    .pf-field-item:hover { border-color: var(--card-hover-border); }

    .pf-drag-handle {
      display: inline-flex;
      color: var(--text-muted);
      cursor: move;
    }
    .pf-drag-locked { opacity: 0.3; cursor: not-allowed; }

    .pf-lock, .pf-step-delete, .pf-field-action, .pf-field-delete {
      width: 24px;
      height: 24px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      border: none;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease;
    }
    .pf-step-delete:hover, .pf-field-delete:hover {
      background: rgba(239, 68, 68, 0.15);
      color: var(--red-text);
    }
    .pf-field-action:hover {
      background: rgba(124, 58, 237, 0.15);
      color: var(--violet-text);
    }

    .pf-toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      border-radius: 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
    }

    .pf-route-card {
      padding: 14px;
      border-radius: 14px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
    }

    .pf-undo-toast {
      position: fixed;
      bottom: 100px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 50;
      padding: 10px 16px;
      border-radius: 14px;
      background: rgba(15, 23, 42, 0.95);
      color: #ffffff;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 12px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.45);
      backdrop-filter: blur(12px);
    }
    .pf-undo-btn {
      padding: 3px 10px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.15);
      color: #ffffff;
      font-size: 12px;
      font-weight: 500;
      border: none;
      cursor: pointer;
    }
    .pf-undo-btn:hover { background: rgba(255, 255, 255, 0.25); }

    .pf-preview-modal {
      position: relative;
      width: 100%;
      max-width: 56rem;
      max-height: 85dvh;
      overflow: auto;
      border-radius: 20px;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    }
    .pf-preview-header {
      position: sticky;
      top: 0;
      background: var(--bg-card-solid);
      border-bottom: 1px solid var(--border-muted);
      padding: 12px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      z-index: 10;
    }

    .pf-history-panel {
      position: relative;
      margin-left: auto;
      height: 100%;
      width: 100%;
      max-width: 28rem;
      background: var(--bg-card-solid);
      border-left: 1px solid var(--glass-border);
      box-shadow: -20px 0 60px rgba(0, 0, 0, 0.4);
      display: flex;
      flex-direction: column;
    }
    .pf-history-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 20px;
      border-bottom: 1px solid var(--border-muted);
    }
    .pf-close-btn {
      width: 32px;
      height: 32px;
      border-radius: 9999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      color: var(--text-muted);
      border: none;
      cursor: pointer;
    }
    .pf-close-btn:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
    .pf-history-row {
      padding: 12px 14px;
      border-radius: 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
    }
    .pf-history-footer {
      padding: 12px 20px;
      border-top: 1px solid var(--border-muted);
      font-size: 11px;
      color: var(--text-muted);
    }

    /* ══════════════════════════════════════════════════════════════
       CROSS-PLATFORM OVERRIDES — ADDITIVE ONLY.
       Everything above (desktop-web base, >=1280px) is byte-for-byte
       unchanged. These rules apply ONLY below desktop, on touch, or
       under platform html classes — they cannot reach the wide view.
       ════════════════════════════════════════════════════════════ */

    /* --- Touch: reveal hover-gated row actions (edit / delete on steps
       and fields) which are otherwise stuck at opacity:0 with no hover
       to trigger them. Desktop hover behaviour is untouched. --- */
    @media (hover: none), (pointer: coarse) {
      :host .pf-step-delete,
      :host .pf-field-action,
      :host .pf-field-delete {
        opacity: 1 !important;
      }
    }

    /* --- Touch sizing: grow the small (24px) icon buttons and the drag
       handles to a comfortable target without changing desktop visuals.
       Scoped to this page's own controls only. --- */
    @media (pointer: coarse) {
      :host .pf-step-delete,
      :host .pf-field-action,
      :host .pf-field-delete,
      :host .pf-close-btn {
        min-width: 44px;
        min-height: 44px;
      }
      :host .pf-drag-handle {
        min-width: 44px;
        min-height: 44px;
        align-items: center;
        justify-content: center;
      }
      :host .pf-inline-link {
        min-height: 44px;
        display: inline-flex;
        align-items: center;
      }
    }

    /* --- Phone (<=640): stop iOS auto-zoom on focus by lifting this
       page's inputs to >=16px. Scoped to :host so the shared .pf-input
       primitive is unchanged elsewhere. --- */
    @media (max-width: 640px) {
      :host .pf-input { font-size: 16px; }

      /* ICON-ONLY header actions on phone: hide BOTH labels and show just the
         leading icon. Six text buttons were eating the whole header width and
         squeezing the title down to a 1-char-per-line vertical column — compact
         icons free the width so the title stays horizontal and nothing clips. */
      :host .pf-tab-icon { display: inline-flex; align-items: center; }
      :host .pf-tab-full { display: none; }
      :host .pf-tab-short { display: none; }
      /* Drop the in-page Back action on phone — the shared header's leading
         chevron (added app-wide) already returns to the workflow list. */
      :host .pf-tab-back { display: none; }

      /* Editor header (form flows): the title + the icon actions can't share one
         row on a phone without crushing the title into a vertical sliver. Stack
         them — title (with the leading chevron) on its own line, and BELOW it a
         single segmented action bar (one bordered box, icons split into equal
         divided cells) — the same look as the report-queue download/view/share/
         print bar. Scoped to .pf-builder-hdr via ng-deep so only the form-flow
         editor changes; every other screen is untouched. */
      :host ::ng-deep .pf-builder-hdr header { flex-wrap: wrap; }
      :host ::ng-deep .pf-builder-hdr h1 { font-size: 22px !important; }
      /* The actions cluster becomes the segmented bar. */
      :host ::ng-deep .pf-builder-hdr header > div:last-child {
        width: 100%;
        margin-top: 12px;
        gap: 0 !important;
        align-items: stretch;
        flex-wrap: nowrap;
        border: 1px solid var(--glass-border);
        border-radius: 10px;
        overflow: hidden;
        background: var(--seg-track);
      }
      /* Each action = an equal divided cell. */
      :host ::ng-deep .pf-builder-hdr header > div:last-child pf-touch-btn {
        flex: 1 1 0;
        display: flex;
        border-right: 1px solid var(--glass-border);
      }
      :host ::ng-deep .pf-builder-hdr header > div:last-child pf-touch-btn:last-child {
        border-right: 0;
      }
      /* Keep the in-page Back out of the bar (the shared chevron covers it). */
      :host ::ng-deep .pf-builder-hdr header > div:last-child pf-touch-btn.pf-tab-back {
        display: none !important;
      }
      :host ::ng-deep .pf-builder-hdr header > div:last-child pf-touch-btn button {
        width: 100%;
        min-width: 0;
        height: 44px;
        padding: 0;
        gap: 0;
        border: 0 !important;
        border-radius: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
      }

      /* Workflow list rows: the whole card is tappable to edit on phone, so
         drop the decorative grid icon and the separate Edit button — just the
         name + status remain. Name pinned left, status chip pushed to the right
         edge of the card. */
      :host .pf-wf-icon { display: none; }
      :host .pf-wf-edit { display: none; }
      :host .pf-wf-row { cursor: pointer; }
      :host .pf-wf-titlerow {
        flex-wrap: nowrap;
        justify-content: space-between;
        gap: 10px;
      }
      :host .pf-wf-titlerow pf-chip { flex: 0 0 auto; }

      /* The actions cluster wraps under the title on phone; trim the section's
         top padding so the STEPS panel starts reasonably high (kills the big
         empty gap above the content). */
      :host section { padding-top: 14px; }

      /* Collapse the fixed-width inner grids (step title pair + routing
         rows) to a single column so they don't overflow the narrow
         detail panel. Base grid-cols stay intact above this width. */
      :host .pf-step-titlegrid { grid-template-columns: 1fr; }
      :host .pf-route-row,
      :host .pf-goto-row { grid-template-columns: 1fr; }
      :host .pf-route-row > label { margin-bottom: 2px; }

      /* Keep this page from introducing horizontal overflow on phones. */
      :host section { overflow-x: clip; }
    }

    /* --- Web-below-desktop band (641–1279), two-pane sub-band: between
       768–1023px the steps rail narrows to 200px (md:grid-cols-[200px_1fr]),
       leaving the detail panel only ~440px wide. The detail panel's inner
       fixed-width grids (step title pair, routing label columns) crowd at
       that width, so collapse them to a single column here. The desktop
       lg layout (1024px+ → 280px rail) keeps the multi-column grids, and
       >=1280 stays byte-identical. Additive — base grid-cols are intact. */
    @media (min-width: 768px) and (max-width: 1023px) {
      :host .pf-step-titlegrid { grid-template-columns: 1fr; }
      :host .pf-route-row,
      :host .pf-goto-row { grid-template-columns: 1fr; }
      :host .pf-route-row > label,
      :host .pf-goto-row > span { margin-bottom: 2px; }
    }

    /* --- Web-below-desktop band (641–1279): guard against this page
       introducing horizontal page scroll (no element may push past the
       64px left rail). Desktop >=1280 is unaffected. --- */
    @media (min-width: 641px) and (max-width: 1279px) {
      :host section { overflow-x: clip; }
    }

    /* --- Undo toast sits at a fixed 100px above the bottom; on phones
       that can collide with the bottom-nav pill. Lift it clear using the
       global nav-height token (+ safe area is already inside the token). */
    @media (max-width: 1023px) {
      .pf-undo-toast {
        bottom: calc(var(--tab-nav-total-height, 88px) + 12px);
      }
    }

    /* --- Phone (<=640): the centred preview modal becomes a full-width
       bottom sheet so it doesn't get squeezed; history slide-over already
       spans full width below its 28rem cap. --- */
    @media (max-width: 640px) {
      :host .pf-preview-overlay { align-items: flex-end; }
      .pf-preview-modal {
        max-width: 100%;
        max-height: 90dvh;
        border-bottom-left-radius: 0;
        border-bottom-right-radius: 0;
      }
    }

    /* --- Capacitor native: keep the full-bleed overlays clear of the
       notch / status bar and home indicator. The preview header is
       sticky at the top of its own scroller and the history panel is a
       full-height fixed pane, so both need their own insets here. --- */
    :host-context(html.cap-native) .pf-history-header {
      padding-top: calc(14px + env(safe-area-inset-top, 0px));
    }
    :host-context(html.cap-native) .pf-history-footer {
      padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
    }
    :host-context(html.cap-native) .pf-preview-header {
      padding-top: calc(12px + env(safe-area-inset-top, 0px));
    }
    @media (max-width: 640px) {
      :host-context(html.cap-native) .pf-preview-modal {
        padding-bottom: env(safe-area-inset-bottom, 0px);
      }
    }
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
  saveDraft() {
    this.saving.set(true);
    this.builder.saveDraft('Manual edit').subscribe({
      next: () => { this.saving.set(false); this.toasts.success('Draft saved'); },
      error: e => { this.saving.set(false); this.toasts.error(ApiError.from(e).message); }
    });
  }

  publish() {
    this.saving.set(true);
    this.builder.publish('Manual edit').subscribe({
      next: () => { this.saving.set(false); this.toasts.success('Published'); },
      error: e => { this.saving.set(false); this.toasts.error(ApiError.from(e).message); }
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
