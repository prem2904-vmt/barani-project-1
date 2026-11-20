import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, computed, inject, signal, viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { ToastService } from '../../../core/services/toast.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { AuditFacets, AuditLog, AuditLogPage, AuditRef } from '../../../shared/models/audit.model';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { SkeletonRowsComponent } from '../../../shared/primitives/skeleton-kit.component';
import { PfDateComponent } from '../../../shared/components/pf-date/pf-date.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { spinDelay } from '../../../shared/utils/busy';
import { downloadCsv } from '../../../shared/utils/export-csv';
import { addDays, istDayRange, labDaysAgo, labToday } from '../../../shared/utils/lab-clock';
import {
  AUDIT_AREAS, AuditArea, AuditEvent, CSV_HEADER, areaDef, areaOf, csvRow, entityTypesOf, groupByDay, groupEvents,
} from './audit-text';

/** The "When" window. */
export type AuditRange = 'today' | '7d' | '30d' | 'custom';

export const AUDIT_PAGE_SIZE = 50;
/** Export streams the filtered rows in pages of 200, up to this many. */
export const AUDIT_EXPORT_CAP = 10_000;

/** The side card's filters — pure, so the query a choice sends is unit-tested. */
export interface AuditFilters {
  range: AuditRange;
  from: string;   // IST yyyy-MM-dd (custom)
  to: string;     // IST yyyy-MM-dd (custom, inclusive)
  area: AuditArea | '';
  userId: string;
  q: string;
}

/** The query string for a filter set (the server's `to` is exclusive, so the last IST day is included). */
export function auditQuery(f: AuditFilters, page: number, pageSize: number, today = labToday()): URLSearchParams {
  const p = new URLSearchParams();
  const from = f.range === 'today' ? today : f.range === '7d' ? addDays(today, -6) : f.range === '30d' ? addDays(today, -29) : f.from;
  const to = f.range === 'custom' ? (f.to || today) : today;
  if (from) { const r = istDayRange(from, to < from ? from : to); p.set('from', r.from); p.set('to', r.to); }
  if (f.area) p.set('entityTypes', entityTypesOf(f.area).join(','));
  if (f.userId) p.set('userId', f.userId);
  if (f.q.trim().length >= 2) p.set('q', f.q.trim());
  p.set('page', String(page));
  p.set('pageSize', String(pageSize));
  return p;
}

/** Facet rows folded into the side card's areas: area → count ('all' = the total). */
export function areaCounts(f: AuditFacets | null): Record<string, number> {
  const out: Record<string, number> = { all: f?.total ?? 0 };
  for (const a of AUDIT_AREAS) out[a.key] = 0;
  for (const t of f?.types ?? []) {
    const k = areaOf(t.entityType);
    out[k] = (out[k] ?? 0) + t.count;
  }
  return out;
}

