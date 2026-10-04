import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, firstValueFrom, of } from 'rxjs';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { SkeletonFormComponent } from '../../../shared/primitives/skeleton-kit.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { plural } from '../../../shared/utils/plural';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { AuthService } from '../../../core/auth/auth.service';
import { OpdAdminApi, OpdFormDetail, OpdFormListRow, OpdStarter } from './opd-admin.api';
import { mq } from './opd-admin.util';
import {
  BUILT_INS, OpdAnswers, OpdFormDoc, OpdFormDocSection, OpdMediaRef, OpdQType, OpdQuestion, allQuestions, clone, emptyDoc, normalizeSchema,
  sampleAnswers, typeName,
} from './forms/form-schema';
import {
  BuilderAction, DeleteUndo, applyAction, changeType, fromParsed, fromType, insertAt, keysOf, replaceSectionFields, sectionIndexOfKey, undoDelete,
  versionState, withQuestions,
  addSection as addSectionOp, moveSection as moveSectionOp, removeSection as removeSectionOp, renameSection as renameSectionOp,
} from './forms/form-builder-ops';
import { SENTENCE_EXAMPLES, parseQuestion } from './forms/sentence-parser';
import { OpdFormRendererComponent } from './forms/renderer';
import { OpdFormGalleryComponent, StarterPick } from './forms/form-gallery.component';
import { InspectorMode, OpdFormInspectorComponent } from './forms/form-inspector.component';

type View = 'doctor' | 'phone' | 'print';
type Fill = 'sample' | 'empty';
/** `si` is the target SECTION for an insert (ignored when `change` is true —
 *  the selected question's own section is used instead). */
type Gallery = null | { kind: 'starters' } | { kind: 'types'; change: boolean; at: number | null; si?: number };
type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

const AUTOSAVE_MS = 900;

/**
 * Form builder (/admin/opd/forms/:id, `new` + ?departmentId=) — the form is
 * edited IN PLACE on the doctor's own Step-1 consult screen, filled with a
 * sample patient (owner mockup v5). Click a question → selection + tools + an
 * inspector in doctor language; type a sentence to add one (parseQuestion);
 * browse answer types; "show only when" conditions; print-on-report; views
 * Doctor's screen | Phone | Printed report; Try it as a doctor. Vitals,
 * diagnosis, Rx, investigations and follow-up are BUILT IN — shown locked.
 * Changes autosave as the draft; Publish (the ONE primary) makes the next
 * immutable version — past consults keep theirs.
 */
