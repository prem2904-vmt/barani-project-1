import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { CultureEntryComponent } from '../culture-entry/culture-entry.component';
import { DelegateModalComponent } from '../my-work/delegate-modal.component';
import { CultureResult } from '../../../shared/models/culture.model';
import { CultureCaseView, CultureStageView } from '../culture-panel/culture-panel.component';
import { OrderTestComment } from '../../../shared/models/comment.model';
import { CommentThreadComponent } from '../../../shared/components/comment-thread/comment-thread.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { DialogService } from '../../../core/services/dialog.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { NavBackService } from '../../../core/services/nav-back.service';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';

/** A per-user reusable findings template (mirrors the backend TemplateDto). */
interface ResultTemplate { id: string; scope: string; name: string; body: string; }

/** One structured field of a culture stage (from /api/microbiology/stage-schema). */
interface StageField { name: string; title: string; type: string; options: string[]; suggest?: string | null; }

/**
 * The CULTURE bench workspace for one case — the staged pipeline
 * (Gram → Growth → Identification → AST) with the per-stage soft lock. Any
 * micro tech can pick an open stage; once picked it's locked to them until they
 * submit, drop, or delegate it, and others can work a different stage in
 * parallel. Every completed stage is stamped who + when.
 *
 * v1 captures each stage's finding as free text (the rich per-stage editors —
 * Gram option groups, the existing culture-entry AST table — layer on later).
 * When the bench is done, "Submit for sign-out" hands the case to a pathologist.
 */