const RANGE_LABEL: Record<AuditRange, string> = { today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days', custom: 'Custom dates' };

/**
 * Settings → Audit trail (owner-approved redesign, 2026-11-19). The two-panel
 * frame: the band (back, lab logo + name, the ONE search, Export), a SHOW side
 * card on the LEFT (When · What changed · Who) and the ACTIVITY card — a
 * timeline grouped by IST day that scrolls inside its card (no page scroll,
 * the next page loads as it nears the end). Every line is a human sentence from
 * the ONE mapping table (`audit-text.ts`); the rows one request wrote collapse
 * into one event; IDs never show (the server names them: `enrich=true` →
 * `refs`). Phones / narrow tablets: one card; the filters open as a sheet from
 * the filter icon inside the search.
 */
@Component({
  selector: 'pf-audit-log',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, ScreenHeaderComponent, HeroBandComponent, SelectComponent, SkeletonRowsComponent, PfDateComponent, BusyDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page pf-au px-4 md:px-8 pt-6 pb-4">
      @if (theme.isNewDesign()) {
        <pf-hero-band [back]="true" placeholder="Search a person, patient, order number or test…"
                      [value]="q()" (valueChange)="onSearch($event)" (submitted)="searchNow()">
          @if (narrow()) {
            <ng-container band-inline>
              <button type="button" class="pf-au__filterbtn press" (click)="sheetOpen.set(true)" aria-haspopup="dialog"
                      [attr.aria-expanded]="sheetOpen()" aria-label="Filters" data-testid="audit-filters-btn">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M6 12h12M10 18h4"/></svg>
                @if (activeFilterCount() > 0) { <span class="pf-au__filterdot" aria-hidden="true"></span> }
              </button>
            </ng-container>
          }
          <ng-container band-actions>
            <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" data-testid="audit-export" [disabled]="exporting()"
                    [pfBusy]="exporting()" pfBusyLabel="Preparing the CSV…" (click)="exportCsv()" aria-label="Export" title="Download these changes as CSV">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>
              <span class="pf-au__exportlbl">{{ exporting() ? 'Preparing…' : 'Export' }}</span>
            </button>
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only" eyebrow="Admin" title="Audit trail"
        subtitle="Every change to results, samples, patients, reports, billing and access — who did it and when. Append-only.">
      </pf-screen-header>

      <div class="pf-band-body pf-band-body--fill pf-au__body">
        <div class="pf-au__panels" [class.pf-au__panels--narrow]="narrow()">
          @if (narrow()) {
            @if (sheetOpen()) {
              <div class="pf-sheet-backdrop" (click)="sheetOpen.set(false)"></div>
              <aside class="pf-card pf-au__side pf-au__side--sheet" role="dialog" aria-modal="true" aria-label="Show"
                     (keydown.escape)="sheetOpen.set(false)" data-testid="audit-sheet">
                <span class="pf-sheet__handle" aria-hidden="true"></span>
                <ng-container *ngTemplateOutlet="sideHead; context: { sheet: true }"></ng-container>
                <ng-container *ngTemplateOutlet="sideBody"></ng-container>
              </aside>
            }
          } @else {
            <aside class="pf-card pf-au__side" aria-label="Show" data-testid="audit-side">
              <ng-container *ngTemplateOutlet="sideHead; context: { sheet: false }"></ng-container>
              <ng-container *ngTemplateOutlet="sideBody"></ng-container>
            </aside>
          }

          <section class="pf-card pf-au__main" aria-label="Activity" data-testid="audit-activity">
            <header class="pf-card__head">
              <span class="pf-card__icon" aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
              </span>
              <h2 class="pf-card__label">Activity</h2>
              <span class="pf-card__note pf-au__note pf-num" aria-live="polite" data-testid="audit-count">{{ countNote() }}</span>
            </header>
            <div class="pf-card__body pf-au__scroll" #scroller (scroll)="onScroll()" data-testid="audit-scroll">
              @if (listSkeleton()) {
                <pf-skeleton-rows class="pf-au__skel" [rows]="9" [avatar]="true" [trailing]="true" label="Loading the audit trail…"></pf-skeleton-rows>
              } @else if (days().length === 0 && !loading()) {
                <div class="pf-empty pf-empty--compact" data-testid="audit-empty">
                  <span class="pf-empty__icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
                  </span>
                  <p class="pf-empty__title">{{ q().trim() ? 'Nothing matches “' + q().trim() + '”' : 'No changes in this window' }}</p>
                  <p class="pf-empty__body">{{ q().trim() ? 'Try a name, an order or sample number, or a test.' : 'Pick a longer window or another area.' }}</p>
                </div>
              } @else {
                @for (d of days(); track d.day) {
                  <h3 class="pf-au__day" data-testid="audit-day">{{ d.label }}</h3>
                  <ul class="pf-au__list">
                    @for (e of d.events; track e.id) {
                      <li class="pf-au__ev" [class.is-open]="isOpen(e.id)" data-testid="audit-event">
                        <button type="button" class="pf-au__row" (click)="toggle(e.id)" [attr.aria-expanded]="isOpen(e.id)"
                                [attr.aria-controls]="'au-' + e.id">
                          <span class="pf-au__time pf-num">{{ e.time }}</span>
                          <span class="pf-au__avatar" aria-hidden="true">{{ e.initials }}</span>
                          <span class="pf-au__text">
                            <!-- Each word's leading space lives INSIDE its text node: Angular drops whitespace-only nodes between elements. -->
                            <b class="pf-au__who">{{ e.who }}</b>
                            <span class="pf-au__verb" [class.is-danger]="e.danger">{{ ' ' + e.verb }}</span>
                            @if (e.what) { <b class="pf-au__what">{{ ' ' + e.what }}</b> }
                            @if (e.rest) { <span class="pf-au__rest">{{ ' ' + e.rest }}</span> }
                          </span>
                          <span class="pf-chip pf-chip--static pf-au__chip" data-testid="audit-area">
                            <span class="pf-au__dot" [style.background]="dotOf(e.area)" aria-hidden="true"></span>{{ areaLabel(e.area) }}
                          </span>
                        </button>
                        @if (isOpen(e.id)) {
                          <div class="pf-au__detail" [id]="'au-' + e.id" data-testid="audit-detail">
                            @if (e.changes.length) {
                              <dl class="pf-au__changes">
                                @for (c of e.changes; track c.field) {
                                  <div class="pf-au__change" data-testid="audit-change">
                                    <dt>{{ c.label }}</dt>
                                    <dd>
                                      @if (c.from !== null) {
                                        <span class="pf-au__from">{{ c.from }}</span>
                                        <svg class="pf-au__arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
                                        <span class="sr-only">to</span>
                                      }
                                      <span class="pf-au__to">{{ c.to }}</span>
                                    </dd>
                                  </div>
                                }
                              </dl>
                            } @else {
                              <p class="pf-au__none">{{ e.rows[0].entityType === 'Auth' ? 'A sign-in or security event — there are no record fields to compare.' : 'Only technical details changed.' }}</p>
                            }
                            <div class="pf-au__links">
                              @if (e.link) { <a class="pf-au__link" [routerLink]="e.link.url" data-testid="audit-open">{{ e.link.label }}</a> }
                              @if (e.also) { <span class="pf-au__also" data-testid="audit-also">Also updated: {{ e.also }} (same moment)</span> }
                              <span class="pf-au__spacer"></span>
                              <button type="button" class="pf-au__tech" (click)="toggleTech(e.id)" [attr.aria-expanded]="techOpen() === e.id"
                                      data-testid="audit-tech">Technical details</button>
                            </div>
                            @if (techOpen() === e.id) {
                              <pre class="pf-au__raw" data-testid="audit-raw">{{ rawOf(e) }}</pre>
                            }
                          </div>
                        }
                      </li>
                    }
                  </ul>
                }
                <p class="pf-au__more" role="status" data-testid="audit-more">
                  @if (loadingMore()) { Loading older changes… }
                  @else if (hasMore()) { Scroll for older changes }
                  @else { That is everything in this window. }
                </p>
              }
            </div>
          </section>
        </div>
      </div>
    </section>

    <ng-template #sideHead let-sheet="sheet">
      <header class="pf-card__head">
        <span class="pf-card__icon" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M6 12h12M10 18h4"/></svg>
        </span>
        <h2 class="pf-card__label">Show</h2>
        <span class="pf-card__spacer"></span>
        @if (sheet) {
          <button type="button" class="pf-btn pf-btn--icon" (click)="sheetOpen.set(false)" aria-label="Close filters">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        }
      </header>
    </ng-template>

    <ng-template #sideBody>
      <div class="pf-card__body pf-au__filters">
        <div class="pf-field">
          <span class="pf-field__lbl" id="pf-au-when">When</span>
          <span class="pf-seg pf-au__seg" role="radiogroup" aria-labelledby="pf-au-when" data-testid="audit-when">
            @for (r of ranges; track r.value) {
              <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="range() === r.value" (click)="setRange(r.value)">{{ r.label }}</button>
            }
          </span>
          @if (range() === 'custom') {
            <div class="pf-au__dates">
              <label class="pf-au__dates-lbl" for="pf-au-from">From</label>
              <pf-date label="From" inputId="pf-au-from" [value]="from() || null" [max]="to() || today" (valueChange)="setFrom($event)"></pf-date>
              <label class="pf-au__dates-lbl" for="pf-au-to">To</label>
              <pf-date label="To" inputId="pf-au-to" [value]="to() || null" [min]="from() || null" [max]="today" (valueChange)="setTo($event)"></pf-date>
            </div>
          }
        </div>
        <div class="pf-field">
          <span class="pf-field__lbl" id="pf-au-what">What changed</span>
          <ul class="pf-side-list pf-au__areas" role="listbox" aria-labelledby="pf-au-what" data-testid="audit-areas">
            <li><button type="button" class="pf-side-item" role="option" [attr.aria-selected]="area() === ''" (click)="setArea('')" data-area="all">
              <span class="pf-au__dot" style="background: var(--text-tertiary)" aria-hidden="true"></span>
              <span class="pf-au__arealbl">Everything</span><span class="pf-au__n pf-num">{{ counts()['all'] }}</span>
            </button></li>
            @for (a of areas; track a.key) {
              <li><button type="button" class="pf-side-item" role="option" [attr.aria-selected]="area() === a.key" (click)="setArea(a.key)"
                          [attr.data-area]="a.key">
                <span class="pf-au__dot" [style.background]="a.dot" aria-hidden="true"></span>
                <span class="pf-au__arealbl">{{ a.label }}</span><span class="pf-au__n pf-num">{{ counts()[a.key] }}</span>
              </button></li>
            }
          </ul>
        </div>
        <div class="pf-field">
          <label class="pf-field__lbl" for="pf-au-who">Who</label>
          <pf-select id="pf-au-who" [options]="whoOptions()" [value]="userId()" [searchable]="true" placeholder="Everyone"
                     (valueChange)="setUser($event)" aria-label="Who" data-testid="audit-who"></pf-select>
        </div>
      </div>
    </ng-template>
  `,
  styles: [`
    :host { display: block; min-height: 0; height: 100%; }
    .pf-au__body { display: flex; flex-direction: column; min-height: 0; }
    .pf-au__panels { display: grid; grid-template-columns: var(--pf-side-w, 340px) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr);
      gap: 12px; align-items: stretch; flex: 1 1 auto; min-height: 0; }
    .pf-au__panels--narrow { grid-template-columns: minmax(0, 1fr); }
    .pf-au__side, .pf-au__main { min-height: 0; min-width: 0; }
    .pf-au__main { overflow: clip; }
    .pf-au__side--sheet {
      position: fixed; left: 0; right: 0; bottom: var(--pf-nav-h, 0px); z-index: 80; max-height: 82dvh;
      border-radius: 18px 18px 0 0; padding-bottom: env(safe-area-inset-bottom, 0px);
    }
    .pf-au__side--sheet .pf-sheet__handle { display: block; width: 40px; height: 4px; margin: 8px auto 0; border-radius: 999px; background: var(--pf-line); }
    .pf-au__filters { gap: 16px; }
    .pf-au__seg { display: flex; width: 100%; }
    .pf-au__seg .pf-seg__item { flex: 1 1 0; min-height: 36px; }
    .pf-au__dates { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 8px; align-items: center; margin-top: 8px; }
    .pf-au__dates-lbl { font-size: 12px; color: var(--text-tertiary); }
    .pf-au__areas { padding: 0; }
    .pf-au__arealbl { flex: 1 1 auto; min-width: 0; }
    .pf-au__n { font-size: 12px; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
    .pf-au__dot { width: 7px; height: 7px; border-radius: 999px; flex: none; display: inline-block; }
    .pf-au__note { color: var(--text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pf-au__scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 0 0 12px; display: block; }
    .pf-au__skel { display: block; padding: 12px 16px; }
    .pf-au__day { margin: 0; padding: 14px 18px 6px; font-size: 11.5px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-au__list { list-style: none; margin: 0; padding: 0; }
    .pf-au__ev { border-bottom: 1px solid var(--pf-line); }
    .pf-au__ev.is-open { background: var(--pf-chip-bg); }
    .pf-au__row {
      display: flex; align-items: flex-start; gap: 12px; width: 100%; min-height: 56px; padding: 12px 18px; border: 0; background: transparent;
      color: var(--text-primary); font: inherit; text-align: left; cursor: pointer;
    }
    .pf-au__row:hover { background: var(--pf-chip-bg); }
    .pf-au__row:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: -2px; }
    .pf-au__time { width: 64px; flex: none; padding-top: 6px; font-size: 12.5px; color: var(--text-tertiary); }
    .pf-au__avatar {
      width: 32px; height: 32px; flex: none; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center;
      background: var(--pf-sel-bg, var(--pf-chip-bg)); color: var(--violet-text); font-size: 12px; font-weight: 600;
    }
    .pf-au__text { flex: 1 1 auto; min-width: 0; font-size: 14px; line-height: 1.45; padding-top: 5px; overflow-wrap: anywhere; }
    .pf-au__who, .pf-au__what { font-weight: 600; }
    .pf-au__verb, .pf-au__rest { color: var(--text-secondary); }
    .pf-au__verb.is-danger { color: var(--rose-text); font-weight: 600; }
    .pf-au__chip { flex: none; height: 26px; gap: 6px; font-size: 12px; font-weight: 500; margin-top: 3px; white-space: nowrap; }
    .pf-au__detail { margin: 0 18px 12px 126px; padding: 10px 12px; border-radius: 10px; background: var(--pf-card-bg); border: 1px solid var(--pf-line); font-size: 13px; }
    .pf-au__changes { margin: 0; display: flex; flex-direction: column; gap: 6px; }
    .pf-au__change { display: grid; grid-template-columns: 140px minmax(0, 1fr); gap: 10px; align-items: baseline; }
    .pf-au__change dt { color: var(--text-tertiary); }
    .pf-au__change dd { margin: 0; display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: 6px; overflow-wrap: anywhere; }
    .pf-au__from { color: var(--text-tertiary); text-decoration: line-through; }
    .pf-au__arrow { color: var(--text-tertiary); align-self: center; }
    .pf-au__to { font-weight: 600; }
    .pf-au__none { margin: 0; color: var(--text-tertiary); }
    .pf-au__links { display: flex; flex-wrap: wrap; align-items: center; gap: 0 16px; padding-top: 4px; font-size: 12.5px; }
    .pf-au__link, .pf-au__tech { color: var(--violet-text); font: inherit; font-weight: 500; text-decoration: none; background: none; border: 0; padding: 0; cursor: pointer;
      min-height: 44px; display: inline-flex; align-items: center; }
    .pf-au__link:hover, .pf-au__tech:hover { text-decoration: underline; }
    .pf-au__tech { color: var(--text-tertiary); }
    .pf-au__also { color: var(--text-tertiary); }
    .pf-au__spacer { flex: 1 1 auto; }
    .pf-au__raw { margin: 6px 0 0; padding: 8px 10px; max-height: 260px; overflow: auto; border-radius: 8px; background: var(--pf-chip-bg);
      font-size: 11.5px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-secondary); }
    .pf-au__more { margin: 0; padding: 14px 18px; font-size: 12px; color: var(--text-tertiary); text-align: center; }
    .pf-au__filterbtn { position: relative; width: 44px; height: 44px; margin-right: -10px; border: 0; background: transparent; color: var(--text-secondary);
      display: inline-flex; align-items: center; justify-content: center; border-radius: 12px; cursor: pointer; }
    .pf-au__filterdot { position: absolute; top: 10px; right: 9px; width: 7px; height: 7px; border-radius: 999px; background: var(--color-violet-600, #7c3aed); }
    @media (pointer: coarse) { .pf-au__seg .pf-seg__item { min-height: 44px; } }
    @media (max-width: 640px) {
      .pf-au__row { flex-wrap: wrap; gap: 8px 10px; padding: 12px 14px; }
      .pf-au__time { width: auto; order: 3; padding-top: 0; margin-left: 42px; }
      .pf-au__text { flex-basis: calc(100% - 42px); padding-top: 4px; }
      .pf-au__chip { order: 4; margin-top: 0; }
      .pf-au__detail { margin: 0 14px 12px; }
      .pf-au__change { grid-template-columns: 1fr; gap: 2px; }
      .pf-au__exportlbl { display: none; }
      .pf-au__day { padding: 12px 14px 4px; }
    }
  `],
})
export class AuditLogComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly theme = inject(ThemeService);
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  readonly today = labToday();
  readonly areas = AUDIT_AREAS;
  readonly ranges: { value: AuditRange; label: string }[] = [
    { value: 'today', label: 'Today' }, { value: '7d', label: '7 days' }, { value: '30d', label: '30 days' }, { value: 'custom', label: 'Custom' },
  ];
  readonly narrow = signal(this.mq('(max-width: 900px)'));
  readonly sheetOpen = signal(false);

  // ── Filters ──
  readonly range = signal<AuditRange>('7d');
  readonly from = signal<string>(labDaysAgo(6));
  readonly to = signal<string>(labToday());
  readonly area = signal<AuditArea | ''>('');
  readonly userId = signal<string>('');
  readonly q = signal<string>('');
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  readonly filters = computed<AuditFilters>(() => ({
    range: this.range(), from: this.from(), to: this.to(), area: this.area(), userId: this.userId(), q: this.q(),
  }));
  readonly activeFilterCount = computed(() => (this.range() !== '7d' ? 1 : 0) + (this.area() ? 1 : 0) + (this.userId() ? 1 : 0));

  // ── Data ──
  private readonly logs = signal<AuditLog[]>([]);
  private readonly refs = signal<Record<string, AuditRef>>({});
  readonly total = signal(0);
  readonly facets = signal<AuditFacets | null>(null);
  private page = 1;
  private reqSeq = 0;
  readonly loading = signal(true);
  readonly loadingMore = signal(false);
  readonly exporting = signal(false);
  readonly listSkeleton = spinDelay(computed(() => this.loading() && this.logs().length === 0));
  readonly hasMore = computed(() => this.logs().length < this.total());

  readonly events = computed(() => groupEvents(this.logs(), this.refs()));
  readonly days = computed(() => groupByDay(this.events(), this.today));
  readonly counts = computed(() => areaCounts(this.facets()));
  readonly whoOptions = computed<PfSelectOption<string>[]>(() => [
    { value: '', label: 'Everyone' },
    ...(this.facets()?.users ?? []).map(u => ({ value: u.userId, label: u.name || 'Someone' })),
  ]);
  readonly countNote = computed(() => {
    const n = this.total();
    const when = this.range() === 'custom' ? 'Custom dates' : RANGE_LABEL[this.range()];
    return `${when} · ${n === 1 ? '1 change' : `${n.toLocaleString('en-IN')} changes`}`;
  });

  // ── Expand ──
  private readonly open = signal<ReadonlySet<string>>(new Set());
  readonly techOpen = signal<string | null>(null);
  isOpen(id: string): boolean { return this.open().has(id); }
  toggle(id: string) {
    this.open.update(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  toggleTech(id: string) { this.techOpen.update(cur => (cur === id ? null : id)); }
  /** Support view: the raw rows of the event, as stored. */
  rawOf(e: AuditEvent): string {
    return JSON.stringify(e.rows.map(r => {
      let changes: unknown = r.changes ?? null;
      try { changes = r.changes ? JSON.parse(r.changes) : null; } catch { /* free text */ }
      return { at: r.at, entityType: r.entityType, entityId: r.entityId, action: r.action, userId: r.userId ?? null, changes };
    }), null, 2);
  }

  dotOf(a: AuditArea) { return areaDef(a).dot; }
  areaLabel(a: AuditArea) { return areaDef(a).label; }

  ngOnInit(): void {
    if (typeof window !== 'undefined' && window.matchMedia) {
      const m = window.matchMedia('(max-width: 900px)');
      const on = (e: MediaQueryListEvent) => { this.narrow.set(e.matches); if (!e.matches) this.sheetOpen.set(false); };
      m.addEventListener?.('change', on);
      this.destroyRef.onDestroy(() => m.removeEventListener?.('change', on));
    }
    this.destroyRef.onDestroy(() => { if (this.searchTimer) clearTimeout(this.searchTimer); });
    this.reload();
  }

  private mq(q: string): boolean {
    return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(q).matches;
  }

  // ── Filter actions (each reloads at once) ──
  setRange(r: AuditRange) {
    this.range.set(r);
    if (r === 'custom') { if (!this.from()) this.from.set(labDaysAgo(6)); if (!this.to()) this.to.set(this.today); }
    this.reload();
  }
  setFrom(v: string | null) { this.from.set(v ?? ''); this.reload(); }
  setTo(v: string | null) { this.to.set(v ?? ''); this.reload(); }
  setArea(a: AuditArea | '') {
    this.area.set(a);
    if (this.narrow()) this.sheetOpen.set(false);
    this.reload(false);
  }
  setUser(id: string) { this.userId.set(id ?? ''); this.reload(false); }
  onSearch(v: string) {
    this.q.set(v ?? '');
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => { this.searchTimer = null; this.reload(); }, 350);
  }
  searchNow() {
    if (this.searchTimer) { clearTimeout(this.searchTimer); this.searchTimer = null; }
    this.reload();
  }

  /** Fresh first page (+ the side-card counts when the window / search changed). */
  reload(withFacets = true) {
    this.page = 1;
    this.open.set(new Set());
    this.techOpen.set(null);
    const seq = ++this.reqSeq;
    this.loading.set(true);
    const p = auditQuery(this.filters(), 1, AUDIT_PAGE_SIZE, this.today);
    p.set('enrich', 'true');
    this.api.get<AuditLogPage>(`/api/audit/logs?${p.toString()}`).subscribe({
      next: res => {
        if (seq !== this.reqSeq) return;
        this.logs.set(res?.items ?? []);
        this.refs.set(res?.refs ?? {});
        this.total.set(res?.total ?? 0);
        this.loading.set(false);
        const el = this.scroller()?.nativeElement;
        if (el) el.scrollTop = 0;
      },
      error: e => { if (seq !== this.reqSeq) return; this.loading.set(false); this.toast.error(ApiError.from(e).message); },
    });
    if (withFacets) this.loadFacets();
  }

  private loadFacets() {
    const f = auditQuery({ ...this.filters(), area: '', userId: '' }, 1, 1, this.today);
    const p = new URLSearchParams();
    for (const k of ['from', 'to', 'q']) { const v = f.get(k); if (v) p.set(k, v); }
    this.api.get<AuditFacets>(`/api/audit/facets?${p.toString()}`).subscribe({
      next: res => this.facets.set(res && Array.isArray(res.types) ? res : null),
      error: () => this.facets.set(null),
    });
  }

  /** Infinite scroll: the next page when the timeline nears its end. */
  onScroll() {
    const el = this.scroller()?.nativeElement;
    if (!el || this.loading() || this.loadingMore() || !this.hasMore()) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) this.loadMore();
  }

  loadMore() {
    if (this.loadingMore() || !this.hasMore()) return;
    const seq = this.reqSeq;
    this.loadingMore.set(true);
    const p = auditQuery(this.filters(), this.page + 1, AUDIT_PAGE_SIZE, this.today);
    p.set('enrich', 'true');
    this.api.get<AuditLogPage>(`/api/audit/logs?${p.toString()}`).subscribe({
      next: res => {
        this.loadingMore.set(false);
        if (seq !== this.reqSeq) return;
        this.page++;
        const seen = new Set(this.logs().map(l => l.id));
        this.logs.update(cur => [...cur, ...(res?.items ?? []).filter(l => !seen.has(l.id))]);
        this.refs.update(cur => ({ ...cur, ...(res?.refs ?? {}) }));
        this.total.set(res?.total ?? this.total());
      },
      error: e => { this.loadingMore.set(false); this.toast.error(ApiError.from(e).message); },
    });
  }

  /** Every filtered row as CSV: the human sentence + friendly changes, then the raw ids. */
  async exportCsv() {
    if (this.exporting()) return;
    this.exporting.set(true);
    try {
      const rows: string[][] = [CSV_HEADER];
      let page = 1, total = Infinity, fetched = 0;
      while (fetched < total && fetched < AUDIT_EXPORT_CAP) {
        const p = auditQuery(this.filters(), page, 200, this.today);
        p.set('enrich', 'true');
        const res = await firstValueFrom(this.api.get<AuditLogPage>(`/api/audit/logs?${p.toString()}`));
        const items = res?.items ?? [];
        total = res?.total ?? 0;
        for (const log of items) rows.push(csvRow(log, res?.refs ?? {}));
        fetched += items.length;
        if (items.length === 0) break;
        page++;
      }
      downloadCsv(`audit-trail-${this.today}.csv`, rows);
      if (total > AUDIT_EXPORT_CAP) this.toast.info(`Exported the latest ${AUDIT_EXPORT_CAP.toLocaleString('en-IN')} changes — narrow the window for the rest.`);
    } catch (e) {
      this.toast.error(ApiError.from(e).message);
    } finally {
      this.exporting.set(false);
    }
  }
}