@Component({
  selector: 'pf-opd-form-builder',
  standalone: true,
  imports: [HeroBandComponent, ScreenHeaderComponent, SelectComponent, SkeletonFormComponent, BusyDirective,
    OpdFormRendererComponent, OpdFormGalleryComponent, OpdFormInspectorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./opd-admin.shared.scss'],
  styles: [`
    .fb-ctx { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; width: 100%; }
    .fb-name { flex: 0 1 280px; min-width: 140px; height: 36px; border: 1px solid transparent; border-radius: 10px; padding: 0 10px; font: inherit; font-size: 15px; font-weight: 600;
      color: var(--text-primary); background: transparent; }
    .fb-name:hover { border-color: var(--nd-line); }
    .fb-name:focus { outline: 0; border-color: var(--color-violet-600, #7c3aed); background: var(--nd-card-bg); }
    .fb-ver { display: inline-flex; align-items: center; height: 26px; padding: 0 10px; border-radius: 999px; font-size: 12px; font-weight: 500; color: var(--text-secondary);
      background: var(--nd-chip-bg); border: 1px solid var(--nd-line); white-space: nowrap; }
    .fb-ver--draft::before { content: ''; width: 6px; height: 6px; border-radius: 999px; background: var(--color-violet-600, #7c3aed); margin-right: 6px; }
    .fb-lib { width: 190px; }
    .fb-used { display: inline-flex; gap: 6px; align-items: center; flex-wrap: wrap; font-size: 12px; color: var(--text-tertiary); }
    .fb-div { width: 1px; align-self: stretch; background: var(--nd-line); }
    .fb-wrap { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 16px; }
    .fb-wrap--narrow { grid-template-columns: minmax(0, 1fr); }
    .fb-main { display: flex; flex-direction: column; min-height: 0; gap: 10px; }
    .fb-tool { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .fb-tool__note { margin-left: auto; font-size: 12px; color: var(--text-tertiary); }
    .fb-stage { flex: 1 1 auto; min-height: 0; overflow-y: auto; border-radius: var(--nd-radius-card, 16px); background: color-mix(in srgb, var(--color-primary, #7c3aed) 4%, var(--nd-chip-bg));
      border: 1px solid var(--nd-line); padding: 16px; overscroll-behavior: contain; }
    .fb-canvas { max-width: 980px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; }
    .fb-phone { width: 390px; max-width: 100%; margin: 0 auto; border-radius: 28px; border: 8px solid color-mix(in srgb, var(--text-primary) 18%, transparent); padding: 10px; background: var(--bg-primary, var(--nd-card-bg)); }
    .fb-pbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; padding: 12px 14px; border-radius: 14px; background: var(--nd-card-bg); border: 1px solid var(--nd-line); }
    .fb-pbar b { font-size: 14.5px; color: var(--text-primary); }
    .fb-pbar span { font-size: 12.5px; color: var(--text-secondary); }
    .fb-pbar__st { margin-left: auto; font-size: 11.5px !important; padding: 2px 10px; border-radius: 999px; background: var(--nd-chip-bg); border: 1px solid var(--nd-line); }
    .fb-vit { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 10px 14px; border-radius: 14px; background: var(--nd-card-bg); border: 1px dashed var(--nd-line); }
    .fb-vit__v { display: inline-flex; gap: 4px; align-items: baseline; font-size: 12px; color: var(--text-tertiary); }
    .fb-vit__v b { font-size: 13.5px; color: var(--text-primary); }
    .fb-lock { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: .06em; }
    .fb-pane { display: flex; flex-direction: column; gap: 12px; padding: 16px; border-radius: 14px; background: var(--nd-card-bg); border: 1px solid var(--nd-line); }
    .fb-pane__h { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .fb-pane__step { font-size: 11.5px; color: var(--text-tertiary); }
    .fb-pane__h h2 { margin: 0; font-size: 16px; font-weight: 600; color: var(--text-primary); }
    .fb-own { margin-left: auto; font-size: 12px; color: var(--violet-text, #6d28d9); border: 1px dashed var(--nd-sel-border); border-radius: 999px; padding: 4px 10px; }
    .fb-sec__h { display: flex; align-items: center; gap: 10px; }
    .fb-sec__h h3 { margin: 0; font-size: 13px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--text-secondary); }
    .fb-sec__n { font-size: 12px; color: var(--text-tertiary); }
    .fb-section { display: flex; flex-direction: column; gap: 10px; }
    .fb-section + .fb-section { margin-top: 6px; padding-top: 16px; border-top: 1px solid var(--nd-line); }
    .fb-sec-title { flex: 0 1 auto; min-width: 100px; height: 30px; border: 1px solid transparent; border-radius: 8px; padding: 0 8px; font: inherit; font-size: 13px; font-weight: 600;
      letter-spacing: .06em; text-transform: uppercase; color: var(--text-secondary); background: transparent; }
    .fb-sec-title:hover { border-color: var(--nd-line); }
    .fb-sec-title:focus { outline: 0; border-color: var(--color-violet-600, #7c3aed); background: var(--nd-card-bg); text-transform: none; }
    .fb-sec-tools { display: inline-flex; align-items: center; gap: 2px; margin-left: auto; }
    .fb-sec-tools .nd-btn--icon { width: 28px !important; height: 28px; min-height: 28px; }
    .fb-add-section { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; }
    .fb-undo { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 10px; background: var(--nd-chip-bg); font-size: 12.5px; color: var(--text-secondary); }
    .fb-add { display: flex; flex-direction: column; gap: 8px; padding: 12px; border-radius: 12px; border: 1px dashed var(--nd-sel-border); }
    .fb-add__row { display: flex; gap: 8px; align-items: center; }
    .fb-add__row .nd-input { flex: 1 1 auto; }
    .fb-add__pv { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 12.5px; color: var(--text-secondary); min-height: 30px; }
    .fb-add__pv b { color: var(--text-primary); }
    .fb-add__k { font-size: 12px; color: var(--text-tertiary); }
    .fb-add__enter { margin-left: auto; font-size: 11.5px; color: var(--text-tertiary); }
    .fb-ex { height: 28px; padding: 0 10px; font-size: 12px; }
    .fb-blk { opacity: .78; }
    .fb-blk__in { display: flex; flex-wrap: wrap; gap: 6px; }
    .fb-blk__search { display: flex; align-items: center; min-height: 40px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--nd-line); color: var(--text-tertiary); font-size: 13px; width: 100%; }
    .fb-next { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: 12px; background: var(--nd-chip-bg); border: 1px solid var(--nd-line); font-size: 12.5px; color: var(--text-secondary); }
    .fb-paper { max-width: 760px; margin: 0 auto; padding: 28px 32px; border-radius: 6px; background: #fff; color: #111827; box-shadow: 0 10px 30px rgba(15, 23, 42, .12);
      --text-primary: #111827; --text-secondary: #4b5563; --text-tertiary: #6b7280; --nd-line: #e5e7eb; }
    .fb-paper__h { display: flex; justify-content: space-between; gap: 12px; border-bottom: 2px solid #111827; padding-bottom: 10px; }
    .fb-paper__h b { font-size: 16px; }
    .fb-paper__h small { display: block; font-size: 11px; color: #6b7280; }
    .fb-paper__pt { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 16px; padding: 10px 0; font-size: 12px; border-bottom: 1px solid #e5e7eb; }
    .fb-paper__blk { position: relative; padding: 12px 0; border-bottom: 1px solid #e5e7eb; font-size: 12px; }
    .fb-paper__mk { position: absolute; right: 0; top: 10px; font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: .06em; }
    .fb-paper__t { margin: 0 0 8px; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
    .fb-paper__foot { display: flex; justify-content: space-between; gap: 12px; padding-top: 12px; font-size: 11px; color: #6b7280; }
    .fb-side { min-height: 0; }
    .fb-savestate--err { color: var(--red-text, #dc2626); }
    @media (max-width: 640px) { .fb-savestate span:not(.nd-savestate__dot) { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); } }
    @media (max-width: 640px) {
      .fb-stage { padding: 10px; }
      .fb-paper { padding: 18px; }
      .fb-paper__pt { grid-template-columns: minmax(0, 1fr); }
      .fb-lib { width: 100%; }
      .fb-name { flex-basis: 100%; }
      .fb-tool__note { display: none; }
    }
  `],
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10" (keydown.escape)="onEscape()">
      @if (theme.isNewDesign()) {
        <pf-hero-band [back]="true" backTo="/admin/opd/forms" [customSearch]="true" [contextBar]="true">
          <ng-container band-actions>
            <span class="nd-savestate fb-savestate" [class.fb-savestate--err]="saveState() === 'error'" role="status" aria-live="polite">
              @switch (saveState()) {
                @case ('saving') { <span class="nd-savestate__dot" aria-hidden="true"></span><span>Saving draft…</span> }
                @case ('dirty') { <span class="nd-savestate__dot" aria-hidden="true"></span><span>Draft changes</span> }
                @case ('error') { <span>Draft not saved — retrying on the next change</span> }
                @default { <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg><span>Draft saves automatically</span> }
              }
            </span>
            @if (canDiscard()) {
              <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" (click)="discardDraft()" aria-label="Discard draft" title="Discard draft — back to the published version">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>
                Discard draft</button>
            }
            <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" [attr.aria-pressed]="trying()" (click)="setTry(!trying())" [disabled]="!ready()"
                    [attr.aria-label]="trying() ? 'Back to editing' : 'Try it as a doctor'" [title]="trying() ? 'Back to editing' : 'Try it as a doctor'">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 2v2M5 2v2M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1M8 15a6 6 0 0 0 12 0v-3M20 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/></svg>
              {{ trying() ? 'Back to editing' : 'Try it as a doctor' }}</button>
            <button type="button" class="pf-hb-btn pf-hb-btn--primary press" [disabled]="!vstate().canPublish || publishing() || !ready()" [pfBusy]="publishing()" pfBusyLabel="Publishing…"
                    (click)="publish()" [attr.aria-label]="vstate().publishLabel" [title]="vstate().publishLabel">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14v6h16v-6M12 4v12M7 9l5-5 5 5"/></svg>
              {{ publishing() ? 'Publishing…' : vstate().publishLabel }}</button>
          </ng-container>
          <div band-search class="nd-ctx fb-ctx">
            @if (ready()) {
              <input class="fb-name" [value]="name()" aria-label="Form name" maxlength="160" autocomplete="off" (change)="rename($any($event.target).value)">
              <span class="fb-ver" [class.fb-ver--draft]="vstate().draft">{{ vstate().chip }}</span>
              <pf-select class="fb-lib" size="sm" [options]="libraryOptions()" [value]="formId() ?? ''" [searchable]="library().length > 8"
                         triggerLabel="Form library" (valueChange)="switchForm($event)"></pf-select>
              <span class="fb-div" aria-hidden="true"></span>
              <span class="fb-used"><span>Used by</span>
                @for (u of usedBy(); track u.id) { <button type="button" class="nd-chip press" (click)="openUse(u)">{{ u.name }}</button> }
                @empty { <span>No service yet — attach it in OPD Master</span> }
              </span>
            } @else { <span class="nd-ctx__primary">{{ isNew() ? 'New form' : 'Form' }}</span> }
          </div>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only" eyebrow="OPD · Consultation form" [title]="name() || 'New form'" parentRoute="/admin/opd/forms">
        <div actions class="oa-actions">
          <button type="button" class="nd-btn nd-btn--secondary press" (click)="setTry(!trying())" [disabled]="!ready()">{{ trying() ? 'Back to editing' : 'Try it as a doctor' }}</button>
          <button type="button" class="nd-btn nd-btn--primary press" [disabled]="!vstate().canPublish || publishing() || !ready()" (click)="publish()">{{ vstate().publishLabel }}</button>
        </div>
      </pf-screen-header>

      <div class="pf-band-body pf-band-body--fill">
        @if (!ready()) {
          <section class="nd-card"><div class="nd-card__body"><pf-skeleton-form [fields]="6" [cols]="2" label="Loading the form…"></pf-skeleton-form></div></section>
        } @else {
        <div class="fb-wrap" [class.fb-wrap--narrow]="narrow()">
          <div class="fb-main">
            <div class="fb-tool">
              <span class="nd-seg" role="radiogroup" aria-label="View as">
                @for (v of views; track v.value) {
                  <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="view() === v.value" (click)="setView(v.value)">{{ v.label }}</button>
                }
              </span>
              <span class="nd-seg" role="radiogroup" aria-label="Fill with">
                <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="fill() === 'sample'" (click)="setFill('sample')">Sample patient</button>
                <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="fill() === 'empty'" (click)="setFill('empty')">Empty</button>
              </span>
              @if (narrow()) {
                <button type="button" class="nd-btn nd-btn--secondary press" (click)="sheetOpen.set(true)">{{ inspectorTitle() }}</button>
              }
              <span class="fb-tool__note">Past consults keep the version they were filled with.</span>
            </div>

            <div class="fb-stage" (click)="stageClick($event)">
              @if (view() === 'print') {
                <div class="fb-paper" role="document" aria-label="Printed consult summary">
                  <div class="fb-paper__h"><div><b>{{ clinic() }}</b><small>Consultation summary</small></div><span class="nd-num">{{ sample() ? 'OPD-2609-0142' : 'OPD-——' }}</span></div>
                  <div class="fb-paper__pt">
                    <span>Patient <b>{{ sample() ? 'Mrs. Kavitha Ramesh' : '—' }}</b></span><span>Age / sex <b>{{ sample() ? '42 Y / F' : '—' }}</b></span>
                    <span>Doctor <b>{{ sample() ? 'Dr. Ananya Rao' : '—' }}</b></span><span>Date <b class="nd-num">{{ sample() ? '29 Sep 2026' : '—' }}</b></span>
                  </div>
                  <div class="fb-paper__blk"><span class="fb-paper__mk">Built-in</span><b>Vitals:</b> {{ sample() ? 'BP 128/82 mmHg · Pulse 84/min · Temp 99.1 °F · SpO₂ 98% · BMI 26.2' : '' }}</div>
                  <div class="fb-paper__blk"><span class="fb-paper__mk">{{ name() }}</span><p class="fb-paper__t">Examination findings</p>
                    <pf-opd-form-renderer [schema]="doc()" [answers]="answers()" mode="print" [printBlanks]="!sample()"></pf-opd-form-renderer></div>
                  <div class="fb-paper__blk"><span class="fb-paper__mk">Built-in</span><b>Diagnosis:</b> {{ sample() ? 'Acute rhinosinusitis' : '' }}<p class="fb-paper__t" style="margin-top:8px">Rx</p>
                    @if (sample()) { <ol style="margin:0;padding-left:18px;list-style:decimal"><li>Clavumox 625 — 1-0-1 × 5 days, after food</li><li>Montiz-LC — 0-0-1 × 10 days, after food</li></ol> }
                    <p style="margin:8px 0 0"><b>Investigations:</b> {{ sample() ? 'AEC, Total IgE' : '' }} · <b>Review:</b> {{ sample() ? 'Tue, 6 Oct 2026' : '' }}</p></div>
                  <div class="fb-paper__foot"><span>Doctor's signature and registration number</span><span>Form: {{ name() }} · {{ vstate().chip }}</span></div>
                </div>
              } @else {
                <div [class.fb-phone]="view() === 'phone'">
                  <div class="fb-canvas">
                    <div class="fb-pbar"><b>{{ sample() ? 'Mrs. Kavitha Ramesh' : 'Patient name' }}</b><span class="nd-num">{{ sample() ? '42 F · AA0112 · Token A3' : '— · — · —' }}</span>
                      <span class="fb-pbar__st">{{ trying() ? 'Trying as a doctor' : sample() ? 'Sample patient' : 'Empty form' }}</span></div>
                    <div class="fb-vit" role="group" aria-label="Vitals — built in, filled at the vitals station">
                      <span class="fb-lock"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>Built-in</span>
                      @for (v of vitals; track v.k) { <span class="fb-vit__v">{{ v.k }} <b class="nd-num">{{ sample() ? v.v : '—' }}</b>{{ v.u }}</span> }
                    </div>
                    <div class="fb-pane">
                      <div class="fb-pane__h"><span class="fb-pane__step nd-num">Step 1 of 4</span><h2>Assessment &amp; diagnosis</h2>
                        @if (doc().allowAddons !== false) { <span class="fb-own" title="Doctors can add their own questions on top of yours">+ Add my own field</span> }</div>
                      @if (undo() && !trying()) {
                        <div class="fb-undo"><span>Deleted “{{ undo()!.q.label }}” — past consults keep it.</span><button type="button" class="nd-btn nd-btn--tertiary press" (click)="undoDelete()">Undo</button></div>
                      }
                      @for (section of doc().sections; track section.key; let si = $index) {
                        <div class="fb-section">
                          <div class="fb-sec__h">
                            @if (!trying()) {
                              <input class="fb-sec-title" [value]="section.title" maxlength="80" autocomplete="off" aria-label="Section title"
                                     (change)="renameSection(si, $any($event.target).value)">
                            } @else { <h3>{{ section.title }}</h3> }
                            <span class="fb-sec__n">{{ plural(section.fields.length, 'question') }}</span>
                            @if (!trying()) {
                              <span class="fb-sec-tools">
                                <button type="button" class="nd-btn nd-btn--icon" (click)="moveSection(si, -1)" [disabled]="si === 0" aria-label="Move section up" title="Move section up">
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>
                                </button>
                                <button type="button" class="nd-btn nd-btn--icon" (click)="moveSection(si, 1)" [disabled]="si === doc().sections.length - 1" aria-label="Move section down" title="Move section down">
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                                </button>
                                <button type="button" class="nd-btn nd-btn--icon" (click)="removeSection(si)" [disabled]="doc().sections.length <= 1" aria-label="Remove section" title="Remove section">
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                                </button>
                              </span>
                            }
                          </div>
                          <pf-opd-form-renderer [schema]="sectionDoc(section)" [answers]="answers()" [mode]="trying() ? 'edit' : 'design'" [layout]="view() === 'phone' ? 'phone' : 'screen'"
                                                [selectedKey]="trying() ? null : selected()" (questionSelect)="select($event)" (action)="onAction($event.key, $event.action)"
                                                (insertAt)="insertHere($event, si)" (answersChange)="tryAnswers.set($event)" (mediaRequest)="fakeMedia($event.key, $event.side)"></pf-opd-form-renderer>
                          @if (!section.fields.length) { <p class="fb-add__k">No questions yet — type one below, or browse the answer types.</p> }
                          @if (!trying()) {
                            <div class="fb-add">
                              <span class="fb-add__row">
                                <input class="nd-input" [id]="'fb-add-' + section.key" [value]="addText()" autocomplete="off" placeholder="Add a question — type it the way you'd say it"
                                       [attr.aria-label]="'Add a question to ' + section.title + ': type it as a sentence'" [attr.aria-describedby]="'fb-add-pv-' + section.key"
                                       (input)="addText.set($any($event.target).value)" (keydown.enter)="addFromSentence(si)">
                                <button type="button" class="nd-btn nd-btn--secondary press" (click)="openTypes(false, null, si)">Browse answer types</button>
                              </span>
                              <span class="fb-add__pv" [id]="'fb-add-pv-' + section.key" aria-live="polite">
                                @if (parsed(); as p) {
                                  <b>{{ parsedType() }}</b><span>“{{ p.label }}”@if (p.choices.length) { · {{ p.choices.join(', ') }} }</span><span class="fb-add__enter">Enter to add</span>
                                } @else {
                                  <span class="fb-add__k">Try</span>
                                  @for (e of examples; track e) { <button type="button" class="nd-chip fb-ex press" (click)="addText.set(e); focusAdd(section.key)">{{ e }}</button> }
                                }
                              </span>
                            </div>
                          }
                        </div>
                      }
                      @if (!trying()) {
                        <button type="button" class="nd-btn nd-btn--secondary fb-add-section press" (click)="addSection()">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                          Add section</button>
                      }
                      <div class="fb-blk" aria-label="Diagnosis — built into every consult">
                        <div class="fb-sec__h"><h3>Diagnosis</h3><span class="fb-lock"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>Built into every consult</span></div>
                        <div class="fb-blk__in" aria-hidden="true"><span class="fb-blk__search">Type a diagnosis — e.g. sinusitis</span></div>
                      </div>
                    </div>
                    <div class="fb-next"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                      <span><b>{{ builtInNames }} come next</b> — built into every consult. They aren't questions on this form.</span></div>
                  </div>
                </div>
              }
            </div>
          </div>

          @if (!narrow() || sheetOpen()) {
            @if (narrow()) { <div class="oa-sheet-backdrop" (click)="sheetOpen.set(false)"></div> }
            <aside class="nd-card fb-side" [class.oa-side--sheet]="narrow()" aria-label="Question settings" [attr.role]="narrow() ? 'dialog' : null">
              <pf-opd-form-inspector [list]="list()" [selectedKey]="selected()" [mode]="inspectorMode()" [allowAddons]="doc().allowAddons !== false"
                                     (listChange)="setList($event)" (closed)="select(null)" (browse)="openTypes(false, null, doc().sections.length - 1)" (changeType)="openTypes(true, null)"
                                     (allowAddonsChange)="setAllowAddons($event)" (resetTry)="resetTry()" (stopTry)="setTry(false)"></pf-opd-form-inspector>
            </aside>
          }
        </div>
        }
      </div>
    </section>

    @if (gallery(); as g) {
      <pf-opd-form-gallery [kind]="g.kind" [starters]="starters()" [library]="activeLibrary()" [current]="currentType()"
                           [changing]="g.kind === 'types' && g.change ? (selectedQ()?.label ?? null) : null"
                           (picked)="pickStarter($event)" (type)="pickType($event)" (closed)="closeGallery()"></pf-opd-form-gallery>
    }
  `,
})
export class OpdFormBuilderPage {
  private readonly api = inject(OpdAdminApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly auth = inject(AuthService, { optional: true });
  protected readonly theme = inject(ThemeService);
  protected readonly plural = plural;

  readonly views: { value: View; label: string }[] = [{ value: 'doctor', label: "Doctor's screen" }, { value: 'phone', label: 'Phone' }, { value: 'print', label: 'Printed report' }];
  readonly examples = SENTENCE_EXAMPLES;
  readonly vitals = [{ k: 'BP', v: '128/82', u: 'mmHg' }, { k: 'Pulse', v: '84', u: '/min' }, { k: 'Temp', v: '99.1', u: '°F' }, { k: 'SpO₂', v: '98', u: '%' }, { k: 'BMI', v: '26.2', u: '' }];
  readonly builtInNames = BUILT_INS.filter((b) => b.key !== 'vitals' && b.key !== 'diagnosis').map((b) => b.title).join(', ');

  readonly formId = signal<string | null>(null);
  readonly isNew = computed(() => !this.formId());
  readonly detail = signal<OpdFormDetail | null>(null);
  readonly doc = signal<OpdFormDoc>(emptyDoc());
  /** Every question, form-wide, in section order — what the inspector counts
   *  and edits (attribute edits only; structural ops are section-scoped). */
  readonly list = computed(() => allQuestions(this.doc()));
  readonly name = signal('');
  readonly selected = signal<string | null>(null);
  readonly selectedQ = computed(() => this.list().find((q) => q.key === this.selected()) ?? null);
  readonly view = signal<View>('doctor');
  readonly fill = signal<Fill>('sample');
  readonly trying = signal(false);
  readonly tryAnswers = signal<OpdAnswers>({});
  readonly undo = signal<(DeleteUndo & { sectionIndex: number }) | null>(null);
  readonly saveState = signal<SaveState>('saved');
  readonly publishing = signal(false);
  readonly gallery = signal<Gallery>(null);
  readonly addText = signal('');
  readonly library = signal<OpdFormListRow[]>([]);
  readonly starters = signal<OpdStarter[]>([]);
  readonly narrow = signal(false);
  readonly sheetOpen = signal(false);
  readonly ready = computed(() => !!this.detail());
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<void> | null = null;
  private attachDept: string | null = null;

  readonly parsed = computed(() => parseQuestion(this.addText()));
  readonly parsedType = computed(() => { const p = this.parsed(); return p ? typeName(p) : ''; });
  readonly sample = computed(() => this.trying() || this.fill() === 'sample');
  readonly answers = computed<OpdAnswers>(() => (this.trying() ? this.tryAnswers() : this.fill() === 'sample' ? sampleAnswers(this.list()) : {}));
  readonly vstate = computed(() => {
    const d = this.detail();
    const pub = d?.published?.version ?? null;
    const draft = d?.draft?.version ?? (this.saveState() !== 'saved' ? (pub ?? 0) + 1 : null);
    return versionState({ published: pub, draft });
  });
  readonly canDiscard = computed(() => !!this.detail()?.published && (!!this.detail()?.draft || this.saveState() === 'dirty'));
  readonly usedBy = computed(() => (this.detail()?.usedBy ?? []).filter((u) => u.kind === 'service'));
  readonly activeLibrary = computed(() => this.library().filter((f) => f.isActive));
  readonly libraryOptions = computed<PfSelectOption<string>[]>(() => [
    ...this.activeLibrary().map((f) => ({ value: f.id, label: f.name, hint: `${f.publishedVersion ? 'v' + f.publishedVersion : 'new'} · ${plural(f.usedByServices, 'service')}` })),
    { value: '__new', label: '+ New form', hint: 'From a specialty starter' },
  ]);
  readonly inspectorMode = computed<InspectorMode>(() => (this.trying() ? 'try' : this.view() === 'print' ? 'print' : this.selectedQ() ? 'question' : 'form'));
  readonly inspectorTitle = computed(() => ({ try: 'Trying as a doctor', print: 'What prints', form: 'Form settings', question: 'Question settings' })[this.inspectorMode()]);
  readonly currentType = computed<OpdQType | 'lr' | null>(() => { const g = this.gallery(); const q = this.selectedQ(); return g?.kind === 'types' && g.change && q ? (q.sides ? 'lr' : q.type) : null; });
  readonly clinic = computed(() => this.auth?.user()?.tenantName || 'Your clinic');

  constructor() {
    const ref = inject(DestroyRef);
    this.narrow.set(mq('(max-width: 1023px)', ref, (m) => this.narrow.set(m)));
    ref.onDestroy(() => { if (this.timer) clearTimeout(this.timer); });
    this.api.starters().subscribe({ next: (s) => this.starters.set(s ?? []), error: () => undefined });
    this.api.forms().subscribe({ next: (f) => this.library.set(f ?? []), error: () => undefined });
    this.route.paramMap.subscribe((pm) => {
      const id = pm.get('id');
      this.attachDept = this.route.snapshot.queryParamMap.get('departmentId');
      this.reset();
      if (!id || id === 'new') { this.formId.set(null); this.gallery.set({ kind: 'starters' }); return; }
      this.formId.set(id);
      this.api.form(id).subscribe({ next: (d) => this.loadDetail(d), error: () => this.toasts.error('Could not load the form') });
    });
  }

  private reset(): void {
    this.detail.set(null); this.selected.set(null); this.trying.set(false); this.undo.set(null); this.saveState.set('saved'); this.addText.set('');
  }

  private loadDetail(d: OpdFormDetail): void {
    this.detail.set(d);
    this.name.set(d.name);
    const v = d.draft ?? d.published;
    this.doc.set(normalizeSchema(v?.schema ?? emptyDoc()));
    this.saveState.set('saved');
  }

  // ── Editing ──
  /** Attribute-only edits from the inspector: same length + order as `list()`
   *  (allQuestions(doc)) — redistributed back into each section untouched. */
  setList(list: OpdQuestion[]): void {
    this.doc.update((d) => withQuestions(d, list));
    this.markDirty();
  }
  setAllowAddons(on: boolean): void { this.doc.update((d) => ({ ...d, allowAddons: on })); this.markDirty(); }

  select(key: string | null): void {
    if (this.trying()) return;
    this.selected.set(key);
    if (this.narrow()) this.sheetOpen.set(!!key);
  }
  onEscape(): void { if (this.gallery()) return; if (this.selected()) this.select(null); }
  stageClick(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    if (!t.closest('.ofr-q, .fb-add, button, input, textarea')) this.select(null);
  }

  /** Which section a question key lives in (null if not found). */
  sectionIndexOf(key: string | null): number | null { return sectionIndexOfKey(this.doc(), key); }

  /** up / down / dup / req / del — scoped to the question's OWN section. */
  onAction(key: string, a: BuilderAction): void {
    const si = this.sectionIndexOf(key);
    if (si == null) return;
    const section = this.doc().sections[si];
    const r = applyAction(section.fields, key, a);
    this.doc.update((d) => replaceSectionFields(d, si, r.list));
    if (a === 'del' && r.undo) {
      this.undo.set({ ...r.undo, sectionIndex: si });
      this.toasts.info(`Deleted “${r.undo.q.label}” — past consults keep it`);
    } else {
      this.undo.set(null);
    }
    this.selected.set(r.selected);
    this.markDirty();
  }
  undoDelete(): void {
    const u = this.undo();
    if (!u) return;
    const section = this.doc().sections[u.sectionIndex];
    if (!section) return;
    this.doc.update((d) => replaceSectionFields(d, u.sectionIndex, undoDelete(section.fields, u)));
    this.selected.set(u.q.key);
    this.markDirty();
  }

  /** Types the shared "Add a question" box and adds it to section `si`
   *  (defaults to the first section — one section is the common case). */
  addFromSentence(si = 0): void {
    const p = this.parsed();
    const section = this.doc().sections[si];
    if (!p || !section) return;
    const q = fromParsed(p, keysOf(this.list()));
    this.doc.update((d) => replaceSectionFields(d, si, insertAt(section.fields, q, null)));
    this.addText.set('');
    if (!this.narrow()) this.selected.set(q.key);
    this.toasts.success(`Added “${q.label}” · ${typeName(q)}`);
    this.markDirty();
  }
  async insertHere(index: number, si = 0): Promise<void> {
    const text = await this.dialog.prompt({ title: 'Add a question here', message: "Type it the way you'd say it.", placeholder: 'e.g. Ear discharge? yes/no', required: true });
    const p = parseQuestion(text);
    const section = this.doc().sections[si];
    if (!p || !section) return;
    const q = fromParsed(p, keysOf(this.list()));
    this.doc.update((d) => replaceSectionFields(d, si, insertAt(section.fields, q, index)));
    this.selected.set(q.key);
    this.markDirty();
  }
  focusAdd(sectionKey = 'findings'): void { setTimeout(() => (document.getElementById('fb-add-' + sectionKey) as HTMLInputElement | null)?.focus(), 0); }

  openTypes(change: boolean, at: number | null, si?: number): void { this.gallery.set({ kind: 'types', change, at, si }); }
  pickType(t: OpdQType | 'lr'): void {
    const g = this.gallery();
    this.gallery.set(null);
    if (g?.kind !== 'types') return;
    const q = this.selectedQ();
    if (g.change && q) {
      const si = this.sectionIndexOf(q.key);
      if (si == null) return;
      const next = changeType(q, t);
      const section = this.doc().sections[si];
      this.doc.update((d) => replaceSectionFields(d, si, section.fields.map((x) => (x.key === q.key ? next : x))));
      this.toasts.info(`“${q.label}” is now ${typeName(next)}`);
      this.markDirty();
      return;
    }
    const si = g.si ?? 0;
    const section = this.doc().sections[si];
    if (!section) return;
    const nq = fromType(t, keysOf(this.list()));
    this.doc.update((d) => replaceSectionFields(d, si, insertAt(section.fields, nq, g.at)));
    if (!this.narrow()) this.selected.set(nq.key);
    this.markDirty();
  }

  // ── Sections ──
  sectionDoc(section: OpdFormDocSection): OpdFormDoc { return { schemaVersion: 2, allowAddons: this.doc().allowAddons, sections: [section] }; }
  renameSection(si: number, title: string): void { this.doc.update((d) => renameSectionOp(d, si, title)); this.markDirty(); }
  moveSection(si: number, dir: -1 | 1): void { this.doc.update((d) => moveSectionOp(d, si, dir)); this.markDirty(); }
  async addSection(): Promise<void> {
    const title = await this.dialog.prompt({ title: 'Add a section', message: 'What is this group of questions called?', placeholder: 'e.g. Examination', required: true });
    if (!title) return;
    this.doc.update((d) => addSectionOp(d, title));
    this.markDirty();
  }
  async removeSection(si: number): Promise<void> {
    const section = this.doc().sections[si];
    if (!section) return;
    if (this.doc().sections.length <= 1) { this.toasts.error('A form needs at least one section'); return; }
    const ok = await this.dialog.confirm({
      title: `Remove “${section.title}”?`,
      message: section.fields.length ? `${plural(section.fields.length, 'question')} in it are removed too — past consults keep their answers.` : 'This section has no questions.',
      confirmLabel: 'Remove section', tone: 'danger',
    });
    if (!ok) return;
    if (this.selected() && section.fields.some((q) => q.key === this.selected())) this.selected.set(null);
    this.doc.update((d) => removeSectionOp(d, si));
    this.markDirty();
  }
  closeGallery(): void {
    const g = this.gallery();
    this.gallery.set(null);
    if (g?.kind === 'starters' && this.isNew()) this.router.navigate(['/admin/opd/forms']);
  }

  // ── Views / try ──
  setView(v: View): void {
    this.view.set(v);
    if (v === 'print') this.trying.set(false);
    setTimeout(() => { const st = document.querySelector('.fb-stage'); if (st) st.scrollTop = 0; }, 0);
  }
  setFill(f: Fill): void { this.fill.set(f); if (this.trying()) this.resetTry(); }
  setTry(on: boolean): void {
    this.trying.set(on);
    this.selected.set(null);
    this.undo.set(null);
    if (on) { this.resetTry(); if (this.view() === 'print') this.view.set('doctor'); this.toasts.info("Trying the form as a doctor · answers aren't saved"); }
  }
  resetTry(): void { this.tryAnswers.set(this.fill() === 'sample' ? clone(sampleAnswers(this.list())) : {}); }
  fakeMedia(key: string, side?: 'r' | 'l'): void {
    const cur = this.tryAnswers();
    const add = (v: unknown): OpdMediaRef[] => { const a = Array.isArray(v) ? (v as OpdMediaRef[]) : []; return [...a, { name: `Image ${a.length + 1}`, kind: 'image' }]; };
    const next = side ? { ...((cur[key] ?? {}) as Record<string, unknown>), [side]: add((cur[key] as Record<string, unknown> | undefined)?.[side]) } : add(cur[key]);
    this.tryAnswers.set({ ...cur, [key]: next });
  }

  // ── Save / publish ──
  private markDirty(): void {
    this.saveState.set('dirty');
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), AUTOSAVE_MS);
  }

  /** Save the draft now (awaits an in-flight save first). */
  flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const id = this.formId();
    if (!id || this.saveState() === 'saved') return this.inflight ?? Promise.resolve();
    const run = async () => {
      if (this.inflight) await this.inflight;
      if (this.saveState() === 'saved') return;
      const sent = this.doc();
      this.saveState.set('saving');
      try {
        const d = await firstValueFrom(this.api.saveDraft(id, sent));
        this.detail.set(d);
        // Keep typing smooth: only mark saved when nothing changed meanwhile.
        this.saveState.set(this.doc() === sent ? 'saved' : 'dirty');
        if (this.doc() !== sent) this.markDirty();
      } catch (e) {
        this.saveState.set('error');
        this.toasts.error((e as Error).message || 'Could not save the draft');
      }
    };
    this.inflight = run().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  async publish(): Promise<void> {
    const id = this.formId();
    if (!id || this.publishing()) return;
    await this.flush();
    if (this.saveState() === 'error') return;
    const was = this.detail()?.published?.version ?? null;
    this.publishing.set(true);
    this.api.publish(id).subscribe({
      next: (d) => {
        this.publishing.set(false);
        this.loadDetail(d);
        const n = this.usedBy().length;
        this.toasts.success(`Published ${d.name} v${d.published?.version}${n ? ` · ${plural(n, 'service')} use it from the next consult` : ''}${was ? ` · past consults keep v${was}` : ''}`);
        this.api.forms().subscribe((f) => this.library.set(f ?? []));
      },
      error: (e: Error) => { this.publishing.set(false); this.toasts.error(e.message || 'Could not publish'); },
    });
  }

  async discardDraft(): Promise<void> {
    const id = this.formId();
    const pub = this.detail()?.published?.version;
    if (!id || !pub) return;
    const ok = await this.dialog.confirm({ title: 'Discard the draft?', message: `Your changes since v${pub} are thrown away. Doctors keep using v${pub}.`, confirmLabel: 'Discard draft', tone: 'danger' });
    if (!ok) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.inflight) await this.inflight;
    this.saveState.set('saved');
    this.api.discardDraft(id).subscribe({
      next: (d) => { this.loadDetail(d); this.selected.set(null); this.toasts.success(`Back to v${pub}`); },
      error: (e: Error) => this.toasts.error(e.message || 'Could not discard the draft'),
    });
  }

  rename(v: string): void {
    const id = this.formId();
    const n = String(v ?? '').trim();
    if (!id || !n || n === this.name()) return;
    this.api.updateForm(id, { name: n }).subscribe({
      next: (d) => { this.name.set(d.name); this.detail.update((x) => (x ? { ...x, name: d.name } : x)); },
      error: (e: Error) => { this.toasts.error(e.message || 'Could not rename the form'); this.name.set(this.detail()?.name ?? this.name()); },
    });
  }

  async switchForm(id: string): Promise<void> {
    if (!id || id === this.formId()) return;
    await this.flush();
    if (id === '__new') { this.router.navigate(['/admin/opd/forms', 'new']); return; }
    this.router.navigate(['/admin/opd/forms', id]);
  }

  openUse(u: { kind: string; id: string }): void {
    if (u.kind === 'service') this.router.navigate(['/admin/opd/services', u.id]);
    else this.router.navigate(['/admin/opd/departments']);
  }

  pickStarter(p: StarterPick): void {
    this.gallery.set(null);
    const body = p.kind === 'starter' ? { starterKey: p.key } : p.kind === 'copy' ? { copyFromFormId: p.formId } : { name: 'New form' };
    this.api.createForm(body).subscribe({
      next: (d) => {
        const how = p.kind === 'starter' ? 'from a specialty starter' : p.kind === 'copy' ? 'copied' : 'blank';
        this.toasts.success(`New form “${d.name}” · ${how} · draft until you publish`);
        this.attach(d.id).subscribe(() => this.router.navigate(['/admin/opd/forms', d.id], { replaceUrl: true }));
      },
      error: (e: Error) => { this.toasts.error(e.message || 'Could not create the form'); if (this.isNew()) this.gallery.set({ kind: 'starters' }); },
    });
  }

  /** New form opened from a department (OPD Master "+ New form"): attach it as the department's form. */
  private attach(formId: string): Observable<unknown> {
    const deptId = this.attachDept;
    if (!deptId) return of(null);
    return new Observable((sub) => {
      this.api.departments().subscribe({
        next: (ds) => {
          const d = ds.find((x) => x.id === deptId);
          if (!d) { sub.next(null); sub.complete(); return; }
          this.api.saveDepartments([{ id: d.id, name: d.name, code: d.code, description: d.description ?? null, defaultFormId: formId, sortOrder: d.sortOrder, isActive: d.isActive }])
            .subscribe({ next: () => { this.toasts.info(`${d.name} now uses the new form`); sub.next(null); sub.complete(); }, error: () => { sub.next(null); sub.complete(); } });
        },
        error: () => { sub.next(null); sub.complete(); },
      });
    });
  }

  /** For tests: every question in form order. */
  questions(): OpdQuestion[] { return allQuestions(this.doc()); }
}
