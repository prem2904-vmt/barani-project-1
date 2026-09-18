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
  imports: [FormsModule, CultureEntryComponent, DelegateModalComponent, CommentThreadComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      <div class="pf-cse__note">Loading…</div>
    } @else if (!c()) {
      <div class="pf-cse__note">Case not found.</div>
    } @else if (c(); as cc) {
      <!-- ── Whole case, result-entry style: every stage a row, worked
           collaboratively (lock per stage, pick inline, notes autosave). ── -->
      <section class="pf-cse">
        <header class="pf-cse__hdr">
          <div class="pf-cse__hdr-top">
            <button type="button" class="pf-cse__back" (click)="back()" aria-label="Back">‹</button>
            <div class="pf-cse__titles">
              <div class="pf-cse__eyebrow">{{ (cc.departmentName || 'Microbiology') }} · Culture &amp; Sensitivity · Day {{ dayNo() }}</div>
              <div class="pf-cse__id">{{ cc.barcode || cc.sampleId || cc.testName || 'Culture case' }}</div>
              <div class="pf-cse__patient">
                <span class="pf-cse__pt-name">{{ cc.patientName || 'Patient' }}</span>
                <span class="pf-cse__mid">·</span>{{ cc.testName || 'Culture' }}
              </div>
            </div>
            <div class="pf-cse__hdr-right">
              @if (techName()) {
                <span class="pf-cse__tech"><span class="pf-cse__tech-dot"></span>{{ techName() }}</span>
              }
              <!-- ONE incubation control for the whole case: while a plate is
                   incubating it shows the countdown; otherwise it inoculates
                   the next stage that needs it. -->
              @if (incubatingStage(); as inc) {
                <span class="pf-cse__incubpill" [title]="'Incubating for ' + inc.label">⏳ Incubating · {{ inc.label }} · ready in {{ incubateReadyIn(inc) }}</span>
              } @else if (incubateTarget(); as tgt) {
                <button type="button" class="pf-cse__incubbtn press" [disabled]="busy()" (click)="incubate(tgt)"
                        [title]="'Start the incubation clock for ' + tgt.label">
                  Inoculate &amp; incubate · {{ tgt.label }}
                </button>
              }
              @if (cc.caseState === 'awaiting_signout') {
                <span class="pf-cse__awaitpill">Awaiting sign-out</span>
              } @else if (allDone()) {
                <button type="button" class="pf-cse__signout" [disabled]="busy()" (click)="submitForSignout()">Submit for sign-out</button>
              } @else {
                <span class="pf-cse__progresspill">{{ doneCount() }} / {{ cc.stages.length }} stages</span>
              }
            </div>
          </div>
          <!-- Stage progress chips (mirrors the standard screen's test chips). -->
          <div class="pf-cse__chips">
            @for (s of cc.stages; track s.key) {
              <span class="pf-cse__chip"
                    [class.pf-cse__chip--done]="s.state === 'done'"
                    [class.pf-cse__chip--active]="isMine(s)"
                    [class.pf-cse__chip--held]="lockedByOther(s)"
                    [class.pf-cse__chip--incub]="incubating(s)">
                @if (s.state === 'done') { <span class="pf-cse__chipdot">✓</span> }
                {{ s.label }}
              </span>
            }
          </div>
        </header>

        <div class="pf-cse__scroll">
          <!-- The case as a stack of full-width stage cards (Gram → Growth →
               ID → AST); each card carries its own header (state + holder +
               actions) and body. No spreadsheet columns, no numbered rail. -->
          <div class="pf-cse__flow">
            @for (s of cc.stages; track s.key) {
              <div class="pf-stg"
                   [class.pf-stg--done]="s.state === 'done'"
                   [class.pf-stg--locked]="lockedByOther(s)"
                   [class.pf-stg--incub]="incubating(s)"
                   [class.pf-stg--mine]="isMine(s)">
                <div class="pf-stg__card">
                  <header class="pf-stg__hdr">
                    <div class="pf-stg__titles">
                      <h3 class="pf-stg__name">{{ s.label }}</h3>
                      @if (s.state === 'done') { <span class="pf-stg__state c-done">Done{{ s.doneByName ? ' · ' + s.doneByName : '' }}</span> }
                      @else if (isMine(s)) { <span class="pf-stg__state c-mine">You{{ elapsed(s) ? ' · ' + elapsed(s) : '' }}</span> }
                      @else if (lockedByOther(s)) { <span class="pf-stg__state c-held">{{ s.holderName || 'In progress' }}{{ elapsed(s) ? ' · ' + elapsed(s) : '' }}</span> }
                      @else if (incubating(s)) { <span class="pf-stg__state c-incub">Ready in {{ incubateReadyIn(s) }}</span> }
                    </div>
                    <div class="pf-stg__acts">
                      <!-- Stage-level note thread (same conversation model as the
                           standard result entry: tech ↔ validator, per test). -->
                      <button type="button" class="pf-stg__note press" [class.pf-stg__note--has]="commentsFor(s.key).length > 0"
                              (click)="toggleNote(s.key)" [attr.aria-expanded]="noteOpen(s.key)" title="Note on this stage">✎</button>
                      @if (s.state !== 'done' && !lockedByOther(s) && requiresIncubation(s.key) && !incubating(s)) {
                        <button type="button" class="pf-stg__ghost pf-stg__ghost--incub press" [disabled]="busy()" (click)="incubate(s)"
                                [title]="'Start the incubation clock for ' + s.label">Inoculate &amp; incubate</button>
                      }
                      @if (isMine(s) && s.state !== 'done') {
                        <button type="button" class="pf-stg__ghost press" [disabled]="busy()" (click)="drop(s)">Drop</button>
                        <button type="button" class="pf-stg__ghost press" [disabled]="busy()" (click)="startDelegate(s)">Delegate</button>
                        <button type="button" class="pf-stg__submit press" [disabled]="busy()" (click)="submit(s)">Submit</button>
                      }
                    </div>
                  </header>
                  @if (noteOpen(s.key) || commentsFor(s.key).length > 0) {
                    <div class="pf-stg__thread">
                      <pf-comment-thread [comments]="commentsFor(s.key)" currentRole="tech"
                                         [composeLabel]="'Add note on ' + s.label"
                                         (add)="addComment(s.key, $event.body, $event.type)"
                                         (reply)="replyComment(s.key, $event.parentId, $event.body)"></pf-comment-thread>
                    </div>
                  }

                  @if (s.state === 'done') {
                    <p class="pf-stg__summary">{{ readable(s.valuesJson || '') || 'Completed' }}</p>
                  } @else if (lockedByOther(s)) {
                    <p class="pf-stg__lockmsg">{{ s.holderName || 'Another tech' }} is working this stage.</p>
                  } @else if (incubating(s)) {
                    <p class="pf-stg__lockmsg">⏳ Incubating — ready in {{ incubateReadyIn(s) }}. This stage unlocks when the clock elapses.</p>
                  } @else {
                    <!-- Editable (mine, or open → first touch locks it). -->
                    @if (s.key === 'ast') {
                      <button type="button" class="pf-cse__astbtn" (click)="ensurePicked(s); astOpen.set(!astOpen())">
                        {{ astOpen() ? 'Hide organism / sensitivity ▴' : ((astSummary() || 'Enter organism + sensitivity') + ' ▾') }}
                      </button>
                      @if (astOpen()) {
                        <div class="pf-cse__astwrap">
                          <pf-culture-entry [value]="astValue()" [organismNames]="organismNames()"
                                            [seedOrganisms]="identifiedOrganisms()"
                                            (valueChange)="astValue.set($event)"></pf-culture-entry>
                        </div>
                      }
                    } @else if (schemaFor(s.key); as fields) {
                      <!-- Same-option components collapse into ONE tally matrix
                           (rows × Nil/Few/Moderate/Many); the rest render as
                           single segmented rows. -->
                      @for (g of fieldGroups(s.key); track g.id) {
                        @if (g.kind === 'matrix') {
                          <div class="pf-mx" role="group" [style.--mx-cols]="g.options.length">
                            <div class="pf-mx__row pf-mx__row--head">
                              <span class="pf-mx__lbl"></span>
                              @for (o of g.options; track o) { <span class="pf-mx__hopt">{{ o }}</span> }
                              <span class="pf-mx__hopt"></span>
                            </div>
                            @for (f of g.fields; track f.name) {
                              <div class="pf-mx__row">
                                <span class="pf-mx__lbl">{{ f.title }}</span>
                                @for (o of g.options; track o) {
                                  <button type="button" class="pf-mx__cell press"
                                          [class.pf-mx__cell--on]="fieldValue(s.key, f.name) === o"
                                          [attr.aria-label]="f.title + ': ' + o"
                                          (click)="ensurePicked(s); toggleField(s.key, f.name, o)">
                                    <span class="pf-mx__dot"></span>
                                  </button>
                                }
                                <span class="pf-mx__notecell">
                                  <button type="button" class="pf-stg__note press" [class.pf-stg__note--has]="commentsFor(paramKey(s.key, f.name)).length > 0"
                                          (click)="toggleNote(paramKey(s.key, f.name))" [title]="'Note on ' + f.title">✎</button>
                                </span>
                              </div>
                              @if (noteOpen(paramKey(s.key, f.name)) || commentsFor(paramKey(s.key, f.name)).length > 0) {
                                <div class="pf-mx__thread">
                                  <pf-comment-thread [comments]="commentsFor(paramKey(s.key, f.name))" currentRole="tech"
                                                     [composeLabel]="'Add note on ' + f.title"
                                                     (add)="addComment(paramKey(s.key, f.name), $event.body, $event.type)"
                                                     (reply)="replyComment(paramKey(s.key, f.name), $event.parentId, $event.body)"></pf-comment-thread>
                                </div>
                              }
                            }
                          </div>
                        } @else {
                          @for (f of g.fields; track f.name) {
                            <label class="pf-cse__field pf-cse__field--noted">
                              <span class="pf-cse__field-lbl">{{ f.title }}</span>
                              @if (f.options.length) {
                                <span class="pf-cse__opts" role="radiogroup" [attr.aria-label]="f.title">
                                  @for (o of f.options; track o) {
                                    <button type="button" class="pf-cse__opt press"
                                            [class.pf-cse__opt--on]="fieldValue(s.key, f.name) === o"
                                            [attr.aria-checked]="fieldValue(s.key, f.name) === o" role="radio"
                                            (click)="ensurePicked(s); toggleField(s.key, f.name, o)">{{ o }}</button>
                                  }
                                </span>
                              } @else if (f.suggest === 'organisms') {
                                <!-- Multi-organism: chips + search. The comma-joined
                                     value feeds the AST stage's per-organism panels. -->
                                <span class="pf-cse__orgs">
                                  @for (name of orgList(s.key, f.name); track name) {
                                    <span class="pf-cse__orgchip">{{ name }}
                                      <button type="button" class="pf-cse__orgx" (click)="ensurePicked(s); removeOrg(s.key, f.name, name)"
                                              [attr.aria-label]="'Remove ' + name">×</button>
                                    </span>
                                  }
                                  <input type="text" class="pf-cse__ftext pf-cse__ftext--org" [ngModel]="orgSearch()"
                                         (focus)="ensurePicked(s)"
                                         (ngModelChange)="orgSearch.set($event)"
                                         (change)="addOrg(s.key, f.name)"
                                         (keydown.enter)="$event.preventDefault(); addOrg(s.key, f.name)"
                                         [attr.list]="'pf-cw-organisms'"
                                         [placeholder]="orgList(s.key, f.name).length ? 'Add another organism…' : 'Type to search organisms…'" />
                                </span>
                                <datalist id="pf-cw-organisms">
                                  @for (o of organismNames(); track o) { <option [value]="o"></option> }
                                </datalist>
                              } @else if (f.type === 'textarea') {
                                <textarea class="pf-cse__ftext" rows="1" [ngModel]="fieldValue(s.key, f.name)"
                                          (focus)="ensurePicked(s)"
                                          (ngModelChange)="setField(s.key, f.name, $event)" placeholder="Optional…"></textarea>
                              } @else {
                                <input type="text" class="pf-cse__ftext" [ngModel]="fieldValue(s.key, f.name)"
                                       (focus)="ensurePicked(s)"
                                       (ngModelChange)="setField(s.key, f.name, $event)" placeholder="Optional…" />
                              }
                              <button type="button" class="pf-stg__note press" [class.pf-stg__note--has]="commentsFor(paramKey(s.key, f.name)).length > 0"
                                      (click)="$event.preventDefault(); toggleNote(paramKey(s.key, f.name))" [title]="'Note on ' + f.title">✎</button>
                            </label>
                            @if (noteOpen(paramKey(s.key, f.name)) || commentsFor(paramKey(s.key, f.name)).length > 0) {
                              <div class="pf-stg__thread pf-stg__thread--field">
                                <pf-comment-thread [comments]="commentsFor(paramKey(s.key, f.name))" currentRole="tech"
                                                   [composeLabel]="'Add note on ' + f.title"
                                                   (add)="addComment(paramKey(s.key, f.name), $event.body, $event.type)"
                                                   (reply)="replyComment(paramKey(s.key, f.name), $event.parentId, $event.body)"></pf-comment-thread>
                              </div>
                            }
                          }
                        }
                      }
                    } @else {
                      <div class="pf-cse__tpl">
                        <span class="pf-cse__tpl-lbl">Templates:</span>
                        @for (t of templatesFor(s.key); track t.id) {
                          <button type="button" class="pf-cse__tplchip" [title]="t.body"
                                  (click)="applyTemplate(s.key, t)">{{ t.name }}
                            <span class="pf-cse__tplx" (click)="deleteTemplate(t, $event)" aria-label="Delete template">×</span>
                          </button>
                        }
                        <button type="button" class="pf-cse__tplsave" [disabled]="!(drafts()[s.key] || '').trim()"
                                (click)="saveTemplate(s.key)">+ Save as template</button>
                      </div>
                      <textarea class="pf-cse__input" rows="3" [ngModel]="drafts()[s.key] || ''"
                                (focus)="ensurePicked(s)"
                                (ngModelChange)="onDraft(s.key, $event)" placeholder="Enter findings… (or load a template above)"></textarea>
                    }
                  }
                </div>
              </div>
            }
          </div>
        </div>
      </section>
    }

    @if (delegating(); as ds) {
      <pf-delegate-modal [testName]="ds.label" (chose)="doDelegate(ds, $event)" (cancelled)="delegating.set(null)"></pf-delegate-modal>
    }
  `,
  styles: [`
    .pf-cse__note { padding: 48px; text-align: center; font-size: 13px; color: var(--text-tertiary); }
    /* Single-stage entry — mirrors the standard result-entry chrome. */
    .pf-cse { display: flex; flex-direction: column; min-height: calc(100dvh - 60px); }
    .pf-cse__hdr { position: sticky; top: 0; z-index: 5; padding: 16px 24px 12px;
      background: var(--bg-card, #12121a); border-bottom: 1px solid var(--glass-border); }
    .pf-cse__hdr-top { display: flex; align-items: flex-start; gap: 12px; }
    .pf-cse__back { flex-shrink: 0; font-size: 22px; line-height: 1; background: transparent; border: none;
      color: var(--text-secondary); cursor: pointer; padding: 2px 6px; margin-top: 4px; }
    .pf-cse__titles { flex: 1; min-width: 0; }
    .pf-cse__eyebrow { font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-cse__id { font-size: 25px; font-weight: 800; color: var(--text-primary); margin-top: 3px; line-height: 1.15; font-variant-numeric: tabular-nums; }
    .pf-cse__patient { font-size: 13px; color: var(--text-secondary); margin-top: 3px; }
    .pf-cse__pt-name { font-weight: 600; color: var(--text-primary); }
    .pf-cse__mid { margin: 0 6px; opacity: .5; }
    .pf-cse__hdr-right { flex-shrink: 0; display: flex; align-items: center; gap: 10px; }
    .pf-cse__tech { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600;
      color: var(--text-secondary); padding: 6px 12px; border-radius: 999px; background: var(--glass-bg); border: 1px solid var(--glass-border); }
    .pf-cse__tech-dot { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; }
    .pf-cse__progresspill { font-size: 12px; font-weight: 700; color: var(--violet-text, #a78bfa);
      padding: 6px 12px; border-radius: 999px; background: rgba(124,58,237,0.14); }
    .pf-cse__chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; padding-left: 34px; }
    .pf-cse__chip { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600;
      padding: 3px 10px; border-radius: 999px; color: var(--text-tertiary);
      background: var(--glass-bg); border: 1px solid var(--glass-border); }
    .pf-cse__chip--done { color: #34d399; background: rgba(34,197,94,0.12); border-color: rgba(34,197,94,0.35); }
    .pf-cse__chip--active { color: #c4b5fd; background: rgba(124,58,237,0.18); border-color: rgba(124,58,237,0.5); }
    .pf-cse__chip--held { color: #fbbf24; background: rgba(245,158,11,0.12); border-color: rgba(245,158,11,0.35); }
    .pf-cse__chip--incub { color: #22d3ee; background: rgba(6,182,212,0.12); border-color: rgba(6,182,212,0.35); }
    .pf-cse__chipdot { font-weight: 800; }

    .pf-cse__awaitpill { flex-shrink: 0; font-size: 12px; font-weight: 700; color: #b45309;
      padding: 6px 12px; border-radius: 999px; background: rgba(245,158,11,0.14); }
    .pf-cse__incubpill { flex-shrink: 0; font-size: 12px; font-weight: 700; color: #0e7490;
      padding: 6px 12px; border-radius: 999px; background: rgba(6,182,212,0.14); }
    .pf-cse__incubbtn { flex-shrink: 0; font-size: 12.5px; font-weight: 700; cursor: pointer;
      padding: 8px 14px; border-radius: 10px; color: #22d3ee; background: rgba(6,182,212,0.10);
      border: 1px solid rgba(6,182,212,0.4); }
    .pf-cse__incubbtn:disabled { opacity: .5; cursor: default; }
    .pf-cse__signout { flex-shrink: 0; padding: 9px 16px; border-radius: 10px; font-size: 13px; font-weight: 700; color: #fff;
      background: var(--gradient-primary, linear-gradient(90deg,#a855f7,#ec4899)); border: 1px solid transparent; cursor: pointer; }
    .pf-cse__signout:disabled { opacity: .5; cursor: default; }

    .pf-cse__scroll { flex: 1; padding: 26px 24px 60px; }

    /* ── The case as a stack of glass stage cards. ── */
    .pf-cse__flow { width: 100%; display: flex; flex-direction: column; }
    .pf-stg { display: block; }
    /* State colours flow through the card accent. */
    .pf-stg__card { min-width: 0; margin-bottom: 18px; padding: 16px 20px 18px; border-radius: 16px;
      background: var(--glass-bg); border: 1px solid var(--glass-border);
      backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
      transition: border-color .25s ease, box-shadow .25s ease, opacity .25s ease; }
    .pf-stg--mine .pf-stg__card { border-color: rgba(139,92,246,.45); box-shadow: 0 8px 30px rgba(124,58,237,.14); }
    .pf-stg--done .pf-stg__card { padding-top: 13px; padding-bottom: 13px; }
    .pf-stg--locked .pf-stg__card { opacity: .62; }
    .pf-stg--incub .pf-stg__card { border-color: rgba(6,182,212,.35); }

    .pf-stg__hdr { display: flex; align-items: center; gap: 12px; }
    .pf-stg__titles { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
    .pf-stg__name { margin: 0; font-size: 14.5px; font-weight: 700; color: var(--text-primary); }
    .pf-stg__state { font-size: 11px; font-weight: 700; padding: 2.5px 9px; border-radius: 999px; white-space: nowrap; }
    .pf-stg__state.c-done { color: #34d399; background: rgba(34,197,94,.13); }
    .pf-stg__state.c-mine { color: #c4b5fd; background: rgba(124,58,237,.16); }
    .pf-stg__state.c-held { color: #fbbf24; background: rgba(245,158,11,.13); }
    .pf-stg__state.c-incub { color: #22d3ee; background: rgba(6,182,212,.13); }
    .pf-stg__acts { flex-shrink: 0; display: flex; align-items: center; gap: 8px; }
    /* ✎ note pencil — same affordance as the standard result-entry grid. */
    .pf-stg__note { width: 28px; height: 28px; border-radius: 8px; font-size: 13px; line-height: 1; cursor: pointer;
      color: var(--text-tertiary); background: transparent; border: 1px solid var(--glass-border); }
    .pf-stg__note:hover { color: var(--text-primary); border-color: rgba(124,58,237,.5); }
    .pf-stg__note--has { color: #fff; background: var(--gradient-primary, linear-gradient(135deg,#a855f7,#ec4899)); border-color: transparent; }
    .pf-stg__thread { margin: 10px 0 4px; }
    .pf-stg__thread--field { margin: 0 0 8px 194px; }
    .pf-stg__ghost--incub { color: #22d3ee; border-color: rgba(6,182,212,.4); background: rgba(6,182,212,.10); }
    .pf-mx__notecell { display: flex; align-items: center; justify-content: center; border-left: 1px solid var(--glass-border); }
    .pf-mx__thread { padding: 8px 14px 12px; border-top: 1px solid var(--glass-border); background: rgba(124,58,237,.04); }
    .pf-stg__ghost { padding: 6px 12px; border-radius: 9px; font-size: 12px; font-weight: 600; cursor: pointer;
      color: var(--text-secondary); background: transparent; border: 1px solid var(--glass-border); }
    .pf-stg__ghost:hover { color: var(--text-primary); border-color: var(--text-tertiary); }
    .pf-stg__ghost:disabled { opacity: .5; cursor: default; }
    .pf-stg__submit { padding: 6px 18px; border-radius: 9px; font-size: 12.5px; font-weight: 700; color: #fff; cursor: pointer;
      background: var(--gradient-primary, linear-gradient(90deg,#a855f7,#ec4899)); border: 1px solid transparent;
      box-shadow: 0 4px 14px rgba(124,58,237,.3); }
    .pf-stg__submit:disabled { opacity: .5; cursor: default; }
    .pf-stg__summary { margin: 8px 0 0; font-size: 13px; font-weight: 500; color: var(--text-secondary); line-height: 1.5; }
    .pf-stg__lockmsg { margin: 8px 0 0; font-size: 12.5px; font-weight: 500; color: var(--text-tertiary); }
    .pf-stg__hdr + .pf-cse__field, .pf-stg__hdr + .pf-mx, .pf-stg__hdr + .pf-cse__tpl,
    .pf-stg__hdr + .pf-cse__astbtn { margin-top: 14px; }

    /* ── Tally matrix: same-option components collapse into one grid —
       component names down, the shared options across, tap a cell. ── */
    .pf-mx { display: flex; flex-direction: column; margin-top: 14px; border-radius: 12px; overflow: hidden;
      border: 1px solid var(--glass-border); }
    .pf-mx__row { display: grid; grid-template-columns: minmax(150px, 1.4fr) repeat(var(--mx-cols, 4), minmax(64px, 1fr)) 44px;
      align-items: stretch; }
    .pf-mx__row + .pf-mx__row { border-top: 1px solid var(--glass-border); }
    .pf-mx__row--head { background: rgba(124,58,237,.08); }
    .pf-mx__hopt { display: flex; align-items: center; justify-content: center; padding: 8px 6px;
      font-size: 10.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase;
      color: var(--text-tertiary); text-align: center; }
    .pf-mx__lbl { display: flex; align-items: center; padding: 9px 14px;
      font-size: 12.5px; font-weight: 500; color: var(--text-secondary); line-height: 1.3; }
    .pf-mx__cell { display: flex; align-items: center; justify-content: center; min-height: 40px;
      cursor: pointer; background: transparent; border: none; border-left: 1px solid var(--glass-border); }
    .pf-mx__cell:hover .pf-mx__dot { border-color: var(--text-tertiary); transform: scale(1.15); }
    .pf-mx__dot { width: 14px; height: 14px; border-radius: 50%; border: 1.5px solid var(--glass-border);
      background: transparent; transition: transform .12s ease, border-color .15s ease, background .15s ease, box-shadow .15s ease; }
    .pf-mx__cell--on .pf-mx__dot { border-color: transparent; transform: scale(1.2);
      background: var(--gradient-primary, linear-gradient(135deg,#a855f7,#ec4899));
      box-shadow: 0 2px 10px rgba(124,58,237,.5); }

    .pf-cse__input { width: 100%; padding: 10px 12px; border-radius: 8px; font-size: 13.5px; color: var(--text-primary);
      background: var(--input-bg); border: 1px solid var(--input-border); outline: none; resize: vertical; box-sizing: border-box; }
    .pf-cse__input:focus { border-color: var(--input-border-focus); box-shadow: 0 0 0 3px rgba(139,92,246,.18); }
    /* Non-matrix structured fields — one aligned row per parameter. */
    .pf-cse__field { display: grid; grid-template-columns: 180px minmax(0, 1fr); align-items: center; gap: 14px;
      padding: 5px 0; }
    .pf-cse__field--noted { grid-template-columns: 180px minmax(0, 1fr) 28px; }
    .pf-cse__field-lbl { font-size: 13px; font-weight: 500; color: var(--text-secondary); line-height: 1.35; }
    .pf-cse__opts { display: inline-flex; flex-wrap: wrap; gap: 2px; padding: 3px; border-radius: 9999px;
      background: var(--glass-bg); border: 1px solid var(--glass-border); justify-self: start;
      backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
    .pf-cse__opt { display: inline-flex; align-items: center; justify-content: center; height: 28px; padding: 0 14px;
      font-size: 12.5px; font-weight: 500; cursor: pointer; border-radius: 9999px; border: none; white-space: nowrap;
      color: var(--text-tertiary); background: transparent;
      transition: background .2s ease, color .2s ease, box-shadow .2s ease, transform .08s ease; }
    .pf-cse__opt:hover { color: var(--text-primary); }
    .pf-cse__opt:active { transform: scale(.97); }
    .pf-cse__opt--on { color: #fff; background: var(--gradient-primary, linear-gradient(90deg,#a855f7,#ec4899));
      box-shadow: 0 4px 14px rgba(124, 58, 237, 0.35); }
    /* Free-text fields sit in the same aligned row; keep them modest. */
    .pf-cse__field .pf-cse__ftext { max-width: 520px; }
    @media (max-width: 760px) {
      .pf-cse__field, .pf-cse__field--noted { grid-template-columns: 1fr; gap: 5px; }
      .pf-stg__thread--field { margin-left: 0; }
    }

    /* ── Phone (≤640px): slim the rail, full-bleed cards, comfy tap targets.
       Desktop is untouched (mobile-ui convention). ── */
    @media (max-width: 640px) {
      .pf-cse__hdr { padding: 12px 14px 10px; }
      .pf-cse__hdr-top { flex-wrap: wrap; }
      .pf-cse__id { font-size: 21px; }
      .pf-cse__hdr-right { width: 100%; order: 3; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
      .pf-cse__chips { padding-left: 0; margin-top: 10px; }
      .pf-cse__scroll { padding: 16px 12px 48px; }
      .pf-stg__card { padding: 13px 14px 15px; margin-bottom: 14px; border-radius: 14px; }
      .pf-stg__hdr { flex-wrap: wrap; }
      .pf-stg__acts { width: 100%; margin-top: 8px; }
      .pf-stg__submit { margin-left: auto; }
      .pf-cse__opt { height: 36px; padding: 0 13px; }  /* comfy tap targets */
      .pf-cse__field { grid-template-columns: 1fr; gap: 5px; padding: 4px 0; }
      .pf-mx__row { grid-template-columns: minmax(94px, 1.1fr) repeat(var(--mx-cols, 4), minmax(44px, 1fr)) 36px; }
      .pf-mx__lbl { padding: 8px 10px; font-size: 11.5px; }
      .pf-mx__hopt { font-size: 9px; padding: 7px 3px; }
      .pf-mx__cell { min-height: 42px; }
      .pf-mx__dot { width: 16px; height: 16px; }
    }
    .pf-cse__ftext { width: 100%; padding: 8px 10px; border-radius: 8px; font-size: 13px;
      color: var(--text-primary); background: var(--input-bg); border: 1px solid var(--input-border); outline: none; box-sizing: border-box; }
    .pf-cse__ftext:focus { border-color: var(--input-border-focus); box-shadow: 0 0 0 3px rgba(139,92,246,.18); }
    .pf-cse__tpl { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
    .pf-cse__tpl-lbl { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-cse__tplchip { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; cursor: pointer;
      padding: 4px 6px 4px 10px; border-radius: 999px; color: var(--violet-text, #a78bfa);
      background: rgba(124,58,237,0.12); border: 1px solid rgba(124,58,237,0.3); }
    .pf-cse__tplchip:hover { background: rgba(124,58,237,0.2); }
    .pf-cse__tplx { display: inline-flex; align-items: center; justify-content: center; width: 15px; height: 15px; border-radius: 50%;
      font-size: 13px; line-height: 1; color: var(--text-tertiary); }
    .pf-cse__tplx:hover { color: #ef4444; background: rgba(239,68,68,0.15); }
    .pf-cse__tplsave { font-size: 12px; font-weight: 600; cursor: pointer; padding: 4px 10px; border-radius: 999px;
      color: var(--text-secondary); background: transparent; border: 1px dashed var(--glass-border); }
    .pf-cse__tplsave:disabled { opacity: .4; cursor: default; }
    .pf-cse__astbtn { font-size: 13px; font-weight: 600; color: var(--violet-text, #7c3aed); background: transparent;
      border: 1px dashed rgba(124,58,237,.4); border-radius: 8px; padding: 9px 12px; cursor: pointer; width: 100%; text-align: left; }
    .pf-cse__astwrap { margin-top: 14px; }

    /* Identification: multi-organism chips + search. */
    .pf-cse__orgs { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; flex: 1; min-width: 0; }
    .pf-cse__orgchip { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 600;
      padding: 4px 6px 4px 11px; border-radius: 999px; color: var(--violet-text, #a78bfa);
      background: rgba(124,58,237,.1); border: 1px solid rgba(124,58,237,.35); white-space: nowrap; }
    .pf-cse__orgx { border: none; background: transparent; color: inherit; cursor: pointer;
      font-size: 14px; line-height: 1; padding: 2px 4px; border-radius: 50%; }
    .pf-cse__orgx:hover { color: #ef4444; background: rgba(239,68,68,.12); }
    .pf-cse__ftext--org { flex: 1 1 220px; min-width: 180px; }
  `],
})
export class CultureWorkbenchComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);

  readonly c = signal<CultureCaseView | null>(null);
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
  /** In-progress text of the identification organism search box. */
  readonly orgSearch = signal('');
  /** The chips: the comma-joined field value split back into names. */
  orgList(stageKey: string, field: string): string[] {
    return (this.fieldValue(stageKey, field) ?? '').split(',').map(s => s.trim()).filter(Boolean);
  }
  addOrg(stageKey: string, field: string) {
    const name = this.orgSearch().trim();
    if (!name) return;
    const list = this.orgList(stageKey, field);
    if (!list.some(x => x.toLowerCase() === name.toLowerCase()))
      this.setField(stageKey, field, [...list, name].join(', '));
    this.orgSearch.set('');
  }
  removeOrg(stageKey: string, field: string, name: string) {
    this.setField(stageKey, field, this.orgList(stageKey, field).filter(x => x !== name).join(', '));
  }
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
    const st = this.c()?.stages?.find(s => s.key === 'identification');
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

  private id = '';

  /** The stage the tech came in to work (from ?stage=…) — the entry focuses on
   *  just this one, styled like the standard result-entry. Null = full case. */
  readonly focusStage = signal<string | null>(null);

  readonly subtitle = computed(() => {
    const c = this.c();
    if (!c) return '';
    return [c.patientName, c.testName, c.departmentName].filter(Boolean).join(' · ');
  });

  /** Only the focused stage when one was picked; otherwise the whole case. */
  readonly visibleStages = computed(() => {
    const all = this.c()?.stages ?? [];
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
  readonly astStage = computed(() => this.c()?.stages?.find(s => s.key === 'ast') ?? null);
  /** True when every stage is done — enables the case-level sign-out. */
  readonly allDone = computed(() => {
    const st = this.c()?.stages ?? [];
    return st.length > 0 && st.every(s => s.state === 'done');
  });
  readonly doneCount = computed(() => (this.c()?.stages ?? []).filter(s => s.state === 'done').length);
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
    const bySig = new Map<string, StageField[]>();
    for (const f of fields) {
      if (f.options.length >= 2) {
        const sig = f.options.join('');
        bySig.set(sig, [...(bySig.get(sig) ?? []), f]);
      }
    }
    const matrixSigs = new Set([...bySig.entries()].filter(([, fs]) => fs.length >= 3).map(([sig]) => sig));
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
    const created = this.c()?.createdAt;
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

  back() { this.router.navigate(['/lab/my-work']); }

  // ── Draft autosave (per stage, in localStorage) ─────────────────────────
  private draftKey(key: string) { return `pf.cw.draft.${this.id}.${key}`; }
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
  paramKey(stageKey: string, field: string): string { return `${stageKey}.${field}`; }
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
        this.loadDrafts(c?.stages ?? []);
        this.loadFieldDrafts(c?.stages ?? []);
        // Rehydrate the AST editor from a saved/in-progress result.
        const ast = c?.stages?.find(s => s.key === 'ast');
        if (ast?.valuesJson) { try { this.astValue.set(JSON.parse(ast.valuesJson) as CultureResult); } catch { /* keep empty */ } }
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); },
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

  // ── Incubation ──────────────────────────────────────────────────────────
  private readonly incubationStages = new Set(['growth', 'identification', 'ast']);
  requiresIncubation(key: string): boolean { return this.incubationStages.has(key); }
  /** True while a stage's incubation clock is still running. */
  incubating(s: CultureStageView): boolean {
    if (!s.incubateUntil) return false;
    const t = new Date(s.incubateUntil).getTime();
    return !Number.isNaN(t) && t > this.now();
  }
  /** Live "ready in …" countdown (recomputes as `now` ticks). */
  incubateReadyIn(s: CultureStageView): string {
    if (!s.incubateUntil) return '';
    const ms = new Date(s.incubateUntil).getTime() - this.now();
    if (ms <= 0) return 'now';
    const m = Math.floor(ms / 60_000);
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }
  incubate(s: CultureStageView) {
    this.run(this.api.post<CultureCaseView>(`/api/microbiology/culture/${this.id}/stage/${s.key}/incubate`, {}));
  }
  /** The stage whose incubation clock is currently running (one at a time). */
  readonly incubatingStage = computed(() =>
    (this.c()?.stages ?? []).find(s => this.incubating(s)) ?? null);
  /** The next stage the header button would inoculate: first not-done stage
   *  that needs incubation and isn't already past its clock. */
  readonly incubateTarget = computed(() => {
    const stages = this.c()?.stages ?? [];
    return stages.find(s => s.state !== 'done' && !this.lockedByOther(s)
      && this.requiresIncubation(s.key) && !this.incubating(s)) ?? null;
  });

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
    this.run(this.api.post<CultureCaseView>(`/api/microbiology/culture/${this.id}/stage/${s.key}/pick`, {}));
  }

  /** Auto-lock on first touch: an open stage is editable right away — the first
   *  interaction claims it silently. If someone else grabbed it in the
   *  meantime, the server refuses, we re-sync and the row grays out. */
  private readonly _picking = new Set<string>();
  ensurePicked(s: CultureStageView) {
    if (s.state !== 'open' || this._picking.has(s.key) || this.incubating(s)) return;
    this._picking.add(s.key);
    this.api.post<CultureCaseView>(`/api/microbiology/culture/${this.id}/stage/${s.key}/pick`, {}).subscribe({
      next: c => { this._picking.delete(s.key); if (c) this.c.set(c); },
      error: (e: { error?: { message?: string } }) => {
        this._picking.delete(s.key);
        this.toasts.error(e?.error?.message || 'That stage was just taken by another tech');
        this.load();
      },
    });
  }
  drop(s: CultureStageView) {
    this.run(this.api.post<CultureCaseView>(`/api/microbiology/culture/${this.id}/stage/${s.key}/drop`, {}));
  }

  /** Hand this stage to another tech (reuses the shared delegate picker). */
  readonly delegating = signal<CultureStageView | null>(null);
  startDelegate(s: CultureStageView) { this.delegating.set(s); }
  doDelegate(s: CultureStageView, toUserId: string) {
    this.delegating.set(null);
    this.busy.set(true);
    this.api.post<CultureCaseView>(`/api/microbiology/culture/${this.id}/stage/${s.key}/delegate`, { toUserId }).subscribe({
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
    this.api.post<CultureCaseView>(`/api/microbiology/culture/${this.id}/stage/${s.key}/submit`, { valuesJson }).subscribe({
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