@Component({
  selector: 'pf-culture-workbench',
  standalone: true,
  imports: [FormsModule, CultureEntryComponent, DelegateModalComponent, CommentThreadComponent, SelectComponent, HeroBandComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-cse">
      <!-- Band: identical to every step (back + tenant). The PILL is the
           context bar; the page's actions sit top-right with ONE primary. -->
      <pf-hero-band class="pf-cse-band" [customSearch]="true" [back]="true" [backAction]="backFn">
        <ng-container band-actions>
          @if (view(); as cc) {
            <span class="nd-chip nd-chip--static pf-cse-tech" [title]="techName() || 'Technician'"
                  [attr.aria-label]="'Technician ' + (techName() || '')">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              <span class="pf-cse-tech__name">{{ techName() || 'Technician' }}</span>
            </span>
            <span class="pf-cse-techavatar" role="img" [title]="techName()" [attr.aria-label]="'Technician ' + techName()">{{ techInitials() }}</span>
            @if (cc.caseState === 'awaiting_signout') {
              <span class="nd-chip nd-chip--static pf-cse-await">Awaiting sign-out</span>
            } @else {
              <!-- THE page primary: submit (or validate) the whole case —
                   the existing sign-out actions, enabled once every stage is done. -->
              <button type="button" class="pf-hb-btn pf-hb-btn--primary pf-cse-act pf-cse-signout press"
                      [disabled]="busy() || !allDone()"
                      (click)="canValidate() ? submitAndValidate() : submitForSignout()"
                      aria-label="Submit all results"
                      [title]="allDone() ? (canValidate() ? 'Validate and submit the whole case' : 'Submit the whole case for sign-out') : 'Submit every stage first'">
                <svg class="pf-cse-act__i" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                <span class="pf-cse-act__t">Submit all results</span>
              </button>
            }
          }
        </ng-container>

        <!-- CONTEXT BAR: the case as read-only chips — case ID leads. -->
        <div band-search class="pf-cse-ctx">
          @if (view(); as cc) {
            <span class="nd-chip nd-chip--static pf-cse-chip pf-cse-chip--id" title="Case / sample ID">
              <span class="nd-num">{{ cc.barcode || cc.sampleId || 'Culture case' }}</span>
            </span>
            <span class="nd-chip nd-chip--static pf-cse-chip pf-cse-chip--patient" title="Patient">{{ cc.patientName || 'Patient' }}</span>
            <span class="nd-chip nd-chip--static pf-cse-chip pf-cse-chip--test" title="Test">{{ cc.testName || 'Culture' }}</span>
            <span class="nd-chip nd-chip--static pf-cse-chip pf-cse-chip--day"><span class="nd-num">Day {{ dayNo() }}</span></span>
            <span class="pf-cse-ctx__grow"></span>
            <span class="nd-chip nd-chip--static pf-cse-chip pf-cse-chip--progress" aria-live="polite">
              <span class="nd-num">{{ doneCount() }}/{{ cc.stages.length }}</span> stages
            </span>
          } @else {
            <span class="pf-cse-skel" aria-hidden="true"></span>
          }
        </div>
      </pf-hero-band>

      @if (loading()) {
        <div class="pf-cse__note">Loading…</div>
      } @else if (!c()) {
        <div class="pf-cse__note">Case not found.</div>
      } @else if (view(); as cc) {
        <div class="pf-cse__scroll">
          <!-- ONE navigation row: specimen · branch · stage tabs. -->
          <div class="pf-cse-nav">
            <label class="pf-cse-spec">
              <span class="pf-cse-spec__lbl">Specimen</span>
              <pf-select class="pf-cse__specsel" size="sm" [searchable]="true"
                         [options]="specimenOpts()" [value]="c()?.specimen ?? ''"
                         placeholder="Choose…" (valueChange)="setSpecimen($event)"></pf-select>
            </label>
            <span class="nd-seg pf-cse-branches" role="group" aria-label="Culture branch">
              <button type="button" class="nd-seg__item pf-cse-branch" [attr.aria-pressed]="!selCaseId()" (click)="selectCase(null)">Primary</button>
              @for (b of branches(); track b.id) {
                <button type="button" class="nd-seg__item pf-cse-branch" [attr.aria-pressed]="selCaseId() === b.id" (click)="selectCase(b.id!)">{{ b.label || 'Subculture' }}</button>
              }
            </span>
            <button type="button" class="nd-btn nd-btn--tertiary pf-cse-navbtn press" [disabled]="busy()" (click)="newSubculture()">+ Subculture</button>
            @if (selCaseId()) {
              <button type="button" class="nd-btn nd-btn--tertiary pf-cse-navbtn pf-cse-navbtn--muted press" [disabled]="busy()"
                      (click)="deleteBranch()" title="Delete this subculture">Delete branch</button>
            }
            <!-- Incubation lives in the nav row (the band holds the page
                 primary): status chip · Inoculate / + Hours (secondary). -->
            <span class="pf-cse-incubgrp">
              @if (cc.incubateUntil) {
                <span class="nd-chip nd-chip--static pf-cse-incub" [class.pf-cse-incub--done]="incubDone()" aria-live="polite">
                  @if (incubDone()) {
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                  } @else {
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
                  }
                  <span class="nd-num">{{ incubDone() ? 'Incubation complete' : ('Ready in ' + incubReadyIn()) }}</span>
                </span>
              }
              <span class="pf-cse__incubwrap">
                <button type="button" class="nd-btn nd-btn--secondary pf-cse-incubbtn press"
                        [disabled]="busy()" (click)="incubOpen.set(!incubOpen())"
                        [attr.aria-label]="cc.incubateUntil ? 'Add incubation hours' : 'Inoculate and incubate'"
                        [title]="cc.incubateUntil ? 'Add hours to the incubation timer' : 'Start the incubation reference timer'">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M9 2h6"/></svg>
                  <span>{{ cc.incubateUntil ? '+ Hours' : 'Inoculate & incubate' }}</span>
                </button>
                @if (incubOpen()) {
                  <div class="pf-cse__incubpop" role="dialog" aria-label="Incubation">
                    <p class="pf-cse__incublbl">{{ cc.incubateUntil && !incubDone() ? 'Extend incubation by' : 'Incubate for' }}</p>
                    <div class="pf-cse__incubchips">
                      @for (h of incubPresets; track h) {
                        <button type="button" class="nd-chip pf-cse__incubchip press" (click)="applyIncubation(h)"><span class="nd-num">+{{ h }}h</span></button>
                      }
                    </div>
                    <div class="pf-cse__incubcustom">
                      <input type="number" class="pf-cse__incubinp" min="1" max="336" placeholder="Hours" aria-label="Custom hours"
                             [ngModel]="incubCustom()" (ngModelChange)="incubCustom.set($event)"
                             (keydown.enter)="incubCustom() && applyIncubation(incubCustom()!)" />
                      <button type="button" class="nd-btn nd-btn--secondary pf-cse__incubgo press" [disabled]="!incubCustom()"
                              (click)="applyIncubation(incubCustom()!)">Set</button>
                    </div>
                    @if (cc.incubateUntil) {
                      <button type="button" class="nd-btn nd-btn--tertiary pf-cse__incubstop press" [disabled]="busy()"
                              (click)="stopIncubation()">Stop incubation</button>
                    }
                  </div>
                }
              </span>
            </span>
          </div>

          @for (s of cc.stages; track s.key) {
            <section class="nd-card pf-stg"
                     [class.pf-stg--done]="s.state === 'done'"
                     [class.pf-stg--locked]="lockedByOther(s)"
                     [class.pf-stg--mine]="isMine(s)"
                     [attr.aria-label]="s.label">
              <header class="nd-card__head pf-stg__hdr">
                <span class="nd-card__icon" aria-hidden="true">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><circle cx="10" cy="10" r="1.6"/><circle cx="14.6" cy="13.2" r="1.1"/></svg>
                </span>
                <h3 class="nd-card__label pf-stg__name">{{ s.label }}</h3>
                @if (s.state === 'done') {
                  <span class="pf-stg__state pf-stg__state--done">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                    Done{{ s.doneByName ? ' · ' + s.doneByName : '' }}
                  </span>
                } @else if (isMine(s)) {
                  <span class="pf-stg__state"><span class="pf-cse-dot" aria-hidden="true"></span>You{{ elapsed(s) ? ' · ' + elapsed(s) : '' }}</span>
                } @else if (lockedByOther(s)) {
                  <span class="pf-stg__state">{{ s.holderName || 'In progress' }}{{ elapsed(s) ? ' · ' + elapsed(s) : '' }}</span>
                }
                <span class="nd-card__spacer"></span>
                <span class="pf-stg__acts">
                  <button type="button" class="pf-cse-note press" [class.pf-cse-note--has]="commentsFor(sk(s.key)).length > 0"
                          (click)="toggleNote(sk(s.key))" [attr.aria-expanded]="noteOpen(sk(s.key))"
                          [attr.aria-label]="'Note on ' + s.label" [title]="'Note on ' + s.label">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                  </button>
                  @if (isMine(s) && s.state !== 'done') {
                    <button type="button" class="nd-btn nd-btn--tertiary pf-stg__btn press" [disabled]="busy()" (click)="drop(s)">Drop</button>
                    <button type="button" class="nd-btn nd-btn--tertiary pf-stg__btn press" [disabled]="busy()" (click)="startDelegate(s)">Delegate</button>
                    <button type="button" class="nd-btn nd-btn--secondary pf-stg__btn pf-stg__submit press" [disabled]="busy()" (click)="submit(s)"
                            [attr.aria-label]="'Submit ' + s.label">Submit</button>
                  }
                  @if (s.state === 'done' && cc.caseState === 'active') {
                    <!-- Submitted ≠ sealed: editable until the case leaves for sign-out. -->
                    <button type="button" class="nd-btn nd-btn--secondary pf-stg__btn press" [disabled]="busy()" (click)="reopen(s)">Edit</button>
                  }
                </span>
              </header>

              <div class="nd-card__body pf-stg__body">
                @if (noteOpen(sk(s.key)) || commentsFor(sk(s.key)).length > 0) {
                  <div class="pf-stg__thread">
                    <pf-comment-thread [comments]="commentsFor(sk(s.key))" currentRole="tech" [autoCompose]="true"
                                       [composeLabel]="'Add note on ' + s.label"
                                       (add)="addComment(sk(s.key), $event.body, $event.type)"
                                       (reply)="replyComment(sk(s.key), $event.parentId, $event.body)"></pf-comment-thread>
                  </div>
                }

                @if (s.state === 'done') {
                  <p class="pf-stg__summary">{{ readable(s.valuesJson || '') || 'Completed' }}</p>
                } @else if (lockedByOther(s)) {
                  <p class="pf-stg__lockmsg">{{ s.holderName || 'Another tech' }} is working this stage.</p>
                } @else {
                  @if (s.key === 'ast') {
                    <button type="button" class="nd-btn pf-cse__astbtn press" [class.nd-btn--tertiary]="astOpen()" [class.nd-btn--secondary]="!astOpen()" (click)="ensurePicked(s); astOpen.set(!astOpen())"
                            [attr.aria-expanded]="astOpen()">
                      {{ astOpen() ? 'Hide organism / sensitivity' : (astSummary() || 'Enter organism + sensitivity') }}
                    </button>
                    @if (astOpen()) {
                      <div class="pf-cse__astwrap">
                        <pf-culture-entry [value]="astValue()" [organismNames]="organismNames()"
                                          [seedOrganisms]="identifiedOrganisms()" [embedded]="true" [orderTestId]="id"
                                          [reportHidden]="reportHidden()"
                                          (reportHiddenChange)="setReportHidden($event)"
                                          (valueChange)="astValue.set($event)"></pf-culture-entry>
                      </div>
                    }
                  } @else if (schemaFor(s.key)) {
                    <!-- One ROW per component: [report tick] name · compact
                         options (sized to content) · quiet note pencil. -->
                    <div class="pf-cse-rows">
                      @for (g of fieldGroups(s.key); track g.id) {
                        @for (f of g.fields; track f.name) {
                          <div class="pf-cse-row" [class.pf-cse-row--wide]="!f.options.length">
                            <span class="pf-cse-row__name">
                              @if (rhEnabled()) {
                                <input type="checkbox" class="pf-rh" [checked]="rhShown(s.key, f.name)"
                                       (change)="rhToggle(s.key, f.name)"
                                       [attr.aria-label]="'Print ' + f.title + ' on the report'"
                                       title="Print on the report (unticked = hidden on the PDF only)" />
                              }
                              <span class="pf-cse-row__title">{{ f.title }}</span>
                            </span>
                            <span class="pf-cse-row__ctl">
                              @if (g.kind === 'matrix' || f.options.length) {
                                @let opts = f.options.length ? f.options : g.options;
                                <span class="nd-seg pf-cse-opts pf-cse-opts--fill" role="radiogroup" [attr.aria-label]="f.title"
                                      [class.pf-cse-opts--many]="opts.length > 4" [style.--n]="opts.length">
                                  @for (o of opts; track o) {
                                    <button type="button" class="nd-seg__item pf-cse-opt press" role="radio"
                                            [attr.aria-checked]="fieldValue(s.key, f.name) === o"
                                            (click)="ensurePicked(s); toggleField(s.key, f.name, o)">{{ o }}</button>
                                  }
                                </span>
                              } @else if (f.suggest === 'organisms') {
                                <!-- Multi-organism: OUR dropdown (never a native datalist). -->
                                <pf-select class="pf-cse-orgs" size="sm"
                                           [options]="organismOptions()" [multiple]="true" [searchable]="true"
                                           [values]="orgList(s.key, f.name)"
                                           placeholder="Select organisms…"
                                           (valuesChange)="ensurePicked(s); setOrgs(s.key, f.name, $event)"></pf-select>
                              } @else if (f.type === 'textarea') {
                                <textarea class="pf-cse-field pf-cse-field--ta" rows="2" [ngModel]="fieldValue(s.key, f.name)"
                                          [attr.aria-label]="f.title"
                                          (focus)="ensurePicked(s)"
                                          (ngModelChange)="setField(s.key, f.name, $event)" placeholder="Optional"></textarea>
                              } @else {
                                <input type="text" class="pf-cse-field" [ngModel]="fieldValue(s.key, f.name)"
                                       [attr.aria-label]="f.title"
                                       (focus)="ensurePicked(s)"
                                       (ngModelChange)="setField(s.key, f.name, $event)" placeholder="Optional" />
                              }
                            </span>
                            <button type="button" class="pf-cse-note press" [class.pf-cse-note--has]="commentsFor(paramKey(s.key, f.name)).length > 0"
                                    (click)="toggleNote(paramKey(s.key, f.name))" [attr.aria-expanded]="noteOpen(paramKey(s.key, f.name))"
                                    [attr.aria-label]="'Note on ' + f.title" [title]="'Note on ' + f.title">
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                            </button>
                          </div>
                          @if (noteOpen(paramKey(s.key, f.name)) || commentsFor(paramKey(s.key, f.name)).length > 0) {
                            <div class="pf-stg__thread pf-stg__thread--field">
                              <pf-comment-thread [comments]="commentsFor(paramKey(s.key, f.name))" currentRole="tech" [autoCompose]="true"
                                                 [composeLabel]="'Add note on ' + f.title"
                                                 (add)="addComment(paramKey(s.key, f.name), $event.body, $event.type)"
                                                 (reply)="replyComment(paramKey(s.key, f.name), $event.parentId, $event.body)"></pf-comment-thread>
                            </div>
                          }
                        }
                      }
                    </div>
                  } @else {
                    <div class="pf-cse__tpl">
                      <span class="pf-cse__tpl-lbl">Templates</span>
                      @for (t of templatesFor(s.key); track t.id) {
                        <span class="nd-chip pf-cse__tplchip">
                          <button type="button" class="pf-cse__tplname" [title]="t.body" (click)="applyTemplate(s.key, t)">{{ t.name }}</button>
                          <button type="button" class="pf-cse__tplx" (click)="deleteTemplate(t, $event)" [attr.aria-label]="'Delete template ' + t.name">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                          </button>
                        </span>
                      }
                      <button type="button" class="nd-btn nd-btn--tertiary pf-cse__tplsave" [disabled]="!(drafts()[s.key] || '').trim()"
                              (click)="saveTemplate(s.key)">+ Save as template</button>
                    </div>
                    <textarea class="pf-cse-field pf-cse-field--ta pf-cse-field--findings" rows="3" [ngModel]="drafts()[s.key] || ''"
                              aria-label="Findings"
                              (focus)="ensurePicked(s)"
                              (ngModelChange)="onDraft(s.key, $event)" placeholder="Enter findings, or load a template"></textarea>
                  }
                }
              </div>
            </section>
          }
        </div>
      }
    </section>

    @if (delegating(); as ds) {
      <pf-delegate-modal [testName]="ds.label" (chose)="doDelegate(ds, $event)" (cancelled)="delegating.set(null)"></pf-delegate-modal>
    }
  `,
  styles: [`
    /* Culture case on the nd pattern (docs/ND-PATTERN.md § Culture case):
       band + context bar, one nav row (specimen · branch · stage tabs), the
       selected stage as an nd-card with calm rows. Palette: violet + neutrals;
       one font (Noto Sans, tabular numbers). */
    :host { display: block; height: 100%; min-height: 0; }
    .pf-cse { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden;
      padding: 0 20px; --pf-hb-bleed: 20px; }
    .pf-cse__note { padding: 48px; text-align: center; font-size: 13px; color: var(--text-tertiary); }
    .pf-cse__scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 4px 0 24px;
      display: flex; flex-direction: column; gap: 14px; }

    /* ── Context bar ── */
    .pf-cse-ctx { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
    .pf-cse-ctx__grow { flex: 1 1 auto; }
    .pf-cse-chip { height: 32px; font-size: 13px; white-space: normal; }
    .pf-cse-chip--id { font-size: 15px; font-weight: 600; color: var(--text-primary); background: var(--nd-card-bg); }
    .pf-cse-chip--patient { font-weight: 500; color: var(--text-primary); }
    .pf-cse-chip--progress { color: var(--text-secondary); gap: 4px; }
    .pf-cse-chip--progress .nd-num { font-weight: 600; color: var(--text-primary); }
    .pf-cse-skel { display: inline-block; width: 240px; height: 14px; border-radius: 6px; background: var(--nd-chip-bg); }

    /* ── Band actions ── */
    .pf-cse-tech { height: 34px; gap: 6px; font-size: 13px; color: var(--text-secondary); }
    .pf-cse-tech svg { color: var(--text-tertiary); }
    .pf-cse-tech__name { font-weight: 500; color: var(--text-primary); }
    .pf-cse-techavatar { display: none; align-items: center; justify-content: center; flex: none;
      width: 36px; height: 36px; border-radius: 999px; background: var(--nd-chip-bg);
      color: var(--text-secondary); font-size: 12px; font-weight: 600; }
    .pf-cse-incub { height: 34px; gap: 6px; font-size: 13px; color: var(--text-secondary); }
    .pf-cse-incub svg { color: var(--text-tertiary); }
    .pf-cse-incub--done svg { color: var(--color-violet-600, #7c3aed); }
    .pf-cse-await { height: 34px; font-size: 13px; }
    .pf-cse-act { position: relative; justify-content: center; }
    .pf-cse-act__i { display: none; flex: none; }
    .pf-cse__incubwrap { position: relative; display: inline-flex; }
    .pf-cse__incubpop { position: absolute; top: calc(100% + 6px); right: 0; z-index: 50; min-width: 240px;
      padding: 12px; border-radius: var(--nd-radius, 12px); background: var(--nd-card-bg);
      border: 1px solid var(--nd-line); box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
      display: flex; flex-direction: column; gap: 10px; }
    .pf-cse__incublbl { margin: 0; font-size: 12px; color: var(--text-tertiary); }
    .pf-cse__incubchips { display: flex; flex-wrap: wrap; gap: 6px; }
    .pf-cse__incubcustom { display: flex; gap: 6px; }
    .pf-cse__incubinp { flex: 1; min-width: 0; height: 40px; padding: 0 10px; border-radius: var(--nd-radius-sm, 10px);
      font: inherit; font-size: 14px; font-variant-numeric: tabular-nums; color: var(--text-primary);
      background: var(--nd-card-bg); border: 1px solid var(--nd-line); outline: none;
      -moz-appearance: textfield; appearance: textfield; }
    .pf-cse__incubinp::-webkit-inner-spin-button, .pf-cse__incubinp::-webkit-outer-spin-button { display: none; }
    .pf-cse__incubinp:focus, .pf-cse-field:focus {
      border-color: var(--color-violet-600, #7c3aed);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary, #7c3aed) 14%, transparent); }
    .pf-cse__incubgo { height: 40px; min-height: 40px; }
    .pf-cse__incubstop { align-self: flex-start; color: var(--text-secondary); height: 32px; min-height: 32px; }

    /* ── Nav row: specimen · branch · stage tabs (one row) ── */
    .pf-cse-nav { display: flex; align-items: center; gap: 10px 12px; flex-wrap: wrap; }
    .pf-cse-spec { display: inline-flex; align-items: center; gap: 8px; }
    .pf-cse-spec__lbl { font-size: 13px; color: var(--text-tertiary); }
    .pf-cse__specsel { width: 200px; }
    .pf-cse-branches { flex: none; }
    .pf-cse-branch { height: 32px; font-size: 13px; white-space: nowrap; }
    .pf-cse-navbtn { height: 32px; min-height: 32px; font-size: 13px; }
    .pf-cse-navbtn--muted { color: var(--text-secondary); }

    /* ── Stage card ── */
    .pf-stg { flex: none; }
    .pf-stg__hdr { flex-wrap: wrap; }
    .pf-stg__name { margin: 0; }
    .pf-stg__state { display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px; border-radius: var(--nd-radius-chip, 8px);
      background: var(--nd-chip-bg); color: var(--text-secondary); font-size: 12px; font-weight: 500; white-space: nowrap; }
    .pf-stg__state--done svg { color: var(--color-violet-600, #7c3aed); }
    .pf-stg__acts { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .pf-stg__btn { height: 32px; min-height: 32px; font-size: 13px; }
    .pf-stg--locked { opacity: .7; }
    .pf-stg__body { overflow: visible; padding: 6px 14px 14px; gap: 0; }
    .pf-stg__summary { margin: 8px 0 0; font-size: 14px; color: var(--text-secondary); line-height: 1.5; }
    .pf-stg__lockmsg { margin: 8px 0 0; font-size: 13px; color: var(--text-tertiary); }
    .pf-stg__thread { margin: 8px 0; }
    .pf-stg__thread--field { margin: 0 0 8px; padding-left: 26px; }

    /* Quiet neutral icon button — the note pencil (one tap opens a focused
       inline note). */
    /* Incubation group (nav row, right). */
    .pf-cse-incubgrp { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .pf-cse-incubbtn { height: 36px; min-height: 36px; font-size: 13px; }
    .pf-cse-dot { width: 7px; height: 7px; border-radius: 999px; background: var(--color-violet-500, #8b5cf6); flex: none; }
    .pf-cse-note { display: inline-flex; align-items: center; justify-content: center; flex: none;
      width: 32px; height: 32px; border-radius: var(--nd-radius-sm, 10px); cursor: pointer;
      color: var(--text-tertiary); background: transparent; border: 1px solid var(--nd-line); }
    .pf-cse-note:hover { color: var(--text-primary); border-color: var(--nd-sel-border); }
    .pf-cse-note--has { color: var(--violet-text, #6d28d9); border-color: color-mix(in srgb, var(--color-primary, #7c3aed) 40%, transparent); }

    /* ── Rows: [tick] name · compact options · pencil ── */
    .pf-cse-rows { display: flex; flex-direction: column; }
    .pf-cse-row { display: grid; grid-template-columns: minmax(180px, 260px) minmax(0, 1fr) auto;
      align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--nd-line); }
    .pf-cse-rows > .pf-cse-row:last-of-type { border-bottom: 0; }
    .pf-cse-row__name { display: inline-flex; align-items: center; gap: 10px; min-width: 0; }
    .pf-cse-row__title { font-size: 14px; font-weight: 500; color: var(--text-primary); line-height: 1.35; }
    .pf-cse-row__ctl { min-width: 0; display: flex; align-items: center; }
    /* Options: a COMPACT segmented control sized to its content — never
       stretched across the row. Many options wrap inside the cell. */
    /* Options FILL the control column: equal-width segments, one row up to
       4 options; more wrap into balanced rows (auto-fit, ≥110px). */
    .pf-cse-opts.pf-cse-opts--fill { display: grid; width: 100%; box-sizing: border-box;
      grid-template-columns: repeat(var(--n, 4), minmax(0, 1fr)); }
    .pf-cse-opts.pf-cse-opts--many { grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); }
    .pf-cse-opt { height: 38px; font-size: 13px; min-width: 0; padding: 0 8px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pf-cse-orgs { width: 100%; }
    /* Kit fields: a comfortable width (~60%), not the whole row. */
    .pf-cse-field { width: 100%; min-width: 0; min-height: 40px; padding: 8px 12px; box-sizing: border-box;
      border-radius: var(--nd-radius-sm, 10px); border: 1px solid var(--nd-line); background: var(--nd-card-bg);
      font: inherit; font-size: 14px; color: var(--text-primary); outline: none; }
    .pf-cse-field::placeholder { color: var(--text-muted); }
    .pf-cse-field--ta { resize: vertical; line-height: 1.45; }
    .pf-cse-field--findings { width: 100%; margin-top: 8px; }

    /* Report tick: kit checkbox (drawn, not the native look). */
    .pf-rh { appearance: none; -webkit-appearance: none; flex: none; margin: 0; cursor: pointer;
      width: 16px; height: 16px; border-radius: 5px; border: 1.5px solid var(--nd-sel-border); background: var(--nd-card-bg);
      display: inline-grid; place-content: center; }
    .pf-rh::after { content: ''; width: 9px; height: 5px; margin-top: -2px; border: 2px solid #fff; border-top: 0; border-right: 0;
      transform: rotate(-45deg) scale(0); transition: transform var(--nd-dur-fast, 200ms) ease; }
    .pf-rh:checked { background: var(--color-violet-600, #7c3aed); border-color: transparent; }
    .pf-rh:checked::after { transform: rotate(-45deg) scale(1); }
    .pf-rh:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }

    /* Templates (free-text stages). */
    .pf-cse__tpl { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .pf-cse__tpl-lbl { font-size: 12px; color: var(--text-tertiary); margin-right: 2px; }
    .pf-cse__tplchip { gap: 2px; padding: 0 4px 0 10px; }
    .pf-cse__tplname { border: 0; background: none; padding: 0; font: inherit; color: var(--text-primary); cursor: pointer; }
    .pf-cse__tplx { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px;
      border: 0; border-radius: 6px; background: none; color: var(--text-tertiary); cursor: pointer; }
    .pf-cse__tplx:hover { color: var(--text-primary); background: var(--nd-chip-bg); }
    .pf-cse__tplsave { height: 30px; min-height: 30px; font-size: 13px; }
    .pf-cse__astbtn { margin-top: 8px; align-self: flex-start; height: 40px; }
    .pf-cse__astwrap { margin-top: 14px; }

    /* ── Touch ── */
    @media (pointer: coarse) {
      .pf-cse-note { width: 44px; height: 44px; }
      .pf-cse-opt, .pf-cse-branch { height: 44px; }
      .pf-cse-incubbtn { height: 44px; min-height: 44px; }
      .pf-stg__btn, .pf-cse-navbtn { height: 44px; min-height: 44px; }
    }

    /* ── Phones: rows stack; tabs scroll; actions become 44px icons ── */
    @media (max-width: 640px) {
      .pf-cse { padding: 0 12px; --pf-hb-bleed: 12px; }
      .pf-cse-chip--test, .pf-cse-ctx__grow { display: none; }
      .pf-cse-tech { display: none; }
      .pf-cse-techavatar { display: inline-flex; }
      .pf-cse-band .pf-cse-act { width: 44px; min-width: 44px; height: 44px; padding: 0; gap: 0; border-radius: 12px; }
      .pf-cse-band .pf-cse-act__i { display: block; }
      .pf-cse-band .pf-cse-act__t { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
      .pf-cse-nav { flex-wrap: wrap; }
      .pf-cse-spec { width: 100%; }
      .pf-cse__specsel { flex: 1; width: auto; min-width: 0; }
      .pf-cse-incubgrp { width: 100%; margin-left: 0; }
      .pf-cse-incubgrp .pf-cse__incubwrap { flex: 1 1 auto; }
      .pf-cse-incubbtn { width: 100%; }
      .pf-cse__incubpop { left: 0; right: auto; }
      .pf-cse-opts.pf-cse-opts--many { grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); }
      .pf-cse-row { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'name note' 'ctl ctl'; gap: 8px; }
      .pf-cse-row__name { grid-area: name; }
      .pf-cse-row__ctl { grid-area: ctl; }
      .pf-cse-note { grid-area: note; }
      .pf-cse-field { width: 100%; min-width: 0; min-height: 44px; }
      .pf-cse-field--ta { min-height: 88px; }
      .pf-stg__thread--field { padding-left: 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      .pf-rh::after { transition: none !important; }
    }
  `],
})
export class CultureWorkbenchComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly navBack = inject(NavBackService);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);

  /** The case TREE (root + subCultures) — every response carries it. */
  readonly c = signal<CultureCaseView | null>(null);
  /** The selected branch (null = the primary). */
  readonly selCaseId = signal<string | null>(null);
  /** The case being WORKED — root or the selected subculture. */
  readonly view = computed<CultureCaseView | null>(() => {
    const t = this.c();
    if (!t) return null;
    const id = this.selCaseId();
    if (!id) return t;
    return (t.subCultures ?? []).find(s => s.id === id)
      ?? t;                                     // branch deleted elsewhere → primary
  });
  readonly branches = computed<CultureCaseView[]>(() => this.c()?.subCultures ?? []);
  /** caseId query for stage ops on a branch. */
  private q(): string { const id = this.selCaseId(); return id ? `?caseId=${id}` : ''; }
  /** Comment keys are branch-scoped so notes never bleed across branches. */
  sk(stageKey: string): string {
    const id = this.selCaseId();
    return id ? `${stageKey}#${id.slice(0, 8)}` : stageKey;
  }
  readonly loading = signal(true);
  readonly busy = signal(false);
  /** Per-stage draft notes (autosaved to localStorage), keyed by stage key. */
  readonly drafts = signal<Record<string, string>>({});
  /** The AST stage's structured result (organisms + S/I/R). */
  readonly astValue = signal<CultureResult>({});
  /** Whether the AST organism/sensitivity editor is expanded. */
  readonly astOpen = signal(false);
  /** Master-driven organism names for the AST editor's picker. */
  readonly organismNames = signal<string[]>([]);

  // ── Multi-organism identification → AST seeding ────────────────────────
  /** The selection: the comma-joined field value split back into names. */
  orgList(stageKey: string, field: string): string[] {
    return (this.fieldValue(stageKey, field) ?? '').split(',').map(s => s.trim()).filter(Boolean);
  }
  setOrgs(stageKey: string, field: string, names: string[]) {
    this.setField(stageKey, field, names.join(', '));
  }
  /** Organism master as dropdown options — plus any already-picked name the
   *  master no longer carries, so its chip stays visible and removable. */
  readonly organismOptions = computed<PfSelectOption<string>[]>(() => {
    const master = this.organismNames();
    const sel = (this.fieldValues()['identification']?.['organism'] ?? '')
      .split(',').map(s => s.trim()).filter(Boolean);
    const extra = sel.filter(n => !master.some(m => m.toLowerCase() === n.toLowerCase()));
    return [...extra, ...master].map(n => ({ value: n, label: n }));
  });
  /**
   * Every organism named in the Organism-identification stage — the live chip
   * draft while the stage is being worked, else the submitted stage values.
   * Feeds the AST editor's seedOrganisms input, which appends a sensitivity
   * panel per organism (merge-only), so the two stages can never disagree.
   */
  readonly identifiedOrganisms = computed<string[]>(() => {
    const draft = (this.fieldValues()['identification']?.['organism'] ?? '')
      .split(',').map(s => s.trim()).filter(Boolean);
    if (draft.length) return draft;
    const st = this.view()?.stages?.find(s => s.key === 'identification');
    if (st?.valuesJson) {
      try {
        const o = JSON.parse(st.valuesJson) as { fields?: { name?: string; value?: string }[] };
        const f = o.fields?.find(x => x.name === 'organism');
        if (f?.value) return String(f.value).split(',').map(s => s.trim()).filter(Boolean);
      } catch { /* unreadable stage payload → no seeds */ }
    }
    return [];
  });
  /** Ticks every 30s so per-stage "held" timers update live. */
  private readonly now = signal(Date.now());
  private timer?: ReturnType<typeof setInterval>;

  protected id = '';

  /** The stage the tech came in to work (from ?stage=…) — the entry focuses on
   *  just this one, styled like the standard result-entry. Null = full case. */
  readonly focusStage = signal<string | null>(null);

  readonly subtitle = computed(() => {
    const c = this.view();
    if (!c) return '';
    return [c.patientName, c.testName, c.departmentName].filter(Boolean).join(' · ');
  });

  /** Only the focused stage when one was picked; otherwise the whole case. */
  readonly visibleStages = computed(() => {
    const all = this.view()?.stages ?? [];
    const key = this.focusStage();
    if (!key) return all;
    const one = all.filter(s => s.key === key);
    return one.length ? one : all;
  });

  readonly eyebrow = computed(() => {
    const s = this.visibleStages();
    return this.focusStage() && s.length === 1 ? `Culture · ${s[0].label}` : 'Microbiology · Culture';
  });

  /** The AST stage (rendered inline via the culture-entry editor). */
  readonly astStage = computed(() => this.view()?.stages?.find(s => s.key === 'ast') ?? null);
  /** True when every stage is done — enables the case-level sign-out. */
  readonly allDone = computed(() => {
    const st = this.c()?.stages ?? [];
    return st.length > 0 && st.every(s => s.state === 'done');
  });
  readonly doneCount = computed(() => (this.view()?.stages ?? []).filter(s => s.state === 'done').length);
  /** The logged-in tech (shown as the header pill, like the standard entry). */
  readonly techName = computed(() => this.auth.user()?.displayName ?? '');

  // ── Structured stage fields (component → option-group dropdowns) ────────
  /** stage key → its structured fields (from the tenant's catalog; e.g. gram →
   *  Gram Stain MIC105 components). Absent key ⇒ free-text findings. */
  readonly stageSchema = signal<Record<string, StageField[]>>({});
  /** stage key → { fieldName: value } (draft-persisted like the notes). */
  readonly fieldValues = signal<Record<string, Record<string, string>>>({});

  schemaFor(stageKey: string): StageField[] | null {
    const f = this.stageSchema()[stageKey];
    return f?.length ? f : null;
  }
  /**
   * Groups a stage's fields for rendering: ≥3 consecutive-in-schema fields that
   * share the exact same option list collapse into ONE tally matrix (rows =
   * components, columns = the shared options — e.g. Gram's seven QUANTITY
   * components × Nil/Few/Moderate/Many); everything else renders as its own
   * segmented row / input. Cached per stage since schemas are static.
   */
  fieldGroups(stageKey: string): Array<{ id: string; kind: 'matrix' | 'rows'; options: string[]; fields: StageField[] }> {
    const cached = this._groupCache[stageKey];
    if (cached) return cached;
    const fields = this.stageSchema()[stageKey] ?? [];
    // Owner's call (2026-09-18): no radio-dot tally matrix — every component
    // renders as the same segmented PILL row (Nil | Few | Moderate | Many)
    // the rest of the stage's fields use.
    const matrixSigs = new Set<string>();
    const groups: Array<{ id: string; kind: 'matrix' | 'rows'; options: string[]; fields: StageField[] }> = [];
    for (const f of fields) {
      const sig = f.options.join('');
      if (f.options.length >= 2 && matrixSigs.has(sig)) {
        const existing = groups.find(g => g.kind === 'matrix' && g.options.join('') === sig);
        if (existing) existing.fields.push(f);
        else groups.push({ id: 'mx:' + sig, kind: 'matrix', options: f.options, fields: [f] });
      } else {
        const last = groups[groups.length - 1];
        if (last?.kind === 'rows') last.fields.push(f);
        else groups.push({ id: 'rows:' + groups.length, kind: 'rows', options: [], fields: [f] });
      }
    }
    this._groupCache[stageKey] = groups;
    return groups;
  }
  private _groupCache: Record<string, Array<{ id: string; kind: 'matrix' | 'rows'; options: string[]; fields: StageField[] }>> = {};
  fieldValue(stageKey: string, field: string): string {
    return this.fieldValues()[stageKey]?.[field] ?? '';
  }
  setField(stageKey: string, field: string, value: string) {
    this.fieldValues.update(all => ({ ...all, [stageKey]: { ...(all[stageKey] ?? {}), [field]: value } }));
    try { localStorage.setItem(this.draftKey(stageKey) + '.fields', JSON.stringify(this.fieldValues()[stageKey])); } catch { /* ignore */ }
  }
  /** Touch option: tap to pick; tapping the picked one again clears it. */
  toggleField(stageKey: string, field: string, value: string) {
    this.setField(stageKey, field, this.fieldValue(stageKey, field) === value ? '' : value);
  }
  private loadFieldDrafts(stages: CultureStageView[]) {
    const all: Record<string, Record<string, string>> = {};
    for (const s of stages) {
      try {
        const raw = localStorage.getItem(this.draftKey(s.key) + '.fields');
        if (raw) all[s.key] = JSON.parse(raw);
      } catch { /* ignore */ }
    }
    this.fieldValues.set(all);
  }
  private loadStageSchema() {
    this.api.get<Record<string, StageField[]>>('/api/microbiology/stage-schema').subscribe({
      next: s => { this._groupCache = {}; this.stageSchema.set(s ?? {}); },
      error: () => { /* stages fall back to free text */ },
    });
  }

  // ── Personal "canned findings" templates ────────────────────────────────
  readonly templates = signal<ResultTemplate[]>([]);
  private templateScope(stageKey: string) { return `culture.${stageKey}`; }
  templatesFor(stageKey: string): ResultTemplate[] {
    const scope = this.templateScope(stageKey);
    return this.templates().filter(t => t.scope === scope);
  }
  private loadTemplates() {
    this.api.get<ResultTemplate[]>('/api/result-templates').subscribe({
      next: rows => this.templates.set(rows ?? []),
      error: () => { /* none */ },
    });
  }
  /** Load a template into the findings box (the tech then fills in specifics). */
  applyTemplate(stageKey: string, t: ResultTemplate) {
    const existing = (this.drafts()[stageKey] ?? '').trim();
    const body = existing ? `${existing}\n${t.body}` : t.body;
    this.onDraft(stageKey, body);
  }
  saveTemplate(stageKey: string) {
    const body = (this.drafts()[stageKey] ?? '').trim();
    if (!body) return;
    const name = (window.prompt('Save these findings as a template — name it:') ?? '').trim();
    if (!name) return;
    this.api.post<ResultTemplate>('/api/result-templates', { scope: this.templateScope(stageKey), name, body }).subscribe({
      next: t => {
        if (t) this.templates.update(list => [...list.filter(x => x.id !== t.id), t]);
        this.toasts.success(`Template “${name}” saved`);
      },
      error: () => this.toasts.error('Could not save template'),
    });
  }
  deleteTemplate(t: ResultTemplate, ev: Event) {
    ev.stopPropagation();
    this.api.delete(`/api/result-templates/${t.id}`).subscribe({
      next: () => this.templates.update(list => list.filter(x => x.id !== t.id)),
      error: () => this.toasts.error('Could not delete template'),
    });
  }
  /** 1-based day counter from the case's creation date. */
  readonly dayNo = computed(() => {
    const created = this.view()?.createdAt;
    if (!created) return 1;
    const start = new Date(created).getTime();
    if (Number.isNaN(start)) return 1;
    return Math.max(1, Math.floor((this.now() - start) / 86_400_000) + 1);
  });
  astSummary(): string {
    const m = this.astValue();
    if (m.noGrowth) return 'No growth';
    if (m.organisms?.length) return m.organisms.map(o => o.name).filter(Boolean).join(', ');
    // Nothing entered here yet, but identification already knows the organisms.
    const idents = this.identifiedOrganisms();
    if (idents.length) return idents.join(', ') + ' — enter sensitivities';
    return '';
  }

  back() { this.navBack.backTo('/lab/my-work'); }
  /** The band's back chevron runs the page's own back (My Work fallback). */
  readonly backFn = () => this.back();

  readonly techInitials = computed(() => (this.techName() || 'T').split(/\s+/).filter(Boolean)
    .slice(0, 2).map(w => w[0]!.toUpperCase()).join(''));


  // ── Draft autosave (per stage, in localStorage) ─────────────────────────
  private draftKey(key: string) { return `pf.cw.draft.${this.id}.${this.selCaseId() ?? 'root'}.${key}`; }
  onDraft(key: string, val: string) {
    this.drafts.update(d => ({ ...d, [key]: val }));
    try { localStorage.setItem(this.draftKey(key), val); } catch { /* ignore */ }
  }
  private loadDrafts(stages: CultureStageView[]) {
    const d: Record<string, string> = {};
    for (const s of stages) {
      try { const v = localStorage.getItem(this.draftKey(s.key)); if (v) d[s.key] = v; } catch { /* ignore */ }
    }
    this.drafts.set(d);
  }
  private clearDraft(key: string) {
    try { localStorage.removeItem(this.draftKey(key)); localStorage.removeItem(this.draftKey(key) + '.fields'); } catch { /* ignore */ }
    this.drafts.update(d => { const n = { ...d }; delete n[key]; return n; });
    this.fieldValues.update(d => { const n = { ...d }; delete n[key]; return n; });
  }

  // ── Notes (tech ↔ validator conversation, same model as result entry) ──
  // One flat list for this order test; the view splits it by parameterName:
  // `<stage>` for the stage-level thread, `<stage>.<field>` per component.
  private readonly _comments = signal<OrderTestComment[]>([]);
  private readonly _noteOpen = signal<Set<string>>(new Set<string>());
  paramKey(stageKey: string, field: string): string { return `${this.sk(stageKey)}.${field}`; }
  commentsFor(parameterName: string): OrderTestComment[] {
    return this._comments().filter(c => c.parameterName === parameterName);
  }
  noteOpen(key: string): boolean { return this._noteOpen().has(key); }
  toggleNote(key: string) {
    this._noteOpen.update(set => { const n = new Set(set); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }
  private loadComments() {
    if (!this.id) return;
    this.api.get<OrderTestComment[]>(`/api/results/${this.id}/comments`).subscribe({
      next: list => this._comments.set(list ?? []),
      error: () => { /* non-fatal — the bench works without notes */ },
    });
  }
  addComment(parameterName: string, body: string, type: 'observation' | 'correction') {
    this.postComment(parameterName, null, body, type);
  }
  replyComment(parameterName: string, parentId: string, body: string) {
    this.postComment(parameterName, parentId, body, 'observation');
  }
  private postComment(parameterName: string, parentId: string | null, body: string, commentType: 'observation' | 'correction') {
    this.api.post<OrderTestComment>(`/api/results/${this.id}/comments`, { parameterName, parentId, commentType, body }).subscribe({
      next: () => this.loadComments(),
      error: (e: { error?: { message?: string } }) => this.toasts.error(e?.error?.message || 'Could not save the note'),
    });
  }

  ngOnInit() {
    this.loadSpecimens();
    this.id = this.route.snapshot.paramMap.get('orderTestId') ?? '';
    this.loadComments();
    this.focusStage.set(this.route.snapshot.queryParamMap.get('stage'));
    this.load();
    this.api.get<{ name: string }[]>('/api/microbiology/organisms').subscribe({
      next: rows => this.organismNames.set((rows ?? []).map(o => o.name).filter(Boolean)),
      error: () => { /* falls back to the built-in common isolates */ },
    });
    this.timer = setInterval(() => this.now.set(Date.now()), 30_000);
    this.loadTemplates();
    this.loadStageSchema();
  }

  ngOnDestroy() { if (this.timer) clearInterval(this.timer); }

  private load() {
    this.loading.set(true);
    this.api.get<CultureCaseView>(`/api/microbiology/culture/${this.id}`).subscribe({
      next: c => {
        this.c.set(c ?? null);
        this.reportHidden.set(c?.reportHidden ?? []);
        this.rehydrateBranch();
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); },
    });
  }

  /** Report-row visibility (checkboxes in the AST editor): unticked rows are
   *  hidden on the patient PDF only — the bench record is untouched. */
  readonly reportHidden = signal<string[]>([]);
  setReportHidden(keys: string[]) {
    this.reportHidden.set(keys); // optimistic — the PUT reconciles below
    this.api.put<{ hidden: string[] }>(`/api/microbiology/culture/${this.id}/report-hidden`, { keys }).subscribe({
      next: r => { if (r?.hidden) this.reportHidden.set(r.hidden); },
      error: e => this.toasts.error(ApiError.from(e).message),
    });
  }
  /** Stage-row checkboxes live on the PRIMARY only — the report prints the
   *  root case's stages, so branch rows have nothing to hide. */
  rhEnabled(): boolean { return this.selCaseId() === null; }
  rhShown(stageKey: string, field: string): boolean {
    return !this.reportHidden().includes(`stage:${stageKey}:${field}`);
  }
  rhToggle(stageKey: string, field: string) {
    const k = `stage:${stageKey}:${field}`;
    const cur = this.reportHidden();
    this.setReportHidden(cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k]);
  }

  /** Load the SELECTED branch's drafts + AST editor state. */
  private rehydrateBranch() {
    const v = this.view();
    this.loadDrafts(v?.stages ?? []);
    this.loadFieldDrafts(v?.stages ?? []);
    this.astValue.set({});
    const ast = v?.stages?.find(s => s.key === 'ast');
    if (ast?.valuesJson) { try { this.astValue.set(JSON.parse(ast.valuesJson) as CultureResult); } catch { /* keep empty */ } }
    // The ordered specimen flows into the result (panels + report) unless the
    // AST draft already carries one.
    const sp = this.c()?.specimen;
    if (sp && !this.astValue().specimen) this.astValue.update(x => ({ ...x, specimen: sp }));
    this.astOpen.set(false);
  }

  // ── Specimen (order-test level; desk-picked, bench-editable) ──
  readonly specimenOpts = signal<PfSelectOption[]>([]);
  private loadSpecimens() {
    this.api.get<{ name: string }[]>('/api/microbiology/specimens').subscribe({
      next: rows => this.specimenOpts.set((rows ?? []).map(r => ({ value: r.name, label: r.name }))),
      error: () => { /* list stays empty — the pill still shows the current value */ }
    });
  }
  setSpecimen(v: string) {
    if (!v || v === (this.c()?.specimen ?? '')) return;
    this.busy.set(true);
    this.api.post<CultureCaseView>(`/api/microbiology/culture/${this.id}/specimen`, { specimen: v }).subscribe({
      next: t => {
        this.busy.set(false);
        if (t) this.c.set(t);
        this.astValue.update(x => ({ ...x, specimen: v }));
        this.toasts.success(`Specimen set to ${v}`);
      },
      error: () => {
        this.busy.set(false);
        this.toasts.error('Could not update the specimen');
      },
    });
  }

  /** Switch branches like git checkout — each keeps its own stages, drafts,
   *  AST editor state, notes and incubation clock. */
  selectCase(id: string | null) {
    if (this.selCaseId() === id) return;
    this.selCaseId.set(id);
    this.rehydrateBranch();
  }

  /** Fork a subculture off the SELECTED case (primary or another branch). */
  async newSubculture() {
    const label = await this.dialog.prompt({
      title: 'New subculture',
      message: 'Fork this culture onto fresh media — the branch gets its own growth, identification and sensitivity stages.',
      placeholder: 'e.g. Blood agar re-streak',
    });
    if (label === null) return;
    this.busy.set(true);
    this.api.post<CultureCaseView>(`/api/microbiology/culture/${this.id}/subculture`,
      { label: (label || '').trim() || null, parentCaseId: this.selCaseId() }).subscribe({
      next: t => {
        this.busy.set(false);
        if (t) {
          this.c.set(t);
          const subs = t.subCultures ?? [];
          const newest = subs[subs.length - 1];
          if (newest?.id) this.selectCase(newest.id);
        }
        this.toasts.success('Subculture created');
      },
      error: (e: { error?: { message?: string } }) => { this.busy.set(false); this.toasts.error(e?.error?.message || 'Could not create the subculture'); },
    });
  }

  /** Delete the selected (abandoned) branch — never the primary. */
  async deleteBranch() {
    const v = this.view();
    const id = this.selCaseId();
    if (!id || !v) return;
    const ok = await this.dialog.confirm({
      title: `Delete "${v.label || 'this subculture'}"?`,
      message: 'The branch and everything entered on it are removed. The primary culture is untouched.',
      confirmLabel: 'Delete branch',
      tone: 'danger',
    });
    if (!ok) return;
    this.busy.set(true);
    this.api.delete<CultureCaseView>(`/api/microbiology/culture/${this.id}/subculture/${id}`).subscribe({
      next: t => {
        this.busy.set(false);
        if (t) this.c.set(t);
        this.selectCase(null);
        this.toasts.success('Subculture deleted');
      },
      error: (e: { error?: { message?: string } }) => { this.busy.set(false); this.toasts.error(e?.error?.message || 'Could not delete the branch'); },
    });
  }

  /** Live "held" duration for a picked stage (recomputes as `now` ticks). */
  elapsed(s: CultureStageView): string | null {
    if (s.state !== 'picked' || !s.pickedAt) return null;
    const ms = this.now() - new Date(s.pickedAt).getTime();
    if (Number.isNaN(ms) || ms < 0) return null;
    const m = Math.floor(ms / 60_000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  isMine(s: CultureStageView): boolean {
    return !!s.holderUserId && s.holderUserId === this.auth.user()?.id;
  }
  lockedByOther(s: CultureStageView): boolean {
    return s.state === 'picked' && !this.isMine(s);
  }

  // ── Case-level incubation (reference timer — locks nothing) ────────────
  readonly incubPresets = [6, 12, 18, 24, 48];
  readonly incubOpen = signal(false);
  readonly incubCustom = signal<number | null>(null);
  /** True when the case has a timer and it has elapsed. */
  incubDone(): boolean {
    const u = this.view()?.incubateUntil;
    if (!u) return false;
    const t = new Date(u).getTime();
    return !Number.isNaN(t) && t <= this.now();
  }
  /** Live "ready in …" countdown (recomputes as `now` ticks). */
  incubReadyIn(): string {
    const u = this.view()?.incubateUntil;
    if (!u) return '';
    const ms = new Date(u).getTime() - this.now();
    if (ms <= 0) return 'now';
    const m = Math.floor(ms / 60_000);
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }
  /** Plate taken out — clear the timer. */
  stopIncubation() {
    this.incubOpen.set(false);
    this.run(this.api.post<CultureCaseView>(`/api/microbiology/culture/${this.id}/incubate/stop${this.q()}`, {}),
      'Incubation stopped');
  }
  /** Start or extend the timer by whole hours (preset chip or custom). */
  applyIncubation(hours: number) {
    const h = Math.round(hours);
    if (!h || h < 1 || h > 336) { this.toasts.error('Hours must be between 1 and 336.'); return; }
    this.incubOpen.set(false);
    this.incubCustom.set(null);
    this.run(this.api.post<CultureCaseView>(`/api/microbiology/culture/${this.id}/incubate${this.q()}`, { hours: h }),
      `Incubation ${this.view()?.incubateUntil ? 'extended' : 'started'} · +${h}h`);
  }

    private run(obs: Observable<CultureCaseView>, ok?: string) {
    this.busy.set(true);
    obs.subscribe({
      next: c => {
        if (c) this.c.set(c);
        if (ok) this.toasts.success(ok);
        this.busy.set(false);
      },
      error: (e: { error?: { message?: string } }) => {
        this.toasts.error(e?.error?.message || 'Could not update the stage');
        this.busy.set(false);
        this.load(); // re-sync in case another tech changed it
      },
    });
  }

  pick(s: CultureStageView) {
    this.run(this.api.post<CultureCaseView>(`/api/microbiology/culture/${this.id}/stage/${s.key}/pick${this.q()}`, {}));
  }

  /** Auto-lock on first touch: an open stage is editable right away — the first
   *  interaction claims it silently. If someone else grabbed it in the
   *  meantime, the server refuses, we re-sync and the row grays out. */
  private readonly _picking = new Set<string>();
  ensurePicked(s: CultureStageView) {
    if (s.state !== 'open' || this._picking.has(s.key)) return;
    this._picking.add(s.key);
    this.api.post<CultureCaseView>(`/api/microbiology/culture/${this.id}/stage/${s.key}/pick${this.q()}`, {}).subscribe({
      next: c => { this._picking.delete(s.key); if (c) this.c.set(c); },
      error: (e: { error?: { message?: string } }) => {
        this._picking.delete(s.key);
        this.toasts.error(e?.error?.message || 'That stage was just taken by another tech');
        this.load();
      },
    });
  }
  drop(s: CultureStageView) {
    this.run(this.api.post<CultureCaseView>(`/api/microbiology/culture/${this.id}/stage/${s.key}/drop${this.q()}`, {}));
  }

  /** Hand this stage to another tech (reuses the shared delegate picker). */
  readonly delegating = signal<CultureStageView | null>(null);
  startDelegate(s: CultureStageView) { this.delegating.set(s); }
  doDelegate(s: CultureStageView, toUserId: string) {
    this.delegating.set(null);
    this.busy.set(true);
    this.api.post<CultureCaseView>(`/api/microbiology/culture/${this.id}/stage/${s.key}/delegate${this.q()}`, { toUserId }).subscribe({
      next: () => {
        this.busy.set(false);
        this.toasts.success(`${s.label} delegated`);
        // Stay on the case — the row flips to that tech (grayed out).
        this.load();
      },
      error: (e: { error?: { message?: string } }) => {
        this.busy.set(false);
        this.toasts.error(e?.error?.message || 'Could not delegate the stage');
        this.load();
      },
    });
  }
  submit(s: CultureStageView) {
    let valuesJson: string | null;
    if (s.key === 'ast') {
      valuesJson = JSON.stringify(this.astValue());
    } else if (this.schemaFor(s.key)) {
      // Structured stage: serialize the filled component fields (titled, so the
      // stored payload and roll-up read naturally).
      const vals = this.fieldValues()[s.key] ?? {};
      const fields = (this.schemaFor(s.key) ?? [])
        .filter(f => (vals[f.name] ?? '').trim())
        .map(f => ({ name: f.name, title: f.title, value: vals[f.name] }));
      valuesJson = fields.length ? JSON.stringify({ fields }) : null;
    } else {
      const notes = (this.drafts()[s.key] ?? '').trim();
      valuesJson = notes ? JSON.stringify({ notes }) : null;
    }
    this.busy.set(true);
    this.api.post<CultureCaseView>(`/api/microbiology/culture/${this.id}/stage/${s.key}/submit${this.q()}`, { valuesJson }).subscribe({
      next: c => {
        this.busy.set(false);
        this.toasts.success(`${s.label} submitted`);
        this.clearDraft(s.key);
        if (s.key === 'ast') this.astOpen.set(false);
        if (c) this.c.set(c); // stay on the case — the row flips to done
      },
      error: (e: { error?: { message?: string } }) => {
        this.busy.set(false);
        this.toasts.error(e?.error?.message || 'Could not submit the stage');
        this.load();
      },
    });
  }

  /** Reopen a done stage — values prefill so the tech edits, not re-types. */
  reopen(s: CultureStageView) {
    this.busy.set(true);
    this.api.post<CultureCaseView>(`/api/microbiology/culture/${this.id}/stage/${s.key}/reopen${this.q()}`, {}).subscribe({
      next: t => {
        this.busy.set(false);
        if (t) this.c.set(t);
        this.prefillFromStage(s.key);
        this.toasts.success(`${s.label} reopened for editing`);
      },
      error: (e: { error?: { message?: string } }) => {
        this.busy.set(false);
        this.toasts.error(e?.error?.message || 'Could not reopen the stage');
        this.load();
      },
    });
  }
  /** Seed the editable drafts from the stage's submitted values. */
  private prefillFromStage(stageKey: string) {
    const st = this.view()?.stages?.find(x => x.key === stageKey);
    if (!st?.valuesJson) return;
    try {
      const o = JSON.parse(st.valuesJson) as { fields?: { name?: string; value?: string }[]; notes?: string; organisms?: unknown };
      if (stageKey === 'ast') {
        this.astValue.set(JSON.parse(st.valuesJson) as CultureResult);
        this.astOpen.set(true);
        return;
      }
      if (Array.isArray(o.fields)) {
        for (const f of o.fields) if (f.name) this.setField(stageKey, f.name, f.value ?? '');
      } else if (o.notes) {
        this.onDraft(stageKey, o.notes);
      }
    } catch { /* unreadable payload → start clean */ }
  }

  /** The tech also validates — one step, no validation-queue detour. The
   *  backend still enforces the two-person rule (validate_own_result). */
  canValidate(): boolean { return this.auth.hasPermission('validate_result'); }
  submitAndValidate() {
    this.busy.set(true);
    this.api.post<CultureCaseView>(`/api/microbiology/culture/${this.id}/signout-validate`, {}).subscribe({
      next: () => {
        this.busy.set(false);
        this.toasts.success('Validated & signed out');
        this.router.navigate(['/lab/my-work']);
      },
      error: (e: { error?: { message?: string } }) => {
        this.busy.set(false);
        this.toasts.error(e?.error?.message || 'Could not validate — it may need a second person.');
        this.load();
      },
    });
  }

  submitForSignout() {
    this.busy.set(true);
    this.api.post(`/api/microbiology/culture/${this.id}/submit-for-signout`, {}).subscribe({
      next: () => { this.busy.set(false); this.toasts.success('Sent for pathologist sign-out'); this.router.navigate(['/lab/my-work']); },
      error: () => { this.busy.set(false); this.toasts.error('Could not submit for sign-out'); },
    });
  }

  readable(valuesJson: string): string {
    try {
      const o = JSON.parse(valuesJson);
      if (o?.notes) return o.notes;
      if (Array.isArray(o?.fields) && o.fields.length) {
        return o.fields.map((f: { title?: string; name?: string; value?: string }) =>
          `${f.title || f.name}: ${f.value}`).join(' · ');
      }
      if (o?.noGrowth) return 'No growth';
      if (Array.isArray(o?.organisms) && o.organisms.length) {
        return o.organisms.map((g: { name?: string; antibiotics?: unknown[] }) =>
          (g?.name || 'Organism') + (g?.antibiotics?.length ? ` (${g.antibiotics.length} abx)` : '')).join('; ');
      }
      return valuesJson;
    } catch { return valuesJson; }
  }
}
